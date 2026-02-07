import type { Insight } from '../models/monitoring.js';

export interface SimilarInsightGroup {
  insights: Insight[];
}

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 2),
  );
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;

  let intersectionSize = 0;
  for (const token of a) {
    if (b.has(token)) intersectionSize++;
  }

  const unionSize = a.size + b.size - intersectionSize;
  if (unionSize === 0) return 0;

  return intersectionSize / unionSize;
}

/**
 * Find groups of similar insights using Jaccard text similarity.
 * Uses greedy union-find clustering: if two insights have similarity >= threshold,
 * they are merged into the same group.
 */
export function findSimilarInsights(
  insights: Insight[],
  threshold: number,
): SimilarInsightGroup[] {
  if (insights.length < 2) return [];

  // Tokenize title + description for each insight
  const tokens = insights.map((insight) =>
    tokenize(`${insight.title} ${insight.description}`),
  );

  // Union-Find
  const parent = insights.map((_, i) => i);

  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]; // path compression
      i = parent[i];
    }
    return i;
  }

  function union(i: number, j: number): void {
    const pi = find(i);
    const pj = find(j);
    if (pi !== pj) parent[pi] = pj;
  }

  // Compare all pairs
  for (let i = 0; i < insights.length; i++) {
    for (let j = i + 1; j < insights.length; j++) {
      const sim = jaccardSimilarity(tokens[i], tokens[j]);
      if (sim >= threshold) {
        union(i, j);
      }
    }
  }

  // Collect groups
  const groups = new Map<number, Insight[]>();
  for (let i = 0; i < insights.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(insights[i]);
  }

  // Only return groups with 2+ insights
  return Array.from(groups.values())
    .filter((group) => group.length >= 2)
    .map((insights) => ({ insights }));
}
