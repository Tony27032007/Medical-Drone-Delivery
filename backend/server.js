import { GetLocationData, NotificationHandler } from "./utils.js";
import http from "node:http";

// Create server
const server = http.createServer((req, res) => {
    const routes = {
        "/device-locations": GetLocationData,
        "/notification-destination": NotificationHandler,
    };

    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const handler = routes[parsedUrl.pathname];

    if (handler) {
        handler(req, res);
    } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("404 Not Found");
    }
});

server.listen(3000, () => {
    console.log("Server running on port 3000");
});
