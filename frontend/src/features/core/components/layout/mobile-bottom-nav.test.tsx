import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MobileBottomNav } from './mobile-bottom-nav';
import {
  mobilePrimaryDestinations,
  mobileDrawerDestinations,
} from '@/features/core/lib/navigation-manifest';

vi.mock('@/features/security/hooks/use-harbor-vulnerabilities', () => ({
  useHarborEnabled: () => ({ data: { enabled: true } }),
}));

function renderNav(initialRoute = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <MobileBottomNav />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MobileBottomNav', () => {
  it('renders primary navigation items', () => {
    renderNav();
    expect(screen.getByText(/Home/)).toBeTruthy();
    expect(screen.getByText(/Workloads/)).toBeTruthy();
    expect(screen.getByText(/Health/)).toBeTruthy();
    expect(screen.getByText(/Metrics/)).toBeTruthy();
  });

  it('renders More button', () => {
    renderNav();
    expect(screen.getByText('More')).toBeTruthy();
  });

  it('opens drawer when More is clicked', () => {
    renderNav();
    const moreButton = screen.getByLabelText('More pages', { selector: 'button' });
    fireEvent.click(moreButton);
    expect(screen.getByText('More Pages')).toBeTruthy();
    expect(screen.getByText(/Infrastructure/)).toBeTruthy();
    expect(screen.getByText(/Settings/)).toBeTruthy();
  });

  it('closes drawer when Close button is clicked', () => {
    renderNav();
    fireEvent.click(screen.getByLabelText('More pages', { selector: 'button' }));
    expect(screen.getByText('More Pages')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Close more pages'));
    expect(screen.queryByText('More Pages')).toBeNull();
  });

  it('has correct navigation role and label', () => {
    renderNav();
    const nav = screen.getByRole('navigation', { name: 'Mobile navigation' });
    expect(nav).toBeTruthy();
  });

  it('shows secondary nav items in the drawer grid', () => {
    renderNav();
    fireEvent.click(screen.getByLabelText('More pages', { selector: 'button' }));
    expect(screen.getByText(/Infrastructure/)).toBeTruthy();
    expect(screen.getByText(/Remediation/)).toBeTruthy();
    expect(screen.getByText(/Traces/)).toBeTruthy();
    expect(screen.getByText(/Assistant/)).toBeTruthy();
  });

  // --- Coverage: every destination must be reachable from a phone ----------

  it('reaches every manifest destination from the bar or the drawer', () => {
    renderNav();
    fireEvent.click(screen.getByLabelText('More pages', { selector: 'button' }));

    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    const expected = [
      ...mobilePrimaryDestinations,
      ...mobileDrawerDestinations({ harborEnabled: true }),
    ];
    for (const destination of expected) {
      expect(hrefs, `${destination.path} unreachable on mobile`).toContain(destination.path);
    }
  });

  it('exposes the destinations the curated list used to drop', () => {
    renderNav();
    fireEvent.click(screen.getByLabelText('More pages', { selector: 'button' }));
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    for (const path of [
      '/logs',
      '/security/audit',
      '/security/vulnerabilities',
      '/reports',
      '/llm-observability',
      '/ebpf-coverage',
    ]) {
      expect(hrefs).toContain(path);
    }
  });

  // --- Drawer accessibility ------------------------------------------------

  it('is a modal dialog, not an anonymous div', () => {
    renderNav();
    fireEvent.click(screen.getByLabelText('More pages', { selector: 'button' }));
    const dialog = screen.getByRole('dialog', { name: 'More pages' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('closes on Escape', () => {
    renderNav();
    fireEvent.click(screen.getByLabelText('More pages', { selector: 'button' }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('gives the scrim a keyboard-reachable control instead of a bare div onClick', () => {
    renderNav();
    fireEvent.click(screen.getByLabelText('More pages', { selector: 'button' }));
    const scrim = screen.getByTestId('mobile-drawer-scrim');
    expect(scrim.tagName).toBe('BUTTON');
    fireEvent.click(scrim);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('moves focus into the drawer on open and back to the opener on close', () => {
    renderNav();
    const opener = screen.getByLabelText('More pages', { selector: 'button' });
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(opener);
  });

  it('reports drawer state on the More button', () => {
    renderNav();
    const opener = screen.getByLabelText('More pages', { selector: 'button' });
    expect(opener).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(opener);
    expect(opener).toHaveAttribute('aria-expanded', 'true');
  });

  // --- Label legibility ----------------------------------------------------

  it('raises bottom-bar labels above the 10px floor', () => {
    renderNav();
    const home = screen.getByText('Home').closest('a');
    expect(home?.className).not.toContain('text-[10px]');
    expect(home?.className).toContain('text-xs');
  });
});
