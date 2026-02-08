/**
 * Artillery processor helpers for REST load tests.
 *
 * Functions are invoked by Artillery's `processor` config to generate
 * dynamic payloads and debug auth tokens during test runs.
 */

const CHAT_MESSAGES = [
  'Which containers are using the most CPU right now?',
  'Show me containers with high memory usage.',
  'Are there any stopped containers that should be running?',
  'Summarize the health of my Docker environment.',
  'What anomalies have been detected in the last hour?',
  'Which stacks are currently running?',
  'Tell me about network connectivity between containers.',
  'Are there any security concerns with my running containers?',
  'What is the average CPU usage across all containers?',
  'List containers that restarted recently.',
];

/**
 * Sets a random chat message on context.vars for use in Artillery scenarios.
 */
function generateRandomMessage(context, events, done) {
  const idx = Math.floor(Math.random() * CHAT_MESSAGES.length);
  context.vars.chatMessage = CHAT_MESSAGES[idx];
  return done();
}

/**
 * Logs the first 40 characters of the captured JWT token for debugging.
 */
function logToken(context, events, done) {
  const token = context.vars.token;
  if (token) {
    console.log(`  [auth] token: ${token.substring(0, 40)}...`);
  } else {
    console.log('  [auth] WARNING: no token captured');
  }
  return done();
}

module.exports = { generateRandomMessage, logToken };
