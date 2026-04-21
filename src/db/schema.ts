// db/schema.ts
import { pgTable, uuid, text, boolean, date, time, decimal, timestamp, jsonb, unique, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const staff = pgTable('staff', {
  id: uuid('id').primaryKey().defaultRandom(),
  fullName: text('full_name').notNull(),
  displayOrder: integer('display_order'),
  active: boolean('active').default(true),
  department: text('department'),
  unit: text('unit'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const staffRelations = relations(staff, ({ many }) => ({
  entries: many(latenessEntry),
}));

export const latenessEntry = pgTable('lateness_entry', {
  id: uuid('id').primaryKey().defaultRandom(),
  staffId: uuid('staff_id').notNull().references(() => staff.id),
  date: date('date').notNull(),
  arrivalTime: time('arrival_time'),
  didNotSignOut: boolean('did_not_sign_out').default(false),
  reason: text('reason'),
  computedAmount: decimal('computed_amount', { precision: 10, scale: 2 }).notNull(),
  overrideAmount: decimal('override_amount', { precision: 10, scale: 2 }),
  overrideReason: text('override_reason'),
  overriddenBy: uuid('overridden_by'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [unique().on(table.staffId, table.date)]);

export const latenessEntryRelations = relations(latenessEntry, ({ one }) => ({
  staff: one(staff, {
    fields: [latenessEntry.staffId],
    references: [staff.id],
  }),
}));

export const workCalendar = pgTable('work_calendar', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: date('date').unique().notNull(),
  isHoliday: boolean('is_holiday').default(false),
  holidayNote: text('holiday_note'),
  source: text('source').default('manual'), // 'google' or 'manual'
  isRemoved: boolean('is_removed').default(false), // true if user unmarked a Google holiday
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const auditEvent = pgTable('audit_event', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  action: text('action').notNull(),
  beforeJson: jsonb('before_json'),
  afterJson: jsonb('after_json'),
  actorUserId: uuid('actor_user_id'),
  actorEmail: text('actor_email').notNull(),
  timestamp: timestamp('timestamp').defaultNow(),
});

export const templateVersion = pgTable('template_version', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  r2Key: text('r2_key').notNull(),
  version: integer('version').notNull(),
  isActive: boolean('is_active').default(true),
  mappingJson: jsonb('mapping_json').notNull(),
  uploadedBy: uuid('uploaded_by'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const notificationRead = pgTable('notification_read', {
  id: uuid('id').primaryKey().defaultRandom(),
  notificationId: text('notification_id').notNull(),
  userId: text('user_id').notNull(),
  readAt: timestamp('read_at').defaultNow(),
}, (table) => [
  unique().on(table.notificationId, table.userId),
]);
