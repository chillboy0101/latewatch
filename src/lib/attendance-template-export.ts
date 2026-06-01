import ExcelJS from 'exceljs';
import { addDays, endOfMonth, format, startOfMonth } from 'date-fns';
import path from 'path';
import { and, asc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import {
  type AttendanceExportGroup,
  type AttendanceExportTemplate,
  getAttendanceExportFileName,
  isAttendanceExportTemplateAllowedForGroup,
  NSS_ATTENDANCE_EXPORT_RESTRICTION_MESSAGE,
} from '@/lib/attendance-export-shared';
import { formatAbsencePermissionReason } from '@/lib/attendance-permissions';
import { getAccraDateKey } from '@/lib/date-key';
import { WORKDAY_START_TIME } from '@/lib/work-hours';

export { getAttendanceExportFileName };
export type { AttendanceExportGroup, AttendanceExportTemplate };

type RosterStaff = {
  active?: boolean | null;
  archived?: boolean | null;
  displayOrder?: number | null;
  fullName: string;
  gender?: string | null;
  id: string;
  isAttendanceOnly?: boolean | null;
  isNssPersonnel?: boolean | null;
  rank?: string | null;
  staffNo?: string | null;
};

type AttendanceRow = {
  checkInTime?: string | null;
  date: string;
  staffId: string;
};

type PermissionRow = {
  date: string;
  permissionType?: string | null;
  reason?: string | null;
  staffId: string;
  status?: string | null;
};

type LeavePeriodRow = {
  endDate?: string | null;
  staffId: string;
  startDate: string;
};

type HolidayRow = {
  date: string;
  isHoliday?: boolean | null;
  isRemoved?: boolean | null;
};

export type AttendanceWorkbookInput = {
  attendanceRecords: AttendanceRow[];
  asOfDate?: string;
  group: AttendanceExportGroup;
  holidays: HolidayRow[];
  leavePeriods?: LeavePeriodRow[];
  month: number;
  permissions: PermissionRow[];
  roster: RosterStaff[];
  template: AttendanceExportTemplate;
  year: number;
};

export type AttendanceExportBuildResult = {
  buffer: ExcelJS.Buffer;
  fileName: string;
  rosterCount: number;
  template: AttendanceExportTemplate;
};

type DayStatus =
  | { kind: 'approved_absence'; reason: string | null }
  | { kind: 'leave' }
  | { kind: 'nonworking' }
  | { checkInTime: string; isLate: boolean; kind: 'present' }
  | { kind: 'unapproved_absence' };

const TEMPLATE_FILES: Record<AttendanceExportTemplate, string> = {
  'daily-summary': 'daily-summary.xlsx',
  'monthly-matrix': 'monthly-matrix.xlsx',
  'weekly-validation': 'weekly-validation.xlsx',
};

const PRESENT_MARK = '\u2713';
const ABSENT_MARK = '\u2717';
const MISSING_ATTENDANCE_REMARK = 'Absent with permission';
const OFFICIAL_DUTY_EXPORT_REMARK = 'Official duty';
const DAILY_OFFICIAL_DUTY_REMARK = 'Exempt (Official Duty)';
const DAILY_EXEMPT_REASONS = new Set(['training', 'official duty', 'sick', 'workshop']);
const DAILY_REMARK_COLUMN = 7;
const DAILY_REMARK_COLUMN_WIDTH = 40;
const DAILY_REMARK_LINE_HEIGHT = 16;
const DAILY_REMARK_ORDER = new Map([
  ['Exempt (Training)', 1],
  [DAILY_OFFICIAL_DUTY_REMARK, 2],
  ['Exempt (Workshop)', 3],
  ['Sick', 4],
  ['Leave', 5],
]);

function templatePath(template: AttendanceExportTemplate) {
  return path.join(process.cwd(), 'src', 'attendance-templates', TEMPLATE_FILES[template]);
}

function normalizeDateKey(value: string | Date | null | undefined) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.includes('T') ? value.slice(0, 10) : value;
}

function normalizeTime(value: string | null | undefined) {
  return typeof value === 'string' ? value.slice(0, 5) : '';
}

