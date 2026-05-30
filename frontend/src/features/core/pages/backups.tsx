import { Navigate, useLocation } from 'react-router-dom';

export default function BackupsPage() {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);

  if (!searchParams.has('tab')) {
    searchParams.set('tab', 'portainer-backup');
  }

  return <Navigate to={`/settings?${searchParams.toString()}`} replace />;
}
