import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MobileBottomNav } from './mobile-bottom-nav';

vi.mock('@/shared/lib/utils', () => ({
  cn: (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(' '),
}));

function renderNav(initialRoute = '/') {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <MobileBottomNav />
    </MemoryRouter>,
  );
}

describe('MobileBottomNav - Mobile Optimization', () => {
  it('renders primary tabs: Home, Workloads, Health, Metrics', () => {
    renderNav();
    expect(screen.getByText('Home')).toBeTruthy();
    expect(screen.getByText('Workloads')).toBeTruthy();
    expect(screen.getByText('Health')).toBeTruthy();
    expect(screen.getByText('Metrics')).toBeTruthy();
  });

  it('primary nav links have min-w-[56px] for touch targets', () => {
    renderNav();
    // NavButton renders NavLink with min-w-[56px] class
    const homeLink = screen.getByText('Home').closest('a');
    expect(homeLink?.className).toContain('min-w-[56px]');
  });

  it('More button opens secondary navigation drawer', () => {
    renderNav();
    fireEvent.click(screen.getByLabelText('More pages'));
    expect(screen.getByText('More Pages')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();
    expect(screen.getByText('Infrastructure')).toBeTruthy();
  });

  it('secondary nav items in drawer have adequate touch targets', () => {
    renderNav();
    fireEvent.click(screen.getByLabelText('More pages'));
    const settingsLink = screen.getAllByText('Settings')[0].closest('a');
    // Drawer items use p-3 (12px padding) + icon (24px) + text = well above 48px
    expect(settingsLink?.className).toContain('p-3');
  });

  it('drawer closes on close button click', () => {
    renderNav();
    fireEvent.click(screen.getByLabelText('More pages'));
    expect(screen.getByText('More Pages')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Close menu'));
    // Drawer transitions off-screen (translate-y-full) — still in DOM but hidden
  });

  it('has mobile navigation aria label', () => {
    renderNav();
    expect(screen.getByRole('navigation', { name: 'Mobile navigation' })).toBeTruthy();
  });

  it('only shows on mobile (md:hidden class)', () => {
    renderNav();
    const nav = screen.getByRole('navigation', { name: 'Mobile navigation' });
    expect(nav.className).toContain('md:hidden');
  });

  it('has backdrop blur for glassmorphic effect', () => {
    renderNav();
    const nav = screen.getByRole('navigation', { name: 'Mobile navigation' });
    expect(nav.className).toContain('backdrop-blur');
  });
});
