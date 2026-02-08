import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  useUiStore: (selector: (s: { setCommandPaletteOpen: (open: boolean) => void }) => void) =>
    selector({ setCommandPaletteOpen: vi.fn() }),
}));

const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: mockApi,
}));

vi.mock('@/components/shared/connection-orb', () => ({
  ConnectionOrb: () => <div data-testid="connection-orb" />,
}));

describe('Header', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_GIT_COMMIT', 'abc1234');
    mockApi.get.mockResolvedValue({ commit: 'def5678' });
  });

  it('renders commit hash in the top header', async () => {
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    );

    expect(await screen.findByText('def5678')).toBeInTheDocument();
    expect(screen.getByLabelText('Build def5678')).toBeInTheDocument();
    expect(mockApi.get).toHaveBeenCalledWith('/api/version');
  });
});
