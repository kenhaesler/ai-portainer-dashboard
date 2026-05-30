/**
 * Pure Isolation Forest implementation (zero npm dependencies).
 * Used for multivariate anomaly detection on [cpu, memory] metric pairs.
 */

interface IsolationNode {
  type: 'internal';
  splitFeature: number;
  splitValue: number;
  left: IsolationNode | ExternalNode;
  right: IsolationNode | ExternalNode;
}

interface ExternalNode {
  type: 'external';
  size: number;
}

type TreeNode = IsolationNode | ExternalNode;

/**
 * Average path length of unsuccessful search in a Binary Search Tree.
 * Used as normalization factor for anomaly scores.
 * c(n) = 2 * H(n-1) - (2*(n-1)/n) where H(i) is the harmonic number.
 */
export function averagePathLength(n: number): number {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  // H(n-1) ≈ ln(n-1) + 0.5772156649 (Euler-Mascheroni constant)
  const harmonicNumber = Math.log(n - 1) + 0.5772156649;
  return 2 * harmonicNumber - (2 * (n - 1)) / n;
}

function buildTree(data: number[][], depth: number, maxDepth: number): TreeNode {
  if (depth >= maxDepth || data.length <= 1) {
    return { type: 'external', size: data.length };
  }

  const nFeatures = data[0].length;
  const splitFeature = Math.floor(Math.random() * nFeatures);

  // Find min/max for the chosen feature
  let min = Infinity;
  let max = -Infinity;
  for (const point of data) {
    const val = point[splitFeature];
    if (val < min) min = val;
    if (val > max) max = val;
  }

  // If all values are the same for this feature, can't split further
  if (max - min < 1e-10) {
    return { type: 'external', size: data.length };
  }

  const splitValue = min + Math.random() * (max - min);

  const left: number[][] = [];
  const right: number[][] = [];
  for (const point of data) {
    if (point[splitFeature] < splitValue) {
      left.push(point);
    } else {
      right.push(point);
    }
  }

  return {
    type: 'internal',
    splitFeature,
    splitValue,
    left: buildTree(left, depth + 1, maxDepth),
    right: buildTree(right, depth + 1, maxDepth),
  };
}

function pathLength(point: number[], node: TreeNode, depth: number): number {
  if (node.type === 'external') {
    return depth + averagePathLength(node.size);
  }

  if (point[node.splitFeature] < node.splitValue) {
    return pathLength(point, node.left, depth + 1);
  }
  return pathLength(point, node.right, depth + 1);
}

export class IsolationForest {
  private trees: TreeNode[] = [];
  private readonly nTrees: number;
  private readonly sampleSize: number;
  private readonly contamination: number;
  private threshold = 0.5;

  constructor(nTrees = 100, sampleSize = 256, contamination = 0.1) {
    this.nTrees = nTrees;
    this.sampleSize = sampleSize;
    this.contamination = contamination;
  }

  fit(data: number[][]): void {
    if (data.length === 0) return;

    const maxDepth = Math.ceil(Math.log2(this.sampleSize));
    this.trees = [];

    for (let i = 0; i < this.nTrees; i++) {
      // Subsample
      const sample: number[][] = [];
      const sampleCount = Math.min(this.sampleSize, data.length);
      for (let j = 0; j < sampleCount; j++) {
        const idx = Math.floor(Math.random() * data.length);
        sample.push(data[idx]);
      }

      this.trees.push(buildTree(sample, 0, maxDepth));
    }

    // Compute threshold: score all training data, then pick the percentile
    const scores = data.map((point) => this.anomalyScore(point));
    scores.sort((a, b) => b - a); // descending
    const cutoffIdx = Math.max(0, Math.floor(data.length * this.contamination) - 1);
    this.threshold = scores[cutoffIdx] ?? 0.5;
  }

  anomalyScore(point: number[]): number {
    if (this.trees.length === 0) return 0;

    let totalPathLength = 0;
    for (const tree of this.trees) {
      totalPathLength += pathLength(point, tree, 0);
    }

    const avgPath = totalPathLength / this.trees.length;
    const c = averagePathLength(this.sampleSize);

    if (c === 0) return 0;

    // score = 2^(-E(h(x)) / c(n))
    return Math.pow(2, -avgPath / c);
  }

  predict(point: number[]): boolean {
    return this.anomalyScore(point) >= this.threshold;
  }
}