function isWeekend(date: Date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getExportAsOfDate(input: Pick<AttendanceWorkbookInput, 'asOfDate'>) {
  const key = normalizeDateKey(input.asOfDate) || getAccraDateKey();
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : getAccraDateKey();
}

function isFutureExportDate(date: Date, asOfDate: string) {
  return dateKey(date) > asOfDate;
}

function monthWorkingDates(year: number, month: number, holidaySet: Set<string>, asOfDate: string) {
  const dates: Date[] = [];
  const lastDay = endOfMonth(new Date(Date.UTC(year, month, 1))).getUTCDate();

  for (let day = 1; day <= lastDay; day++) {
    const date = new Date(Date.UTC(year, month, day));
    const key = dateKey(date);
    if (!isWeekend(date) && !holidaySet.has(key) && !isFutureExportDate(date, asOfDate)) dates.push(date);
  }

  return dates;
}

function monthCalendarWeeks(year: number, month: number) {
  const first = startOfMonth(new Date(Date.UTC(year, month, 1)));
  const last = endOfMonth(first);
  const firstDow = first.getUTCDay() || 7;
  let cursor = addDays(first, 1 - firstDow);
  const weeks: Date[][] = [];

  while (cursor <= last || weeks.length === 0) {
    const week = Array.from({ length: 7 }, (_, index) => addDays(cursor, index));
    weeks.push(week);
    cursor = addDays(cursor, 7);
  }

  return weeks.slice(0, 5);
}

function weekdayOffset(date: Date) {
  const day = date.getUTCDay();
  return day === 0 ? 6 : day - 1;
}

function getHolidaySet(rows: HolidayRow[]) {
  return new Set(
    rows
      .filter((row) => row.isHoliday !== false && row.isRemoved !== true)
      .map((row) => normalizeDateKey(row.date))
      .filter(Boolean),
  );
}

function sortedRoster(roster: RosterStaff[], group: AttendanceExportGroup) {
  return roster
    .filter((member) => {
      if (member.archived === true || member.isAttendanceOnly === true) return false;
      return group === 'nss'
        ? member.isNssPersonnel === true
        : member.isNssPersonnel !== true;
    })
    .sort((a, b) => {
      const aOrder = Number.isFinite(a.displayOrder) ? Number(a.displayOrder) : Number.MAX_SAFE_INTEGER;
      const bOrder = Number.isFinite(b.displayOrder) ? Number(b.displayOrder) : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.fullName.localeCompare(b.fullName);
    });
}

function attendanceMap(rows: AttendanceRow[]) {
  const map = new Map<string, AttendanceRow>();
  for (const row of rows) {
    map.set(`${row.staffId}:${normalizeDateKey(row.date)}`, row);
  }
  return map;
}

function permissionMap(rows: PermissionRow[]) {
  const map = new Map<string, PermissionRow>();
  for (const row of rows) {
    const isApproved = row.status === undefined || row.status === null || row.status === 'approved';
    if (!isApproved || row.permissionType !== 'absence') continue;
    map.set(`${row.staffId}:${normalizeDateKey(row.date)}`, row);
  }
  return map;
}

function leavePeriodMap(rows: LeavePeriodRow[]) {
  const map = new Map<string, LeavePeriodRow[]>();
  for (const row of rows) {
    const list = map.get(row.staffId) || [];
    list.push(row);
    map.set(row.staffId, list);
  }
  return map;
}

function hasLeavePeriod(staffId: string, key: string, leavePeriodsByStaff: Map<string, LeavePeriodRow[]>) {
  const periods = leavePeriodsByStaff.get(staffId) || [];
  return periods.some((period) => {
    const start = normalizeDateKey(period.startDate);
    const end = normalizeDateKey(period.endDate);
    if (!start || key < start) return false;
    return !end || key <= end;
  });
}

function resolveDayStatus(
  member: RosterStaff,
  key: string,
  attendanceByStaffDate: Map<string, AttendanceRow>,
  leavePeriodsByStaff: Map<string, LeavePeriodRow[]>,
  permissionsByStaffDate: Map<string, PermissionRow>,
): DayStatus {
  if (member.active === false || hasLeavePeriod(member.id, key, leavePeriodsByStaff)) return { kind: 'leave' };

  const permission = permissionsByStaffDate.get(`${member.id}:${key}`);
  if (permission) {
    return { kind: 'approved_absence', reason: permission.reason || null };
  }

  const attendance = attendanceByStaffDate.get(`${member.id}:${key}`);
  if (attendance) {
    const checkInTime = normalizeTime(attendance.checkInTime);
    return {
      checkInTime,
      isLate: Boolean(checkInTime && checkInTime > WORKDAY_START_TIME),
      kind: 'present',
    };
  }

  return { kind: 'unapproved_absence' };
}

function cloneValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function copyRowStyle(sheet: ExcelJS.Worksheet, sourceRowNumber: number, targetRowNumber: number) {
  const source = sheet.getRow(sourceRowNumber);
  const target = sheet.getRow(targetRowNumber);
  target.height = source.height;
  source.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const nextCell = target.getCell(colNumber);
    nextCell.style = cloneValue(cell.style);
    if (cell.numFmt) nextCell.numFmt = cell.numFmt;
    nextCell.alignment = cloneValue(cell.alignment);
    nextCell.border = cloneValue(cell.border);
    nextCell.fill = cloneValue(cell.fill);
    nextCell.font = cloneValue(cell.font);
  });
}

