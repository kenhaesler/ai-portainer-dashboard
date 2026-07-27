import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import NotFound from './not-found';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotFound />
    </MemoryRouter>,
  );
}

describe('NotFound', () => {
  it('names the path that was not found', () => {
    renderAt('/workloadz');
    expect(screen.getByRole('heading', { name: /page not found/i })).toBeInTheDocument();
    expect(screen.getByText(/No route matches \/workloadz/)).toBeInTheDocument();
  });

  it('suggests the closest matching destination from the manifest', () => {
    renderAt('/workloadz');
    const suggestion = screen.getByTestId('not-found-suggestion');
    expect(suggestion).toHaveAttribute('href', '/workloads');
    expect(suggestion).toHaveTextContent('Workloads');
  });

  it('always offers Home and Workload Explorer as links', () => {
    renderAt('/zzzzzzzz');
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toContain('/');
    expect(links).toContain('/workloads');
  });

  it('does not duplicate a fallback that is already the suggestion', () => {
    renderAt('/workloadz');
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links.filter((href) => href === '/workloads')).toHaveLength(1);
  });

  it('renders links, not a redirect — Back must still work', () => {
    renderAt('/nope');
    // A <Navigate> would render nothing; assert real navigation targets exist.
    expect(screen.getAllByRole('link').length).toBeGreaterThan(0);
  });
});
