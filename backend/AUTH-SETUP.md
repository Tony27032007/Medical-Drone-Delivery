# Authentication setup

The authentication server uses SQLite, allowlisted email addresses, password
hashing with scrypt, mandatory authenticator-app TOTP, and persistent
server-side sessions scoped to the current browser tab. OAuth is not enabled.

## Requirements

Use Node.js 22.5 or later, which provides the built-in `node:sqlite` module.
Install the existing backend dependencies with `npm install --prefix backend`.

Set these environment variables in the shell before starting the server:

```sh
export AUTH_ALLOWED_EMAILS="operator@example.com,admin@example.com"
export AUTH_ENCRYPTION_KEY="$(openssl rand -hex 32)"
```

Generate the encryption key with `openssl rand -hex 32`. Keep it private and
back it up: enrolled TOTP secrets cannot be decrypted if this key is lost.
The SQLite database defaults to `backend/auth.sqlite`; set `AUTH_DB_PATH` to
override it. In production, set `NODE_ENV=production` and serve the app over
HTTPS so session cookies are marked Secure.

## Provision an account

Provisioning is restricted to addresses in `AUTH_ALLOWED_EMAILS`. The password
is entered without terminal echo:

```sh
node backend/scripts/provision-user.js operator@example.com
```

An allowlisted account must enroll an authenticator app on first sign-in. Scan
the displayed QR code (or enter its setup key manually), then submit the
generated six-digit code. Closing the tab requires signing in again when it is
reopened.
If an operator loses their authenticator, reset their enrollment and have them
sign in again:

```sh
node backend/scripts/reset-totp.js operator@example.com
```

## Run

From the repository root, start all three services together:

```sh
npm start
```

Open `http://localhost:3000` for the app. The Node.js web proxy forwards to the
authentication server on port 8080; the existing backend server runs on port
4000. Stop all three services with Ctrl+C. Override the defaults with
`WEB_PORT`, `AUTH_SERVER_PORT`, and `BACKEND_PORT`.