function ensureRows(sheet: ExcelJS.Worksheet, startRow: number, count: number, templateCapacity: number, styleRow: number) {
  if (count <= templateCapacity) {
    for (let row = startRow; row < startRow + count; row++) copyRowStyle(sheet, styleRow, row);
    return;
  }

  const extra = count - templateCapacity;
  sheet.spliceRows(startRow + templateCapacity, 0, ...Array.from({ length: extra }, () => []));
  for (let row = startRow; row < startRow + count; row++) copyRowStyle(sheet, styleRow, row);
}

function clearRows(sheet: ExcelJS.Worksheet, startRow: number, count: number, startColumn: number, endColumn: number) {
  for (let rowNumber = startRow; rowNumber < startRow + count; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    for (let column = startColumn; column <= endColumn; column++) {
      row.getCell(column).value = null;
    }
    row.commit();
  }
}

function setCell(cell: ExcelJS.Cell, value: ExcelJS.CellValue) {
  cell.value = value;
  cell.alignment = {
    ...(cell.alignment || {}),
    horizontal: cell.alignment?.horizontal || 'center',
    vertical: cell.alignment?.vertical || 'middle',
  };
}

function normalizedAbsenceReason(reason: string | null | undefined) {
  const normalized = (reason || '').trim().toLowerCase();
  return normalized === 'personal excuse' || normalized === 'field work' ? 'official duty' : normalized;
}

function isDailyExemptReason(reason: string | null | undefined) {
  return DAILY_EXEMPT_REASONS.has(normalizedAbsenceReason(reason));
}

function absenceRemarkLabel(reason: string | null | undefined) {
  const normalized = normalizedAbsenceReason(reason);
  if (normalized === 'training') return 'Exempt (Training)';
  if (normalized === 'official duty') return OFFICIAL_DUTY_EXPORT_REMARK;
  if (normalized === 'workshop') return 'Exempt (Workshop)';
  return formatAbsencePermissionReason(reason);
}

function dailySummaryAbsenceRemarkLabel(reason: string | null | undefined) {
  const normalized = normalizedAbsenceReason(reason);
  if (normalized === 'training') return 'Exempt (Training)';
  if (normalized === 'workshop') return 'Exempt (Workshop)';
  if (normalized === 'official duty') return DAILY_OFFICIAL_DUTY_REMARK;
  return formatAbsencePermissionReason(reason);
}

function weeklyRemarkLabel(status: DayStatus) {
  if (status.kind === 'leave') return 'On Leave';
  if (status.kind === 'approved_absence') {
    const normalized = normalizedAbsenceReason(status.reason);
    if (normalized === 'general pardon') return '';
    return normalized === 'official duty' ? OFFICIAL_DUTY_EXPORT_REMARK : formatAbsencePermissionReason(status.reason);
  }
  if (status.kind === 'unapproved_absence') return MISSING_ATTENDANCE_REMARK;
  return '';
}

