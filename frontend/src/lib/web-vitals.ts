import type { Metric } from 'web-vitals';

type ReportHandler = (metric: Metric) => void;

const isDev = import.meta.env.DEV;

const defaultHandler: ReportHandler = (metric) => {
  if (isDev) {
    const color = metric.rating === 'good' ? '\x1b[32m' : metric.rating === 'needs-improvement' ? '\x1b[33m' : '\x1b[31m';
     
    console.log(
      `${color}[Web Vitals] ${metric.name}: ${Math.round(metric.value * 100) / 100} (${metric.rating})\x1b[0m`,
    );
  }
};

export async function reportWebVitals(onReport: ReportHandler = defaultHandler) {
  const { onCLS, onINP, onLCP, onTTFB } = await import('web-vitals');
  onCLS(onReport);
  onINP(onReport);
  onLCP(onReport);
  onTTFB(onReport);
}
