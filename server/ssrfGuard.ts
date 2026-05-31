/**
 * SSRF guard for operator-supplied URLs (W2).
 *
 * The only operator-supplied outbound URL today is AI_TEXT_BASE_URL, validated
 * at env-parse time. The guard rejects URLs whose hostname is a literal
 * loopback / private / link-local address, or `localhost` — common
 * misconfiguration patterns that would point the AI provider client at a
 * service on the same host or LAN.
 *
 * Limitation (documented as defense-in-depth follow-up): the check is
 * synchronous and only catches literal IP / hostname patterns. A non-literal
 * hostname that resolves to a private IP at DNS-resolution time would still
 * slip past. A full fix would do an async DNS lookup at startup and refuse
 * to boot if the resolved address is private. That's a separate W2-follow-up
 * PR; this guard closes the bulk of accidental misconfigurations.
 */

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
