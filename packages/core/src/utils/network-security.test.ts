import { describe, expect, it } from 'vitest';
import { validateOutboundWebhookUrl, validateOutboundUrl } from './network-security.js';

const PRIVATE = 'Webhook URL cannot target private or loopback IP ranges';

describe('validateOutboundWebhookUrl', () => {
  it('accepts public http and https URLs', () => {
    expect(validateOutboundWebhookUrl('https://example.com/webhook')).toBeNull();
    expect(validateOutboundWebhookUrl('http://api.example.com/webhook')).toBeNull();
  });

  it('rejects unsupported schemes', () => {
    expect(validateOutboundWebhookUrl('file:///etc/passwd')).toBe(
      'Webhook URL must use http:// or https://'
    );
  });

  it('rejects localhost and private IP targets', () => {
    expect(validateOutboundWebhookUrl('http://localhost:8080/hook')).toBe(
      'Webhook URL cannot target localhost'
    );
    expect(validateOutboundWebhookUrl('http://127.0.0.1:8080/hook')).toBe(
      'Webhook URL cannot target private or loopback IP ranges'
    );
    expect(validateOutboundWebhookUrl('http://192.168.1.10/hook')).toBe(
      'Webhook URL cannot target private or loopback IP ranges'
    );
  });

  // Regression: 0.0.0.0/8 routes to localhost on Linux and was previously allowed.
  it('rejects the 0.0.0.0 / 0.0.0.0:port loopback bypass', () => {
    expect(validateOutboundWebhookUrl('http://0.0.0.0:6379/')).toBe(PRIVATE);
    expect(validateOutboundWebhookUrl('http://0.0.0.1/')).toBe(PRIVATE);
  });

  // Regression: URL.hostname keeps the brackets for IPv6 literals, so net.isIP
  // returned 0 and every IPv6 private target sailed through.
  it('rejects bracketed IPv6 loopback / unique-local / link-local literals', () => {
    expect(validateOutboundWebhookUrl('http://[::1]:8080/x')).toBe(PRIVATE);
    expect(validateOutboundWebhookUrl('http://[::]/x')).toBe(PRIVATE);
    expect(validateOutboundWebhookUrl('http://[fd00::1]/x')).toBe(PRIVATE);
    expect(validateOutboundWebhookUrl('http://[fc00::1]/x')).toBe(PRIVATE);
    expect(validateOutboundWebhookUrl('http://[fe80::1]/x')).toBe(PRIVATE);
  });

  // Regression: IPv4-mapped IPv6 reaches the same target as the bare IPv4.
  it('rejects IPv4-mapped IPv6 forms of loopback and cloud metadata', () => {
    expect(validateOutboundWebhookUrl('http://[::ffff:127.0.0.1]/x')).toBe(PRIVATE);
    expect(validateOutboundWebhookUrl('http://[::ffff:169.254.169.254]/latest/meta-data/')).toBe(PRIVATE);
    // Hex-encoded form of ::ffff:169.254.169.254 (a9fe:a9fe)
    expect(validateOutboundWebhookUrl('http://[::ffff:a9fe:a9fe]/x')).toBe(PRIVATE);
  });

  it('still accepts genuine public IPv6 and IPv4 literals', () => {
    expect(validateOutboundWebhookUrl('https://[2606:4700:4700::1111]/x')).toBeNull();
    expect(validateOutboundWebhookUrl('https://8.8.8.8/x')).toBeNull();
  });

  it('rejects cloud metadata and other private IPv4 literals', () => {
    expect(validateOutboundWebhookUrl('http://169.254.169.254/latest/meta-data/')).toBe(PRIVATE);
    expect(validateOutboundWebhookUrl('http://10.0.0.5/x')).toBe(PRIVATE);
    expect(validateOutboundWebhookUrl('http://172.16.0.1/x')).toBe(PRIVATE);
  });
});

describe('validateOutboundUrl', () => {
  it('uses the supplied label in error messages', () => {
    expect(validateOutboundUrl('ftp://example.com', 'Elasticsearch endpoint')).toBe(
      'Elasticsearch endpoint must use http:// or https://'
    );
    expect(validateOutboundUrl('http://[::1]/', 'Elasticsearch endpoint')).toBe(
      'Elasticsearch endpoint cannot target private or loopback IP ranges'
    );
  });

  it('accepts public URLs', () => {
    expect(validateOutboundUrl('https://es.example.com:9200', 'ES')).toBeNull();
  });
});
