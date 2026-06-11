import net from 'node:net';

function isPrivateIpv4(host: string): boolean {
  const octets = host.split('.').map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;

  const [a, b] = octets;
  // 0.0.0.0/8 — "this host". 0.0.0.0 routes to localhost on Linux, so it must be
  // blocked alongside 127/8 to stop loopback-via-0.0.0.0 SSRF.
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata 169.254.169.254
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT (defense in depth)
  return false;
}

/**
 * Extract an embedded IPv4 address from an IPv4-mapped / IPv4-compatible IPv6
 * literal (e.g. `::ffff:169.254.169.254` dotted form, or `::ffff:a9fe:a9fe`
 * hex form), returning the dotted-quad string. Returns null when no embedded
 * IPv4 is present. This is required because `http://[::ffff:169.254.169.254]/`
 * reaches the same target as `http://169.254.169.254/` but would otherwise
 * sail past an IPv6-only check.
 */
function extractEmbeddedIpv4(ipv6: string): string | null {
  const dotted = ipv6.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1] ?? null;

  const hex = ipv6.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hex) {
    const hi = Number.parseInt(hex[1]!, 16);
    const lo = Number.parseInt(hex[2]!, 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

function isPrivateIpv6(host: string): boolean {
  const normalized = host.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true; // loopback + unspecified
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(normalized)) return true; // fe80::/10 link-local

  // IPv4-mapped / -embedded forms must be re-checked against the IPv4 ranges.
  const embedded = extractEmbeddedIpv4(normalized);
  if (embedded && isPrivateIpv4(embedded)) return true;

  return false;
}

function checkOutboundHost(url: string, label: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `${label} must be a valid URL`;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return `${label} must use http:// or https://`;
  }

  let hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return `${label} cannot target localhost`;
  }

  // URL.hostname preserves the surrounding brackets for an IPv6 literal
  // (e.g. "[::1]"). net.isIP() and the private-range checks only recognise the
  // bare address, so strip the brackets first — otherwise the IPv6 branch is
  // dead code and `http://[::1]/` / `http://[::ffff:169.254.169.254]/` are
  // accepted.
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1);
  }

  const ipVersion = net.isIP(hostname);
  if (ipVersion === 4 && isPrivateIpv4(hostname)) {
    return `${label} cannot target private or loopback IP ranges`;
  }
  if (ipVersion === 6 && isPrivateIpv6(hostname)) {
    return `${label} cannot target private or loopback IP ranges`;
  }

  return null;
}

/**
 * SSRF guard for admin/user-supplied outbound webhook destinations. Returns an
 * error message string when the URL is unsafe (bad scheme, localhost, or a
 * private/loopback/link-local/metadata IP literal — in either IPv4 or IPv6,
 * including bracketed and IPv4-mapped IPv6 forms), or null when it is allowed.
 */
export function validateOutboundWebhookUrl(url: string): string | null {
  return checkOutboundHost(url, 'Webhook URL');
}

/**
 * Generic synchronous SSRF guard for any admin-supplied outbound URL (e.g. the
 * Elasticsearch log endpoint). Same rules as {@link validateOutboundWebhookUrl}
 * with a caller-provided label for the error message.
 */
export function validateOutboundUrl(url: string, label = 'URL'): string | null {
  return checkOutboundHost(url, label);
}

export const _internal = { isPrivateIpv4, isPrivateIpv6, extractEmbeddedIpv4 };
