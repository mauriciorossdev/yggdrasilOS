import { createServer, type Server } from "node:http";
import type Database from "better-sqlite3";
import { HttpError, sendJson } from "./http.js";
import { route } from "./routes.js";
import { webRoute } from "./web.js";

export function createSyncServer(db: Database.Database): Server {
  return createServer((req, res) => {
    void (async () => {
      try {
        const handled = (await route(req, res, db)) || webRoute(req, res, db);
        if (!handled) {
          if (req.method === "GET" && (req.url === "/" || req.url === "")) {
            sendJson(res, 200, { ok: true, service: "yggdrasil-sync-server" });
            return;
          }
          sendJson(res, 404, { error: "Not found" });
        }
      } catch (err) {
        if (err instanceof HttpError) {
          sendJson(res, err.status, { error: err.message });
        } else {
          console.error("sync-server: unhandled error", err);
          sendJson(res, 500, { error: "Internal error" });
        }
      }
    })();
  });
}
