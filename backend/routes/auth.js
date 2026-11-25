import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = "mdd_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const TOTP_PERIOD_SECONDS = 30;
const TOTP_WINDOW = 1;
const PASSWORD_HASH_BYTES = 64;
const PASSWORD_SALT_BYTES = 16;
const MAX_BODY_BYTES = 8192;
const ALLOWED_EMAILS = new Set(
    (process.env.AUTH_ALLOWED_EMAILS ?? "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
);
const ENCRYPTION_KEY = process.env.AUTH_ENCRYPTION_KEY;
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

if (ALLOWED_EMAILS.size === 0) {
    throw new Error("AUTH_ALLOWED_EMAILS must contain at least one email address.");
}

if (!ENCRYPTION_KEY || !/^[a-f\d]{64}$/i.test(ENCRYPTION_KEY)) {
    throw new Error("AUTH_ENCRYPTION_KEY must be a 32-byte key encoded as 64 hex characters.");
}

const encryptionKey = Buffer.from(ENCRYPTION_KEY, "hex");
const databasePath = process.env.AUTH_DB_PATH
    ? path.resolve(process.env.AUTH_DB_PATH)
    : path.resolve(moduleDirectory, "../auth.sqlite");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const database = new DatabaseSync(databasePath);
database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
        email TEXT PRIMARY KEY,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        totp_secret TEXT,
        pending_totp_secret TEXT,
        pending_totp_expires_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_tabs (
        token_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
        tab_hash TEXT NOT NULL,
        PRIMARY KEY (token_hash, tab_hash)
    );
    CREATE INDEX IF NOT EXISTS sessions_expires_at_idx
        ON sessions(expires_at);
`);

const findUser = database.prepare("SELECT * FROM users WHERE email = ?");
const savePendingTotp = database.prepare(`
    UPDATE users
    SET pending_totp_secret = ?, pending_totp_expires_at = ?
    WHERE email = ?
`);
const enableTotp = database.prepare(`
    UPDATE users
    SET totp_secret = ?, pending_totp_secret = NULL, pending_totp_expires_at = NULL
    WHERE email = ?
`);
const insertSession = database.prepare(`
    INSERT INTO sessions (token_hash, email, expires_at) VALUES (?, ?, ?)
`);
const insertSessionTab = database.prepare(`
    INSERT OR IGNORE INTO session_tabs (token_hash, tab_hash) VALUES (?, ?)
`);
const findSessionTab = database.prepare(`
    SELECT 1 FROM session_tabs WHERE token_hash = ? AND tab_hash = ?
`);
const findSession = database.prepare(`
    SELECT token_hash, email, expires_at FROM sessions
    WHERE token_hash = ? AND expires_at > ?
`);
const deleteSession = database.prepare(
    "DELETE FROM sessions WHERE token_hash = ?",
);
const deleteExpiredSessions = database.prepare(
    "DELETE FROM sessions WHERE expires_at <= ?",
);

function normalizeEmail(email) {
    return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function isAllowedEmail(email) {
    return ALLOWED_EMAILS.has(normalizeEmail(email));
}

async function hashPassword(password, salt) {
    return scrypt(password, salt, PASSWORD_HASH_BYTES, {
        N: 16384,
        r: 8,
        p: 1,
        maxmem: 64 * 1024 * 1024,
    });
}

export async function createOrUpdateUser(email, password) {
    const normalizedEmail = normalizeEmail(email);
    if (!isAllowedEmail(normalizedEmail)) {
        throw new Error("The email address is not included in AUTH_ALLOWED_EMAILS.");
    }
    if (typeof password !== "string" || password.length < 12) {
        throw new Error("Passwords must be at least 12 characters long.");
    }

    const salt = crypto.randomBytes(PASSWORD_SALT_BYTES);
    const passwordHash = await hashPassword(password, salt);
    database.prepare(`
        INSERT INTO users (email, password_salt, password_hash)
        VALUES (?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET
            password_salt = excluded.password_salt,
            password_hash = excluded.password_hash,
            pending_totp_secret = NULL,
            pending_totp_expires_at = NULL
    `).run(
        normalizedEmail,
        salt.toString("base64"),
        passwordHash.toString("base64"),
    );
    database.prepare("DELETE FROM sessions WHERE email = ?").run(
        normalizedEmail,
    );
}

export function resetUserTotp(email) {
    const normalizedEmail = normalizeEmail(email);
    if (!isAllowedEmail(normalizedEmail)) {
        throw new Error("The email address is not included in AUTH_ALLOWED_EMAILS.");
    }
    const result = database.prepare(`
        UPDATE users
        SET totp_secret = NULL, pending_totp_secret = NULL, pending_totp_expires_at = NULL
        WHERE email = ?
    `).run(normalizedEmail);
    if (result.changes === 0) {
        throw new Error("No provisioned account exists for that email address.");
    }
    database.prepare("DELETE FROM sessions WHERE email = ?").run(
        normalizedEmail,
    );
}

function encryptSecret(secret) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
    const ciphertext = Buffer.concat([
        cipher.update(secret, "utf8"),
        cipher.final(),
    ]);
    return [
        iv.toString("base64"),
        cipher.getAuthTag().toString("base64"),
        ciphertext.toString("base64"),
    ].join(".");
}

function decryptSecret(value) {
    const [iv, authTag, ciphertext] = value.split(".").map((part) =>
        Buffer.from(part, "base64"),
    );
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
    ]).toString("utf8");
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function encodeBase32(buffer) {
    let bits = 0;
    let value = 0;
    let output = "";
    for (const byte of buffer) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) {
        output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    }
    return output;
}

function decodeBase32(value) {
    let bits = 0;
    let buffer = 0;
    const bytes = [];
    for (const character of value.toUpperCase().replace(/=+$/, "")) {
        const index = BASE32_ALPHABET.indexOf(character);
        if (index < 0) throw new Error("Invalid TOTP secret.");
        buffer = (buffer << 5) | index;
        bits += 5;
        if (bits >= 8) {
            bytes.push((buffer >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(bytes);
}

function getTotp(secret, timestamp = Date.now()) {
    const counter = Math.floor(timestamp / 1000 / TOTP_PERIOD_SECONDS);
    const message = Buffer.alloc(8);
    message.writeBigUInt64BE(BigInt(counter));
    const digest = crypto
        .createHmac("sha1", decodeBase32(secret))
        .update(message)
        .digest();
    const offset = digest[digest.length - 1] & 15;
    const code =
        (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
    return String(code).padStart(6, "0");
}

function verifyTotp(secret, code, timestamp = Date.now()) {
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) return false;
    for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset += 1) {
        const expected = getTotp(
            secret,
            timestamp + offset * TOTP_PERIOD_SECONDS * 1000,
        );
        if (crypto.timingSafeEqual(Buffer.from(code), Buffer.from(expected))) {
            return true;
        }
    }
    return false;
}

function parseCookies(req) {
    const cookies = new Map();
    for (const part of (req.headers.cookie ?? "").split(";")) {
        const separator = part.indexOf("=");
        if (separator > 0) {
            cookies.set(
                part.slice(0, separator).trim(),
                part.slice(separator + 1).trim(),
            );
        }
    }
    return cookies;
}

function sessionTokenHash(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

function isSecureRequest(req) {
    return (
        process.env.NODE_ENV === "production" ||
        req.socket.encrypted === true
    );
}

function setSessionCookie(res, token, req) {
    const attributes = [
        `${SESSION_COOKIE}=${token}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Strict",
        `Max-Age=${SESSION_TTL_MS / 1000}`,
    ];
    if (isSecureRequest(req)) attributes.push("Secure");
    res.setHeader("Set-Cookie", attributes.join("; "));
}

