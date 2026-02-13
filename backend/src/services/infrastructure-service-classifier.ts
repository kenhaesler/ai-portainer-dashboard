import { getSetting } from './settings-store.js';

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

export function getInfrastructureServicePatterns(): string[] {
  const raw = getSetting(INFRASTRUCTURE_PATTERNS_KEY)?.value ?? '';
  const configured = parsePatterns(raw);
  const source = configured.length > 0 ? configured : DEFAULT_INFRASTRUCTURE_PATTERNS;
  return Array.from(new Set(source.map(normalizePattern).filter(Boolean)));
}

export function isInfrastructureService(name: string, patterns?: string[]): boolean {
  const normalized = name.trim().toLowerCase();
  const activePatterns = patterns && patterns.length > 0
    ? patterns
    : getInfrastructureServicePatterns();

  return activePatterns.some((pattern) => (
    normalized === pattern
    || normalized.startsWith(`${pattern}-`)
    || normalized.startsWith(`${pattern}_`)
  ));
}

