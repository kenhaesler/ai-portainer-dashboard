import type { Container } from '@/features/containers/hooks/use-containers';

/**
 * Reading Docker's host-side bind address.
 *
 * Whether a port is published on `127.0.0.1` or `0.0.0.0` is the most
 * security-relevant fact about it, and it is also the only thing separating the
 * IPv4 and IPv6 bindings Docker emits for the same mapping — without it they
 * render as two identical rows and the table looks broken.
 *
 * These live here rather than beside one renderer because two surfaces show
 * ports (the container detail table and the topology side panel) and a second
 * copy of "which addresses mean every interface" is a copy that drifts.
 */

export type PortMapping = Container['ports'][number];

/** Host bind addresses that mean "every interface on this host". */
export const UNSPECIFIED_BIND_ADDRESSES = new Set(['0.0.0.0', '::', '[::]']);

export function isLoopbackBind(ip: string): boolean {
  return ip === '::1' || ip === '[::1]' || ip.startsWith('127.');
}

/** True when the mapping is reachable from outside the host. */
export function isPubliclyBound(ip: string | undefined): boolean {
  return !!ip && UNSPECIFIED_BIND_ADDRESSES.has(ip);
}

/**
 * One-line rendering of a mapping for compact surfaces, e.g.
 * `127.0.0.1:5432 → 5432/tcp`.
 *
 * The bind address is included whenever the port is published, so a
 * loopback-only publish is never displayed identically to a world-facing one,
 * and the two bindings of a dual-stack publish stay distinguishable.
 */
/**
 * Bracket an IPv6 literal before appending a port.
 *
 * Without this, `::` + `:8080` renders as `:::8080`, which is ambiguous and
 * matches nothing an operator has seen elsewhere — Docker's own `docker ps`
 * prints `[::]:8080->80/tcp`.
 */
function formatHostAddress(ip: string): string {
  return ip.includes(':') && !ip.startsWith('[') ? `[${ip}]` : ip;
}

export function formatPortMapping(port: PortMapping): string {
  const target = `${port.private}/${port.type}`;
  if (port.public === undefined) return target;
  const host = port.ip ? `${formatHostAddress(port.ip)}:${port.public}` : String(port.public);
  return `${host} → ${target}`;
}
