// db/schema.ts
import { pgTable, uuid, text, boolean, date, time, decimal, timestamp, jsonb, unique, integer, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const staff = pgTable('staff', {
  id: uuid('id').primaryKey().defaultRandom(),
  fullName: text('full_name').notNull(),
  email: text('email'),
  displayOrder: integer('display_order'),
  active: boolean('active').default(true),
  archived: boolean('archived').default(false),
  archivedAt: timestamp('archived_at'),
  department: text('department'),
  unit: text('unit'),
  isNssPersonnel: boolean('is_nss_personnel').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('staff_active_archived_idx').on(table.active, table.archived),
  index('staff_email_idx').on(table.email),
]);

export const staffRelations = relations(staff, ({ many }) => ({
  attendanceRecords: many(attendanceRecord),
  attendancePermissions: many(attendancePermission),
  deviceTransferRequests: many(deviceTransferRequest),
  devices: many(staffDevice),
  emergencyContacts: many(emergencyContact),
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
}, (table) => [
  index('lateness_entry_date_idx').on(table.date),
  unique().on(table.staffId, table.date),
]);

export const latenessEntryRelations = relations(latenessEntry, ({ one }) => ({
  staff: one(staff, {
    fields: [latenessEntry.staffId],
    references: [staff.id],
  }),
}));

export const entrySubmission = pgTable('entry_submission', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: date('date').unique().notNull(),
  submittedByUserId: text('submitted_by_user_id'),
  submittedByEmail: text('submitted_by_email').notNull(),
  entryCount: integer('entry_count').default(0).notNull(),
  deletedCount: integer('deleted_count').default(0).notNull(),
  submittedAt: timestamp('submitted_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

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

export const officeNetwork = pgTable('office_network', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().default('Office WiFi'),
  allowedIp: text('allowed_ip').notNull(),
  isActive: boolean('is_active').default(true),
  updatedByUserId: text('updated_by_user_id'),
  updatedByEmail: text('updated_by_email').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const officeLocation = pgTable('office_location', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().default('Office Location'),
  latitude: decimal('latitude', { precision: 10, scale: 7 }).notNull(),
  longitude: decimal('longitude', { precision: 10, scale: 7 }).notNull(),
  radiusMeters: integer('radius_meters').notNull().default(100),
  maxAccuracyMeters: integer('max_accuracy_meters').notNull().default(75),
  locationKind: text('location_kind').notNull().default('default'),
  googlePlaceId: text('google_place_id'),
  formattedAddress: text('formatted_address'),
  source: text('source').notNull().default('manual'),
  scheduleStartDate: date('schedule_start_date'),
  scheduleEndDate: date('schedule_end_date'),
  isActive: boolean('is_active').default(true),
  archivedAt: timestamp('archived_at'),
  updatedByUserId: text('updated_by_user_id'),
  updatedByEmail: text('updated_by_email').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('office_location_kind_active_idx').on(table.locationKind, table.isActive),
  index('office_location_schedule_idx').on(table.scheduleStartDate, table.scheduleEndDate),
]);

export const attendanceRecord = pgTable('attendance_record', {
  id: uuid('id').primaryKey().defaultRandom(),
  staffId: uuid('staff_id').notNull().references(() => staff.id),
  date: date('date').notNull(),
  checkInAt: timestamp('check_in_at').notNull(),
  checkInTime: time('check_in_time').notNull(),
  signOutAt: timestamp('sign_out_at'),
  signOutTime: time('sign_out_time'),
  signOutNetworkIp: text('sign_out_network_ip'),
  signOutUserAgent: text('sign_out_user_agent'),
  checkInLatitude: decimal('check_in_latitude', { precision: 10, scale: 7 }),
  checkInLongitude: decimal('check_in_longitude', { precision: 10, scale: 7 }),
  checkInOfficeLocationId: uuid('check_in_office_location_id').references(() => officeLocation.id),
  checkInAccuracyMeters: decimal('check_in_accuracy_meters', { precision: 10, scale: 2 }),
  checkInDistanceMeters: decimal('check_in_distance_meters', { precision: 10, scale: 2 }),
  checkInLocationAt: timestamp('check_in_location_at'),
  checkInLocationVerified: boolean('check_in_location_verified').default(false),
  checkInVerificationResult: text('check_in_verification_result'),
  signOutLatitude: decimal('sign_out_latitude', { precision: 10, scale: 7 }),
  signOutLongitude: decimal('sign_out_longitude', { precision: 10, scale: 7 }),
  signOutOfficeLocationId: uuid('sign_out_office_location_id').references(() => officeLocation.id),
  signOutAccuracyMeters: decimal('sign_out_accuracy_meters', { precision: 10, scale: 2 }),
  signOutDistanceMeters: decimal('sign_out_distance_meters', { precision: 10, scale: 2 }),
  signOutLocationAt: timestamp('sign_out_location_at'),
  signOutLocationVerified: boolean('sign_out_location_verified').default(false),
  signOutVerificationResult: text('sign_out_verification_result'),
  status: text('status').notNull(),
  source: text('source').notNull().default('staff_portal'),
  networkIp: text('network_ip').notNull(),
  userAgent: text('user_agent'),
  computedAmount: decimal('computed_amount', { precision: 10, scale: 2 }).notNull().default('0'),
  reason: text('reason'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('attendance_record_date_idx').on(table.date),
  unique().on(table.staffId, table.date),
]);

export const attendanceRecordRelations = relations(attendanceRecord, ({ one }) => ({
  staff: one(staff, {
    fields: [attendanceRecord.staffId],
    references: [staff.id],
  }),
}));

export const attendanceAttempt = pgTable('attendance_attempt', {
  id: uuid('id').primaryKey().defaultRandom(),
  staffId: uuid('staff_id').references(() => staff.id),
  userId: text('user_id'),
  userEmail: text('user_email').notNull(),
  date: date('date').notNull(),
  networkIp: text('network_ip').notNull(),
  userAgent: text('user_agent'),
  latitude: decimal('latitude', { precision: 10, scale: 7 }),
  longitude: decimal('longitude', { precision: 10, scale: 7 }),
  officeLocationId: uuid('office_location_id').references(() => officeLocation.id),
  accuracyMeters: decimal('accuracy_meters', { precision: 10, scale: 2 }),
  distanceMeters: decimal('distance_meters', { precision: 10, scale: 2 }),
  locationAt: timestamp('location_at'),
  verificationResult: text('verification_result'),
  successful: boolean('successful').default(false).notNull(),
  result: text('result').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('attendance_attempt_date_idx').on(table.date),
  index('attendance_attempt_staff_date_idx').on(table.staffId, table.date),
]);

export const attendancePermission = pgTable('attendance_permission', {
  id: uuid('id').primaryKey().defaultRandom(),
  staffId: uuid('staff_id').notNull().references(() => staff.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  permissionType: text('permission_type').notNull().default('late_arrival'),
  arrivalWindow: text('arrival_window').notNull().default('any_time_today'),
  expectedStartTime: time('expected_start_time'),
  expectedEndTime: time('expected_end_time'),
  reason: text('reason').notNull(),
  status: text('status').notNull().default('approved'),
  approvedByUserId: text('approved_by_user_id'),
  approvedByEmail: text('approved_by_email').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('attendance_permission_date_idx').on(table.date),
  index('attendance_permission_staff_id_idx').on(table.staffId),
  unique().on(table.staffId, table.date),
]);

export const attendancePermissionRelations = relations(attendancePermission, ({ one }) => ({
  staff: one(staff, {
    fields: [attendancePermission.staffId],
    references: [staff.id],
  }),
}));

export const staffDevice = pgTable('staff_device', {
  id: uuid('id').primaryKey().defaultRandom(),
  staffId: uuid('staff_id').notNull().references(() => staff.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  deviceHash: text('device_hash').notNull(),
  deviceLabel: text('device_label'),
  userAgent: text('user_agent'),
  registeredIp: text('registered_ip'),
  lastSeenIp: text('last_seen_ip'),
  lastVerifiedAt: timestamp('last_verified_at'),
  lastVerificationMethod: text('last_verification_method'),
  lastDistanceMeters: decimal('last_distance_meters', { precision: 10, scale: 2 }),
  registeredAt: timestamp('registered_at').defaultNow(),
  lastSeenAt: timestamp('last_seen_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('staff_device_user_id_idx').on(table.userId),
  unique().on(table.staffId),
]);

export const staffDeviceRelations = relations(staffDevice, ({ one }) => ({
  staff: one(staff, {
    fields: [staffDevice.staffId],
    references: [staff.id],
  }),
}));

export const deviceTransferRequest = pgTable('device_transfer_request', {
  id: uuid('id').primaryKey().defaultRandom(),
  staffId: uuid('staff_id').notNull().references(() => staff.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  userEmail: text('user_email').notNull(),
  deviceHash: text('device_hash').notNull(),
  deviceLabel: text('device_label'),
  userAgent: text('user_agent'),
  networkIp: text('network_ip'),
  latitude: decimal('latitude', { precision: 10, scale: 7 }),
  longitude: decimal('longitude', { precision: 10, scale: 7 }),
  accuracyMeters: decimal('accuracy_meters', { precision: 10, scale: 2 }),
  distanceMeters: decimal('distance_meters', { precision: 10, scale: 2 }),
  locationAt: timestamp('location_at'),
  verificationResult: text('verification_result'),
  status: text('status').notNull().default('pending'),
  reviewedByUserId: text('reviewed_by_user_id'),
  reviewedByEmail: text('reviewed_by_email'),
  reviewedAt: timestamp('reviewed_at'),
  requestedAt: timestamp('requested_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('device_transfer_request_staff_status_idx').on(table.staffId, table.status),
  index('device_transfer_request_status_idx').on(table.status),
]);

export const deviceTransferRequestRelations = relations(deviceTransferRequest, ({ one }) => ({
  staff: one(staff, {
    fields: [deviceTransferRequest.staffId],
    references: [staff.id],
  }),
}));

export const emergencyContact = pgTable('emergency_contact', {
  id: uuid('id').primaryKey().defaultRandom(),
  staffId: uuid('staff_id').references(() => staff.id, { onDelete: 'set null' }),
  contactName: text('contact_name').notNull(),
  relationship: text('relationship'),
  phone: text('phone').notNull(),
  alternatePhone: text('alternate_phone'),
  email: text('email'),
  address: text('address'),
  notes: text('notes'),
  priority: text('priority').default('primary').notNull(),
  active: boolean('active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('emergency_contact_active_idx').on(table.active),
  index('emergency_contact_staff_id_idx').on(table.staffId),
]);

export const emergencyContactRelations = relations(emergencyContact, ({ one }) => ({
  staff: one(staff, {
    fields: [emergencyContact.staffId],
    references: [staff.id],
  }),
}));

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
}, (table) => [
  index('audit_event_entity_idx').on(table.entityType, table.entityId),
  index('audit_event_timestamp_idx').on(table.timestamp),
]);

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
  index('notification_read_user_id_idx').on(table.userId),
  unique().on(table.notificationId, table.userId),
]);
