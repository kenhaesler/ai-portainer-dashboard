// Stub: Full implementation coming in a separate PR
export function ResourceOverviewCard({ endpoints }: { endpoints: Array<{ name: string; totalCpu: number; totalMemory: number }> }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="rounded-md border bg-card/50 p-3">
        <p className="text-xs text-muted-foreground">Total CPU</p>
        <p className="text-lg font-semibold">{endpoints.reduce((s, e) => s + e.totalCpu, 0)} cores</p>
      </div>
      <div className="rounded-md border bg-card/50 p-3">
        <p className="text-xs text-muted-foreground">Total Memory</p>
        <p className="text-lg font-semibold">{Math.round(endpoints.reduce((s, e) => s + e.totalMemory, 0) / (1024 ** 3))} GB</p>
      </div>
    </div>
  );
}
