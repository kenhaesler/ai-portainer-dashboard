/**
 * PDF theme metadata used at render time by the Reports page (theme selector,
 * stored-branding validation). Kept separate from management-pdf-export.ts so
 * importing the theme list does not pull the jsPDF machinery into the /reports
 * route chunk (#1507) — the export module is loaded on demand when the user
 * actually clicks Export PDF.
 */
export type ManagementPdfTheme = 'ocean' | 'forest' | 'slate' | 'sunset';

export const MANAGEMENT_PDF_THEMES: Array<{ value: ManagementPdfTheme; label: string }> = [
  { value: 'ocean', label: 'Ocean Blue' },
  { value: 'forest', label: 'Forest Green' },
  { value: 'slate', label: 'Slate Gray' },
  { value: 'sunset', label: 'Sunset Orange' },
];