function weeklyValidationRemarkLabel(status: DayStatus) {
  if (status.kind === 'leave') return 'Leave';
  if (status.kind === 'unapproved_absence') return OFFICIAL_DUTY_EXPORT_REMARK;
  if (status.kind === 'approved_absence' && isDailyExemptReason(status.reason)) {
    return normalizedAbsenceReason(status.reason) === 'official duty'
      ? OFFICIAL_DUTY_EXPORT_REMARK
      : formatAbsencePermissionReason(status.reason);
  }
  return '';
}

function exportStaffNo(input: AttendanceWorkbookInput, member: RosterStaff) {
  return input.group === 'nss' ? null : member.staffNo || null;
}

function exportRank(input: AttendanceWorkbookInput, member: RosterStaff) {
  return input.group === 'nss' ? null : member.rank || null;
}

function countLabels(labels: string[]) {
  const counts = new Map<string, number>();
  for (const label of labels.filter(Boolean)) {
    counts.set(label, (counts.get(label) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([label, count]) => (count > 1 ? `${label} - ${count}` : label))
    .join(', ');
}

function dailyRemark(labels: string[]) {
  const uniqueLabels = Array.from(new Set(labels.filter(Boolean)));
  return uniqueLabels
    .map((label, index) => `${label}${index < uniqueLabels.length - 1 ? ' /' : ''}`)
    .join('\n');
}

function countedDailyRemark(labels: string[]) {
  const counts = new Map<string, number>();
  for (const label of labels.filter(Boolean)) {
    counts.set(label, (counts.get(label) || 0) + 1);
  }

  const entries = Array.from(counts.entries())
    .sort(([left], [right]) => {
      const leftOrder = DAILY_REMARK_ORDER.get(left) || Number.MAX_SAFE_INTEGER;
      const rightOrder = DAILY_REMARK_ORDER.get(right) || Number.MAX_SAFE_INTEGER;
      return leftOrder === rightOrder ? left.localeCompare(right) : leftOrder - rightOrder;
    });

  return entries
    .map(([label, count], index) => `${label} - ${count}${index < entries.length - 1 ? ' /' : ''}`)
    .join('\n');
}

async function loadTemplate(template: AttendanceExportTemplate) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath(template));
  workbook.creator = 'LateWatch';
  workbook.modified = new Date();
  workbook.lastModifiedBy = 'LateWatch';
  return workbook;
}

async function buildDailySummary(input: AttendanceWorkbookInput, roster: RosterStaff[], holidaySet: Set<string>) {
  const workbook = await loadTemplate('daily-summary');
  const sheet = workbook.worksheets[0];
  const attendanceByStaffDate = attendanceMap(input.attendanceRecords);
  const leavePeriodsByStaff = leavePeriodMap(input.leavePeriods || []);
  const permissionsByStaffDate = permissionMap(input.permissions);
  const asOfDate = getExportAsOfDate(input);
  const templateCapacity = 19;
  const workingDates = monthWorkingDates(input.year, input.month, holidaySet, asOfDate);
  const rowsToPrepare = Math.max(workingDates.length, templateCapacity);

  sheet.getCell('A3').value = `Staff Strength: ${roster.length}`;
  sheet.getCell('A4').value = 'Date:';
  sheet.getCell('B4').value = `Month: ${format(new Date(input.year, input.month, 1), 'MMMM, yyyy')}`;
  sheet.getColumn(DAILY_REMARK_COLUMN).width = Math.max(
    sheet.getColumn(DAILY_REMARK_COLUMN).width || 0,
    DAILY_REMARK_COLUMN_WIDTH,
  );
  ensureRows(sheet, 6, rowsToPrepare, templateCapacity, 6);
  clearRows(sheet, 6, rowsToPrepare, 1, 7);

  workingDates.forEach((date, index) => {
    const rowNumber = 6 + index;
    const row = sheet.getRow(rowNumber);
    const key = dateKey(date);
    let before = 0;
    let after = 0;
    let leave = 0;
    let exempt = 0;
    const remarks: string[] = [];

    for (const member of roster) {
      const status = resolveDayStatus(member, key, attendanceByStaffDate, leavePeriodsByStaff, permissionsByStaffDate);
      if (status.kind === 'present') {
        if (status.isLate) after += 1;
        else before += 1;
      } else if (status.kind === 'leave') {
        leave += 1;
        remarks.push('Leave');
      } else if (status.kind === 'approved_absence') {
        if (isDailyExemptReason(status.reason)) {
          exempt += 1;
          remarks.push(dailySummaryAbsenceRemarkLabel(status.reason));
        }
      } else if (status.kind === 'unapproved_absence') {
        exempt += 1;
        remarks.push(DAILY_OFFICIAL_DUTY_REMARK);
      }
    }

    setCell(row.getCell(1), date);
    row.getCell(1).numFmt = 'dd/mm/yyyy';
    setCell(row.getCell(2), before);
    setCell(row.getCell(3), after);
    setCell(row.getCell(4), leave);
    setCell(row.getCell(5), exempt);
    setCell(row.getCell(6), null);
    const remarkText = countedDailyRemark(remarks);
    setCell(row.getCell(DAILY_REMARK_COLUMN), remarkText);
    row.getCell(DAILY_REMARK_COLUMN).alignment = {
      ...(row.getCell(DAILY_REMARK_COLUMN).alignment || {}),
      horizontal: 'left',
      wrapText: true,
    };
    const remarkLineCount = remarkText ? remarkText.split('\n').length : 1;
    row.height = Math.max(row.height || 0, remarkLineCount * DAILY_REMARK_LINE_HEIGHT);
    row.commit();
  });

  return workbook;
}

