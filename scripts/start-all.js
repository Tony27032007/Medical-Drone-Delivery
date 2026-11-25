import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);
const children = [];
let shuttingDown = false;

function portIsInUse(port) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(
            { host: "127.0.0.1", port: Number(port) },
            () => {
                socket.destroy();
                resolve(true);
            },
        );
        socket.once("error", (error) => {
            socket.destroy();
            if (error.code === "ECONNREFUSED") resolve(false);
            else reject(error);
        });
    });
}

async function responseAt(port, pathname = "/") {
    try {
        return await fetch(`http://127.0.0.1:${port}${pathname}`, {
            redirect: "manual",
            signal: AbortSignal.timeout(1500),
        });
    } catch {
        return null;
    }
}

async function findAvailablePort(preferredPort, serviceName, wasExplicitlySet) {
    const preferred = Number(preferredPort);
    if (!Number.isInteger(preferred) || preferred < 1 || preferred > 65535) {
        throw new Error(`${serviceName} port must be a valid TCP port.`);
    }

    for (let port = preferred; port <= Math.min(preferred + 100, 65535); port += 1) {
        if (!(await portIsInUse(port))) return String(port);
        if (wasExplicitlySet) {
            throw new Error(
                `${serviceName} port ${port} is already in use. Stop that service or choose another port.`,
            );
        }
    }

    throw new Error(
        `No available port found for ${serviceName} starting at ${preferredPort}.`,
    );
}

async function resolvePorts() {
    const requestedBackendPort = process.env.BACKEND_PORT || "4000";
    const backendPort = String(Number(requestedBackendPort));
    const backendInUse = await portIsInUse(backendPort);
    let reuseBackend = false;

    if (backendInUse) {
        const existingBackend = await responseAt(backendPort);
        const location = existingBackend?.headers.get("location") ?? "";
        if (
            existingBackend?.status === 302 &&
            /(?:^|\/)html\/dashboard\.html$/.test(location)
        ) {
            reuseBackend = true;
            console.log(`Using existing backend server on port ${backendPort}.`);
        } else {
            throw new Error(
                `Backend port ${backendPort} is occupied by another service. Stop it or set BACKEND_PORT.`,
            );
        }
    }

    const requestedAuthPort = process.env.AUTH_SERVER_PORT || "8080";
    const authPort = await findAvailablePort(
        requestedAuthPort,
        "Authentication server",
        Boolean(process.env.AUTH_SERVER_PORT),
    );
    if (authPort !== requestedAuthPort) {
        console.warn(
            `Authentication port ${requestedAuthPort} is occupied; using ${authPort}.`,
        );
    }

    const requestedWebPort = process.env.WEB_PORT || "3000";
    const webPort = await findAvailablePort(
        requestedWebPort,
        "Web proxy",
        Boolean(process.env.WEB_PORT),
    );
    if (webPort !== requestedWebPort) {
        console.warn(`Web port ${requestedWebPort} is occupied; using ${webPort}.`);
    }

    return { backendPort, authPort, webPort, reuseBackend };
}

function shutdown(exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) {
        if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
    }
    const pending = children.filter((child) => child.exitCode === null);
    if (pending.length === 0) {
        process.exit(exitCode);
        return;
    }
    const timeout = setTimeout(() => {
        for (const child of pending) {
            if (child.exitCode === null) child.kill("SIGKILL");
        }
        process.exit(exitCode);
    }, 5000);
    timeout.unref();
    Promise.all(
        pending.map(
            (child) =>
                new Promise((resolve) => child.once("exit", resolve)),
        ),
    ).then(() => process.exit(exitCode));
}

function startService(service) {
    const child = spawn(
        process.execPath,
        [path.join(projectRoot, service.script)],
        {
            cwd: projectRoot,
            env: { ...process.env, ...service.env },
            stdio: "inherit",
        },
    );
    children.push(child);
    child.on("error", (error) => {
        console.error(`${service.name} failed to start:`, error.message);
        shutdown(1);
    });
    child.on("exit", (code, signal) => {
        if (shuttingDown) return;
        console.error(
            `${service.name} stopped unexpectedly (${signal ?? `exit ${code}`}).`,
        );
        shutdown(code && code !== 0 ? code : 1);
    });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

try {
    const { backendPort, authPort, webPort, reuseBackend } =
        await resolvePorts();
    if (!reuseBackend) {
        startService({
            name: "Backend API",
            script: "backend/server.js",
            env: { PORT: backendPort },
        });
    }
    startService({
        name: "Authentication and app server",
        script: "backend/auth-server.js",
        env: { PORT: authPort },
    });
    startService({
        name: "Node.js web proxy",
        script: "web/nodeJS/static-server.js",
        env: { PORT: webPort, AUTH_SERVER_PORT: authPort },
    });

    console.log(`Starting services:
  Web app:      http://localhost:${webPort}
  Auth server:  http://localhost:${authPort}
  Backend API:  http://localhost:${backendPort}${reuseBackend ? " (already running)" : ""}`);
} catch (error) {
    console.error(`Unable to start application: ${error.message}`);
    process.exitCode = 1;
}
