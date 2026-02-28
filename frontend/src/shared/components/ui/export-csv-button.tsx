import { Download } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

interface ExportCsvButtonProps {
  data: Record<string, unknown>[];
  filename?: string;
  className?: string;
}

export function ExportCsvButton({ data, filename = 'export.csv', className }: ExportCsvButtonProps) {
  const handleExport = () => {
    if (!data.length) return;

    const headers = Object.keys(data[0]);
    const csvRows = [
      headers.join(','),
      ...data.map((row) =>
        headers
          .map((header) => {
            const val = row[header];
            const str = val === null || val === undefined ? '' : String(val);
            return str.includes(',') || str.includes('"') || str.includes('\n')
              ? `"${str.replace(/"/g, '""')}"`
              : str;
          })
          .join(',')
      ),
    ];

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      onClick={handleExport}
      disabled={!data.length}
      className={cn(
        'inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50',
        className
      )}
    >
      <Download className="h-4 w-4" />
      Export CSV
    </button>
  );
}