function writeMonthlyMatrixValues(
  sheet: ExcelJS.Worksheet,
  input: AttendanceWorkbookInput,
  roster: RosterStaff[],
  holidaySet: Set<string>,
) {
  const attendanceByStaffDate = attendanceMap(input.attendanceRecords);
  const leavePeriodsByStaff = leavePeriodMap(input.leavePeriods || []);
  const permissionsByStaffDate = permissionMap(input.permissions);
  const weeks = monthCalendarWeeks(input.year, input.month);
  const weekStartColumns = [5, 12, 19, 26, 33];
  const dataStartRow = 9;
  const templateCapacity = 10;
  const rowsToPrepare = Math.max(roster.length, templateCapacity);
  const asOfDate = getExportAsOfDate(input);

  sheet.getCell('A4').value = `MONTH : ${format(new Date(input.year, input.month, 1), 'MMMM, yyyy').toUpperCase()}`;
  sheet.getCell('A5').value = `STAFF STRENGTH: ${roster.length}`;
  ensureRows(sheet, dataStartRow, rowsToPrepare, templateCapacity, 9);
  clearRows(sheet, dataStartRow, rowsToPrepare, 1, 45);

  roster.forEach((member, index) => {
    const rowNumber = dataStartRow + index;
    const row = sheet.getRow(rowNumber);
    let presentCount = 0;
    let lateCount = 0;
    let absentWithPermission = 0;
    const remarks: string[] = [];

    row.getCell(1).value = exportStaffNo(input, member);
    row.getCell(2).value = member.fullName;
    row.getCell(3).value = member.gender || null;
    row.getCell(4).value = exportRank(input, member);

    weeks.forEach((week, weekIndex) => {
      const startColumn = weekStartColumns[weekIndex];
      if (!startColumn) return;

      week.forEach((date) => {
        const key = dateKey(date);
        const column = startColumn + weekdayOffset(date);
        if (date.getUTCMonth() !== input.month || isWeekend(date) || holidaySet.has(key) || isFutureExportDate(date, asOfDate)) {
          row.getCell(column).value = null;
          return;
        }

        const status = resolveDayStatus(member, key, attendanceByStaffDate, leavePeriodsByStaff, permissionsByStaffDate);
        if (status.kind === 'present') {
          row.getCell(column).value = 'P';
          presentCount += 1;
          if (status.isLate) lateCount += 1;
          return;
        }

        if (status.kind === 'approved_absence' || status.kind === 'leave') {
          row.getCell(column).value = 'AP';
          absentWithPermission += 1;
          remarks.push(weeklyRemarkLabel(status));
          return;
        }

        row.getCell(column).value = 'AP';
        absentWithPermission += 1;
        remarks.push(MISSING_ATTENDANCE_REMARK);
      });
    });

    row.getCell(40).value = presentCount;
    row.getCell(41).value = lateCount;
    row.getCell(42).value = absentWithPermission;
    row.getCell(43).value = absentWithPermission;
    row.getCell(44).value = 0;
    row.getCell(45).value = countLabels(remarks);
    row.commit();
  });
}

