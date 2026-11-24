import { HandleAPIs } from "./routes/api.js";
import { HandlePages } from "./routes/pages.js";
import http from "node:http";

// Create server
const server = http.createServer(async (req, res) => {
    try {
        const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
        const pathname = parsedUrl.pathname;
        if (pathname.startsWith("/api/")) {
            await HandleAPIs(req, res, pathname);
        } else {
            await HandlePages(req, res, pathname);
        }
    } catch (error) {
        console.log(error);
        res.writeHead(500);
        res.end("Internal Server Error");
    }
});

server.listen(3000, () => {
    console.log("Server running on port 3000");
});
