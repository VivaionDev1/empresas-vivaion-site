import { app } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { assertIsolatedDatabaseUrl } from "./domain/dbTarget.js";

if (!config.databaseUrl) throw new Error("DATABASE_URL is required before starting Vivaion Empresas API");
assertIsolatedDatabaseUrl(config.databaseUrl);
if (config.isProduction && (!config.appOrigin.startsWith("https://") || !["127.0.0.1", "::1"].includes(config.host))) {
  throw new Error("Production requires HTTPS APP_ORIGIN and a loopback-only HOST");
}
const server = app.listen(config.port, config.host, () => {
  console.info("Vivaion Empresas API listening on " + config.host + ":" + config.port);
});
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  });
}
