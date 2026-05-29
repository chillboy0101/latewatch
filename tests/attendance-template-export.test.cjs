/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');

require('tsx/cjs');

const {
  buildAttendanceWorkbookFromData,
  getAttendanceExportFileName,
} = require('../src/lib/attendance-template-export.ts');

const CHECK = '\u2713';
const CROSS = '\u2717';

const baseStaff = [
  {
    active: true,
    archived: false,
    displayOrder: 1,
    fullName: 'MAIN ON TIME',
    gender: 'MALE',
    id: 'main-on-time',
    isAttendanceOnly: false,
    isNssPersonnel: false,
    rank: 'RO',
    staffNo: 'GRA000001',
  },
  {
    active: true,
    archived: false,
    displayOrder: 2,
    fullName: 'MAIN LATE',
    gender: 'FEMALE',
    id: 'main-late',
    isAttendanceOnly: false,
    isNssPersonnel: false,
    rank: 'ARO',
    staffNo: 'GRA000002',
  },
  {
    active: true,
    archived: false,
    displayOrder: 3,
    fullName: 'MAIN EXCUSED',
    gender: 'MALE',
    id: 'main-excused',
    isAttendanceOnly: false,
    isNssPersonnel: false,
    rank: 'SRO',
    staffNo: 'GRA000003',
  },
  {
    active: false,
    archived: false,
    displayOrder: 4,
    fullName: 'MAIN ON LEAVE',
    gender: 'MALE',
    id: 'main-leave',
    isAttendanceOnly: false,
    isNssPersonnel: false,
    rank: 'ARO',
    staffNo: 'GRA000004',
  },
  {
    active: true,
    archived: false,
    displayOrder: 5,
    fullName: 'NSS PERSON',
    gender: 'FEMALE',
    id: 'nss-1',
    isAttendanceOnly: false,
    isNssPersonnel: true,
    rank: 'NSS RANK SHOULD NOT EXPORT',
    staffNo: 'NSS-NO-SHOULD-NOT-EXPORT',
  },
  {
    active: true,
    archived: false,
    displayOrder: 6,
    fullName: 'MONITORING ONLY',
    gender: 'MALE',
    id: 'monitoring-1',
    isAttendanceOnly: true,
    isNssPersonnel: false,
    rank: null,
    staffNo: null,
  },
];

function weekdayHolidaysExcept(year, month, ...includedDates) {
  const included = new Set(includedDates);
  const holidays = [];
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  for (let day = 1; day <= lastDay; day++) {
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6 && !included.has(date)) {
      holidays.push({ date, isHoliday: true, isRemoved: false });
    }
  }
  return holidays;
}

function april2026WeekdayHolidaysExcept(...includedDates) {
  return weekdayHolidaysExcept(2026, 3, ...includedDates);
}

async function workbookFor(overrides) {
  return buildAttendanceWorkbookFromData({
    attendanceRecords: [],
    group: 'main',
    holidays: april2026WeekdayHolidaysExcept('2026-04-01'),
    month: 3,
    permissions: [],
    roster: baseStaff,
    template: 'daily-summary',
    year: 2026,
    ...overrides,
  });
}

test('in-progress attendance exports leave future dates blank and ignore future records', async () => {
  const futureRecordScenario = {
    asOfDate: '2026-05-14',
    attendanceRecords: [
      { checkInTime: '08:30', date: '2026-05-14', staffId: 'main-on-time' },
      { checkInTime: '08:30', date: '2026-05-15', staffId: 'main-on-time' },
    ],
    holidays: weekdayHolidaysExcept(2026, 4, '2026-05-14', '2026-05-15'),
    month: 4,
    permissions: [],
    year: 2026,
  };

  const dailyWorkbook = await workbookFor(futureRecordScenario);
  const daily = dailyWorkbook.worksheets[0];
  assert.equal(daily.getCell('B6').value, 1);
  assert.equal(daily.getCell('A7').value, null);
  assert.equal(daily.getCell('B7').value, null);
  assert.equal(daily.getCell('G7').value, null);

  const monthlyWorkbook = await workbookFor({
    ...futureRecordScenario,
    template: 'monthly-matrix',
  });
  const monthly = monthlyWorkbook.worksheets[0];
  assert.equal(monthly.getCell('V9').value, 'P');
  assert.equal(monthly.getCell('W9').value, null);
  assert.equal(monthly.getCell('AN9').value, 1);
  assert.equal(monthly.getCell('AP9').value, 0);

  const weeklyWorkbook = await workbookFor({
    ...futureRecordScenario,
    template: 'weekly-validation',
  });
  const week3 = weeklyWorkbook.getWorksheet('WEEK 3');
  assert.equal(week3.getCell('G7').value, CHECK);
  assert.equal(week3.getCell('H7').value, null);
  assert.equal(week3.getCell('I7').value, 1);
});