function clearSessionCookie(res, req) {
    const attributes = [
        `${SESSION_COOKIE}=`,
        "Path=/",
        "HttpOnly",
        "SameSite=Strict",
        "Max-Age=0",
    ];
    if (isSecureRequest(req)) attributes.push("Secure");
    res.setHeader("Set-Cookie", attributes.join("; "));
}

export function getAuthenticatedUser(req) {
    const token = parseCookies(req).get(SESSION_COOKIE);
    if (!token || !/^[a-f\d]{64}$/i.test(token)) return null;
    const session = findSession.get(sessionTokenHash(token), Date.now());
    if (!session || !isAllowedEmail(session.email)) return null;
    return { email: session.email };
}

function getTabSessionId(req) {
    const header = req.headers["x-tab-session"];
    if (typeof header === "string" && /^[a-f\d]{64}$/i.test(header)) {
        return header;
    }

    try {
        const requestUrl = new URL(
            req.url,
            `http://${req.headers.host ?? "localhost"}`,
        );
        const queryValue = requestUrl.searchParams.get("tab");
        return queryValue && /^[a-f\d]{64}$/i.test(queryValue)
            ? queryValue
            : null;
    } catch {
        return null;
    }
}

export function getAuthenticatedTabUser(req) {
    const user = getAuthenticatedUser(req);
    const tabSessionId = getTabSessionId(req);
    if (!user || !tabSessionId) return null;

    const token = parseCookies(req).get(SESSION_COOKIE);
    const tokenHash = sessionTokenHash(token);
    const tabHash = crypto.createHash("sha256").update(tabSessionId).digest("hex");
    if (!findSessionTab.get(tokenHash, tabHash)) return null;
    return user;
}

