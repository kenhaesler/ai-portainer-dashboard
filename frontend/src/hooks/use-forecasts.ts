import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface ForecastPoint {
  timestamp: string;
  value: number;
  isProjected: boolean;
}

export interface CapacityForecast {
  containerId: string;
  containerName: string;
  metricType: string;
  currentValue: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  slope: number;
  r_squared: number;
  forecast: ForecastPoint[];
  timeToThreshold: number | null;
  confidence: 'high' | 'medium' | 'low';
}

export function useForecasts(limit: number = 10) {
  return useQuery<CapacityForecast[]>({
    queryKey: ['forecasts', limit],
    queryFn: () => api.get<CapacityForecast[]>(`/api/forecasts?limit=${limit}`),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useContainerForecast(containerId: string, metric: string = 'cpu') {
  return useQuery<CapacityForecast>({
    queryKey: ['forecast', containerId, metric],
    queryFn: () => api.get<CapacityForecast>(`/api/forecasts/${containerId}?metric=${metric}`),
    staleTime: 5 * 60 * 1000,
    enabled: !!containerId,
  });
}

interface ForecastNarrativeResponse {
  narrative: string | null;
}

export function useAiForecastNarrative(containerId: string, metricType: string, enabled: boolean = true) {
  return useQuery<ForecastNarrativeResponse>({
    queryKey: ['forecast-narrative', containerId, metricType],
    queryFn: () => api.get<ForecastNarrativeResponse>(
      `/api/forecasts/${containerId}/narrative?metricType=${metricType}`,
    ),
    staleTime: 5 * 60 * 1000,
    retry: 1,
    enabled: enabled && !!containerId,
  });
}
