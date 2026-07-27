import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { AppIconSection, buildOverrideOptions } from './app-icon-section';
import { useThemeStore, DEFAULT_FAVICON_ICON } from '@/stores/theme-store';
import { ICON_SETS } from '@/shared/components/icons/icon-sets';

/**
 * The Appearance tab shipped three near-identical 10-option grids — "Favicon
 * Icon", "Sidebar Logo", "Login Logo" — with byte-identical option sets and
 * byte-identical per-option descriptions: thirty radio cards to choose a logo
 * three times. A design review named it the clearest remaining filler in the
 * product.
 *
 * The consolidation had one genuinely dangerous failure mode, and most of
 * these tests exist for it: a single picker that writes all three fields would
 * silently destroy a per-surface override the operator had deliberately set,
 * with no undo and an immediate write to localStorage. `faviconIcon` is
 * therefore the primary, and a surface moves with it only while it follows it.
 *
 * The other reason this file exists: `tab-appearance.tsx` had no test at all,
 * while every sibling tab has one.
 */

function resetIcons(favicon = DEFAULT_FAVICON_ICON, sidebar = DEFAULT_FAVICON_ICON, login = DEFAULT_FAVICON_ICON) {
  useThemeStore.setState({ faviconIcon: favicon, sidebarIcon: sidebar, loginIcon: login });
}

const icons = () => {
  const { faviconIcon, sidebarIcon, loginIcon } = useThemeStore.getState();
  return { faviconIcon, sidebarIcon, loginIcon };
};

/**
 * The radio tile for an icon label. Anchored, because several labels are
 * prefixes of others — a bare /Brain/ also matches "Circuit Brain".
 */
function tile(label: string) {
  const match = screen
    .getAllByRole('radio')
    .find((r) => (r.textContent ?? '').trim().startsWith(label));
  if (!match) throw new Error(`no icon tile labelled "${label}"`);
  return match;
}

describe('AppIconSection — one picker', () => {
  beforeEach(() => resetIcons());

  it('offers the ten icons once, not three times', () => {
    render(<AppIconSection />);

    // 30 radio cards became 10.
    expect(screen.getAllByRole('radio')).toHaveLength(ICON_SETS.length);
    expect(ICON_SETS).toHaveLength(10);
  });

  it('replaces the three headings with one', () => {
    render(<AppIconSection />);

    expect(screen.getByRole('heading', { name: 'App Icon' })).toBeInTheDocument();
    expect(screen.queryByText('Favicon Icon')).not.toBeInTheDocument();
    expect(screen.queryByText('Sidebar Logo')).not.toBeInTheDocument();
    expect(screen.queryByText('Login Logo')).not.toBeInTheDocument();
  });

  it('drives all three surfaces when they are linked', () => {
    render(<AppIconSection />);

    fireEvent.click(tile('Lighthouse'));

    expect(icons()).toEqual({
      faviconIcon: 'lighthouse',
      sidebarIcon: 'lighthouse',
      loginIcon: 'lighthouse',
    });
  });

  it('names the group and its help text for assistive tech', () => {
    render(<AppIconSection />);

    const group = screen.getByRole('radiogroup', { name: 'App Icon' });
    expect(group).toHaveAttribute('aria-describedby', 'app-icon-help');
    expect(document.getElementById('app-icon-help')).toHaveTextContent(/browser tab, the sidebar and on the sign-in page/i);
  });
});

describe('AppIconSection — overrides survive', () => {
  beforeEach(() => resetIcons());

  it('does not clobber a deliberately overridden surface', () => {
    // The regression the whole design turns on. Without this, picking a new
    // app icon erases the override instantly and irrecoverably.
    resetIcons('brain', 'eye-ai', 'brain');
    render(<AppIconSection />);

    fireEvent.click(tile('Lighthouse'));

    expect(icons()).toEqual({
      faviconIcon: 'lighthouse',
      sidebarIcon: 'eye-ai',   // preserved
      loginIcon: 'lighthouse', // was following, so it moved
    });
  });

  it('preserves an upgrading user whose three values already differ', () => {
    resetIcons('lighthouse', 'eye-ai', 'atom-orbit');
    render(<AppIconSection />);

    fireEvent.click(tile('Neural Net'));

    expect(icons()).toEqual({
      faviconIcon: 'neural-net',
      sidebarIcon: 'eye-ai',
      loginIcon: 'atom-orbit',
    });
  });

  it('always has exactly one checked tile, even when surfaces diverge', () => {
    // An alternative design left the radiogroup with nothing checked in the
    // mixed case and explained it in prose. A radiogroup with no value is a
    // worse control than one with a value.
    resetIcons('lighthouse', 'eye-ai', 'atom-orbit');
    render(<AppIconSection />);

    const checked = screen.getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    expect(checked[0].textContent).toContain('Lighthouse');
  });

  it('opens the override panel already expanded when a surface diverges', () => {
    resetIcons('brain', 'eye-ai', 'brain');
    render(<AppIconSection />);

    expect(screen.getByRole('button', { name: /Use a different icon per surface/ }))
      .toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Sidebar logo')).toBeInTheDocument();
  });

  it('keeps the override panel closed when everything follows', () => {
    render(<AppIconSection />);

    expect(screen.getByRole('button', { name: /Use a different icon per surface/ }))
      .toHaveAttribute('aria-expanded', 'false');
  });

  it('counts diverging surfaces on the disclosure', () => {
    resetIcons('brain', 'eye-ai', 'atom-orbit');
    render(<AppIconSection />);

    const trigger = screen.getByRole('button', { name: /Use a different icon per surface/ });
    expect(within(trigger).getByText('2')).toBeInTheDocument();
  });
});

