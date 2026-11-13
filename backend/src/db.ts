import { Pool } from "pg";
import { config } from "./config.js";

export const pool = new Pool({
  connectionString: config.databaseUrl || undefined,
  max: 10,
  idleTimeoutMillis: 15_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000,
  application_name: "vivaion-empresas",
});
