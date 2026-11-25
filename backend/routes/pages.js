import path from "node:path";
import fs from "node:fs/promises";
import { IncomingMessage, ServerResponse } from "node:http";

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

/**
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {string} pathname
 */
export async function HandlePages(
    req,
    res,
    pathname,
    injectTabSessionGuard = false,
) {
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
        const extension = path.extname(filePath).toLowerCase();
        const content = await fs.readFile(filePath);
        const responseContent =
            injectTabSessionGuard && extension === ".html"
                ? Buffer.from(
                      content
                          .toString("utf8")
                          .replace(
                              /<\/head>/i,
                              '<script>document.documentElement.style.visibility="hidden"</script><script src="/scripts/tab-session.js" defer></script></head>',
                          ),
                  )
                : content;

        res.writeHead(200, {
            "Content-Type": MIME_TYPE[extension] ?? "application/octet-stream",
        });

        res.end(responseContent);
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
