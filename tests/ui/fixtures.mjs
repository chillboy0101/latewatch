// Made-up data for the local UI harness (scripts/ui-shots.mjs). Every /api call the browser
// makes is answered from here, so screenshots never touch real data.

const pad = (value) => String(value).padStart(2, '0');
const dateKey = (date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

export function buildFixtures(now = new Date()) {
  const today = dateKey(now);
  const daysAgo = (days) => dateKey(new Date(now.getTime() - days * 86400000));
  const staffNames = [
    'Mensah Kofi Adjei', 'Owusu Abena Serwaa', 'Boateng Kwame Yeboah', 'Asante Efua Mansa',
    'Darko Yaw Ofori', 'Agyeman Akosua Dufie', 'Osei Kwabena Frimpong', 'Addo Ama Konadu',
    'Nkrumah Kojo Ansah', 'Appiah Adwoa Pokuaa', 'Amoah Kweku Baah', 'Sarpong Esi Nyarko',
  ];
  const staff = staffNames.map((fullName, index) => ({
    active: true,
    archived: false,
    department: 'Operations',
    email: `staff${index + 1}@latewatch.test`,
    fullName,
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    isAttendanceOnly: false,
    isNssPersonnel: index > 9,
  }));
  const me = staff[0];

  const historyEntries = Array.from({ length: 14 }, (_, index) => {
    const amount = [2, 5, 10, 2, 7][index % 5];
    const paid = index % 3 === 0;
    return {
      arrivalTime: index % 4 === 0 ? null : `08:${pad(31 + (index % 20))}:00`,
      date: daysAgo(index + 1),
      entryId: `entry-${index}`,
      outstandingAmount: paid ? '0.00' : amount.toFixed(2),
      pardonedAmount: '0.00',
      paidAmount: paid ? amount.toFixed(2) : '0.00',
      penaltyAmount: amount.toFixed(2),
      reason: index % 4 === 0 ? 'No sign-in' : 'Late arrival',
      status: paid ? 'paid' : 'unpaid',
    };
  });
  const receipts = Array.from({ length: 9 }, (_, index) => ({
    amount: (10 + index * 2).toFixed(2),
    href: `/check-in/receipts/payment-${index}`,
    id: `notification-${index}`,
    note: null,
    paymentId: `payment-${index}`,
    read: index > 1,
    receiptNumber: `LW-2026-${String(120 - index).padStart(5, '0')}`,
    recordedAt: new Date(now.getTime() - index * 7 * 86400000).toISOString(),
    recordedByEmail: 'test.admin@latewatch.test',
    weekEnd: daysAgo(index * 7 + 3),
    weekStart: daysAgo(index * 7 + 7),
  }));
  const week = (offset, entries) => ({
    endDate: daysAgo(offset),
    entries,
    outstandingBalance: entries.reduce((sum, entry) => sum + Number(entry.outstandingAmount), 0).toFixed(2),
    paidAmount: entries.reduce((sum, entry) => sum + Number(entry.paidAmount), 0).toFixed(2),
    receipts: receipts.slice(offset / 7, offset / 7 + 1),
    startDate: daysAgo(offset + 4),
    status: 'partially_paid',
    totalPenalty: entries.reduce((sum, entry) => sum + Number(entry.penaltyAmount), 0).toFixed(2),
  });

  const checkInStatus = {
    attendance: {
      checkInAt: `${today}T08:12:00.000Z`,
      checkInTime: '08:12:00',
      computedAmount: '0.00',
      id: 'attendance-today',
      reason: null,
      signOutAt: null,
      signOutNetworkIp: null,
      signOutTime: null,
      status: 'present',
    },
    date: today,
    device: { lastSeenAt: now.toISOString(), registered: true, registeredAt: now.toISOString(), trusted: true },
    holidayName: null,
    isAfterWorkdayEnd: false,
    isHoliday: false,
    isOfficeNetwork: true,
    isWeekend: false,
    locationConfigured: false,
    locationPolicy: null,
    networkConfigured: true,
    noSignOutAlertLabel: '8:00 PM',
    officeCodeRequired: false,
    permission: null,
    signOutStartLabel: '4:30 PM',
    staff: { email: me.email, fullName: me.fullName, id: me.id },
    time: '10:05:00',
    transferRequest: null,
    workdayEndLabel: '4:30 PM',
    workdayStartLabel: '8:30 AM',
  };

  const entries = staff.slice(0, 9).map((member, index) => ({
    arrivalTime: index === 3 ? null : index % 2 ? `08:${pad(31 + index * 2)}:00` : `07:${pad(20 + index * 3)}:00`,
    computedAmount: index % 2 && index !== 3 ? '5.00' : '0.00',
    didNotSignOut: false,
    isExcusedAbsence: index === 3,
    isGeneralPardon: false,
    noShowSignInWaived: false,
    noSignOutWaived: false,
    reason: index === 3 ? 'Excused absence' : index % 2 ? 'Late arrival' : null,
    signOutTime: null,
    staffId: member.id,
  }));

  const paymentStaff = staff.map((member, index) => {
    const memberEntries = historyEntries.slice(0, 3 + (index % 4));
    const total = memberEntries.reduce((sum, entry) => sum + Number(entry.penaltyAmount), 0);
    const paid = memberEntries.reduce((sum, entry) => sum + Number(entry.paidAmount), 0);
    return {
      email: member.email,
      entries: memberEntries,
      fullName: member.fullName,
      id: member.id,
      isAttendanceOnly: false,
      isNssPersonnel: member.isNssPersonnel,
      outstandingBalance: (total - paid).toFixed(2),
      paidAmount: paid.toFixed(2),
      totalPenalty: total.toFixed(2),
    };
  });

  const officeLocation = {
    archivedAt: null,
    formattedAddress: null,
    googlePlaceId: null,
    id: 'office-1',
    isActive: true,
    latitude: '5.5658293',
    locationKind: 'default',
    longitude: '-0.1775282',
    maxAccuracyMeters: 100,
    name: 'Office Location',
    radiusMeters: 90,
    scheduleEndDate: null,
    scheduleStartDate: null,
    source: 'detected',
    updatedAt: now.toISOString(),
    updatedByEmail: 'test.admin@latewatch.test',
  };

  return {
    '/api/account/theme': {},
    '/api/admin/backups': {
      backups: [0, 7, 14].map((offset) => ({
        createdAt: new Date(now.getTime() - offset * 86400000).toISOString(),
        createdBy: offset ? 'cron:vercel' : 'test.admin@latewatch.test',
        date: daysAgo(offset),
        sizeBytes: 812_000 - offset * 9000,
        totalRows: 14_230 - offset * 120,
      })),
    },
    '/api/attendance/check-in': checkInStatus,
    '/api/attendance/location': {
      configured: true,
      currentIp: '127.0.0.1',
      currentIpSource: 'local',
      date: today,
      defaultLocation: officeLocation,
      location: officeLocation,
      scheduledLocations: [],
      storageAvailable: true,
    },
    '/api/attendance/check-in/penalty-history': {
      currentWeek: week(0, historyEntries.slice(0, 4)),
      receipts,
      staff: { email: me.email, fullName: me.fullName, id: me.id },
      weeks: [week(0, historyEntries.slice(0, 4)), week(7, historyEntries.slice(4, 9)), week(14, historyEntries.slice(9, 14))],
    },
    '/api/attendance/check-in/push-subscription': {
      configured: true,
      publicKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U',
      subscription: { disabledAt: null, endpoint: 'https://push.example.test/1', signInEnabled: false, signOutEnabled: false },
    },
    '/api/attendance/check-in/receipt-notifications': { notifications: receipts.slice(0, 2), receipts },
    '/api/attendance/check-in/receipts/payment-0': {
      allocations: historyEntries.slice(0, 2).map((entry) => ({
        allocatedAmount: entry.penaltyAmount,
        arrivalTime: entry.arrivalTime,
        date: entry.date,
        entryId: entry.entryId,
        penaltyAmount: entry.penaltyAmount,
        reason: entry.reason,
      })),
      receipt: receipts[0],
      staff: { email: me.email, fullName: me.fullName, id: me.id },
    },
    '/api/attendance/device-health': {
      generatedAt: now.toISOString(),
      rows: staff.slice(0, 4).map((member, index) => ({
        attention: index === 1,
        attentionReasons: index === 1 ? ['No trusted attendance device'] : [],
        onLeave: false,
        reminders: { activeSubscriptions: 1, disabledSubscriptions: 0, lastUpdatedAt: null, signInEnabled: 1, signOutEnabled: 1 },
        security: { latestAlertAt: null, latestResetAt: null, latestTransferReviewAt: null, revokedSessions: 0 },
        staff: { department: member.department, email: member.email, fullName: member.fullName, id: member.id, isAttendanceOnly: false, unit: null },
        transfer: { latestRequestedAt: null, latestReviewedAt: null, latestStatus: null, pending: 0, requestedByEmail: null },
        trustedDevice: {
          deviceLabel: index === 1 ? null : 'Android phone',
          id: index === 1 ? null : `device-${index}`,
          lastDistanceMeters: null,
          lastSeenAt: index === 1 ? null : now.toISOString(),
          lastVerificationMethod: null,
          lastVerifiedAt: null,
          registered: index !== 1,
          registeredAt: null,
          sessionTracked: index !== 1,
          updatedAt: null,
        },
      })),
      summary: { activeReminderDevices: 11, attention: 0, pendingTransfers: 0, registeredDevices: 17, sessionTrackedDevices: 17, staff: staff.length },
    },
    '/api/attendance/reminder-monitor': {
      cannotReceive: [
        { fullName: staff[2].fullName, label: 'Phone rejecting', staffId: staff[2].id, status: 'failing' },
        { fullName: staff[4].fullName, label: 'Switched off', staffId: staff[4].id, status: 'reminders_off' },
        { fullName: staff[6].fullName, label: 'Never turned on', staffId: staff[6].id, status: 'not_registered' },
        { fullName: staff[8].fullName, label: 'Sign-out off', staffId: staff[8].id, status: 'partly_off' },
      ],
      day: { holidayName: null, isHoliday: false, isWeekend: false },
      sections: {
        signIn: {
          firstRunAt: `${today}T08:15:20.000Z`,
          label: '8:15 AM Sign-In',
          lastRunAt: `${today}T15:45:02.000Z`,
          missedRun: false,
          rows: [{ staff: { id: staff[0].id }, status: 'sent' }, { staff: { id: staff[1].id }, status: 'no_trusted_device' }, { staff: { id: staff[2].id }, status: 'failed' }, { staff: { id: staff[3].id }, status: 'skipped' }],
          scheduledPassed: true,
          sentByApp: false,
        },
        signOut: {
          firstRunAt: null,
          label: '4:30 PM Sign-Out',
          lastRunAt: null,
          missedRun: false,
          rows: [{ staff: { id: staff[0].id }, status: 'waiting' }, { staff: { id: staff[2].id }, status: 'waiting' }, { staff: { id: staff[3].id }, status: 'reminder_off' }],
          scheduledPassed: false,
          sentByApp: false,
        },
      },
    },
    '/api/calendar': [],
    '/api/dashboard': {
      missedReminders: [],
      entryChangePercent: -11,
      penaltyChangePercent: 8,
      recentActivity: [],
      staffCount: staff.length,
      weekDays: [
        { amount: 22, day: 'Mon 12', entries: 3, status: 'penalties' },
        { amount: 0, day: 'Tue 13', entries: 0, status: 'clear' },
        { amount: 12, day: 'Wed 14', entries: 2, status: 'penalties' },
        { amount: 0, day: 'Thu 15', entries: 0, status: 'today' },
        { amount: 0, day: 'Fri 16', entries: 0, status: 'upcoming' },
      ],
      weekEnd: daysAgo(-2),
      weekEntryCount: 21,
      weekStart: daysAgo(2),
      weekTotal: 86,
    },
    '/api/entries': entries,
    '/api/notifications': { notifications: [], unreadCount: 0 },
    '/api/payments/lateness': {
      monthlyBreakdown: [{ month: today.slice(0, 7), paidAmount: '120.00', pardonedAmount: '0.00', penaltyAmount: '310.00', unpaidAmount: '190.00' }],
      scope: 'all',
      staff: paymentStaff,
    },
    '/api/payments/offence-book-items': {
      calculatedClosingBalance: '120.00',
      canEditOpeningBalance: true,
      carriedOpeningBalance: '0.00',
      closingBalance: '120.00',
      expenditure: [],
      externalMoney: [],
      month: now.getUTCMonth() + 1,
      monthKey: today.slice(0, 7),
      openingBalance: '0.00',
      paymentsCollected: '120.00',
      year: now.getUTCFullYear(),
    },
    '/api/staff': staff,
  };
}
