import net from 'node:net';

function isPrivateIpv4(host: string): boolean {
  const octets = host.split('.').map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((n) => Number.isNaN(n))) return false;

  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80')
  );
}

export function validateOutboundWebhookUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Webhook URL must be a valid URL';
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return 'Webhook URL must use http:// or https://';
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return 'Webhook URL cannot target localhost';
  }

  const ipVersion = net.isIP(hostname);
  if (ipVersion === 4 && isPrivateIpv4(hostname)) {
    return 'Webhook URL cannot target private or loopback IP ranges';
  }
  if (ipVersion === 6 && isPrivateIpv6(hostname)) {
    return 'Webhook URL cannot target private or loopback IP ranges';
  }

  return null;
}
