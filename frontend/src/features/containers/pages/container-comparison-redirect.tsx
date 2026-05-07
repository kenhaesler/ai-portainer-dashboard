import { Navigate, useSearchParams } from 'react-router-dom';

/**
 * Permanent redirect from the legacy /comparison route to the merged
 * /workloads?mode=compare flow. Carries the `containers` query param
 * across so external bookmarks like /comparison?containers=1:abc,1:def
 * continue to land on the right comparison view.
 */
export default function ContainerComparisonRedirect() {
  const [searchParams] = useSearchParams();
  const containers = searchParams.get('containers');
  const target = containers
    ? `/workloads?mode=compare&containers=${encodeURIComponent(containers)}`
    : '/workloads';
  return <Navigate to={target} replace />;
}
