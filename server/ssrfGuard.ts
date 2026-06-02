/**
 * SSRF guard for operator-supplied URLs (W2).
 *
 * The only operator-supplied outbound URL today is AI_TEXT_BASE_URL, validated
 * at env-parse time. The guard rejects URLs whose hostname is a literal
 * loopback / private / link-local address, or `localhost` — common
 * misconfiguration patterns that would point the AI provider client at a
 * service on the same host or LAN.
 *
 * `checkSafeOutboundUrl` is synchronous and only catches literal IP / hostname
 * patterns. A non-literal hostname that resolves to a private IP at DNS-
 * resolution time would slip past it. `assertResolvedHostIsPublic` closes that
 * gap (S2 / W2 follow-up): it resolves a host's A/AAAA records at startup and
 * refuses to boot if any resolved address is private. DNS errors are treated as
 * non-fatal so a transient resolver hiccup doesn't block an otherwise-healthy boot.
 */

import { promises as dnsPromises } from "node:dns";

/** Literal hostnames that are always rejected. */
const REJECTED_HOSTNAMES = new Set<string>(["localhost"]);

/**
 * Parse a hostname into its IPv4 octets if it's an IPv4 literal; otherwise
 * null. URL parsing leaves the hostname unbracketed for v4 and bracketed for
 * v6, so we use a simple regex.
 */
function parseIpv4(hostname: string): readonly number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return null;
  const octets = match.slice(1, 5).map((s) => Number.parseInt(s, 10));
  if (octets.some((n) => n < 0 || n > 255 || !Number.isInteger(n))) return null;
  return octets;
}

function isPrivateIpv4(octets: readonly number[]): boolean {
  const [a, b] = octets;
  if (a === 127) return true;                    // 127.0.0.0/8   loopback
  if (a === 10) return true;                     // 10.0.0.0/8    private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true;       // 192.168.0.0/16 private
  if (a === 169 && b === 254) return true;       // 169.254.0.0/16 link-local (incl. cloud metadata 169.254.169.254)
  if (a === 0) return true;                      // 0.0.0.0/8     "this network"
  return false;
}

/**
 * Lower-cased, bracket-stripped hostname check for IPv6 loopback / unique-
 * local-address (ULA) prefixes. URLs use bracketed v6 hostnames; URL.hostname
 * strips the brackets and lower-cases for us.
 */
function isPrivateIpv6(hostname: string): boolean {
  // Loopback ::1 — any all-zeros prefix ending in :1
  if (hostname === "::1" || hostname === "0:0:0:0:0:0:0:1") return true;
  // Unique local addresses fc00::/7 — first byte 0xfc or 0xfd
  if (/^fc[0-9a-f]{2}:/i.test(hostname)) return true;
  if (/^fd[0-9a-f]{2}:/i.test(hostname)) return true;
  // Link-local fe80::/10 — first two bytes 0xfe80–0xfebf
  if (/^fe[89ab][0-9a-f]:/i.test(hostname)) return true;
  // IPv4-mapped IPv6 ::ffff:127.0.0.1 — accept both the dotted form and the
  // hex-pair form WHATWG URL emits after normalization (e.g. ::ffff:7f00:1).
  const v4MappedDotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(hostname);
  if (v4MappedDotted) {
    const v4 = parseIpv4(v4MappedDotted[1]);
    if (v4 && isPrivateIpv4(v4)) return true;
  }
  const v4MappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(hostname);
  if (v4MappedHex) {
    const high = Number.parseInt(v4MappedHex[1], 16);
    const low = Number.parseInt(v4MappedHex[2], 16);
    const v4 = [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff];
    if (isPrivateIpv4(v4)) return true;
  }
  return false;
}

export interface SsrfCheckResult {
  readonly ok: boolean;
  readonly reason?: string;
}

/**
 * Validates that `url` does not point at a loopback / private / link-local
 * destination. Returns an `ok: false` result rather than throwing so callers
 * can choose how to surface the error (Zod refinement, startup assertion,
 * structured error response, etc.).
 */
export function checkSafeOutboundUrl(url: string): SsrfCheckResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }
  const rawHostname = parsed.hostname.toLowerCase();
  // WHATWG URL parser returns IPv6 hostnames bracketed (e.g. "[::1]"). Strip
  // the brackets so the IPv6 regex matches the canonical address form.
  const hostname = rawHostname.startsWith("[") && rawHostname.endsWith("]")
    ? rawHostname.slice(1, -1)
    : rawHostname;
  if (REJECTED_HOSTNAMES.has(hostname)) {
    return { ok: false, reason: `hostname "${hostname}" is a loopback alias` };
  }
  const v4 = parseIpv4(hostname);
  if (v4 && isPrivateIpv4(v4)) {
    return { ok: false, reason: `${hostname} is in a loopback/private/link-local range` };
  }
  if (isPrivateIpv6(hostname)) {
    return { ok: false, reason: `${hostname} is an IPv6 loopback/ULA/link-local address` };
  }
  return { ok: true };
}

/**
 * Check a resolved IP address literal (IPv4 or IPv6, brackets tolerated)
 * against the same loopback/private/link-local ranges as checkSafeOutboundUrl.
 * Used by the startup DNS-resolution guard on each address a hostname resolves to.
 */
export function isPrivateAddress(address: string): boolean {
  const host = address.toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = parseIpv4(host);
  if (v4) return isPrivateIpv4(v4);
  return isPrivateIpv6(host);
}

/** Minimal DNS resolver surface, injectable so the startup guard is testable. */
export interface DnsResolver {
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
}

const DNS_RESOLVE_TIMEOUT_MS = 2_000;

function withDnsTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => reject(new Error("DNS resolution timed out")), timeoutMs);
      // Don't let a pending resolver promise keep the event loop alive.
      timer.unref();
    }),
  ]);
}

/**
 * Defense-in-depth SSRF guard (S2 / W2 follow-up): resolve a non-literal
 * hostname's A/AAAA records and throw if ANY resolved address is private /
 * loopback / link-local. Literal IPs and `localhost` are already rejected by
 * checkSafeOutboundUrl at env-parse time, so they're skipped here.
 *
 * Throws on a private resolution so the caller can refuse to boot. DNS errors
 * (NXDOMAIN, timeout, no records) are non-fatal — they don't indicate an SSRF
 * target and shouldn't block startup over a transient resolver hiccup.
 */
export async function assertResolvedHostIsPublic(
  rawUrl: string,
  opts: { resolver?: DnsResolver; timeoutMs?: number } = {},
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return; // URL syntax is validated elsewhere (Zod .url()).
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  // Literal IPv4/IPv6 and localhost are already covered synchronously at env
  // time; only a non-literal hostname needs a DNS round-trip here.
  if (host === "localhost" || parseIpv4(host) !== null || host.includes(":")) {
    return;
  }

  const resolver = opts.resolver ?? dnsPromises;
  const timeoutMs = opts.timeoutMs ?? DNS_RESOLVE_TIMEOUT_MS;

  const [v4, v6] = await Promise.all([
    withDnsTimeout(resolver.resolve4(host), timeoutMs).catch(() => [] as string[]),
    withDnsTimeout(resolver.resolve6(host), timeoutMs).catch(() => [] as string[]),
  ]);
  const privateHit = [...v4, ...v6].find((addr) => isPrivateAddress(addr));
  if (privateHit) {
    throw new Error(
      `Outbound URL host "${host}" resolves to a private/loopback address (${privateHit}) — refusing to start (SSRF guard S2)`,
    );
  }
}
