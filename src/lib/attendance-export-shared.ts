import { format } from 'date-fns';

export const ATTENDANCE_EXPORT_TEMPLATES = [
  'daily-summary',
  'monthly-matrix',
  'weekly-validation',
] as const;

export const ATTENDANCE_EXPORT_GROUPS = [
  'main',
  'nss',
] as const;

export type AttendanceExportTemplate = typeof ATTENDANCE_EXPORT_TEMPLATES[number];
export type AttendanceExportGroup = typeof ATTENDANCE_EXPORT_GROUPS[number];

export const NSS_ATTENDANCE_EXPORT_RESTRICTION_MESSAGE = 'NSS personnel attendance exports use Weekly Validation only';

const NSS_ATTENDANCE_EXPORT_TEMPLATES = ['weekly-validation'] as const satisfies readonly AttendanceExportTemplate[];

const DEFAULT_ATTENDANCE_EXPORT_TEMPLATE_BY_GROUP: Record<AttendanceExportGroup, AttendanceExportTemplate> = {
  main: 'daily-summary',
  nss: 'weekly-validation',
};

export function isAttendanceExportTemplate(value: unknown): value is AttendanceExportTemplate {
  return typeof value === 'string' && ATTENDANCE_EXPORT_TEMPLATES.includes(value as AttendanceExportTemplate);
}

export function isAttendanceExportGroup(value: unknown): value is AttendanceExportGroup {
  return typeof value === 'string' && ATTENDANCE_EXPORT_GROUPS.includes(value as AttendanceExportGroup);
}

export function getAttendanceExportTemplatesForGroup(group: AttendanceExportGroup): readonly AttendanceExportTemplate[] {
  return group === 'nss' ? NSS_ATTENDANCE_EXPORT_TEMPLATES : ATTENDANCE_EXPORT_TEMPLATES;
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

export function getAttendanceExportTemplateLabel(template: AttendanceExportTemplate) {
  if (template === 'daily-summary') return 'Daily Summary';
  if (template === 'monthly-matrix') return 'Monthly Matrix';
  return 'Weekly Validation';
}

export function getAttendanceExportGroupLabel(group: AttendanceExportGroup) {
  return group === 'main' ? 'Main Staff' : 'NSS';
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
  const groupLabel = group === 'main' ? 'Main_Staff' : 'NSS';
  const templateLabel = getAttendanceExportTemplateLabel(template).replace(/\s+/g, '_');
  const monthLabel = format(new Date(year, month, 1), 'MMMM');

  return `Attendance_${groupLabel}_${monthLabel}_${year}_${templateLabel}.xlsx`;
}
