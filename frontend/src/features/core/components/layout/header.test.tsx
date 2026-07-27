import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Header, prefersCommandKey } from './header';
import { useHeaderContextStore } from '@/stores/header-context-store';

vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({
    username: 'simon',
    logout: vi.fn(),
  }),
}));

const mockThemeStore = vi.hoisted(() => ({
  useThemeStore: Object.assign(
    vi.fn(() => ({
      theme: 'dark',
      toggleTheme: vi.fn(),
      dashboardBackground: 'none',
    })),
    {
      getState: () => ({ resolvedTheme: () => 'dark' }),
    }
  ),
}));

vi.mock('@/stores/theme-store', () => ({
  useThemeStore: mockThemeStore.useThemeStore,
}));

const setPotatoMode = vi.fn();
vi.mock('@/stores/ui-store', () => ({
  useUiStore: (selector: (s: {
    setCommandPaletteOpen: (open: boolean) => void;
    potatoMode: boolean;
    setPotatoMode: (enabled: boolean) => void;
  }) => unknown) =>
    selector({
      setCommandPaletteOpen: vi.fn(),
      potatoMode: false,
      setPotatoMode,
    }),
}));

vi.mock('@/shared/components/ui/connection-orb', () => ({
  ConnectionOrb: () => <div data-testid="connection-orb" />,
}));

const mockContainerDetail = vi.hoisted(() => ({ data: undefined as { name: string } | undefined }));
vi.mock('@/features/containers/hooks/use-container-detail', () => ({
  useContainerDetail: () => mockContainerDetail,
}));

function renderAt(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Header />
    </MemoryRouter>
  );
}

describe('Header', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_GIT_COMMIT', 'abc1234');
    // `DEV` is a boolean on `ImportMetaEnv`, and vi.stubEnv coerces it to
    // Vite's "1"/"" the same way for `true` as it did for the string 'true'.
    vi.stubEnv('DEV', true);
    mockContainerDetail.data = undefined;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ commit: 'def5678' }),
    } as Response);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    useHeaderContextStore.setState({ metricsContainerName: null });
  });

  it('renders commit hash in the top header', async () => {
    renderAt();

    expect(await screen.findByText('DEV def5678')).toBeInTheDocument();
    expect(screen.getByLabelText('Build DEV def5678')).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith('/__commit');
  });

  it('renders non-hash build identifiers too', async () => {
    vi.stubEnv('VITE_GIT_COMMIT', 'build-20260213');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => null,
    } as Response);

    renderAt();

    expect(await screen.findByText(/(DEV|BUILD) build-202602/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Build (DEV|BUILD) build-202602/i)).toBeInTheDocument();
  });

  it('hides the build badge below md so it cannot wrap to two lines on a phone', async () => {
    renderAt();
    const badge = await screen.findByLabelText('Build DEV def5678');
    expect(badge.className).toContain('hidden');
    expect(badge.className).toContain('md:inline-flex');
  });

  it('renders explicit build number identifiers', async () => {
    vi.stubEnv('VITE_BUILD_NUMBER', '20260213.7');
    vi.stubEnv('VITE_GIT_COMMIT', '');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => null,
    } as Response);

    renderAt();

    expect(await screen.findByText(/(DEV|BUILD) 20260213.7/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Build (DEV|BUILD) 20260213.7/i)).toBeInTheDocument();
  });

  it('renders the metrics container name when set', () => {
    useHeaderContextStore.setState({ metricsContainerName: 'nginx-proxy' });
    renderAt();
    expect(screen.getByTestId('header-context-name')).toHaveTextContent('nginx-proxy');
  });

  it('renders no container name when unset', () => {
    useHeaderContextStore.setState({ metricsContainerName: null });
    renderAt();
    expect(screen.queryByTestId('header-context-name')).toBeNull();
  });

  // --- Breadcrumb ---------------------------------------------------------

  it('calls / "Home" — the same word as the sidebar and the page h1', () => {
    renderAt('/');
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(crumbs).toHaveTextContent('Home');
    expect(crumbs).not.toHaveTextContent('Dashboard');
  });

  it.each([
    ['/llm-observability', 'LLM Observability'],
    ['/ebpf-coverage', 'eBPF Coverage'],
    ['/packet-capture', 'Packet Capture'],
    ['/logs', 'Log Viewer'],
    ['/security/vulnerabilities', 'Vulnerabilities'],
    ['/reports', 'Reports'],
  ])('labels %s as %s instead of "Dashboard / Dashboard"', (path, label) => {
    renderAt(path);
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(crumbs).toHaveTextContent(`Home/${label}`);
    expect(crumbs.textContent).not.toContain('Dashboard');
  });

  it('says so when the URL does not resolve, rather than naming another page', () => {
    renderAt('/no-such-page');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent(
      'Page not found',
    );
  });

  it('names the container on the container detail route', () => {
    mockContainerDetail.data = { name: 'lcm-web' };
    renderAt('/containers/1/abc123def456');
    expect(screen.getByTestId('header-container-name')).toHaveTextContent('lcm-web');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).not.toHaveTextContent(
      'Container Details',
    );
  });

  it('falls back to the short container id before the name loads', () => {
    mockContainerDetail.data = undefined;
    renderAt('/containers/1/abc123def456');
    expect(screen.getByTestId('header-container-name')).toHaveTextContent('abc123def456');
  });

  it('lets the breadcrumb shrink so the right-hand cluster stays on screen', () => {
    renderAt('/workloads');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).className).toContain('min-w-0');
  });

  // --- Search trigger -----------------------------------------------------

  it('shows one keyboard hint for search, not two', () => {
    renderAt();
    const search = screen.getByRole('button', { name: 'Search' });
    expect(search.querySelectorAll('kbd')).toHaveLength(1);
    expect(search.textContent).not.toContain('/');
  });

  it('detects an Apple keyboard without the deprecated navigator.platform', () => {
    expect(
      prefersCommandKey({ platform: '', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' } as Navigator),
    ).toBe(true);
    expect(
      prefersCommandKey({
        userAgentData: { platform: 'macOS' },
        platform: '',
        userAgent: '',
      } as unknown as Navigator),
    ).toBe(true);
    expect(
      prefersCommandKey({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0)' } as Navigator),
    ).toBe(false);
  });

  // --- Potato mode --------------------------------------------------------

  it('keeps potato mode as a labelled switch in the user menu', async () => {
    renderAt();
    expect(screen.queryByRole('switch', { name: /potato mode/i })).toBeNull();

    fireEvent.click(screen.getByTestId('user-menu-trigger'));

    const toggle = await screen.findByRole('switch', { name: /potato mode off/i });
    expect(toggle).toBeInTheDocument();
    // Visible text label, not a bare emoji.
    expect(toggle).toHaveTextContent('Potato mode');

    fireEvent.click(toggle);
    expect(setPotatoMode).toHaveBeenCalledWith(true);
  });
});
