import { config } from "./config.js";

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
  if (!config.mailRelayUrl || !config.mailRelayBearerToken || !config.mailFrom) return false;
  try {
    const url = new URL(config.mailRelayUrl);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
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
  const response = await fetch(config.mailRelayUrl, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(8000),
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + config.mailRelayBearerToken
    },
    body: JSON.stringify({
      from: config.mailFrom,
      to,
      subject,
      text,
      category: purpose === "verify_email" ? "account-verification" : "password-recovery"
    })
  });
  if (!response.ok) throw new Error("mail_delivery_failed");
}
