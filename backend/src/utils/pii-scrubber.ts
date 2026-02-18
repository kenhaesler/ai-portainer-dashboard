import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('utils:pii-scrubber');

/**
 * Patterns for common PII and sensitive data.
 *
 * Intentionally excludes patterns that cause false positives in infrastructure
 * contexts (Docker container IDs, trace IDs, network IPs, timestamps):
 *   - UUID: Container IDs, trace IDs, and other infrastructure identifiers are
 *     required by LLM tool calls (get_trace_details, query_containers, etc.)
 *   - IPv4/IPv6: Docker network IPs (172.17.0.2, 10.0.0.1) are essential
 *     infrastructure context the LLM needs for troubleshooting
 *   - Credit card: The naive digit-sequence pattern matches timestamps, PIDs,
 *     port numbers, and metric values — causing widespread false positives
 */
const PII_PATTERNS = {
  // RFC 5322 compliant email regex
  email: /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*/g,

  // Bearer Tokens / API Keys (well-known prefixes only)
  apiToken: /\b(?:ghp_|glpat-|sqp_|sk-)[a-zA-Z0-9]{20,}\b/g,
  jwt: /\beyJ[A-Za-z0-9-_=]+\.eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_.+/=]+\b/g,

  // Potential Secrets in key=value pairs or JSON — requires longer key names
  // to avoid false positives on infrastructure terms like "key" and "token"
  secretAssignment: /(?:password|passwd|secret|authorization|credential|passphrase|private_key|api_key|api_secret)["']?\s*[:=]\s*["']?([a-zA-Z0-9!@#$%^&*()_+={}[\]|:;"'<>,.?/~`-]{8,})["']?/gi,
};

/**
 * Options for PII scrubbing.
 */
export interface ScrubberOptions {
  /** Custom patterns to include in scrubbing. */
  additionalPatterns?: RegExp[];
  /** Whether to log when PII is detected (at debug level). */
  verbose?: boolean;
  /** Replacement string for masked data. Defaults to "[MASKED]". */
  replacement?: string;
}

/**
 * Scrub PII and sensitive data from a string.
 */
export function scrubPii(text: string, options: ScrubberOptions = {}): string {
  if (!text) return text;

  let scrubbed = text;
  const replacement = options.replacement ?? '[MASKED]';
  let matchCount = 0;

  // 1. Regular patterns
  for (const [name, pattern] of Object.entries(PII_PATTERNS)) {
    if (name === 'secretAssignment') continue; // Handled separately due to capturing groups

    scrubbed = scrubbed.replace(pattern, (match) => {
      matchCount++;
      if (options.verbose) {
        log.debug({ type: name, length: match.length }, 'PII detected and masked');
      }
      return replacement;
    });
  }

  // 2. Secret assignments (handling capturing groups to keep the key)
  scrubbed = scrubbed.replace(PII_PATTERNS.secretAssignment, (match, p1) => {
    matchCount++;
    // We want to keep the "key=" part and only mask the value
    const keyPart = match.substring(0, match.indexOf(p1));
    const suffix = match.substring(match.indexOf(p1) + p1.length);

    if (options.verbose) {
      log.debug({ type: 'secretAssignment' }, 'Secret assignment detected and masked');
    }
    return `${keyPart}${replacement}${suffix}`;
  });

  // 3. Additional custom patterns
  if (options.additionalPatterns) {
    for (const pattern of options.additionalPatterns) {
      scrubbed = scrubbed.replace(pattern, () => {
        matchCount++;
        return replacement;
      });
    }
  }

  if (matchCount > 0 && options.verbose) {
    log.info({ matchCount }, 'PII scrubbing completed');
  }

  return scrubbed;
}

/**
 * Scrub PII from an object or array recursively.
 * Only scrubs values — keys are preserved to avoid corrupting data structures.
 */
export function scrubPiiDeep<T>(obj: T, options: ScrubberOptions = {}): T {
  if (typeof obj === 'string') {
    return scrubPii(obj, options) as unknown as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => scrubPiiDeep(item, options)) as unknown as T;
  }

  if (typeof obj === 'object' && obj !== null) {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = scrubPiiDeep(value, options);
    }
    return result as T;
  }

  return obj;
}
