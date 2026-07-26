import type { ComponentType } from 'react';
import {
  LayoutDashboard,
  Boxes,
  Server,
  PackageOpen,
  HeartPulse,
  BarChart3,
  MessageSquare,
  Activity,
  GitBranch,
  Bug,
  Network,
  Radio,
  ScrollText,
  FileSearch,
  Shield,
  ShieldAlert,
  FileBarChart,
  Settings,
  Webhook,
  Users,
} from 'lucide-react';

/**
 * The one route registry.
 *
 * The sidebar, the header breadcrumb, the command palette and the mobile
 * bottom nav all derive their destination lists from this file. They used to
 * keep four hand-maintained copies, which drifted: seven routes had no
 * breadcrumb label and rendered "Dashboard / Dashboard", five were missing
 * from the command palette, and six (including the whole Security group and
 * the Log Viewer) were unreachable on a phone.
 *
 * Adding a route means adding it here — or, if it deliberately has no
 * navigation entry, listing it in `BREADCRUMB_ONLY_LABELS` or
 * `ROUTES_WITHOUT_NAV_ENTRY` with a reason. `navigation-manifest.test.ts`
 * walks the real router and fails if a route matches none of the three.
 */

/** Sidebar groups, in the order they are rendered. */
export const NAV_GROUP_ORDER = [
  'Overview',
  'Monitoring',
  'Intelligence',
  'Diagnostics',
  'Security',
  'Operations',
] as const;

export type NavGroupTitle = (typeof NAV_GROUP_ORDER)[number];

/**
 * `Pinned` sits at the foot of the sidebar outside the themed groups;
 * `Shortcuts` never appears in a nav surface at all — those entries are
 * command-palette-only jumps to a redirect route.
 */
export type NavSection = NavGroupTitle | 'Pinned' | 'Shortcuts';

/** Feature flags that can hide a destination entirely. */
export type NavFeatureGate = 'harbor';

export interface NavDestination {
  /** Absolute path, exactly as registered in `router.tsx`. */
  path: string;
  /**
   * The single name for this destination. Used by the sidebar, the
   * breadcrumb, the command palette and the mobile drawer alike — the app
   * previously used three different names for several routes.
   */
  label: string;
  /**
   * Compact label for the five-slot mobile bottom bar only, where a long
   * label truncates below legibility. Everything else uses `label`.
   */
  shortLabel?: string;
  section: NavSection;
  icon: ComponentType<{ className?: string }>;
  /**
   * Reachable from the command palette only. These paths are redirects into
   * a Settings tab, not pages with their own chrome, so they must not appear
   * in the sidebar or the mobile nav.
   */
  paletteOnly?: boolean;
  /** Hidden from every surface unless the named integration is configured. */
  featureGate?: NavFeatureGate;
  /** Occupies one of the four primary slots in the mobile bottom bar. */
  mobilePrimary?: boolean;
}

/**
 * Grouped by operator intent: what's running -> is it healthy -> ask the AI ->
 * why -> security posture -> act. Remediation is the one mutating workflow and
 * lives alone under Operations to keep the observer-first separation between
 * looking and acting. Settings is pinned separately (section `Pinned`).
 */