test('daily attendance summary uses 8:30 cutoff, leave, exempt counts, and main roster only', async () => {
  const workbook = await workbookFor({
    attendanceRecords: [
      { checkInTime: '08:30', date: '2026-04-01', staffId: 'main-on-time' },
      { checkInTime: '08:31', date: '2026-04-01', staffId: 'main-late' },
      { checkInTime: '07:55', date: '2026-04-01', staffId: 'nss-1' },
      { checkInTime: '07:55', date: '2026-04-01', staffId: 'monitoring-1' },
    ],
    permissions: [
      { date: '2026-04-01', permissionType: 'absence', reason: 'official duty', staffId: 'main-excused' },
    ],
  });
  const sheet = workbook.worksheets[0];

  assert.match(String(sheet.getCell('A3').value), /Staff Strength: 4/);
  assert.equal(sheet.getCell('B6').value, 1);
  assert.equal(sheet.getCell('C6').value, 1);
  assert.equal(sheet.getCell('D6').value, 1);
  assert.equal(sheet.getCell('E6').value, 1);
  assert.match(String(sheet.getCell('G6').value), /Leave - 1/);
  assert.match(String(sheet.getCell('G6').value), /Exempt \(Official Duty\) - 1/);
});

test('daily attendance summary counts configured exempt permission reasons', async () => {
  const roster = [
    ...baseStaff,
    {
      active: true,
      archived: false,
      displayOrder: 7,
      fullName: 'MAIN WORKSHOP',
      gender: 'FEMALE',
      id: 'main-workshop',
      isAttendanceOnly: false,
      isNssPersonnel: false,
      rank: 'RO',
      staffNo: 'GRA000005',
    },
    {
      active: true,
      archived: false,
      displayOrder: 8,
      fullName: 'MAIN GENERAL PARDON',
      gender: 'MALE',
      id: 'main-general-pardon',
      isAttendanceOnly: false,
      isNssPersonnel: false,
      rank: 'RO',
      staffNo: 'GRA000006',
    },
  ];
  const workbook = await workbookFor({
    permissions: [
      { date: '2026-04-01', permissionType: 'absence', reason: 'training', staffId: 'main-on-time' },
      { date: '2026-04-01', permissionType: 'absence', reason: 'official duty', staffId: 'main-late' },
      { date: '2026-04-01', permissionType: 'absence', reason: 'sick', staffId: 'main-excused' },
      { date: '2026-04-01', permissionType: 'absence', reason: 'workshop', staffId: 'main-workshop' },
      { date: '2026-04-01', permissionType: 'absence', reason: 'general pardon', staffId: 'main-general-pardon' },
    ],
    roster,
  });
  const sheet = workbook.worksheets[0];
  const remarks = String(sheet.getCell('G6').value);

  assert.equal(sheet.getCell('E6').value, 4);
  assert.equal(
    remarks,
    [
      'Exempt (Training) - 1 /',
      'Exempt (Official Duty) - 1 /',
      'Exempt (Workshop) - 1 /',
      'Sick - 1 /',
      'Leave - 1',
    ].join('\n'),
  );
  assert.equal(sheet.getCell('G6').alignment?.wrapText, true);
  assert.ok(sheet.getColumn(7).width >= 38, 'remarks column should keep each reason/count on one line');
  assert.ok((sheet.getRow(6).height || 0) >= 75, 'remarks row should be tall enough for one reason per line');
  assert.doesNotMatch(remarks, /Field Work/);
  assert.doesNotMatch(remarks, /General pardon/);
  assert.doesNotMatch(remarks, /Personal excuse/);
});

test('daily attendance summary aggregates duplicate remark reasons', async () => {
  const roster = [
    {
      ...baseStaff[0],
      active: true,
      displayOrder: 1,
      fullName: 'TRAINING ONE',
      id: 'training-one',
      staffNo: 'GRA100001',
    },
    {
      ...baseStaff[1],
      active: true,
      displayOrder: 2,
      fullName: 'TRAINING TWO',
      id: 'training-two',
      staffNo: 'GRA100002',
    },
  ];
  const workbook = await workbookFor({
    permissions: [
      { date: '2026-04-01', permissionType: 'absence', reason: 'training', staffId: 'training-one' },
      { date: '2026-04-01', permissionType: 'absence', reason: 'training', staffId: 'training-two' },
    ],
    roster,
  });
  const sheet = workbook.worksheets[0];
  const remarks = String(sheet.getCell('G6').value);

  assert.equal(sheet.getCell('E6').value, 2);
  assert.equal(remarks, 'Exempt (Training) - 2');
});

