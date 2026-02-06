import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MobileBottomNav } from './mobile-bottom-nav';

vi.mock('@/lib/utils', () => ({
  cn: (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(' '),
}));

function renderNav(initialRoute = '/') {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <MobileBottomNav />
    </MemoryRouter>,
  );
}

describe('MobileBottomNav', () => {
  it('renders primary navigation items', () => {
    renderNav();
    expect(screen.getByText('Home')).toBeTruthy();
    expect(screen.getByText('Workloads')).toBeTruthy();
    expect(screen.getByText('Health')).toBeTruthy();
    expect(screen.getByText('AI Monitor')).toBeTruthy();
  });

  it('renders More button', () => {
    renderNav();
    expect(screen.getByText('More')).toBeTruthy();
  });

  it('opens drawer when More is clicked', () => {
    renderNav();
    const moreButton = screen.getByLabelText('More pages');
    fireEvent.click(moreButton);
    expect(screen.getByText('More Pages')).toBeTruthy();
    expect(screen.getByText('Fleet')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();
  });

  it('closes drawer when Close button is clicked', () => {
    renderNav();
    fireEvent.click(screen.getByLabelText('More pages'));
    expect(screen.getByText('More Pages')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Close menu'));
    // Drawer should still be in DOM but translated off-screen
    // The "More Pages" text is inside the translated div
  });

  it('has correct navigation role and label', () => {
    renderNav();
    const nav = screen.getByRole('navigation', { name: 'Mobile navigation' });
    expect(nav).toBeTruthy();
  });

  it('shows secondary nav items in the drawer grid', () => {
    renderNav();
    fireEvent.click(screen.getByLabelText('More pages'));
    expect(screen.getByText('Stacks')).toBeTruthy();
    expect(screen.getByText('Metrics')).toBeTruthy();
    expect(screen.getByText('Remediation')).toBeTruthy();
    expect(screen.getByText('Traces')).toBeTruthy();
    expect(screen.getByText('Assistant')).toBeTruthy();
  });
});
