import { useState } from 'react';
import { Play, Square, RotateCw } from 'lucide-react';
import { useContainerAction, type Container } from '@/hooks/use-containers';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';

type ContainerAction = 'start' | 'stop' | 'restart';

interface PendingAction {
  action: ContainerAction;
}

const ACTION_CONFIG: Record<ContainerAction, { label: string; variant: 'default' | 'destructive'; description: (name: string) => string }> = {
  start: {
    label: 'Start',
    variant: 'default',
    description: (name) => `Are you sure you want to start container "${name}"?`,
  },
  stop: {
    label: 'Stop',
    variant: 'destructive',
    description: (name) => `Are you sure you want to stop container "${name}"? Running processes will be terminated.`,
  },
  restart: {
    label: 'Restart',
    variant: 'default',
    description: (name) => `Are you sure you want to restart container "${name}"?`,
  },
};

interface ContainerActionsBarProps {
  container: Container;
  onActionComplete?: () => void;
}

export function ContainerActionsBar({ container, onActionComplete }: ContainerActionsBarProps) {
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const containerAction = useContainerAction();

  const handleAction = (action: ContainerAction) => {
    setPendingAction({ action });
  };

  const confirmAction = async () => {
    if (!pendingAction) return;
    await containerAction.mutateAsync({
      endpointId: container.endpointId,
      containerId: container.id,
      action: pendingAction.action,
    });
    onActionComplete?.();
  };

  const isRunning = container.state === 'running';

  return (
    <>
      <div className="sticky top-0 z-10 flex items-center gap-2 rounded-lg border bg-card p-4 shadow-sm">
        <span className="text-sm font-medium text-muted-foreground">Actions:</span>
        {isRunning ? (
          <>
            <button
              onClick={() => handleAction('stop')}
              className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-red-100 hover:text-red-700 hover:border-red-300 dark:hover:bg-red-900/30 dark:hover:text-red-400"
            >
              <Square className="h-4 w-4" />
              Stop
            </button>
            <button
              onClick={() => handleAction('restart')}
              className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-amber-100 hover:text-amber-700 hover:border-amber-300 dark:hover:bg-amber-900/30 dark:hover:text-amber-400"
            >
              <RotateCw className="h-4 w-4" />
              Restart
            </button>
          </>
        ) : (
          <button
            onClick={() => handleAction('start')}
            className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-emerald-100 hover:text-emerald-700 hover:border-emerald-300 dark:hover:bg-emerald-900/30 dark:hover:text-emerald-400"
          >
            <Play className="h-4 w-4" />
            Start
          </button>
        )}
      </div>

      {/* Confirm Dialog */}
      {pendingAction && (
        <ConfirmDialog
          open={!!pendingAction}
          onOpenChange={(open) => { if (!open) setPendingAction(null); }}
          title={`${ACTION_CONFIG[pendingAction.action].label} Container`}
          description={ACTION_CONFIG[pendingAction.action].description(container.name)}
          confirmLabel={ACTION_CONFIG[pendingAction.action].label}
          variant={ACTION_CONFIG[pendingAction.action].variant}
          onConfirm={confirmAction}
        />
      )}
    </>
  );
}
