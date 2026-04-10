// lib/validation/schemas.ts
import { z } from 'zod';

export const staffSchema = z.object({
  fullName: z.string().min(1, 'Full name is required'),
  department: z.string().optional(),
  unit: z.string().optional(),
});

export const entrySchema = z.object({
  staffId: z.string().uuid('Invalid staff ID'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  arrivalTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  didNotSignOut: z.boolean(),
  reason: z.string().optional(),
});

export const holidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  isHoliday: z.boolean(),
  holidayNote: z.string().optional(),
});

export type StaffInput = z.infer<typeof staffSchema>;
export type EntryInput = z.infer<typeof entrySchema>;
export type HolidayInput = z.infer<typeof holidaySchema>;
