import { Navigate } from 'react-router-dom';
import { useAuth, type UserRole } from '@/providers/auth-provider';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: UserRole;
  fallback?: React.ReactNode;
}

export function ProtectedRoute({ children, requiredRole, fallback }: ProtectedRouteProps) {
  const { isAuthenticated, role } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (requiredRole && role !== requiredRole) {
    return fallback ?? <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