function createSession(req, res, email, tabSessionId) {
    const now = Date.now();
    deleteExpiredSessions.run(now);

    const existingToken = parseCookies(req).get(SESSION_COOKIE);
    const existingSession =
        existingToken && /^[a-f\d]{64}$/i.test(existingToken)
            ? findSession.get(sessionTokenHash(existingToken), now)
            : null;
    let token;
    let tokenHash;

    if (existingSession?.email === email) {
        token = existingToken;
        tokenHash = sessionTokenHash(token);
    } else {
        token = crypto.randomBytes(32).toString("hex");
        tokenHash = sessionTokenHash(token);
        insertSession.run(tokenHash, email, now + SESSION_TTL_MS);
        setSessionCookie(res, token, req);
    }

    const tabHash = crypto
        .createHash("sha256")
        .update(tabSessionId)
        .digest("hex");
    insertSessionTab.run(tokenHash, tabHash);
}

function sendJson(res, status, value) {
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(value));
}

async function readJson(req) {
    let raw = "";
    for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
            throw new Error("Request body is too large.");
        }
    }
    try {
        return JSON.parse(raw);
    } catch {
        throw new Error("Request body must be valid JSON.");
    }
}

function hasTrustedOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
        return new URL(origin).host === req.headers.host;
    } catch {
        return false;
    }
}

const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function attemptKey(req) {
    return req.socket.remoteAddress ?? "unknown";
}

function isRateLimited(key) {
    const now = Date.now();
    const attempt = loginAttempts.get(key);
    if (!attempt || now - attempt.startedAt >= LOGIN_WINDOW_MS) {
        loginAttempts.set(key, { startedAt: now, count: 0 });
        return false;
    }
    return attempt.count >= MAX_LOGIN_ATTEMPTS;
}

function recordFailedAttempt(key) {
    const attempt = loginAttempts.get(key);
    if (attempt) attempt.count += 1;
}

function clearAttempts(key) {
    loginAttempts.delete(key);
}

function getTotpSetupUri(email, secret) {
    const issuer = "Medical Drone Delivery";
    const label = `${issuer}:${email}`;
    const query = new URLSearchParams({
        secret,
        issuer,
        algorithm: "SHA1",
        digits: "6",
        period: String(TOTP_PERIOD_SECONDS),
    });
    return `otpauth://totp/${encodeURIComponent(label)}?${query}`;
}

