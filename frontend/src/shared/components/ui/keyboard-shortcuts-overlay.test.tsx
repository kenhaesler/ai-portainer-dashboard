import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KeyboardShortcutsOverlay } from './keyboard-shortcuts-overlay';
import {
  NAV_CHORDS,
  breadcrumbLabelForPath,
} from '@/features/core/lib/navigation-manifest';

describe('KeyboardShortcutsOverlay — labels derive from the navigation manifest', () => {
  // This overlay used to carry its own hardcoded copy of the route labels — the
  // sixth such copy in the app — and it had already drifted, advertising "Go to
  // Network Topology" / "Go to Trace Explorer" / "Go to LLM Assistant" while the
  // sidebar and breadcrumb said Topology / Traces / Assistant. These tests fail
  // if anyone reintroduces a hand-written label here.

  it('renders one navigation entry per chord, labelled from the manifest', () => {
    render(<KeyboardShortcutsOverlay open onClose={vi.fn()} />);

    for (const [, path] of NAV_CHORDS) {
      const label = breadcrumbLabelForPath(path);
      expect(
        label,
        `no manifest breadcrumb label for chord target ${path}`,
      ).toBeTruthy();
      expect(screen.getByText(`Go to ${label}`)).toBeInTheDocument();
    }
  });

  it('shows no label that the manifest does not know about', () => {
    render(<KeyboardShortcutsOverlay open onClose={vi.fn()} />);

    const known = new Set(
      NAV_CHORDS.map(([, path]) => `Go to ${breadcrumbLabelForPath(path)}`),
    );
    const rendered = screen
      .getAllByText(/^Go to /)
      .map((el) => el.textContent?.trim() ?? '');

    expect(rendered.length).toBe(NAV_CHORDS.length);
    for (const label of rendered) {
      expect(known, `stale hand-written label: ${label}`).toContain(label);
    }
  });
});

describe('KeyboardShortcutsOverlay', () => {
  it('should not render when open is false', () => {
    const onClose = vi.fn();
    const { container } = render(
      <KeyboardShortcutsOverlay open={false} onClose={onClose} />,
    );

    expect(container.innerHTML).toBe('');
  });

  it('should render when open is true', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsOverlay open={true} onClose={onClose} />);

    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
  });

  it('should show navigation shortcuts', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsOverlay open={true} onClose={onClose} />);

    expect(screen.getByText('Navigation (vim-style)')).toBeInTheDocument();
    expect(screen.getByText('Go to Home')).toBeInTheDocument();
    expect(screen.getByText('Go to Workloads')).toBeInTheDocument();
    expect(screen.getByText('Go to Settings')).toBeInTheDocument();
  });

  it('should show quick actions shortcuts', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsOverlay open={true} onClose={onClose} />);

    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
    expect(screen.getByText('Refresh current page data')).toBeInTheDocument();
    expect(screen.getByText('Cycle theme')).toBeInTheDocument();
    expect(screen.getByText('Collapse sidebar')).toBeInTheDocument();
    expect(screen.getByText('Expand sidebar')).toBeInTheDocument();
  });

  it('should show global shortcuts', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsOverlay open={true} onClose={onClose} />);

    expect(screen.getByText('Global')).toBeInTheDocument();
    expect(screen.getByText('Show / hide this overlay')).toBeInTheDocument();
    expect(screen.getByText('Open command palette')).toBeInTheDocument();
  });

  it('should show table navigation shortcuts', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsOverlay open={true} onClose={onClose} />);

    expect(screen.getByText('Table Navigation')).toBeInTheDocument();
    expect(screen.getByText('Move down in table')).toBeInTheDocument();
    expect(screen.getByText('Move up in table')).toBeInTheDocument();
    expect(screen.getByText('Open selected row')).toBeInTheDocument();
  });

  it('should call onClose when close button clicked', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsOverlay open={true} onClose={onClose} />);

    const closeButton = screen.getByRole('button');
    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should call onClose when backdrop clicked', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsOverlay open={true} onClose={onClose} />);

    // The backdrop has aria-hidden="true"
    const backdrop = document.querySelector('[aria-hidden="true"]');
    expect(backdrop).toBeInTheDocument();
    fireEvent.click(backdrop!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should call onClose when Escape key pressed', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsOverlay open={true} onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should call onClose when ? key pressed while open', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsOverlay open={true} onClose={onClose} />);

    fireEvent.keyDown(window, { key: '?' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should have dialog role', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsOverlay open={true} onClose={onClose} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('should render kbd elements for shortcut keys', () => {
    const onClose = vi.fn();
    const { container } = render(
      <KeyboardShortcutsOverlay open={true} onClose={onClose} />,
    );

    const kbds = container.querySelectorAll('kbd');
    expect(kbds.length).toBeGreaterThan(10);
  });
});