export const navDestinations: readonly NavDestination[] = [
  // Overview
  { path: '/', label: 'Home', section: 'Overview', icon: LayoutDashboard, mobilePrimary: true },
  { path: '/workloads', label: 'Workloads', section: 'Overview', icon: Boxes, mobilePrimary: true },
  { path: '/infrastructure', label: 'Infrastructure', section: 'Overview', icon: Server },
  { path: '/images', label: 'Images', section: 'Overview', icon: PackageOpen },

  // Monitoring
  {
    path: '/health',
    label: 'Health & Monitoring',
    shortLabel: 'Health',
    section: 'Monitoring',
    icon: HeartPulse,
    mobilePrimary: true,
  },
  {
    path: '/metrics',
    label: 'Metrics Dashboard',
    shortLabel: 'Metrics',
    section: 'Monitoring',
    icon: BarChart3,
    mobilePrimary: true,
  },

  // Intelligence
  { path: '/assistant', label: 'Assistant', section: 'Intelligence', icon: MessageSquare },
  { path: '/llm-observability', label: 'LLM Observability', section: 'Intelligence', icon: Activity },

  // Diagnostics
  { path: '/traces', label: 'Traces', section: 'Diagnostics', icon: GitBranch },
  { path: '/ebpf-coverage', label: 'eBPF Coverage', section: 'Diagnostics', icon: Bug },
  { path: '/topology', label: 'Topology', section: 'Diagnostics', icon: Network },
  { path: '/packet-capture', label: 'Packet Capture', section: 'Diagnostics', icon: Radio },
  { path: '/logs', label: 'Log Viewer', section: 'Diagnostics', icon: ScrollText },
  { path: '/edge-logs', label: 'Edge Logs', section: 'Diagnostics', icon: FileSearch },

  // Security
  { path: '/security/audit', label: 'Security Audit', section: 'Security', icon: Shield },
  {
    path: '/security/vulnerabilities',
    label: 'Vulnerabilities',
    section: 'Security',
    icon: ShieldAlert,
    featureGate: 'harbor',
  },

  // Operations
  { path: '/remediation', label: 'Remediation', section: 'Operations', icon: Shield },
  { path: '/reports', label: 'Reports', section: 'Operations', icon: FileBarChart },

  // Pinned at the foot of the sidebar
  { path: '/settings', label: 'Settings', section: 'Pinned', icon: Settings },

  // Command-palette-only redirect shortcuts into Settings tabs
  { path: '/webhooks', label: 'Webhooks', section: 'Shortcuts', icon: Webhook, paletteOnly: true },
  { path: '/users', label: 'Users', section: 'Shortcuts', icon: Users, paletteOnly: true },
];

/**
 * Routes with no navigation entry that still need a breadcrumb. Reached from
 * inside another page rather than from the nav.
 */
export const BREADCRUMB_ONLY_LABELS: Readonly<Record<string, string>> = {
  '/backups': 'Backups',
  '/containers': 'Workloads',
  '/investigations': 'Investigation',
};

/**
 * Routes that deliberately have neither a nav entry nor a breadcrumb, with the
 * reason. The manifest test fails on any router path that is in none of the
 * three registries, so a new route cannot be added without a decision here.
 */
export const ROUTES_WITHOUT_NAV_ENTRY: Readonly<Record<string, string>> = {
  '/login': 'Unauthenticated, rendered outside AppLayout',
  '/auth/callback': 'OIDC hand-off, redirects immediately',
  '/status': 'Public status page, rendered outside AppLayout',
  '/fleet': 'Alias, redirects to /infrastructure?tab=fleet',
  '/stacks': 'Alias, redirects to /infrastructure?tab=stacks',
  '/ai-monitor': 'Alias, redirects to /health',
  '/comparison': 'Redirect shim into /workloads with a comparison selection',
};

// --- Derived views -------------------------------------------------------

export interface NavGroup {
  title: NavGroupTitle;
  items: NavDestination[];
}

function passesGate(
  destination: NavDestination,
  enabledFeatures: { harborEnabled?: boolean },
): boolean {
  if (destination.featureGate === 'harbor') return enabledFeatures.harborEnabled === true;
  return true;
}

/** Sidebar groups, in order, with feature-gated destinations removed. */
export function sidebarNavigation(
  enabledFeatures: { harborEnabled?: boolean } = {},
): NavGroup[] {
  return NAV_GROUP_ORDER.map((title) => ({
    title,
    items: navDestinations.filter(
      (d) => d.section === title && passesGate(d, enabledFeatures),
    ),
  }));
}

