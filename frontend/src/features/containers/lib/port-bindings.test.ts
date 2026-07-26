import { describe, it, expect } from 'vitest';
import {
  UNSPECIFIED_BIND_ADDRESSES,
  isLoopbackBind,
  isPubliclyBound,
  formatPortMapping,
} from './port-bindings';

describe('isLoopbackBind', () => {
  it('recognises IPv4 and IPv6 loopback', () => {
    expect(isLoopbackBind('127.0.0.1')).toBe(true);
    expect(isLoopbackBind('127.1.2.3')).toBe(true);
    expect(isLoopbackBind('::1')).toBe(true);
    expect(isLoopbackBind('[::1]')).toBe(true);
  });

  it('does not treat a routable address as loopback', () => {
    expect(isLoopbackBind('0.0.0.0')).toBe(false);
    expect(isLoopbackBind('192.168.1.10')).toBe(false);
    // The near-miss that a naive `startsWith('127')` would get wrong.
    expect(isLoopbackBind('12.7.0.1')).toBe(false);
  });
});

describe('isPubliclyBound', () => {
  it('flags the addresses that mean every interface', () => {
    for (const ip of UNSPECIFIED_BIND_ADDRESSES) expect(isPubliclyBound(ip)).toBe(true);
  });

  it('does not flag loopback or an absent bind address', () => {
    expect(isPubliclyBound('127.0.0.1')).toBe(false);
    expect(isPubliclyBound(undefined)).toBe(false);
  });
});

describe('formatPortMapping', () => {
  it('includes the bind address so a loopback publish is not shown as world-facing', () => {
    expect(formatPortMapping({ private: 5432, public: 5432, type: 'tcp', ip: '127.0.0.1' }))
      .toBe('127.0.0.1:5432 → 5432/tcp');
    expect(formatPortMapping({ private: 80, public: 8080, type: 'tcp', ip: '0.0.0.0' }))
      .toBe('0.0.0.0:8080 → 80/tcp');
  });

  it('keeps the two bindings of a dual-stack publish distinguishable', () => {
    // Docker emits these as separate entries. Dropping the IP rendered them as
    // two identical lines, which reads as a rendering bug.
    const v4 = formatPortMapping({ private: 80, public: 8080, type: 'tcp', ip: '0.0.0.0' });
    const v6 = formatPortMapping({ private: 80, public: 8080, type: 'tcp', ip: '::' });
    expect(v4).not.toBe(v6);
  });

  it('brackets an IPv6 literal, as docker ps does', () => {
    // `::` + `:8080` would otherwise render `:::8080` — ambiguous, and unlike
    // anything the operator sees in `docker ps`.
    expect(formatPortMapping({ private: 80, public: 8080, type: 'tcp', ip: '::' }))
      .toBe('[::]:8080 → 80/tcp');
    expect(formatPortMapping({ private: 80, public: 8080, type: 'tcp', ip: '::1' }))
      .toBe('[::1]:8080 → 80/tcp');
    // Already-bracketed input is not double-bracketed.
    expect(formatPortMapping({ private: 80, public: 8080, type: 'tcp', ip: '[::]' }))
      .toBe('[::]:8080 → 80/tcp');
    // IPv4 is untouched.
    expect(formatPortMapping({ private: 80, public: 8080, type: 'tcp', ip: '0.0.0.0' }))
      .toBe('0.0.0.0:8080 → 80/tcp');
  });

  it('renders an exposed but unpublished port as the target alone', () => {
    expect(formatPortMapping({ private: 9000, type: 'tcp' })).toBe('9000/tcp');
  });

  it('falls back to the host port when Docker reported no bind address', () => {
    expect(formatPortMapping({ private: 80, public: 8080, type: 'tcp' })).toBe('8080 → 80/tcp');
  });
});
