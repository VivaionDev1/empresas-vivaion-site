import { app } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";

if (!config.databaseUrl) throw new Error("DATABASE_URL is required before starting Vivaion Empresas API");
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
