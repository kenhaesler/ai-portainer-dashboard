import { describe, expect, it } from 'vitest';
import { validateOutboundWebhookUrl } from './network-security.js';

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
});