/** Destinations pinned below the sidebar groups (Settings). */
export const pinnedNavDestinations: readonly NavDestination[] = navDestinations.filter(
  (d) => d.section === 'Pinned',
);

/**
 * Every destination the command palette offers, including the palette-only
 * Settings shortcuts. Feature-gated entries stay listed: the palette is a
 * search surface, and a gated page still renders its own not-configured state.
 */
export const palettePages: readonly NavDestination[] = navDestinations;

/** The four destinations promoted to the mobile bottom bar. */
export const mobilePrimaryDestinations: readonly NavDestination[] = navDestinations.filter(
  (d) => d.mobilePrimary,
);

/**
 * Everything else, for the mobile "More" drawer. The drawer is a scrollable
 * grid — there is no reason for this list to be curated, and curating it is
 * what left the entire Security group unreachable from a phone.
 */
export function mobileDrawerDestinations(
  enabledFeatures: { harborEnabled?: boolean } = {},
): NavDestination[] {
  return navDestinations.filter(
    (d) => !d.mobilePrimary && !d.paletteOnly && passesGate(d, enabledFeatures),
  );
}

/** The label the mobile bottom bar shows (compact where one is defined). */
export function mobileLabel(destination: NavDestination): string {
  return destination.shortLabel ?? destination.label;
}

const destinationByPath = new Map(navDestinations.map((d) => [d.path, d]));

export function findDestination(pathname: string): NavDestination | undefined {
  return destinationByPath.get(pathname);
}

/**
 * The breadcrumb label for a pathname: exact match first, then the longest
 * registered prefix so nested routes (`/containers/1/abc`,
 * `/investigations/42`) still name their section. Returns `null` when the
 * path is genuinely unknown — callers must not substitute a generic word,
 * which is how "Dashboard / Dashboard" happened.
 */
export function breadcrumbLabelForPath(pathname: string): string | null {
  const exact = destinationByPath.get(pathname);
  if (exact) return exact.label;
  if (BREADCRUMB_ONLY_LABELS[pathname]) return BREADCRUMB_ONLY_LABELS[pathname];

  const candidates: Array<[string, string]> = [
    ...navDestinations.map((d): [string, string] => [d.path, d.label]),
    ...Object.entries(BREADCRUMB_ONLY_LABELS),
  ];

  let best: [string, string] | null = null;
  for (const candidate of candidates) {
    const [prefix] = candidate;
    if (prefix === '/') continue;
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      if (!best || prefix.length > best[0].length) best = candidate;
    }
  }
  return best ? best[1] : null;
}

/**
 * Best guess at what an operator meant when a URL does not resolve — used by
 * the 404 page so a stale bookmark points somewhere instead of silently
 * becoming Home. Scores on shared path segments, then on substring overlap.
 */
function sharedPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i += 1;
  return i;
}

export function closestDestination(pathname: string): NavDestination | null {
  const wanted = pathname.toLowerCase().split('/').filter(Boolean);
  if (wanted.length === 0) return null;

  let best: { destination: NavDestination; score: number } | null = null;
  for (const destination of navDestinations) {
    if (destination.path === '/') continue;
    const segments = destination.path.toLowerCase().split('/').filter(Boolean);
    let score = 0;
    for (const segment of segments) {
      for (const term of wanted) {
        if (segment === term) score += 10;
        else if (segment.startsWith(term) || term.startsWith(segment)) score += 5;
        else if (segment.includes(term) || term.includes(segment)) score += 3;
        // Tolerate a one-character slip in a bookmarked URL.
        else if (sharedPrefixLength(segment, term) >= 4) score += 2;
      }
    }
    const labelTerms = destination.label.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    for (const labelTerm of labelTerms) {
      for (const term of wanted) {
        if (labelTerm === term) score += 4;
        else if (labelTerm.startsWith(term) && term.length >= 3) score += 2;
      }
    }
    if (score > 0 && (!best || score > best.score)) best = { destination, score };
  }
  return best ? best.destination : null;
}
