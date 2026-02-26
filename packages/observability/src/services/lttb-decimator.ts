/**
 * Largest-Triangle-Three-Buckets (LTTB) downsampling algorithm.
 * Reduces a time series to `threshold` points while preserving visual shape.
 * Always keeps the first and last data point.
 */

export interface DataPoint {
  timestamp: string;
  value: number;
}

export function decimateLTTB(data: DataPoint[], threshold = 200): DataPoint[] {
  if (data.length <= threshold || threshold < 3) return data;

  const result: DataPoint[] = [data[0]]; // Always keep first point
  const bucketSize = (data.length - 2) / (threshold - 2);

  let prevIndex = 0;

  for (let i = 0; i < threshold - 2; i++) {
    // Calculate bucket boundaries
    const bucketStart = Math.floor((i + 1) * bucketSize) + 1;
    const bucketEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, data.length - 1);

    // Calculate average point in next bucket (for triangle area computation)
    const nextBucketStart = bucketEnd;
    const nextBucketEnd = Math.min(Math.floor((i + 3) * bucketSize) + 1, data.length - 1);

    let avgX = 0;
    let avgY = 0;
    const nextBucketLen = nextBucketEnd - nextBucketStart;

    if (nextBucketLen > 0) {
      for (let j = nextBucketStart; j < nextBucketEnd; j++) {
        avgX += j;
        avgY += data[j].value;
      }
      avgX /= nextBucketLen;
      avgY /= nextBucketLen;
    } else {
      // Last bucket: use the last data point
      avgX = data.length - 1;
      avgY = data[data.length - 1].value;
    }

    // Find point in current bucket with largest triangle area
    let maxArea = -1;
    let maxIndex = bucketStart;

    const prevX = prevIndex;
    const prevY = data[prevIndex].value;

    for (let j = bucketStart; j < bucketEnd; j++) {
      // Triangle area = 0.5 * |x1(y2-y3) + x2(y3-y1) + x3(y1-y2)|
      const area = Math.abs(
        (prevX - avgX) * (data[j].value - prevY) -
        (prevX - j) * (avgY - prevY),
      ) * 0.5;

      if (area > maxArea) {
        maxArea = area;
        maxIndex = j;
      }
    }

    result.push(data[maxIndex]);
    prevIndex = maxIndex;
  }

  result.push(data[data.length - 1]); // Always keep last point
  return result;
}
