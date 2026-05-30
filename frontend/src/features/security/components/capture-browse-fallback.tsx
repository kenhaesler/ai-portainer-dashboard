import { useMemo, useState } from 'react';
import { ThemedSelect } from '@/shared/components/ui/themed-select';
import type { Container } from '@/features/containers/hooks/use-containers';
import type { Stack } from '@/features/containers/hooks/use-stacks';
import {
  buildStackGroupedContainerOptions,
  resolveContainerStackName,
  NO_STACK_LABEL,
} from '@/features/containers/lib/container-stack-grouping';
import type { CaptureTarget } from './capture-target-picker';

export interface CaptureBrowseFallbackProps {
  containers: Container[];
  stacks: Stack[];
  endpoints: { id: number; name: string }[];
  edgeAsyncEndpointIds: Set<number>;
  onChange: (target: CaptureTarget) => void;
}

export function CaptureBrowseFallback({
  containers, stacks, endpoints, edgeAsyncEndpointIds, onChange,
}: CaptureBrowseFallbackProps) {
  const [endpointId, setEndpointId] = useState<number | undefined>();
  const [stackName, setStackName] = useState<string | undefined>();

  const knownStackNames = useMemo(
    () => stacks.filter((s) => s.endpointId === endpointId).map((s) => s.name),
    [stacks, endpointId],
  );
  const endpointContainers = useMemo(
    () => containers.filter((c) => c.endpointId === endpointId),
    [containers, endpointId],
  );
  const stackOptions = useMemo(() => {
    const set = new Set<string>(knownStackNames);
    for (const c of endpointContainers) {
      set.add(resolveContainerStackName(c, knownStackNames) ?? NO_STACK_LABEL);
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
  }, [endpointContainers, knownStackNames]);
  const filtered = useMemo(
    () => (stackName
      ? endpointContainers.filter((c) => (resolveContainerStackName(c, knownStackNames) ?? NO_STACK_LABEL) === stackName)
      : endpointContainers),
    [endpointContainers, stackName, knownStackNames],
  );
  const containerOptions = useMemo(
    () => buildStackGroupedContainerOptions(filtered, knownStackNames),
    [filtered, knownStackNames],
  );

  const handleContainer = (id: string) => {
    const c = filtered.find((x) => x.id === id);
    if (!c || edgeAsyncEndpointIds.has(c.endpointId)) return;
    onChange({
      endpointId: c.endpointId,
      containerId: c.id,
      containerName: c.name,
      endpointName: c.endpointName,
      stackName: resolveContainerStackName(c, knownStackNames) ?? NO_STACK_LABEL,
    });
  };

  return (
    <details className="mt-3 rounded-md border bg-card/50 p-3 text-sm">
      <summary className="cursor-pointer select-none font-medium text-muted-foreground">
        Browse by endpoint
      </summary>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ThemedSelect
          value={endpointId != null ? String(endpointId) : '__all__'}
          onValueChange={(v) => { setEndpointId(v === '__all__' ? undefined : Number(v)); setStackName(undefined); }}
          placeholder="Select endpoint..."
          options={[{ value: '__all__', label: 'Select endpoint...' }, ...endpoints.map((e) => ({ value: String(e.id), label: e.name }))]}
          className="w-full text-sm"
        />
        <ThemedSelect
          value={stackName ?? '__all__'}
          onValueChange={(v) => setStackName(v === '__all__' ? undefined : v)}
          disabled={endpointId == null}
          placeholder="All stacks"
          options={[{ value: '__all__', label: 'All stacks' }, ...stackOptions.map((s) => ({ value: s, label: s }))]}
          className="w-full text-sm"
        />
        <ThemedSelect
          value="__all__"
          onValueChange={(v) => v !== '__all__' && handleContainer(v)}
          disabled={endpointId == null}
          placeholder="Select container..."
          options={[{ value: '__all__', label: 'Select container...' }, ...containerOptions]}
          className="w-full text-sm"
        />
      </div>
    </details>
  );
}
