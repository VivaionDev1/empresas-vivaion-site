import "dotenv/config";

const port = Number.parseInt(process.env.PORT ?? "8082", 10);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port");
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port,
  host: process.env.HOST ?? "127.0.0.1",
  appOrigin: new URL(process.env.APP_ORIGIN ?? "http://localhost:4321").origin,
  databaseUrl: process.env.DATABASE_URL ?? "",
  catalogFeedUrl: process.env.CATALOG_FEED_URL ?? "https://vivaion.com.br/integracoes/empresas/catalogo/v1.json",
  allowLocalCatalog: process.env.ALLOW_LOCAL_CATALOG_FEED === "true",
  corporatePricingEnabled: process.env.CORPORATE_PRICING_ENABLED === "true",
  mailRelayUrl: process.env.MAIL_RELAY_URL ?? "",
  mailRelayBearerToken: process.env.MAIL_RELAY_BEARER_TOKEN ?? "",
  mailFrom: process.env.MAIL_FROM ?? "",
  sessionDays: 7,
  isProduction: process.env.NODE_ENV === "production",
};
