/**
 * Artillery processor helpers for REST load tests.
 *
 * Logs in once (singleton) and shares the JWT token across all
 * virtual users to avoid hitting the login rate limit.
 */

let sharedToken = null;
let loginPromise = null;

/**
 * Logs in once — concurrent calls wait on the same promise.
 */
function doLogin() {
  if (loginPromise) return loginPromise;

  loginPromise = (async () => {
    const baseUrl = process.env.BASE_URL;
    const username = process.env.DASHBOARD_USER || 'admin';
    const password = process.env.DASHBOARD_PASS || 'admin';

    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      throw new Error(`Login failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    sharedToken = data.token;
    console.log(`  [auth] Token acquired: ${sharedToken.substring(0, 40)}...`);
  })();

  return loginPromise;
}

/**
 * Artillery `beforeScenario` hook — runs before each VU scenario.
 * First call triggers login; subsequent calls reuse the token.
 */
function setToken(context, events, done) {
  if (sharedToken) {
    context.vars.token = sharedToken;
    return done();
  }

  doLogin()
    .then(() => {
      context.vars.token = sharedToken;
      done();
    })
    .catch((err) => {
      console.error(`  [auth] ${err.message}`);
      done(err);
    });
}

module.exports = { setToken };
