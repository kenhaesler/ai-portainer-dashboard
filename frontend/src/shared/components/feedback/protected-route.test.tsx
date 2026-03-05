import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from './protected-route';

const mockUseAuth = vi.fn();
vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => mockUseAuth(),
}));

function renderWithRouter(element: React.ReactNode, initialPath = '/protected') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<div>Login Page</div>} />
        <Route path="/" element={<div>Home Page</div>} />
        <Route path="/protected" element={element} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ProtectedRoute', () => {
  it('renders children when authenticated', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true, role: 'viewer' });
    renderWithRouter(
      <ProtectedRoute><div>Protected Content</div></ProtectedRoute>
    );
    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  it('redirects to /login when not authenticated', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, role: 'viewer' });
    renderWithRouter(
      <ProtectedRoute><div>Protected Content</div></ProtectedRoute>
    );
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    expect(screen.getByText('Login Page')).toBeInTheDocument();
  });

  it('renders children when requiredRole matches', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true, role: 'admin' });
    renderWithRouter(
      <ProtectedRoute requiredRole="admin"><div>Admin Content</div></ProtectedRoute>
    );
    expect(screen.getByText('Admin Content')).toBeInTheDocument();
  });

  it('redirects to / when role does not match and no fallback', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true, role: 'viewer' });
    renderWithRouter(
      <ProtectedRoute requiredRole="admin"><div>Admin Content</div></ProtectedRoute>
    );
    expect(screen.queryByText('Admin Content')).not.toBeInTheDocument();
    expect(screen.getByText('Home Page')).toBeInTheDocument();
  });

  it('renders fallback when role does not match and fallback provided', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true, role: 'viewer' });
    renderWithRouter(
      <ProtectedRoute requiredRole="admin" fallback={<div>Access Denied</div>}>
        <div>Admin Content</div>
      </ProtectedRoute>
    );
    expect(screen.queryByText('Admin Content')).not.toBeInTheDocument();
    expect(screen.getByText('Access Denied')).toBeInTheDocument();
  });

  it('redirects to /login even when requiredRole is set but not authenticated', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, role: 'viewer' });
    renderWithRouter(
      <ProtectedRoute requiredRole="admin"><div>Admin Content</div></ProtectedRoute>
    );
    expect(screen.getByText('Login Page')).toBeInTheDocument();
  });
});
