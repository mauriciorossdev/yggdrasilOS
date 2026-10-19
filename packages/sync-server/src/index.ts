import { getDb } from "./db.js";
import { createSyncServer } from "./server.js";

const port = Number(process.env.PORT ?? 8787);
// Railway volumes mount at a path you choose (e.g. /data) — point
// SYNC_DB_PATH at a file inside it so the DB survives redeploys. Falls back
// to a local file for running this outside Railway (dev/test).
const dbPath = process.env.SYNC_DB_PATH ?? "./data/sync.db";

const db = getDb(dbPath);
const server = createSyncServer(db);

server.listen(port, () => {
  console.log(`yggdrasil sync-server listening on :${port} (db: ${dbPath})`);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