async function buildMonthlyMatrix(input: AttendanceWorkbookInput, roster: RosterStaff[], holidaySet: Set<string>) {
  const workbook = await loadTemplate('monthly-matrix');
  const sheet = workbook.worksheets[0];

  writeMonthlyMatrixValues(sheet, input, roster, holidaySet);

  return workbook;
}

function fillWeeklySheet(
  sheet: ExcelJS.Worksheet,
  weekDates: Date[],
  input: AttendanceWorkbookInput,
  roster: RosterStaff[],
  holidaySet: Set<string>,
) {
  const attendanceByStaffDate = attendanceMap(input.attendanceRecords);
  const leavePeriodsByStaff = leavePeriodMap(input.leavePeriods || []);
  const permissionsByStaffDate = permissionMap(input.permissions);
  const dataStartRow = 7;
  const templateCapacity = 15;
  const rowsToPrepare = Math.max(roster.length, templateCapacity);
  const asOfDate = getExportAsOfDate(input);

  ensureRows(sheet, dataStartRow, rowsToPrepare, templateCapacity, 7);
  clearRows(sheet, dataStartRow, rowsToPrepare, 1, 14);
  const inMonthWeekdays = weekDates.filter((date) => date.getUTCMonth() === input.month && !isWeekend(date));
  const first = inMonthWeekdays[0] || weekDates[0];
  const last = inMonthWeekdays[inMonthWeekdays.length - 1] || weekDates[weekDates.length - 1];
  sheet.getCell('A4').value = `WEEK (Date): ${format(first, 'd MMMM')} to ${format(last, 'd MMMM, yyyy')}`;

  roster.forEach((member, index) => {
    const rowNumber = dataStartRow + index;
    const row = sheet.getRow(rowNumber);
    let presentCount = 0;
    const remarks: string[] = [];

    row.getCell(1).value = index + 1;
    row.getCell(2).value = exportStaffNo(input, member);
    row.getCell(3).value = member.fullName;

    weekDates.slice(0, 5).forEach((date, dayIndex) => {
      const key = dateKey(date);
      const column = 4 + dayIndex;
      if (date.getUTCMonth() !== input.month || isWeekend(date) || holidaySet.has(key) || isFutureExportDate(date, asOfDate)) {
        row.getCell(column).value = null;
        return;
      }

      const status = resolveDayStatus(member, key, attendanceByStaffDate, leavePeriodsByStaff, permissionsByStaffDate);
      if (status.kind === 'present') {
        row.getCell(column).value = PRESENT_MARK;
        presentCount += 1;
      } else {
        row.getCell(column).value = ABSENT_MARK;
        remarks.push(weeklyValidationRemarkLabel(status));
      }
    });

    row.getCell(9).value = presentCount;
    const remarkText = dailyRemark(remarks);
    const remarkCell = row.getCell(11);
    remarkCell.value = remarkText;
    remarkCell.alignment = {
      ...(remarkCell.alignment || {}),
      horizontal: 'left',
      vertical: 'middle',
      wrapText: true,
    };
    const remarkLineCount = remarkText ? remarkText.split('\n').length : 1;
    row.height = Math.max(row.height || 0, remarkLineCount * DAILY_REMARK_LINE_HEIGHT);
    row.commit();
  });
}

async function buildWeeklyValidation(input: AttendanceWorkbookInput, roster: RosterStaff[], holidaySet: Set<string>) {
  const workbook = await loadTemplate('weekly-validation');
  const weeks = monthCalendarWeeks(input.year, input.month);

  weeks.forEach((week, index) => {
    const sheet = workbook.getWorksheet(`WEEK ${index + 1}`) || workbook.worksheets[index];
    if (!sheet) return;
    fillWeeklySheet(sheet, week.slice(0, 5), input, roster, holidaySet);
  });

  return workbook;
}

