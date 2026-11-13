/** A deliberate guardrail against running Enterprise migrations against academic/UNYOM databases. */
export function assertIsolatedDatabaseUrl(connectionString: string): void {
  let url: URL;
  try { url = new URL(connectionString); }
  catch { throw new Error("DATABASE_URL must be a PostgreSQL connection URL"); }
  if (!["postgres:","postgresql:"].includes(url.protocol)) throw new Error("DATABASE_URL must use PostgreSQL");
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!/^vivaion_empresas(?:_[a-z0-9]+)*$/.test(dbName)) {
    throw new Error("Refusing database outside vivaion_empresas* namespace");
  }
}