async function handleLogin(req, res) {
    if (!hasTrustedOrigin(req)) {
        sendJson(res, 403, { error: "Request origin is not allowed." });
        return;
    }

    let body;
    try {
        body = await readJson(req);
    } catch (error) {
        sendJson(res, 400, { error: error.message });
        return;
    }

    const email = normalizeEmail(body?.email);
    const password = body?.password;
    const code = body?.code;
    const tabSessionId = body?.tabSession;
    if (
        !email ||
        typeof password !== "string" ||
        password.length > 1024 ||
        typeof tabSessionId !== "string" ||
        !/^[a-f\d]{64}$/i.test(tabSessionId)
    ) {
        sendJson(res, 400, { error: "Enter a valid email address and password." });
        return;
    }

    const key = attemptKey(req);
    if (isRateLimited(key)) {
        sendJson(res, 429, { error: "Too many sign-in attempts. Try again later." });
        return;
    }

    const user = findUser.get(email);
    if (!isAllowedEmail(email) || !user) {
        recordFailedAttempt(key);
        sendJson(res, 401, { error: "Email or password is incorrect." });
        return;
    }

    const expectedHash = Buffer.from(user.password_hash, "base64");
    const actualHash = await hashPassword(
        password,
        Buffer.from(user.password_salt, "base64"),
    );
    if (
        actualHash.length !== expectedHash.length ||
        !crypto.timingSafeEqual(actualHash, expectedHash)
    ) {
        recordFailedAttempt(key);
        sendJson(res, 401, { error: "Email or password is incorrect." });
        return;
    }

    if (user.totp_secret) {
        if (typeof code !== "string" || code.length === 0) {
            sendJson(res, 200, { twoFactorRequired: true });
            return;
        }
        if (!verifyTotp(decryptSecret(user.totp_secret), code)) {
            recordFailedAttempt(key);
            sendJson(res, 401, { error: "The verification code is incorrect." });
            return;
        }
    } else {
        const now = Date.now();
        let pendingSecret = user.pending_totp_secret;
        if (
            !pendingSecret ||
            !user.pending_totp_expires_at ||
            user.pending_totp_expires_at <= now
        ) {
            pendingSecret = encryptSecret(
                encodeBase32(crypto.randomBytes(20)),
            );
            savePendingTotp.run(pendingSecret, now + 10 * 60 * 1000, email);
        }

        const secret = decryptSecret(pendingSecret);
        if (typeof code !== "string" || code.length === 0) {
            const otpauthUri = getTotpSetupUri(email, secret);
            sendJson(res, 200, {
                twoFactorSetupRequired: true,
                secret,
                otpauthUri,
                qrCodeDataUrl: await QRCode.toDataURL(otpauthUri, {
                    errorCorrectionLevel: "M",
                    margin: 2,
                    width: 256,
                }),
            });
            return;
        }
        if (!verifyTotp(secret, code)) {
            recordFailedAttempt(key);
            sendJson(res, 401, { error: "The verification code is incorrect." });
            return;
        }
        enableTotp.run(encryptSecret(secret), email);
    }

    clearAttempts(key);
    createSession(req, res, email, tabSessionId);
    sendJson(res, 200, { authenticated: true, user: { email } });
}

export async function HandleAuth(req, res, pathname) {
    if (req.method === "POST" && pathname === "/api/auth/login") {
        await handleLogin(req, res);
        return;
    }

    if (req.method === "GET" && pathname === "/api/auth/me") {
        const user = getAuthenticatedTabUser(req);
        if (!user) {
            sendJson(res, 401, { error: "Authentication required." });
            return;
        }
        sendJson(res, 200, { authenticated: true, user });
        return;
    }

    if (req.method === "POST" && pathname === "/api/auth/logout") {
        if (!hasTrustedOrigin(req)) {
            sendJson(res, 403, { error: "Request origin is not allowed." });
            return;
        }
        if (!getAuthenticatedTabUser(req)) {
            sendJson(res, 401, { error: "Authentication required." });
            return;
        }
        const token = parseCookies(req).get(SESSION_COOKIE);
        if (token && /^[a-f\d]{64}$/i.test(token)) {
            deleteSession.run(sessionTokenHash(token));
        }
        clearSessionCookie(res, req);
        sendJson(res, 200, { authenticated: false });
        return;
    }

    sendJson(res, 404, { error: "Not found." });
}
