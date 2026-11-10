import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return "scrypt$" + salt + "$" + derived.toString("hex");
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, salt, expected] = stored.split("$");
  if (algo !== "scrypt" || !salt || !expected || !/^[0-9a-f]{128}$/.test(expected)) return false;
  const actual = await scrypt(password, salt, 64) as Buffer;
  const original = Buffer.from(expected, "hex");
  return actual.length === original.length && timingSafeEqual(actual, original);
}
export function createSessionToken(): string { return randomBytes(32).toString("base64url"); }
export function hashSessionToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
