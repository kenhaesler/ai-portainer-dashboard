import { describe, it, expect } from 'vitest';
import { parseK8sQuery, filterK8sResources } from './k8s-search-filter';

const items = [
  { name: 'nginx-abc', namespace: 'default', status: 'Running' },
  { name: 'redis-xyz', namespace: 'cache', status: 'Pending' },
  { name: 'nginx-old', namespace: 'kube-system', status: 'Running' },
  { name: 'api-svc', namespace: 'default' }, // no status (e.g. a service)
];

describe('parseK8sQuery', () => {
  it('returns an empty object for a blank query', () => {
    expect(parseK8sQuery('   ')).toEqual({});
    expect(parseK8sQuery('')).toEqual({});
  });

  it('extracts namespace and status tokens and free text', () => {
    expect(parseK8sQuery('namespace:default status:running nginx')).toEqual({
      namespace: 'default',
      status: 'running',
      text: 'nginx',
    });
  });

  it('treats bare words as free text (joined)', () => {
    expect(parseK8sQuery('nginx web')).toEqual({ text: 'nginx web' });
  });

  it('ignores field tokens with an empty value', () => {
    expect(parseK8sQuery('namespace: nginx')).toEqual({ text: 'nginx' });
  });
});

describe('filterK8sResources', () => {
  it('returns all items for a blank query', () => {
    expect(filterK8sResources(items, '  ')).toHaveLength(4);
  });

  it('matches free text against the name (case-insensitive substring)', () => {
    const r = filterK8sResources(items, 'NGINX');
    expect(r.map((i) => i.name)).toEqual(['nginx-abc', 'nginx-old']);
  });

  it('matches namespace exactly (case-insensitive)', () => {
    const r = filterK8sResources(items, 'namespace:DEFAULT');
    expect(r.map((i) => i.name)).toEqual(['nginx-abc', 'api-svc']);
  });

  it('does not match namespace as a substring', () => {
    const r = filterK8sResources(items, 'namespace:kube');
    expect(r).toHaveLength(0); // 'kube-system' is not an exact match for 'kube'
  });

  it('narrows resources that have a status, by case-insensitive substring', () => {
    const r = filterK8sResources(items, 'status:running');
    // The two Running pods match; redis (Pending) is dropped; api-svc has no
    // status so the status token is ignored for it and it passes through.
    expect(r.map((i) => i.name)).toEqual(['nginx-abc', 'nginx-old', 'api-svc']);
  });

  it('passes status-less resources through a status token (does not exclude them)', () => {
    const r = filterK8sResources(items, 'status:running');
    expect(r.some((i) => i.name === 'api-svc')).toBe(true);
  });

  it('combines tokens with AND', () => {
    const r = filterK8sResources(items, 'namespace:kube-system nginx');
    expect(r.map((i) => i.name)).toEqual(['nginx-old']);
  });
});
