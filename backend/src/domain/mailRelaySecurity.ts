import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/**
 * The relay must be a specific, operator-approved FQDN (never a wildcard,
 * hostname suffix, IP literal, localhost or a name in a private DNS zone).
 */
const hostnamePattern = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function isApprovedHostname(value: string): boolean {
  return value === value.toLowerCase() && value.length <= 253 &&
    hostnamePattern.test(value) && isIP(value) === 0 &&
    !value.endsWith(".localhost") && !value.endsWith(".local") &&
    !value.endsWith(".internal") && !value.endsWith(".test") &&
    !value.endsWith(".invalid") && !value.endsWith(".example");
}

export function validateRelayDestination(rawUrl: string, allowedHostname: string): URL {
  if (!allowedHostname || !isApprovedHostname(allowedHostname)) {
    throw new Error("mail_relay_allowlist_invalid");
  }
  let destination: URL;
  try { destination = new URL(rawUrl); }
  catch { throw new Error("mail_relay_url_invalid"); }
  // The host must match the allowlist EXACTLY, not via endsWith().
  if (destination.protocol !== "https:" ||
      destination.hostname !== allowedHostname ||
      destination.username !== "" || destination.password !== "" ||
      destination.port !== "" || destination.hash !== "") {
    throw new Error("mail_relay_destination_not_allowed");
  }
  return destination;
}

// Deny special-use, private, link-local, loopback, benchmarking, documentation,
// multicast, unspecified and non-routable IPv4 ranges.
const deniedV4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
  ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
] as const) {
  deniedV4.addSubnet(network, prefix, "ipv4");
}

// Only global unicast IPv6, excluding tunneled/special and documentation space.
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const deniedV6 = new BlockList();
for (const [network, prefix] of [
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16]
] as const) {
  deniedV6.addSubnet(network, prefix, "ipv6");
}

export type RelayAddress = { address: string; family: number };
export type RelayResolver = (hostname: string) => Promise<readonly RelayAddress[]>;

export function isPublicRelayAddress(entry: RelayAddress): boolean {
  const { address, family } = entry;
  if (family === 4) return isIP(address) === 4 && !deniedV4.check(address, "ipv4");
  if (family === 6) return isIP(address) === 6 &&
    globalV6.check(address, "ipv6") && !deniedV6.check(address, "ipv6");
  return false;
}

const defaultResolver: RelayResolver = async (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

/**
 * Resolve the final A/AAAA answers. Fail closed if ANY answer is unsafe:
 * accepting only the first safe address would let split DNS retain an unsafe
 * candidate. The selected public IP is used DIRECTLY by https.request,
 * preventing an unvalidated second DNS lookup at connection time.
 */
export async function resolvePublicRelayAddress(
  hostname: string,
  resolver: RelayResolver = defaultResolver
): Promise<RelayAddress> {
  if (!isApprovedHostname(hostname)) throw new Error("mail_relay_hostname_invalid");
  const results = await resolver(hostname);
  if (!Array.isArray(results) || results.length === 0 ||
      results.length > 32 || results.some((record) => !isPublicRelayAddress(record))) {
    throw new Error("mail_relay_dns_blocked");
  }
  return results[0]!;
}
