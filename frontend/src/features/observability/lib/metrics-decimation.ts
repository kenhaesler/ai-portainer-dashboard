export interface TimeSeriesPoint {
  timestamp: string;
  value: number;
  isAnomaly?: boolean;
}

function pickEvenly(indices: number[], count: number): number[] {
  if (count <= 0 || indices.length === 0) return [];
  if (count >= indices.length) return [...indices];
  if (count === 1) return [indices[Math.floor(indices.length / 2)]];

  const picked = new Set<number>();
  const step = (indices.length - 1) / (count - 1);

  for (let i = 0; i < count; i++) {
    picked.add(indices[Math.round(i * step)]);
  }

  if (picked.size < count) {
    for (const idx of indices) {
      picked.add(idx);
      if (picked.size === count) break;
    }
  }

  return [...picked];
}

export function decimateTimeSeries<T extends TimeSeriesPoint>(points: T[], maxPoints: number): T[] {
  if (!Number.isFinite(maxPoints) || maxPoints <= 0) return [];
  if (points.length <= maxPoints) return points;
  if (maxPoints === 1) return [points[points.length - 1]];

  const requiredIndices = new Set<number>([0, points.length - 1]);
  for (let i = 0; i < points.length; i++) {
    if (points[i].isAnomaly) requiredIndices.add(i);
  }

  const required = [...requiredIndices].sort((a, b) => a - b);

  if (required.length >= maxPoints) {
    return pickEvenly(required, maxPoints)
      .sort((a, b) => a - b)
      .map((idx) => points[idx]);
  }

  const candidateIndices: number[] = [];
  for (let i = 0; i < points.length; i++) {
    if (!requiredIndices.has(i)) candidateIndices.push(i);
  }

  const remainingBudget = maxPoints - required.length;
  const sampled = pickEvenly(candidateIndices, remainingBudget);
  const merged = [...new Set([...required, ...sampled])].sort((a, b) => a - b);

  return merged.map((idx) => points[idx]);
}
