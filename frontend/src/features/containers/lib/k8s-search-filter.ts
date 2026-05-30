/**
 * Smart-search filter for Kubernetes resource lists (pods, deployments,
 * services) shown on the Infrastructure page. Supports `namespace:` and
 * `status:` field tokens plus free-text matched against the resource name.
 * Resources without a `status` field (e.g. services) never match a `status:`
 * token, which is the intended behavior.
 */
export interface K8sSearchableResource {
  name: string;
  namespace?: string;
  status?: string;
}

export interface ParsedK8sQuery {
  namespace?: string;
  status?: string;
  text?: string;
}

export function parseK8sQuery(query: string): ParsedK8sQuery {
  const parsed: ParsedK8sQuery = {};
  const freeText: string[] = [];

  for (const token of query.trim().split(/\s+/).filter(Boolean)) {
    const match = /^(namespace|status):(.*)$/i.exec(token);
    if (match) {
      const value = match[2].toLowerCase();
      if (!value) continue;
      if (match[1].toLowerCase() === 'namespace') parsed.namespace = value;
      else parsed.status = value;
    } else {
      freeText.push(token.toLowerCase());
    }
  }

  if (freeText.length > 0) parsed.text = freeText.join(' ');
  return parsed;
}

export function filterK8sResources<T extends K8sSearchableResource>(
  items: T[],
  query: string,
): T[] {
  const { namespace, status, text } = parseK8sQuery(query);
  if (!namespace && !status && !text) return items;

  return items.filter((item) => {
    if (namespace && (item.namespace ?? '').toLowerCase() !== namespace) return false;
    if (status) {
      if (item.status === undefined) return false;
      if (!item.status.toLowerCase().includes(status)) return false;
    }
    if (text && !item.name.toLowerCase().includes(text)) return false;
    return true;
  });
}
