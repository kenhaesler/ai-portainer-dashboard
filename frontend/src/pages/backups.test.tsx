import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import BackupsPage from './backups';

function LocationProbe() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);

  return (
    <div>
      <div data-testid="pathname">{location.pathname}</div>
      <div data-testid="tab">{params.get('tab') ?? ''}</div>
      <div data-testid="foo">{params.get('foo') ?? ''}</div>
    </div>
  );
}

describe('BackupsPage', () => {
  it('redirects /backups to settings backup tab', async () => {
    render(
      <MemoryRouter initialEntries={['/backups']}>
        <Routes>
          <Route path="/backups" element={<BackupsPage />} />
          <Route path="/settings" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('pathname')).toHaveTextContent('/settings');
      expect(screen.getByTestId('tab')).toHaveTextContent('portainer-backup');
    });
  });

  it('preserves existing query params when redirecting', async () => {
    render(
      <MemoryRouter initialEntries={['/backups?foo=bar']}>
        <Routes>
          <Route path="/backups" element={<BackupsPage />} />
          <Route path="/settings" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('pathname')).toHaveTextContent('/settings');
      expect(screen.getByTestId('foo')).toHaveTextContent('bar');
      expect(screen.getByTestId('tab')).toHaveTextContent('portainer-backup');
    });
  });
});
