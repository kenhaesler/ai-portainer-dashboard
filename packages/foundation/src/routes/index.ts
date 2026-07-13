// Route barrel for @dashboard/foundation.
//
// Registered from the composition root via `@dashboard/foundation/routes/index.js`,
// matching how every other package exposes its routes (#1533). Keeping the route
// functions here — rather than on the package barrel (../index.ts) — aligns
// foundation with the core/src/CLAUDE.md "routes not re-exported from the package
// barrel" rule.

export { authRoutes } from './auth.js';
export { cacheAdminRoutes } from './cache-admin.js';
export { containerLogsRoutes } from './container-logs.js';
export { containersRoutes } from './containers.js';
export { dashboardRoutes } from './dashboard.js';
export { endpointsRoutes } from './endpoints.js';
export { healthRoutes } from './health.js';
export { imagesRoutes } from './images.js';
export { kubernetesRoutes } from './kubernetes.js';
export { networksRoutes } from './networks.js';
export { oidcRoutes } from './oidc.js';
export { searchRoutes } from './search.js';
export { settingsRoutes } from './settings.js';
export { stacksRoutes } from './stacks.js';
export { systemInfoRoutes } from './system-info.js';
export type { SystemInfoRoutesOpts } from './system-info.js';
export { userRoutes } from './users.js';
