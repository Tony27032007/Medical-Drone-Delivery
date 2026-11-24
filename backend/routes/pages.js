import path from "node:path";
import fs from "node:fs/promises";

const WEB_DIR = path.resolve("web");

const MIME_TYPE = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".webp": "image/webp",
};

export async function HandlePages(req, res, pathname) {
    if (pathname === "/") {
        res.writeHead(302, {
            Location: "html/dashboard.html",
        });
        res.end();
        return;
    }

    const filePath = path.resolve(WEB_DIR, `.${pathname}`);
    console.log("Serving files from:", path.resolve(WEB_DIR));
    console.log("Requested file:", filePath);

    // Prevent accessing files outside WEB_DIR
    if (filePath !== WEB_DIR && !filePath.startsWith(WEB_DIR + path.sep)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
    }

    try {
        const content = await fs.readFile(filePath);
        const extension = path.extname(filePath).toLowerCase();

        res.writeHead(200, {
            "Content-Type": MIME_TYPE[extension] ?? "application/octet-stream",
        });

        res.end(content);
    } catch (err) {
        if (err.code === "ENOENT" || err.code === "EISDIR") {
            res.writeHead(404);
            res.end("Not Found");
            return;
        }

        res.writeHead(500);
        res.end("Internal Server Error");
    }
}
