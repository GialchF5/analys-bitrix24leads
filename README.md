# analys-bitrix24leads

## Краткое описание

Сервисная функция для регулярной загрузки лидов Bitrix24 в MySQL, чтобы данные можно было использовать в отчетах, аналитике и последующих интеграциях.

## Назначение

Загружает данные о лидах в MySQL

## Параметры функции

- ID функции: `d4edvs9mathipnhpetif`
- Каталог Yandex Cloud: `sl`
- Статус: `ACTIVE`
- Runtime: `nodejs18`
- Entry point: `index.handler`
- Версий в экспорте: `4`
- HTTP URL: `https://functions.yandexcloud.net/d4edvs9mathipnhpetif`

## Триггеры

- `sendleads` (`a1sfss0pbe0tla02capg`), статус: `PAUSED`, cron: `*/15 * ? * * *`

## Переменные окружения

Значения не хранятся в sanitized-экспорте. Реальные значения находятся только в raw/, эту папку нельзя коммитить в GitHub.

- `BITRIX_WEBHOOK` / `Webhook`
- `MYSQL_HOST` / `mysql_host`
- `MYSQL_PORT` / `mysql_port`
- `MYSQL_USER` / `mysql_user`
- `MYSQL_PASSWORD` / `mysql_password`
- `MYSQL_DB` / `mysql_db`
- `MYSQL_TABLE`
- `MYSQL_SSL_CA` / `MYSQL_SSL_CA_PEM` / `ca_pem`
- `MYSQL_SSL_CA_PATH`
- `MYSQL_SSL_REJECT_UNAUTHORIZED`
- `MYSQL_SSL`
- `DATE_FROM` / `START_DATE`
- `DATE_TO` / `END_DATE`
- `DATE_FILTER_FIELD`
- `MAX_RECORDS`
- `BATCH_SIZE`
- `API_DELAY_MS`

Пример .env:

```dotenv
BITRIX_WEBHOOK=<set-value>
MYSQL_HOST=<set-value>
MYSQL_PORT=3306
MYSQL_USER=<set-value>
MYSQL_PASSWORD=<set-value>
MYSQL_DB=<set-value>
MYSQL_TABLE=bitrix_leads
MYSQL_SSL_CA=<set-value>
MYSQL_SSL_CA_PATH=
MYSQL_SSL_REJECT_UNAUTHORIZED=true
DATE_FROM=2025-01-01T00:00:00+03:00
DATE_TO=2025-01-10T23:59:59+03:00
DATE_FILTER_FIELD=DATE_CREATE
MAX_RECORDS=15000
BATCH_SIZE=50
API_DELAY_MS=1000
```

## Локальный запуск

```powershell
cd .\yc-export-author-gilach\sanitized\functions\analys-bitrix24leads
# Положи исходники функции в эту папку: index.js, package.json и остальные файлы.
# Создай .env по примеру выше и event.json с тестовым событием.
npm install
node -e "require('dotenv').config(); const event=require('./event.json'); const mod=require('./index'); Promise.resolve(mod.handler(event, {})).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e);process.exit(1)})"
```

Если проект использует ESM (`"type": "module"` в `package.json`), замени команду запуска на динамический `import()`.

Минимальный event.json для ручной проверки:

```json
{}
```

## Деплой новой версии

Перед деплоем проверь, что в папке лежат исходники функции и файл с зависимостями (`package.json` для Node.js или `requirements.txt` для Python).

```powershell
yc serverless function version create --function-id d4edvs9mathipnhpetif --runtime nodejs18 --entrypoint index.handler --source-path . --execution-timeout 60s
```

Если функции нужны переменные окружения, передавай их через `--environment` или настрой через консоль/секреты. Не коммить реальные токены, пароли, webhook URL и сертификаты в GitHub.

## Файлы экспорта

- `function.json` - описание функции.
- `versions.json` - версии функции с замаскированными значениями переменных окружения.
