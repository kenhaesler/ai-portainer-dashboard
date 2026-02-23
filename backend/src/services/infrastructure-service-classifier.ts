import { getSetting } from '../core/services/settings-store.js';

const INFRASTRUCTURE_PATTERNS_KEY = 'reports.infrastructure_service_patterns';
const DEFAULT_INFRASTRUCTURE_PATTERNS = ['traefik', 'portainer_agent', 'beyla'];

function normalizePattern(value: string): string {
  return value.trim().toLowerCase();
}

function parsePatterns(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item): item is string => typeof item === 'string')
        .map(normalizePattern)
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  return trimmed
    .split(',')
    .map(normalizePattern)
    .filter(Boolean);
}

export async function getInfrastructureServicePatterns(): Promise<string[]> {
  const raw = (await getSetting(INFRASTRUCTURE_PATTERNS_KEY))?.value ?? '';
  const configured = parsePatterns(raw);
  const source = configured.length > 0 ? configured : DEFAULT_INFRASTRUCTURE_PATTERNS;
  return Array.from(new Set(source.map(normalizePattern).filter(Boolean)));
}

/**
 * Sync matching when patterns are already resolved.
 * Use this in `.filter()` callbacks and other sync contexts.
 */
export function matchesInfrastructurePattern(name: string, patterns: string[]): boolean {
  const normalized = name.trim().toLowerCase();
  return patterns.some((pattern) => (
    normalized === pattern
    || normalized.startsWith(`${pattern}-`)
    || normalized.startsWith(`${pattern}_`)
  ));
}

export async function isInfrastructureService(name: string, patterns?: string[]): Promise<boolean> {
  const activePatterns = patterns && patterns.length > 0
    ? patterns
    : await getInfrastructureServicePatterns();

  return matchesInfrastructurePattern(name, activePatterns);
}

