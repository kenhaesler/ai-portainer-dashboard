import { describe, it, expect } from 'vitest';
import type { RouteObject } from 'react-router';
import { appRoutes } from '@/router';
import {
  navDestinations,
  palettePages,
  sidebarNavigation,
  pinnedNavDestinations,
  mobilePrimaryDestinations,
  mobileDrawerDestinations,
  mobileLabel,
  breadcrumbLabelForPath,
  closestDestination,
  findDestination,
  BREADCRUMB_ONLY_LABELS,
  ROUTES_WITHOUT_NAV_ENTRY,
  NAV_GROUP_ORDER,
} from './navigation-manifest';

/**
 * The route list used to live in four hand-maintained copies (sidebar,
 * header breadcrumb, command palette, mobile bottom nav) and they drifted:
 * 7 routes rendered "Dashboard / Dashboard", 5 were missing from the command
 * palette, 6 were unreachable from a phone. These tests exist so that drift
 * fails the build rather than shipping.
 */

function join(parent: string, segment: string): string {
  if (segment.startsWith('/')) return segment;
  const base = parent === '/' ? '' : parent;
  return `${base}/${segment}`;
}

function collectRoutePaths(routes: RouteObject[], parent = ''): string[] {
  const out: string[] = [];
  for (const route of routes) {
    const full = route.index ? parent || '/' : join(parent, route.path ?? '');
    if (route.index || route.path !== undefined) out.push(full);
    if (route.children) out.push(...collectRoutePaths(route.children, full));
  }
  return out;
}

/** Concrete, linkable paths — no `:params`, no `*` splat. */
const concreteRoutePaths = Array.from(
  new Set(
    collectRoutePaths(appRoutes).filter((p) => !p.includes(':') && !p.includes('*')),
  ),
);

const manifestPaths = navDestinations.map((d) => d.path);

describe('navigation manifest — route coverage', () => {
  it('the router exposes the routes we expect to cover', () => {
    // Guards the walker itself: if this drops to a handful of paths the
    // coverage assertions below would pass vacuously.
    expect(concreteRoutePaths.length).toBeGreaterThan(20);
    expect(concreteRoutePaths).toContain('/');
    expect(concreteRoutePaths).toContain('/logs');
    expect(concreteRoutePaths).toContain('/security/vulnerabilities');
  });

  it('every reachable route has a manifest entry, a breadcrumb label, or a documented exemption', () => {
    const uncovered = concreteRoutePaths.filter(
      (path) =>
        !manifestPaths.includes(path) &&
        !(path in BREADCRUMB_ONLY_LABELS) &&
        !(path in ROUTES_WITHOUT_NAV_ENTRY),
    );
    expect(uncovered).toEqual([]);
  });

  it('every manifest entry points at a route that actually exists', () => {
    const dangling = manifestPaths.filter((path) => !concreteRoutePaths.includes(path));
    expect(dangling).toEqual([]);
  });

  it('every navigable route resolves to a breadcrumb label — never the generic "Dashboard"', () => {
    const navigable = concreteRoutePaths.filter((p) => !(p in ROUTES_WITHOUT_NAV_ENTRY));
    for (const path of navigable) {
      const label = breadcrumbLabelForPath(path);
      expect(label, `no breadcrumb label for ${path}`).toBeTruthy();
      expect(label, `${path} still falls through to the generic label`).not.toBe('Dashboard');
    }
  });

  it('resolves nested routes to their section label', () => {
    expect(breadcrumbLabelForPath('/containers/1/abc123')).toBe('Workloads');
    expect(breadcrumbLabelForPath('/investigations/42')).toBe('Investigation');
    expect(breadcrumbLabelForPath('/security/audit')).toBe('Security Audit');
  });

  it('returns null for a genuinely unknown path instead of inventing one', () => {
    expect(breadcrumbLabelForPath('/does-not-exist')).toBeNull();
  });
});

describe('navigation manifest — entry integrity', () => {
  it('gives every entry a non-empty label', () => {
    for (const destination of navDestinations) {
      expect(destination.label.trim(), `empty label for ${destination.path}`).not.toBe('');
    }
  });

  it('has no duplicate paths', () => {
    expect(new Set(manifestPaths).size).toBe(manifestPaths.length);
  });

  it('resolves each entry back to its own label', () => {
    for (const destination of navDestinations) {
      expect(breadcrumbLabelForPath(destination.path)).toBe(destination.label);
    }
  });

  it('gives every entry an icon', () => {
    for (const destination of navDestinations) {
      expect(destination.icon, `no icon for ${destination.path}`).toBeTruthy();
    }
  });
});

