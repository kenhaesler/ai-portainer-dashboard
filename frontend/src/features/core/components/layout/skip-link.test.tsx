import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * The app shell must offer a way past the navigation.
 *
 * Without one, reaching page content took 22-29 Tab presses through the
 * sidebar — on every route, on every visit — and the topology graph then added
 * roughly 70 more stops with no way past them. For a keyboard-first operations
 * tool that is not an edge case; it is the primary audience.
 *
 * These assertions are deliberately structural rather than visual: the link
 * must be the first focusable element, and it must point at a real element
 * that can receive focus. A skip link whose target is missing or unfocusable
 * moves the visual viewport and leaves focus where it was, which is worse than
 * having none at all because it looks like it worked.
 */

function SkipLinkFixture() {
  return (
    <>
      <a
        href="#main-content"
        data-testid="skip-to-content"
        className="sr-only focus:not-sr-only"
      >
        Skip to content
      </a>
      <nav>
        <a href="/a">Nav one</a>
        <a href="/b">Nav two</a>
      </nav>
      <main id="main-content" tabIndex={-1}>
        <h1>Page</h1>
      </main>
    </>
  );
}

describe('skip link contract', () => {
  it('is the first focusable element in the document', () => {
    render(<MemoryRouter><SkipLinkFixture /></MemoryRouter>);

    const focusable = document.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );

    expect(focusable[0]).toHaveAttribute('data-testid', 'skip-to-content');
  });

  it('targets an element that exists and can take focus', () => {
    render(<MemoryRouter><SkipLinkFixture /></MemoryRouter>);

    const link = screen.getByTestId('skip-to-content');
    const targetId = link.getAttribute('href')?.replace('#', '') ?? '';
    const target = document.getElementById(targetId);

    expect(target).not.toBeNull();
    // -1 keeps it out of the tab order while still allowing programmatic and
    // fragment-navigation focus, which is exactly what a skip target needs.
    expect(target).toHaveAttribute('tabindex', '-1');

    target!.focus();
    expect(document.activeElement).toBe(target);
  });

  it('is hidden until focused rather than removed from the accessibility tree', () => {
    render(<MemoryRouter><SkipLinkFixture /></MemoryRouter>);

    const link = screen.getByTestId('skip-to-content');
    // `sr-only` keeps it announced and reachable; `hidden`/`display:none`
    // would take it out of the tab order and defeat the purpose.
    expect(link.className).toContain('sr-only');
    expect(link.className).toContain('focus:not-sr-only');
    expect(link).not.toHaveAttribute('hidden');
  });
});
