import http from "node:http";

const port = Number(process.env.PORT) || 3000;
const authPort = Number(process.env.AUTH_SERVER_PORT) || 8080;

const server = http.createServer((req, res) => {
    const proxy = http.request(
        {
            hostname: "127.0.0.1",
            port: authPort,
            path: req.url,
            method: req.method,
            headers: {
                ...req.headers,
                host: req.headers.host ?? `localhost:${port}`,
            },
        },
        (upstream) => {
            res.writeHead(upstream.statusCode ?? 502, upstream.headers);
            upstream.pipe(res);
        },
    );

    proxy.on("error", (error) => {
        console.error("Web proxy request failed:", error.message);
        if (!res.headersSent) {
            res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
        }
        res.end("The application server is unavailable.");
    });
    req.pipe(proxy);
});

server.listen(port, () => {
    console.log(`Node.js web proxy listening on port ${port}`);
});
