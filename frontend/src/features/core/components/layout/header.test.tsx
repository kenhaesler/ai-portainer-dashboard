import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Header } from './header';

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

vi.mock('@/stores/ui-store', () => ({
  useUiStore: (selector: (s: {
    setCommandPaletteOpen: (open: boolean) => void;
    potatoMode: boolean;
    setPotatoMode: (enabled: boolean) => void;
  }) => unknown) =>
    selector({
      setCommandPaletteOpen: vi.fn(),
      potatoMode: false,
      setPotatoMode: vi.fn(),
    }),
}));

vi.mock('@/components/shared/connection-orb', () => ({
  ConnectionOrb: () => <div data-testid="connection-orb" />,
}));

describe('Header', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_GIT_COMMIT', 'abc1234');
    vi.stubEnv('DEV', 'true');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ commit: 'def5678' }),
    } as Response);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('renders commit hash in the top header', async () => {
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    );

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

    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    );

    expect(await screen.findByText(/(DEV|BUILD) build-202602/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Build (DEV|BUILD) build-202602/i)).toBeInTheDocument();
  });

  it('renders potato mode toggle in header actions', async () => {
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    );

    expect(await screen.findByRole('switch', { name: /potato mode off/i })).toBeInTheDocument();
  });

  it('renders explicit build number identifiers', async () => {
    vi.stubEnv('VITE_BUILD_NUMBER', '20260213.7');
    vi.stubEnv('VITE_GIT_COMMIT', '');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => null,
    } as Response);

    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    );

    expect(await screen.findByText(/(DEV|BUILD) 20260213.7/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Build (DEV|BUILD) 20260213.7/i)).toBeInTheDocument();
  });
});