describe('AppIconSection — override selects', () => {
  beforeEach(() => resetIcons());

  it('never offers a sentinel value for "same as app icon"', () => {
    // A literal 'inherit' would reach setSidebarIcon through ThemedSelect's
    // (value: string) callback, be persisted verbatim, miss the icon lookup,
    // and blank the sidebar mark with no error. Every option must be a real id.
    const ids = ICON_SETS.map((i) => i.id);
    const options = buildOverrideOptions('lighthouse');

    expect(options[0].label).toBe('Same as app icon (Lighthouse)');
    expect(options[0].value).toBe('lighthouse');
    for (const option of options) {
      expect(ids).toContain(option.value);
    }
  });

  it('lists every icon exactly once, with the primary as the "same as" entry', () => {
    const options = buildOverrideOptions('lighthouse');

    expect(options).toHaveLength(ICON_SETS.length);
    expect(new Set(options.map((o) => o.value)).size).toBe(ICON_SETS.length);
  });

  it('labels both override selects', () => {
    resetIcons('lighthouse', 'eye-ai', 'lighthouse');
    render(<AppIconSection />);

    expect(screen.getByLabelText('Sidebar logo')).toBeInTheDocument();
    expect(screen.getByLabelText('Sign-in page logo')).toBeInTheDocument();
  });

  it('offers no control for the browser tab, which always follows', () => {
    resetIcons('brain', 'eye-ai', 'brain');
    render(<AppIconSection />);

    expect(screen.getByText('Always uses the app icon above.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Browser tab')).not.toBeInTheDocument();
  });
});

describe('AppIconSection — keyboard', () => {
  beforeEach(() => resetIcons());

  it('moves focus with arrows without committing a selection', () => {
    // Selecting on arrow would make simple exploration destructive: one
    // keypress while inspecting the current value would rewrite the store and
    // wipe any override, with no undo.
    resetIcons('brain', 'eye-ai', 'brain');
    render(<AppIconSection />);

    const first = tile('Brain');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });

    expect(icons()).toEqual({ faviconIcon: 'brain', sidebarIcon: 'eye-ai', loginIcon: 'brain' });
  });

  it('is a single tab stop', () => {
    render(<AppIconSection />);

    const tabbable = screen.getAllByRole('radio').filter((r) => r.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
  });

  it('commits on click', () => {
    render(<AppIconSection />);

    fireEvent.click(tile('Atom'));
    expect(useThemeStore.getState().faviconIcon).toBe('atom-orbit');
  });
});

describe('AppIconSection — previews', () => {
  beforeEach(() => resetIcons());

  it('keeps all three context previews', () => {
    // These were never duplication: each shows how the mark actually renders
    // on that surface, and they are three different paint paths.
    render(<AppIconSection />);

    const strip = screen.getByTestId('app-icon-previews');
    expect(within(strip).getByText('Browser tab')).toBeInTheDocument();
    expect(within(strip).getByText('Sidebar')).toBeInTheDocument();
    expect(within(strip).getByText('Sign-in page')).toBeInTheDocument();
  });

  it('previews each surface with its own effective icon, not just the primary', () => {
    resetIcons('brain', 'eye-ai', 'atom-orbit');
    const { container } = render(<AppIconSection />);

    // The strip doubles as a status readout when surfaces diverge.
    const strip = container.querySelector('[data-testid="app-icon-previews"]')!;
    expect(strip.querySelectorAll('svg').length).toBe(3);
  });

  it('defines each SVG gradient exactly once in the document', () => {
    // Duplicate ids are invalid SVG and resolve first-wins, so a per-icon id
    // scheme would break the moment one icon appeared in several previews.
    const { container } = render(<AppIconSection />);

    for (const id of ['appicon-login-stroke', 'appicon-favicon-plate']) {
      expect(container.querySelectorAll(`#${id}`).length).toBe(1);
    }
  });

  it('does not host the gradient defs with display:none', () => {
    // Some engines stop resolving paint references into a display:none host.
    const { container } = render(<AppIconSection />);

    const host = container.querySelector('svg.absolute');
    expect(host).not.toBeNull();
    expect(host!.className.baseVal ?? host!.getAttribute('class')).toContain('h-0');
    expect(host!.getAttribute('style') ?? '').not.toContain('display: none');
  });
});

describe('setAppIcon', () => {
  beforeEach(() => resetIcons());

  it('is a no-op on surfaces that already diverge, whatever the order', () => {
    resetIcons('brain', 'eye-ai', 'atom-orbit');

    useThemeStore.getState().setAppIcon('lighthouse');
    useThemeStore.getState().setAppIcon('neural-net');

    expect(icons()).toEqual({
      faviconIcon: 'neural-net',
      sidebarIcon: 'eye-ai',
      loginIcon: 'atom-orbit',
    });
  });

  it('re-links a surface once it is set back to the primary', () => {
    resetIcons('brain', 'eye-ai', 'brain');

    useThemeStore.setState({ sidebarIcon: 'brain' });
    useThemeStore.getState().setAppIcon('lighthouse');

    expect(icons()).toEqual({
      faviconIcon: 'lighthouse',
      sidebarIcon: 'lighthouse',
      loginIcon: 'lighthouse',
    });
  });
});
