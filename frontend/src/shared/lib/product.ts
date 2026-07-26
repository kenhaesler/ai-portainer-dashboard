/**
 * The product's name, in one place.
 *
 * Before this constant existed the product answered to four different names
 * depending on which surface you were looking at:
 *
 * - `Docker Insights` — the login wordmark and the sidebar wordmark
 * - `Docker Insight` (singular) — its own Settings → About → System Information
 * - `Container Insights` — `PRODUCT.md`
 * - `container-insights` — the compose project the app displays back to the
 *   operator in its own Workloads table
 *
 * `Container Insights` is the intended name: it is what `PRODUCT.md` states and
 * what the shipped compose project is called, so it is the one an operator will
 * already have seen in `docker ps` output before they ever reach the login page.
 *
 * Import this rather than typing the name again. A second literal is how the
 * fourth name got there.
 */
export const PRODUCT_NAME = 'Container Insights';