export async function buildAttendanceWorkbookFromData(input: AttendanceWorkbookInput) {
  if (!isAttendanceExportTemplateAllowedForGroup(input.group, input.template)) {
    throw new Error(NSS_ATTENDANCE_EXPORT_RESTRICTION_MESSAGE);
  }

  const roster = sortedRoster(input.roster, input.group);
  const holidaySet = getHolidaySet(input.holidays);

  if (input.template === 'daily-summary') {
    return buildDailySummary(input, roster, holidaySet);
  }

  if (input.template === 'monthly-matrix') {
    return buildMonthlyMatrix(input, roster, holidaySet);
  }

  return buildWeeklyValidation(input, roster, holidaySet);
}

export async function buildAttendanceExportWorkbook({
  group,
  month,
  template,
  year,
}: {
  group: AttendanceExportGroup;
  month: number;
  template: AttendanceExportTemplate;
  year: number;
}): Promise<AttendanceExportBuildResult> {
  const [{ db }, schema] = await Promise.all([
    import('@/db'),
    import('@/db/schema'),
  ]);

  const monthStart = format(startOfMonth(new Date(year, month, 1)), 'yyyy-MM-dd');
  const monthEnd = format(endOfMonth(new Date(year, month, 1)), 'yyyy-MM-dd');
  const [roster, attendanceRecords, permissions, leavePeriods, holidays] = await Promise.all([
    db.select({
      active: schema.staff.active,
      archived: schema.staff.archived,
      displayOrder: schema.staff.displayOrder,
      fullName: schema.staff.fullName,
      gender: schema.staff.gender,
      id: schema.staff.id,
      isAttendanceOnly: schema.staff.isAttendanceOnly,
      isNssPersonnel: schema.staff.isNssPersonnel,
      rank: schema.staff.rank,
      staffNo: schema.staff.staffNo,
    })
      .from(schema.staff)
      .orderBy(asc(schema.staff.displayOrder), asc(schema.staff.fullName)),
    db.select({
      checkInTime: schema.attendanceRecord.checkInTime,
      date: schema.attendanceRecord.date,
      staffId: schema.attendanceRecord.staffId,
    })
      .from(schema.attendanceRecord)
      .where(and(gte(schema.attendanceRecord.date, monthStart), lte(schema.attendanceRecord.date, monthEnd))),
    db.select({
      date: schema.attendancePermission.date,
      permissionType: schema.attendancePermission.permissionType,
      reason: schema.attendancePermission.reason,
      staffId: schema.attendancePermission.staffId,
      status: schema.attendancePermission.status,
    })
      .from(schema.attendancePermission)
      .where(and(
        gte(schema.attendancePermission.date, monthStart),
        lte(schema.attendancePermission.date, monthEnd),
        eq(schema.attendancePermission.status, 'approved'),
      )),
    db.select({
      endDate: schema.staffLeavePeriod.endDate,
      staffId: schema.staffLeavePeriod.staffId,
      startDate: schema.staffLeavePeriod.startDate,
    })
      .from(schema.staffLeavePeriod)
      .where(and(
        lte(schema.staffLeavePeriod.startDate, monthEnd),
        or(
          isNull(schema.staffLeavePeriod.endDate),
          gte(schema.staffLeavePeriod.endDate, monthStart),
        ),
      )),
    db.select({
      date: schema.workCalendar.date,
      isHoliday: schema.workCalendar.isHoliday,
      isRemoved: schema.workCalendar.isRemoved,
    })
      .from(schema.workCalendar)
      .where(and(
        gte(schema.workCalendar.date, monthStart),
        lte(schema.workCalendar.date, monthEnd),
        eq(schema.workCalendar.isHoliday, true),
      )),
  ]);

  const workbook = await buildAttendanceWorkbookFromData({
    attendanceRecords,
    asOfDate: getAccraDateKey(),
    group,
    holidays,
    leavePeriods,
    month,
    permissions,
    roster,
    template,
    year,
  });

  const buffer = await workbook.xlsx.writeBuffer();

  return {
    buffer,
    fileName: getAttendanceExportFileName({ group, month, template, year }),
    rosterCount: sortedRoster(roster, group).length,
    template,
  };
}
