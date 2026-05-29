const axios = require('axios');
const mysql = require('mysql2/promise');
const fs = require('fs');

function getEnv(name, fallback = undefined) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return value;
}

function getRequiredEnv(...names) {
  for (const name of names) {
    const value = getEnv(name);
    if (value !== undefined) return value;
  }
  throw new Error(`Не задана переменная окружения: ${names.join(' или ')}`);
}

function getIntEnv(name, fallback) {
  const raw = getEnv(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Переменная окружения ${name} должна быть числом`);
  }
  return parsed;
}

function getBooleanEnv(name, fallback = false) {
  const raw = getEnv(name);
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'y'].includes(String(raw).toLowerCase());
}

const BITRIX_WEBHOOK = getRequiredEnv('BITRIX_WEBHOOK', 'Webhook').replace(/\/$/, '');
const TABLE_NAME = getEnv('MYSQL_TABLE', 'bitrix_leads');
const MAX_RECORDS = getIntEnv('MAX_RECORDS', 15000);
const BATCH_SIZE = getIntEnv('BATCH_SIZE', 50);
const API_DELAY = getIntEnv('API_DELAY_MS', 1000);
const DATE_FROM = getRequiredEnv('DATE_FROM', 'START_DATE');
const DATE_TO = getRequiredEnv('DATE_TO', 'END_DATE');
const DATE_FILTER_FIELD = getEnv('DATE_FILTER_FIELD', 'DATE_CREATE');

function quoteIdentifier(identifier) {
  if (!/^[a-zA-Z0-9_]+$/.test(identifier)) {
    throw new Error(`Некорректное имя SQL-идентификатора: ${identifier}`);
  }
  return `\`${identifier}\``;
}

function buildMysqlConfig() {
  const config = {
    host: getRequiredEnv('MYSQL_HOST', 'mysql_host'),
    port: getIntEnv('MYSQL_PORT', Number.parseInt(getEnv('mysql_port', '3306'), 10)),
    user: getRequiredEnv('MYSQL_USER', 'mysql_user'),
    password: getRequiredEnv('MYSQL_PASSWORD', 'mysql_password'),
    database: getRequiredEnv('MYSQL_DB', 'mysql_db'),
  };

  const caFromEnv = getEnv('MYSQL_SSL_CA') || getEnv('MYSQL_SSL_CA_PEM') || getEnv('ca_pem');
  const caPath = getEnv('MYSQL_SSL_CA_PATH');
  const rejectUnauthorized = getBooleanEnv('MYSQL_SSL_REJECT_UNAUTHORIZED', true);

  if (caFromEnv || caPath) {
    config.ssl = {
      rejectUnauthorized,
      ca: caFromEnv || fs.readFileSync(caPath, 'utf8'),
    };
  } else if (getBooleanEnv('MYSQL_SSL', false)) {
    config.ssl = { rejectUnauthorized };
  }

  return config;
}

async function createTableIfNotExists(connection) {
  const table = quoteIdentifier(TABLE_NAME);

  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS ${table} (
        id VARCHAR(255) PRIMARY KEY,
        title VARCHAR(255),
        status_id VARCHAR(255),
        comments TEXT,
        assigned_by_id VARCHAR(255),
        created_by_id VARCHAR(255),
        date_create DATETIME,
        date_assigned DATETIME,
        phone VARCHAR(20),
        direction VARCHAR(255),
        source_id VARCHAR(255),
        domain VARCHAR(255),
        businessmen_stat VARCHAR(255),
        INDEX (date_create),
        INDEX (phone)
      )
    `);
    console.log(`Таблица ${TABLE_NAME} проверена/создана`);
  } catch (error) {
    console.error('Ошибка при создании таблицы:', error.message);
    throw error;
  }
}

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');

  if (digits.length === 11) {
    if (digits.startsWith('8')) return `7${digits.slice(1)}`;
    if (digits.startsWith('7')) return digits;
  }

  if (digits.length === 10) return `7${digits}`;
  return null;
}

async function getFieldReferences() {
  const references = {
    STATUS_ID: {},
    SOURCE_ID: {},
    UF_CRM_1650896347: {},
    UF_CRM_1666190537: {},
    ASSIGNED_BY_ID: { 0: 'Не назначен' },
    CREATED_BY_ID: { 0: 'Система' },
  };

  try {
    const statusTypes = ['SOURCE', 'STATUS'];
    for (const type of statusTypes) {
      const response = await axios.get(`${BITRIX_WEBHOOK}/crm.status.list`, {
        params: { 'filter[ENTITY_ID]': type },
      });

      if (response.data.result) {
        references[`${type}_ID`] = response.data.result.reduce((acc, item) => {
          acc[item.STATUS_ID] = item.NAME;
          return acc;
        }, {});
      }
    }

    const fieldsResponse = await axios.get(`${BITRIX_WEBHOOK}/crm.lead.fields`);
    if (fieldsResponse.data.result) {
      ['UF_CRM_1650896347', 'UF_CRM_1666190537'].forEach((field) => {
        if (fieldsResponse.data.result[field]?.items) {
          references[field] = fieldsResponse.data.result[field].items.reduce((acc, item) => {
            acc[item.ID] = item.VALUE;
            return acc;
          }, {});
        }
      });
    }

    let userStart = 0;
    while (true) {
      const usersResponse = await axios.get(`${BITRIX_WEBHOOK}/user.get`, {
        params: {
          start: userStart,
          filter: { ACTIVE: true },
        },
      });

      if (!usersResponse.data.result || usersResponse.data.result.length === 0) break;

      usersResponse.data.result.forEach((user) => {
        const userName = user.NAME ? `${user.NAME} ${user.LAST_NAME || ''}`.trim() : `ID:${user.ID}`;
        references.ASSIGNED_BY_ID[user.ID] = userName;
        references.CREATED_BY_ID[user.ID] = userName;
      });

      if (usersResponse.data.result.length < 50) break;
      userStart += 50;
    }

    console.log('Справочные данные загружены');
    return references;
  } catch (error) {
    console.error('Ошибка загрузки справочников:', error.message);
    return references;
  }
}

function replaceIdsWithText(data, references) {
  return data.map((item) => {
    const newItem = { ...item };

    newItem.ASSIGNED_BY_ID = item.ASSIGNED_BY_ID
      ? references.ASSIGNED_BY_ID[item.ASSIGNED_BY_ID] || `ID:${item.ASSIGNED_BY_ID}`
      : 'Не назначен';

    newItem.CREATED_BY_ID = item.CREATED_BY_ID
      ? references.CREATED_BY_ID[item.CREATED_BY_ID] || `ID:${item.CREATED_BY_ID}`
      : 'Система';

    if (item.STATUS_ID && references.STATUS_ID[item.STATUS_ID]) {
      newItem.STATUS_ID = references.STATUS_ID[item.STATUS_ID];
    }

    if (item.SOURCE_ID && references.SOURCE_ID[item.SOURCE_ID]) {
      newItem.SOURCE_ID = references.SOURCE_ID[item.SOURCE_ID];
    }

    if (item.UF_CRM_1650896347 && references.UF_CRM_1650896347[item.UF_CRM_1650896347]) {
      newItem.UF_CRM_1650896347 = references.UF_CRM_1650896347[item.UF_CRM_1650896347];
    }

    if (item.UF_CRM_1666190537 && references.UF_CRM_1666190537[item.UF_CRM_1666190537]) {
      newItem.UF_CRM_1666190537 = references.UF_CRM_1666190537[item.UF_CRM_1666190537];
    }

    if (item.PHONE && item.PHONE[0]) {
      newItem.normalizedPhone = normalizePhone(item.PHONE[0].VALUE);
    }

    return newItem;
  });
}

async function getBitrixData(startDate, endDate) {
  let allData = [];
  let start = 0;

  while (allData.length < MAX_RECORDS) {
    try {
      const response = await axios.get(`${BITRIX_WEBHOOK}/crm.lead.list`, {
        params: {
          [`filter[>=${DATE_FILTER_FIELD}]`]: startDate,
          [`filter[<=${DATE_FILTER_FIELD}]`]: endDate,
          'select[]': [
            'ID',
            'TITLE',
            'STATUS_ID',
            'COMMENTS',
            'ASSIGNED_BY_ID',
            'CREATED_BY_ID',
            'DATE_CREATE',
            'UF_CRM_1655927709',
            'PHONE',
            'UF_CRM_1650896347',
            'SOURCE_ID',
            'UF_CRM_1650794493',
            'UF_CRM_1697036481',
          ],
          start,
          order: { ID: 'ASC' },
        },
      });

      const data = response.data.result || [];
      if (data.length === 0) break;

      allData = allData.concat(data);
      start += BATCH_SIZE;

      if (data.length < BATCH_SIZE) break;
      await new Promise((resolve) => setTimeout(resolve, API_DELAY));
    } catch (error) {
      console.error('Ошибка загрузки данных:', error.message);
      break;
    }
  }

  return allData;
}

async function insertData(connection, data) {
  const table = quoteIdentifier(TABLE_NAME);
  const values = data.map((item) => [
    item.ID,
    item.TITLE,
    item.STATUS_ID,
    item.COMMENTS,
    item.ASSIGNED_BY_ID,
    item.CREATED_BY_ID,
    item.DATE_CREATE,
    item.UF_CRM_1655927709 ? new Date(item.UF_CRM_1655927709) : null,
    item.normalizedPhone,
    item.UF_CRM_1650896347,
    item.SOURCE_ID,
    item.UF_CRM_1650794493,
    item.UF_CRM_1697036481,
  ]);

  try {
    const [result] = await connection.query(
      `INSERT IGNORE INTO ${table} (
        id, title, status_id, comments, assigned_by_id, created_by_id, date_create, date_assigned, phone, direction, source_id, domain, businessmen_stat
      ) VALUES ?`,
      [values],
    );

    return result.affectedRows;
  } catch (error) {
    console.error('Ошибка пакетной вставки:', error.message);
    return 0;
  }
}

exports.handler = async () => {
  const mysqlConfig = buildMysqlConfig();
  const startDate = DATE_FROM;
  const endDate = DATE_TO;
  const mysqlDate = startDate.split('T')[0];

  try {
    console.log('=== НАЧАЛО РАБОТЫ ===');
    console.log(`Период: ${startDate} - ${endDate}`);

    const references = await getFieldReferences();
    const connection = await mysql.createConnection(mysqlConfig);

    await createTableIfNotExists(connection);

    const table = quoteIdentifier(TABLE_NAME);
    const [existingRows] = await connection.query(
      `SELECT id FROM ${table} WHERE DATE(date_create) = ?`,
      [mysqlDate],
    );
    const existingIds = new Set(existingRows.map((row) => row.id.toString()));

    const bitrixData = await getBitrixData(startDate, endDate);
    console.log(`Получено записей из Bitrix24: ${bitrixData.length}`);

    const newData = bitrixData.filter((item) => !existingIds.has(item.ID.toString()));
    const enrichedData = replaceIdsWithText(newData, references);
    console.log(`Новых записей для вставки: ${enrichedData.length}`);

    let totalInserted = 0;
    if (enrichedData.length > 0) {
      totalInserted = await insertData(connection, enrichedData);
      console.log(`Успешно вставлено записей: ${totalInserted}`);
    }

    await connection.end();

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Обработка завершена',
        stats: {
          totalInBitrix: bitrixData.length,
          existingInMySQL: existingRows.length,
          newRecordsFound: newData.length,
          inserted: totalInserted,
          period: `${startDate} - ${endDate}`,
          table: TABLE_NAME,
        },
      }),
    };
  } catch (error) {
    console.error('ОШИБКА:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message,
        period: `${startDate} - ${endDate}`,
        table: TABLE_NAME,
      }),
    };
  }
};
