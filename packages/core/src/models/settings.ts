import { z } from 'zod/v4';

export const SettingSchema = z.object({
  key: z.string(),
  value: z.string(),
  category: z.string(),
  updated_at: z.string(),
});

export type Setting = z.infer<typeof SettingSchema>;