test('missing attendance is explained as official duty in daily and weekly exports', async () => {
  const attendanceRecords = [
    { checkInTime: '08:30', date: '2026-04-01', staffId: 'main-on-time' },
  ];

  const dailyWorkbook = await workbookFor({ attendanceRecords });
  const dailySheet = dailyWorkbook.worksheets[0];
  const dailyRemarks = String(dailySheet.getCell('G6').value);
  assert.equal(dailySheet.getCell('E6').value, 2);
  assert.match(dailyRemarks, /Exempt \(Official Duty\) - 2/);
  assert.match(dailyRemarks, /Leave - 1/);
  assert.doesNotMatch(dailyRemarks, /Absent with permission/);
  assert.doesNotMatch(dailyRemarks, /Absent without permission/);

  const monthlyWorkbook = await workbookFor({
    attendanceRecords,
    template: 'monthly-matrix',
  });
  const monthlySheet = monthlyWorkbook.worksheets[0];
  assert.equal(monthlySheet.getCell('G10').value, 'AP');
  assert.equal(monthlySheet.getCell('AP10').value, 1);
  assert.equal(monthlySheet.getCell('AQ10').value, 1);
  assert.equal(monthlySheet.getCell('AR10').value, 0);
  assert.equal(monthlySheet.getCell('AS10').value, 'Absent with permission');
  assert.doesNotMatch(String(monthlySheet.getCell('AS10').value), /Absent without permission/);

  const weeklyWorkbook = await workbookFor({
    attendanceRecords,
    template: 'weekly-validation',
  });
  const week1 = weeklyWorkbook.getWorksheet('WEEK 1');
  assert.equal(week1.getCell('K8').value, 'Official duty');
  assert.doesNotMatch(String(week1.getCell('K8').value), /Absent without permission/);
});

test('attendance exports display personal excuse permissions as official duty', async () => {
  const permissions = [
    { date: '2026-04-01', permissionType: 'absence', reason: 'personal excuse', staffId: 'main-excused' },
  ];

  const attendanceRecords = [
    { checkInTime: '08:30', date: '2026-04-01', staffId: 'main-on-time' },
    { checkInTime: '08:30', date: '2026-04-01', staffId: 'main-late' },
  ];

  const dailyWorkbook = await workbookFor({ attendanceRecords, permissions });
  const dailyRemarks = String(dailyWorkbook.worksheets[0].getCell('G6').value);
  assert.equal(dailyWorkbook.worksheets[0].getCell('E6').value, 1);
  assert.match(dailyRemarks, /Exempt \(Official Duty\) - 1/);
  assert.doesNotMatch(dailyRemarks, /Personal excuse/);
  assert.doesNotMatch(dailyRemarks, /Sick/);

  const monthlyWorkbook = await workbookFor({
    permissions,
    template: 'monthly-matrix',
  });
  const monthlySheet = monthlyWorkbook.worksheets[0];
  assert.equal(monthlySheet.getCell('AS11').value, 'Official duty');

  const weeklyWorkbook = await workbookFor({
    permissions,
    template: 'weekly-validation',
  });
  const week1 = weeklyWorkbook.getWorksheet('WEEK 1');
  assert.equal(week1.getCell('K9').value, 'Official duty');
});

test('attendance exports display legacy field work permissions as official duty', async () => {
  const permissions = [
    { date: '2026-04-01', permissionType: 'absence', reason: 'field work', staffId: 'main-excused' },
  ];
  const attendanceRecords = [
    { checkInTime: '08:30', date: '2026-04-01', staffId: 'main-on-time' },
    { checkInTime: '08:30', date: '2026-04-01', staffId: 'main-late' },
  ];

  const dailyWorkbook = await workbookFor({ attendanceRecords, permissions });
  const dailyRemarks = String(dailyWorkbook.worksheets[0].getCell('G6').value);
  assert.equal(dailyWorkbook.worksheets[0].getCell('E6').value, 1);
  assert.match(dailyRemarks, /Exempt \(Official Duty\) - 1/);
  assert.doesNotMatch(dailyRemarks, /Field Work/);

  const monthlyWorkbook = await workbookFor({
    attendanceRecords,
    permissions,
    template: 'monthly-matrix',
  });
  const monthlySheet = monthlyWorkbook.worksheets[0];
  assert.equal(monthlySheet.getCell('AS11').value, 'Official duty');

  const weeklyWorkbook = await workbookFor({
    attendanceRecords,
    permissions,
    template: 'weekly-validation',
  });
  const week1 = weeklyWorkbook.getWorksheet('WEEK 1');
  assert.equal(week1.getCell('K9').value, 'Official duty');
});

