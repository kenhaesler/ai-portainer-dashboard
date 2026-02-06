import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronUp, ChevronDown, AlertCircle, CheckCircle, Info, AlertTriangle, X } from 'lucide-react';
import { useActivityFeedStore, type ActivityEvent } from '@/stores/activity-feed-store';
import { useSockets } from '@/providers/socket-provider';
import { useThemeStore } from '@/stores/theme-store';
import { cn } from '@/lib/utils';

const severityIcons = {
  success: CheckCircle,
  warning: AlertTriangle,
  error: AlertCircle,
  info: Info,
};

const severityColors = {
  success: 'text-emerald-500',
  warning: 'text-amber-500',
  error: 'text-red-500',
  info: 'text-blue-500',
};

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function EventItem({ event }: { event: ActivityEvent }) {
  const navigate = useNavigate();
  const Icon = severityIcons[event.severity];

  return (
    <button
      onClick={() => event.link && navigate(event.link)}
      className={cn(
        'flex items-center gap-2 px-3 py-1 text-left text-xs transition-colors hover:bg-muted/50 w-full',
        event.link && 'cursor-pointer',
        !event.link && 'cursor-default',
      )}
    >
      <Icon className={cn('h-3.5 w-3.5 shrink-0', severityColors[event.severity])} />
      <span className="truncate">{event.message}</span>
      <span className="ml-auto shrink-0 text-muted-foreground">{formatTime(event.timestamp)}</span>
    </button>
  );
}

export function ActivityFeed() {
  const { events, collapsed, unreadCount, toggleCollapsed, clearAll, addEvent } = useActivityFeedStore();
  const { monitoringSocket, connected } = useSockets();
  const dashboardBackground = useThemeStore((s) => s.dashboardBackground);
  const hasAnimatedBg = dashboardBackground !== 'none';
  const scrollRef = useRef<HTMLDivElement>(null);

  // Subscribe to real-time monitoring events
  useEffect(() => {
    if (!monitoringSocket) return;

    const handleInsight = (insight: { severity: string; title: string; container_name?: string }) => {
      const severity = insight.severity === 'critical' ? 'error' : insight.severity === 'warning' ? 'warning' : 'info';
      addEvent({
        type: 'insight',
        severity: severity as ActivityEvent['severity'],
        message: insight.container_name
          ? `${insight.title} (${insight.container_name})`
          : insight.title,
        link: '/ai-monitor',
      });
    };

    monitoringSocket.on('insights:new', handleInsight);
    return () => { monitoringSocket.off('insights:new', handleInsight); };
  }, [monitoringSocket, addEvent]);

  // Track connection state changes
  useEffect(() => {
    if (!monitoringSocket) return;

    const onConnect = () => {
      addEvent({
        type: 'connection',
        severity: 'success',
        message: 'WebSocket connected',
      });
    };
    const onDisconnect = () => {
      addEvent({
        type: 'connection',
        severity: 'error',
        message: 'WebSocket disconnected',
      });
    };

    monitoringSocket.on('connect', onConnect);
    monitoringSocket.on('disconnect', onDisconnect);
    return () => {
      monitoringSocket.off('connect', onConnect);
      monitoringSocket.off('disconnect', onDisconnect);
    };
  }, [monitoringSocket, addEvent]);

  // Auto-scroll to top on new events
  useEffect(() => {
    if (!collapsed && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [events.length, collapsed]);

  return (
    <div
      data-animated-bg={hasAnimatedBg || undefined}
      className={cn(
        "fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur-sm transition-all duration-200 hidden md:block",
        hasAnimatedBg && "backdrop-blur-xl"
      )}
    >
      {/* Collapsed bar */}
      <button
        onClick={toggleCollapsed}
        className="flex w-full items-center justify-between px-4 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {collapsed ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
          <span>Activity Feed</span>
          {unreadCount > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={cn(
            'h-1.5 w-1.5 rounded-full',
            connected ? 'bg-emerald-500' : 'bg-red-500',
          )} />
          <span>{events.length} events</span>
        </div>
      </button>

      {/* Expanded feed */}
      {!collapsed && (
        <div className="border-t">
          <div className="flex items-center justify-between px-4 py-1">
            <span className="text-xs font-medium text-muted-foreground">Recent Activity</span>
            <button
              onClick={clearAll}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          </div>
          <div
            ref={scrollRef}
            className="max-h-64 overflow-y-auto"
          >
            {events.length === 0 ? (
              <p className="px-4 py-3 text-center text-xs text-muted-foreground">
                No activity yet
              </p>
            ) : (
              events.map((event) => (
                <EventItem key={event.id} event={event} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
