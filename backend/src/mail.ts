import { request } from "node:https";
import { config } from "./config.js";
import { validateRelayDestination, resolvePublicRelayAddress } from "./domain/mailRelaySecurity.js";

type Purpose = "verify_email" | "reset_password";
type MailMessage = { to: string; purpose: Purpose; token: string; url: string };
const testMessages: MailMessage[] = [];

/**
 * Only the automated test process may inspect tokens. This is not an HTTP endpoint,
 * not written to logs, and not available in development/production runtime.
 */
export function getTestMail(to: string, purpose: Purpose): MailMessage | undefined {
  if (config.nodeEnv !== "test") throw new Error("Test mailbox unavailable outside NODE_ENV=test");
  return testMessages.filter((message) => message.to === to && message.purpose === purpose).at(-1);
}

export function mailConfigured(): boolean {
  if (config.nodeEnv === "test") return true;
  if (!config.mailRelayUrl || !config.mailRelayAllowedHost ||
      !config.mailRelayBearerToken || !config.mailFrom) return false;
  try {
    validateRelayDestination(config.mailRelayUrl, config.mailRelayAllowedHost);
    return true;
  } catch { return false; }
}

/**
 * HTTPS relay contract: POST JSON { from, to, subject, text, category } with
 * Authorization: Bearer <MAIL_RELAY_BEARER_TOKEN>. Redirects are forbidden.
 * No live provider is configured until the operator explicitly provisions one.
 */
export async function sendActionMail(to: string, purpose: Purpose, token: string): Promise<void> {
  const path = purpose === "verify_email" ? "/confirmar-email/" : "/redefinir-senha/";
  const link = new URL(path, config.appOrigin);
  link.searchParams.set("token", token);
  const subject = purpose === "verify_email"
    ? "Confirme seu e-mail | Vivaion Empresas"
    : "Redefinição de senha | Vivaion Empresas";
  const text = purpose === "verify_email"
    ? "Confirme seu e-mail para acessar o portal Vivaion Empresas. O link vence em 24 horas:\n" + link.toString() + "\nSe você não solicitou este cadastro, ignore esta mensagem."
    : "Para redefinir sua senha, utilize o link abaixo em até 30 minutos:\n" + link.toString() + "\nSe você não solicitou a redefinição, ignore esta mensagem.";

  if (config.nodeEnv === "test") {
    testMessages.push({ to, purpose, token, url: link.toString() });
    return;
  }
  if (!mailConfigured()) throw new Error("mail_not_configured");
  const url = validateRelayDestination(config.mailRelayUrl, config.mailRelayAllowedHost);
  // All DNS answers must be routable; the returned IP is pinned into the
  // connection below so the HTTP client cannot resolve the hostname again.
  const ip = await resolvePublicRelayAddress(url.hostname);
  const body = JSON.stringify({
    from: config.mailFrom,
    to,
    subject,
    text,
    category: purpose === "verify_email" ? "account-verification" : "password-recovery"
  });
  await new Promise<void>((resolve, reject) => {
    const req = request({
      hostname: ip.address,  // Connect directly to validated IP; no DNS rebinding.
      port: 443,
      method: "POST",
      path: url.pathname + url.search,
      servername: url.hostname, // TLS SNI AND certificate hostname validation.
      rejectUnauthorized: true,
      agent: false,
      headers: {
        "Host": url.hostname,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "Authorization": "Bearer " + config.mailRelayBearerToken
      }
    }, (response) => {
      response.once("error", reject);
      response.once("end", () => {
        if ((response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300) resolve();
        else reject(new Error("mail_delivery_failed"));
      });
      response.resume();
    });
    req.once("error", reject);
    req.setTimeout(8000, () => req.destroy(new Error("mail_delivery_timeout")));
    req.end(body);
  });
}