test('attendance exports format sick permissions consistently', async () => {
  const permissions = [
    { date: '2026-04-01', permissionType: 'absence', reason: 'sick', staffId: 'main-excused' },
  ];

  const dailyWorkbook = await workbookFor({ permissions });
  assert.match(String(dailyWorkbook.worksheets[0].getCell('G6').value), /Sick - 1/);

  const monthlyWorkbook = await workbookFor({
    permissions,
    template: 'monthly-matrix',
  });
  const monthlySheet = monthlyWorkbook.worksheets[0];
  assert.equal(monthlySheet.getCell('G11').value, 'AP');
  assert.equal(monthlySheet.getCell('AS11').value, 'Sick');

  const weeklyWorkbook = await workbookFor({
    permissions,
    template: 'weekly-validation',
  });
  const week1 = weeklyWorkbook.getWorksheet('WEEK 1');
  assert.equal(week1.getCell('F9').value, CROSS);
  assert.equal(week1.getCell('K9').value, 'Sick');
});

test('monthly attendance matrix marks all absences as with permission', async () => {
  const mainWorkbook = await workbookFor({
    attendanceRecords: [
      { checkInTime: '08:30', date: '2026-04-01', staffId: 'main-on-time' },
    ],
    permissions: [
      { date: '2026-04-01', permissionType: 'absence', reason: 'training', staffId: 'main-excused' },
    ],
    template: 'monthly-matrix',
  });
  const mainSheet = mainWorkbook.worksheets[0];

  assert.equal(mainSheet.getCell('G9').value, 'P');
  assert.equal(mainSheet.getCell('G11').value, 'AP');
  assert.equal(mainSheet.getCell('G10').value, 'AP');
  assert.equal(mainSheet.getCell('AP10').value, 1);
  assert.equal(mainSheet.getCell('AQ10').value, 1);
  assert.equal(mainSheet.getCell('AR10').value, 0);
  assert.equal(mainSheet.getCell('AS10').value, 'Absent with permission');
});

test('monthly attendance matrix applies general pardon without printing it in remarks', async () => {
  const workbook = await workbookFor({
    attendanceRecords: [
      { checkInTime: '08:30', date: '2026-04-01', staffId: 'main-on-time' },
    ],
    permissions: [
      { date: '2026-04-01', permissionType: 'absence', reason: 'general pardon', staffId: 'main-late' },
    ],
    template: 'monthly-matrix',
  });
  const sheet = workbook.worksheets[0];
  const remarks = String(sheet.getCell('AS10').value || '');

  assert.equal(sheet.getCell('G10').value, 'AP');
  assert.equal(sheet.getCell('AP10').value, 1);
  assert.equal(sheet.getCell('AQ10').value, 1);
  assert.equal(sheet.getCell('AR10').value, 0);
  assert.equal(remarks, '');
  assert.doesNotMatch(remarks, /General pardon/);
});

test('NSS attendance workbooks are limited to weekly validation', async () => {
  await assert.rejects(
    () => workbookFor({ group: 'nss', template: 'daily-summary' }),
    /NSS personnel attendance exports use Weekly Validation only/,
  );
  await assert.rejects(
    () => workbookFor({ group: 'nss', template: 'monthly-matrix' }),
    /NSS personnel attendance exports use Weekly Validation only/,
  );
});