describe('navigation manifest — the three lists cannot drift', () => {
  it('offers every destination in the command palette', () => {
    const palettePaths = palettePages.map((p) => p.path);
    for (const destination of navDestinations) {
      expect(palettePaths, `${destination.path} is missing from ⌘K`).toContain(destination.path);
    }
  });

  it('includes the on-call destinations that ⌘K used to omit', () => {
    const palettePaths = palettePages.map((p) => p.path);
    for (const path of [
      '/logs',
      '/packet-capture',
      '/ebpf-coverage',
      '/reports',
      '/security/vulnerabilities',
    ]) {
      expect(palettePaths).toContain(path);
    }
  });

  it('renders every non-shortcut destination in the sidebar', () => {
    const groups = sidebarNavigation({ harborEnabled: true });
    const sidebarPaths = [
      ...groups.flatMap((g) => g.items.map((i) => i.path)),
      ...pinnedNavDestinations.map((i) => i.path),
    ];
    for (const destination of navDestinations) {
      if (destination.paletteOnly) {
        expect(sidebarPaths).not.toContain(destination.path);
      } else {
        expect(sidebarPaths, `${destination.path} is missing from the sidebar`).toContain(
          destination.path,
        );
      }
    }
  });

  it('reaches every non-shortcut destination from the mobile nav', () => {
    const mobilePaths = [
      ...mobilePrimaryDestinations.map((d) => d.path),
      ...mobileDrawerDestinations({ harborEnabled: true }).map((d) => d.path),
    ];
    for (const destination of navDestinations) {
      if (destination.paletteOnly) continue;
      expect(mobilePaths, `${destination.path} is unreachable on mobile`).toContain(
        destination.path,
      );
    }
  });

  it('keeps the sidebar and the palette using the same words for the same route', () => {
    const groups = sidebarNavigation({ harborEnabled: true });
    for (const group of groups) {
      for (const item of group.items) {
        const paletteEntry = palettePages.find((p) => p.path === item.path);
        expect(paletteEntry?.label).toBe(item.label);
      }
    }
  });

  it('never puts a destination in both the mobile bar and the drawer', () => {
    const primary = mobilePrimaryDestinations.map((d) => d.path);
    const drawer = mobileDrawerDestinations({ harborEnabled: true }).map((d) => d.path);
    expect(primary.filter((p) => drawer.includes(p))).toEqual([]);
  });
});

describe('navigation manifest — grouping and gating', () => {
  it('renders the intent-based groups in order, none empty', () => {
    const groups = sidebarNavigation({ harborEnabled: true });
    expect(groups.map((g) => g.title)).toEqual([...NAV_GROUP_ORDER]);
    for (const group of groups) {
      expect(group.items.length, `${group.title} is empty`).toBeGreaterThan(0);
    }
  });

  it('hides Harbor vulnerabilities until Harbor is configured', () => {
    const gated = sidebarNavigation({ harborEnabled: false })
      .flatMap((g) => g.items)
      .map((i) => i.path);
    expect(gated).not.toContain('/security/vulnerabilities');

    const drawer = mobileDrawerDestinations({ harborEnabled: false }).map((d) => d.path);
    expect(drawer).not.toContain('/security/vulnerabilities');
  });

  it('pins Settings outside the themed groups', () => {
    expect(pinnedNavDestinations.map((d) => d.path)).toEqual(['/settings']);
    const grouped = sidebarNavigation({ harborEnabled: true }).flatMap((g) => g.items);
    expect(grouped.map((i) => i.path)).not.toContain('/settings');
  });

  it('adopts the shorter mobile names as the single name everywhere', () => {
    expect(findDestination('/workloads')?.label).toBe('Workloads');
    expect(findDestination('/images')?.label).toBe('Images');
    expect(findDestination('/topology')?.label).toBe('Topology');
    expect(findDestination('/traces')?.label).toBe('Traces');
    expect(findDestination('/assistant')?.label).toBe('Assistant');
    expect(findDestination('/edge-logs')?.label).toBe('Edge Logs');
  });

  it('uses compact labels only in the four-slot mobile bar', () => {
    expect(mobilePrimaryDestinations).toHaveLength(4);
    expect(mobileLabel(findDestination('/health')!)).toBe('Health');
    expect(mobileLabel(findDestination('/metrics')!)).toBe('Metrics');
    // Everything without a shortLabel falls back to the one name.
    expect(mobileLabel(findDestination('/workloads')!)).toBe('Workloads');
  });
});

describe('closestDestination', () => {
  it('suggests the nearest route for a near-miss URL', () => {
    expect(closestDestination('/workload')?.path).toBe('/workloads');
    expect(closestDestination('/log')?.path).toBe('/logs');
    expect(closestDestination('/security')?.path).toMatch(/^\/security\//);
  });

  it('tolerates a one-character slip in a bookmarked URL', () => {
    expect(closestDestination('/workloadz')?.path).toBe('/workloads');
  });

  it('matches on the label as well as the path', () => {
    expect(closestDestination('/vulnerabilities')?.path).toBe('/security/vulnerabilities');
  });

  it('returns null when nothing is close', () => {
    expect(closestDestination('/zzzzzzzz')).toBeNull();
  });
});
