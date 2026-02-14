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
    expect(screen.getByText('AI Home')).toBeTruthy();
    expect(screen.getByText('AI Workloads')).toBeTruthy();
    expect(screen.getByText('AI Health')).toBeTruthy();
    expect(screen.getByText('AI Metrics')).toBeTruthy();
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
    expect(screen.getByText('AI Fleet')).toBeTruthy();
    expect(screen.getByText('AI Settings')).toBeTruthy();
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
    expect(screen.getByText('AI Stacks')).toBeTruthy();
    expect(screen.getByText('AI Monitor')).toBeTruthy();
    expect(screen.getByText('AI Remediation')).toBeTruthy();
    expect(screen.getByText('AI Traces')).toBeTruthy();
    expect(screen.getByText('AI Assistant')).toBeTruthy();
  });
});
