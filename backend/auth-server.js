import http from "node:http";
import { HandlePages } from "./routes/pages.js";

const {
    getAuthenticatedTabUser,
    HandleAuth,
} = await import("./routes/auth.js");

const server = http.createServer(async (req, res) => {
    try {
        const requestUrl = new URL(
            req.url,
            `http://${req.headers.host ?? "localhost"}`,
        );
        const { pathname } = requestUrl;

        if (pathname.startsWith("/api/auth/")) {
            await HandleAuth(req, res, pathname);
            return;
        }

        if (pathname.startsWith("/api/")) {
            if (
                pathname !== "/api/notification-destination" &&
                !getAuthenticatedTabUser(req)
            ) {
                res.writeHead(401, {
                    "Content-Type": "application/json; charset=utf-8",
                    "Cache-Control": "no-store",
                });
                res.end(JSON.stringify({ error: "Authentication required." }));
                return;
            }
            const { HandleAPIs } = await import("./routes/api.js");
            await HandleAPIs(req, res, pathname);
            return;
        }

        if (pathname === "/") {
            res.writeHead(302, {
                Location: "/html/login.html",
            });
            res.end();
            return;
        }

        const isProtectedPage =
            pathname.startsWith("/html/") &&
            pathname.endsWith(".html") &&
            pathname !== "/html/login.html";
        const user = isProtectedPage ? getAuthenticatedTabUser(req) : null;

        if (isProtectedPage && !user) {
            res.writeHead(302, {
                Location: `/html/login.html?returnTo=${encodeURIComponent(pathname)}`,
            });
            res.end();
            return;
        }

        await HandlePages(req, res, pathname, isProtectedPage);
    } catch (error) {
        console.error("Authentication server request failed:", error);
        if (!res.headersSent) res.writeHead(500);
        res.end("Internal Server Error");
    }
});

const port = Number(process.env.PORT) || 8080;
server.listen(port, () => {
    console.log(`Medical Drone Delivery auth server listening on port ${port}`);
});
