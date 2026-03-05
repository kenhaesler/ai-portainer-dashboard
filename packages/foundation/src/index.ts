// Foundational routes — cross-domain routes tightly coupled to the Portainer API and core services.
// These routes don't belong to any single domain module; they are the "glue" layer
// between the Portainer API, core services, and the frontend.

export { authRoutes } from './routes/auth.js';
export { cacheAdminRoutes } from './routes/cache-admin.js';
export { containerLogsRoutes } from './routes/container-logs.js';
export { containersRoutes } from './routes/containers.js';
export { dashboardRoutes } from './routes/dashboard.js';
export { endpointsRoutes } from './routes/endpoints.js';
export { healthRoutes } from './routes/health.js';
export { imagesRoutes } from './routes/images.js';
export { kubernetesRoutes } from './routes/kubernetes.js';
export { networksRoutes } from './routes/networks.js';
export { oidcRoutes } from './routes/oidc.js';
export { searchRoutes } from './routes/search.js';
export { settingsRoutes } from './routes/settings.js';
export { stacksRoutes } from './routes/stacks.js';
export { userRoutes } from './routes/users.js';