test('attendance exports use historical leave periods without adding sheet rows', async () => {
  const roster = baseStaff.map((member) => (
    member.id === 'main-leave' ? { ...member, active: true } : member
  ));
  const leavePeriods = [
    { endDate: '2026-04-01', staffId: 'main-leave', startDate: '2026-04-01' },
  ];

  const dailyWorkbook = await workbookFor({ leavePeriods, roster });
  const dailySheet = dailyWorkbook.worksheets[0];
  assert.equal(dailySheet.getCell('D6').value, 1);
  assert.match(String(dailySheet.getCell('G6').value), /Leave - 1/);

  const monthlyWorkbook = await workbookFor({
    leavePeriods,
    roster,
    template: 'monthly-matrix',
  });
  const monthlySheet = monthlyWorkbook.worksheets[0];
  assert.equal(monthlySheet.getCell('B12').value, 'MAIN ON LEAVE');
  assert.equal(monthlySheet.getCell('G12').value, 'AP');
  assert.equal(monthlySheet.getCell('AP12').value, 1);
  assert.equal(monthlySheet.getCell('AQ12').value, 1);
  assert.equal(monthlySheet.getCell('AR12').value, 0);
  assert.equal(monthlySheet.getCell('AS12').value, 'On Leave');
  assert.equal(monthlySheet.getCell('B13').value, null);

  const weeklyWorkbook = await workbookFor({
    leavePeriods,
    roster,
    template: 'weekly-validation',
  });
  const week1 = weeklyWorkbook.getWorksheet('WEEK 1');
  assert.equal(week1.getCell('C10').value, 'MAIN ON LEAVE');
  assert.equal(week1.getCell('F10').value, CROSS);
  assert.equal(week1.getCell('K10').value, 'Leave');
  assert.equal(week1.getCell('C11').value, null);
});

test('weekly validation uses daily summary-style remark labels and keeps NSS staff number cells blank', async () => {
  const workbook = await workbookFor({
    attendanceRecords: [
      { checkInTime: '08:30', date: '2026-04-01', staffId: 'main-on-time' },
    ],
    permissions: [
      { date: '2026-04-01', permissionType: 'absence', reason: 'workshop', staffId: 'main-excused' },
    ],
    template: 'weekly-validation',
  });
  const week1 = workbook.getWorksheet('WEEK 1');

  assert.equal(week1.getCell('F7').value, CHECK);
  assert.equal(week1.getCell('F8').value, CROSS);
  assert.equal(week1.getCell('K8').value, 'Official duty');
  assert.equal(week1.getCell('F9').value, CROSS);
  assert.equal(week1.getCell('I7').value, 1);
  assert.equal(week1.getCell('K9').value, 'Exempt (Workshop)');
  assert.equal(week1.getCell('F10').value, CROSS);
  assert.equal(week1.getCell('K10').value, 'Leave');

  const nssWorkbook = await workbookFor({
    attendanceRecords: [
      { checkInTime: '08:30', date: '2026-04-01', staffId: 'nss-1' },
    ],
    group: 'nss',
    template: 'weekly-validation',
  });
  const nssWeek1 = nssWorkbook.getWorksheet('WEEK 1');

  assert.equal(nssWeek1.getCell('A6').value, 'S/N');
  assert.equal(nssWeek1.getCell('B6').value, 'STAFF NO.');
  assert.equal(nssWeek1.getCell('C6').value, 'NAME');
  assert.equal(nssWeek1.getCell('B7').value, null);
  assert.equal(nssWeek1.getCell('C7').value, 'NSS PERSON');
  assert.equal(nssWeek1.getCell('F7').value, CHECK);
});

test('weekly validation puts each staff remark on its own line', async () => {
  const workbook = await workbookFor({
    holidays: april2026WeekdayHolidaysExcept('2026-04-01', '2026-04-02'),
    permissions: [
      { date: '2026-04-01', permissionType: 'absence', reason: 'workshop', staffId: 'main-excused' },
      { date: '2026-04-02', permissionType: 'absence', reason: 'official duty', staffId: 'main-excused' },
    ],
    template: 'weekly-validation',
  });
  const week1 = workbook.getWorksheet('WEEK 1');
  const remarkCell = week1.getCell('K9');

  assert.equal(remarkCell.value, 'Exempt (Workshop) /\nOfficial duty');
  assert.equal(remarkCell.alignment?.wrapText, true);
  assert.ok((week1.getRow(9).height || 0) >= 30, 'weekly validation row should show one remark per line');
});

test('attendance export filenames include group, month, year, and template label', () => {
  assert.equal(
    getAttendanceExportFileName({ group: 'main', month: 3, template: 'weekly-validation', year: 2026 }),
    'Attendance_Main_Staff_April_2026_Weekly_Validation.xlsx',
  );
  assert.equal(
    getAttendanceExportFileName({ group: 'nss', month: 3, template: 'weekly-validation', year: 2026 }),
    'Attendance_NSS_April_2026_Weekly_Validation.xlsx',
  );
});
