import { z } from 'zod';

export const LoginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const SessionSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  username: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
  last_active: z.string(),
  is_valid: z.number(),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;
