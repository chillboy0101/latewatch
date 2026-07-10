import { format } from 'date-fns';

export const ATTENDANCE_EXPORT_TEMPLATES = [
  'daily-summary',
  'weekly-validation',
  'monthly-matrix',
] as const;

export const ATTENDANCE_EXPORT_GROUPS = [
  'main',
  'nss',
  'interns',
] as const;

export type AttendanceExportTemplate = typeof ATTENDANCE_EXPORT_TEMPLATES[number];
export type AttendanceExportGroup = typeof ATTENDANCE_EXPORT_GROUPS[number];

export const NSS_ATTENDANCE_EXPORT_RESTRICTION_MESSAGE = 'NSS personnel attendance exports use Weekly Validation only';
export const INTERNS_ATTENDANCE_EXPORT_RESTRICTION_MESSAGE = 'Special staff & intern attendance exports use Weekly Validation only';

const WEEKLY_ONLY_ATTENDANCE_EXPORT_TEMPLATES = ['weekly-validation'] as const satisfies readonly AttendanceExportTemplate[];

const WEEKLY_ONLY_ATTENDANCE_EXPORT_GROUPS: readonly AttendanceExportGroup[] = ['nss', 'interns'];

const DEFAULT_ATTENDANCE_EXPORT_TEMPLATE_BY_GROUP: Record<AttendanceExportGroup, AttendanceExportTemplate> = {
  main: 'daily-summary',
  nss: 'weekly-validation',
  interns: 'weekly-validation',
};

export function isAttendanceExportTemplate(value: unknown): value is AttendanceExportTemplate {
  return typeof value === 'string' && ATTENDANCE_EXPORT_TEMPLATES.includes(value as AttendanceExportTemplate);
}

export function isAttendanceExportGroup(value: unknown): value is AttendanceExportGroup {
  return typeof value === 'string' && ATTENDANCE_EXPORT_GROUPS.includes(value as AttendanceExportGroup);
}

export function getAttendanceExportTemplatesForGroup(group: AttendanceExportGroup): readonly AttendanceExportTemplate[] {
  return WEEKLY_ONLY_ATTENDANCE_EXPORT_GROUPS.includes(group) ? WEEKLY_ONLY_ATTENDANCE_EXPORT_TEMPLATES : ATTENDANCE_EXPORT_TEMPLATES;
}

export function getDefaultAttendanceExportTemplateForGroup(group: AttendanceExportGroup) {
  return DEFAULT_ATTENDANCE_EXPORT_TEMPLATE_BY_GROUP[group];
}

export function isAttendanceExportTemplateAllowedForGroup(
  group: AttendanceExportGroup,
  template: AttendanceExportTemplate,
) {
  return getAttendanceExportTemplatesForGroup(group).includes(template);
}

export function getAttendanceExportTemplateRestrictionMessage(group: AttendanceExportGroup) {
  return group === 'interns' ? INTERNS_ATTENDANCE_EXPORT_RESTRICTION_MESSAGE : NSS_ATTENDANCE_EXPORT_RESTRICTION_MESSAGE;
}

export function getAttendanceExportTemplateLabel(template: AttendanceExportTemplate) {
  if (template === 'daily-summary') return 'Daily Summary';
  if (template === 'monthly-matrix') return 'Monthly Matrix';
  return 'Weekly Validation';
}

export function getAttendanceExportGroupLabel(group: AttendanceExportGroup) {
  if (group === 'main') return 'Main Staff';
  if (group === 'interns') return 'Special Staff & Interns';
  return 'NSS';
}

export function getAttendanceExportFileName({
  group,
  month,
  template,
  year,
}: {
  group: AttendanceExportGroup;
  month: number;
  template: AttendanceExportTemplate;
  year: number;
}) {
  const groupLabel = group === 'main' ? 'Main_Staff' : group === 'interns' ? 'Special_Staff_Interns' : 'NSS';
  const templateLabel = getAttendanceExportTemplateLabel(template).replace(/\s+/g, '_');
  const monthLabel = format(new Date(year, month, 1), 'MMMM');

  return `Attendance_${groupLabel}_${monthLabel}_${year}_${templateLabel}.xlsx`;
}
