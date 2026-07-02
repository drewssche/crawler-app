# Beta deploy через DuckDNS

Цель: поднять beta на своём сервере так, чтобы root-admin мог войти без SMTP, а тестерам можно было выдать временный пароль вручную.

## 1. Что нужно подготовить руками

1. DuckDNS domain, например:

   ```text
   crawler-app.duckdns.org
   ```

2. A-запись DuckDNS должна указывать на публичный IP сервера.

3. На сервере должны быть открыты порты:

   ```text
   80/tcp
   443/tcp
   ```

   Если на сервере используется `ufw`:

   ```bash
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw status
   ```

   Если используется `firewalld`:

   ```bash
   sudo firewall-cmd --permanent --add-service=http
   sudo firewall-cmd --permanent --add-service=https
   sudo firewall-cmd --reload
   sudo firewall-cmd --list-services
   ```

   Если firewall управляется панелью провайдера, открыть `80/tcp` и `443/tcp` нужно в панели. Команды внутри сервера в этом случае могут быть недостаточны.

   На текущем VPS nginx уже владеет `80/443`. Crawler App поднимается как upstream:

   ```env
   FRONTEND_BIND=127.0.0.1:8002
   BACKEND_BIND=127.0.0.1:8003
   ```

4. На сервере должны быть установлены:

   ```bash
   docker
   docker compose
   git
   ```

5. Нужно знать email root-admin.

## 2. Подготовить `.env.beta`

На сервере в корне проекта:

```bash
cp .env.beta.example .env.beta
nano .env.beta
```

Обязательно заменить:

```env
BETA_DOMAIN=crawler-app.duckdns.org
PUBLIC_APP_URL=https://crawler-app.duckdns.org
POSTGRES_PASSWORD=...
DATABASE_URL=postgresql://crawler:ТОТ_ЖЕ_ПАРОЛЬ@postgres:5432/crawler_db
SECRET_KEY=...
ADMIN_EMAILS=your@email.com
EMERGENCY_ROOT_ADMIN_EMAIL=backup@email.com
ADMIN_PASSWORD=...
```

Для beta без SMTP оставить:

```env
AUTH_ADMIN_PASSWORD_LOGIN_ENABLED=true
AUTH_PASSWORD_LOGIN_ENABLED=true
AUTH_DEV_SHOW_CODE=false
VITE_ADMIN_PASSWORD_LOGIN_ENABLED=true
VITE_PASSWORD_LOGIN_ENABLED=true
```

## 3. Запуск

```bash
docker compose -f docker-compose.beta.yml --env-file .env.beta up -d --build
```

Проверить контейнеры:

```bash
docker compose -f docker-compose.beta.yml --env-file .env.beta ps
```

Логи backend:

```bash
docker compose -f docker-compose.beta.yml --env-file .env.beta logs -f backend
```

## 4. Первый вход root-admin

1. Открыть:

   ```text
   https://crawler-app.duckdns.org/login
   ```

2. Выбрать вкладку `Вход`.
3. Ввести email из `ADMIN_EMAILS`.
4. Включить `Войти как root-admin по паролю из env`.
5. Ввести `ADMIN_PASSWORD`.

## 5. Выдать доступ тестеру без SMTP

1. Тестер открывает login и делает `Запрос доступа`.
2. Root-admin открывает `Пользователи`.
3. Подтверждает пользователя и назначает роль.
4. Открывает карточку пользователя.
5. В блоке `Временный пароль` нажимает `Сгенерировать`.
6. Передаёт пароль тестеру вручную.
7. Тестер на login включает `Войти по временному паролю`.

## 6. Invite-ссылки

Invite-ссылки уже можно создавать в `Пользователи`. Без SMTP ссылку нужно копировать и отправлять вручную.

Важно: текущий invite-flow всё равно подтверждает вход кодом. Пока SMTP не настроен, для тестеров проще использовать временный пароль из карточки пользователя.

## 7. Поисковые роботы

В beta включены:

- `robots.txt` с `Disallow: /`;
- meta `noindex,nofollow,noarchive`;
- Caddy header `X-Robots-Tag: noindex, nofollow, noarchive`.

Это не авторизация, но снижает вероятность индексации и лишних обходов.

## 8. Обновление после новых коммитов

```bash
git pull
docker compose -f docker-compose.beta.yml --env-file .env.beta up -d --build
```

Миграции применяются автоматически при старте backend.
