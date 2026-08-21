import { isOnTimeCheckIn } from '@/lib/work-hours';

export type EntryDaySummaryInput = {
  amount: number;
  arrivalTime: string | null | undefined;
  didNotSignOut: boolean;
  isExcusedAbsence: boolean;
  isGeneralPardon: boolean;
  isOnLeave: boolean;
  noShowSignInWaived: boolean;
  noSignOutWaived: boolean;
};

export function summarizeEntryDay(entries: EntryDaySummaryInput[]) {
  const summary = {
    excused: 0,
    generalPardon: 0,
    late: 0,
    noSignOut: 0,
    notCheckedIn: 0,
    onLeave: 0,
    onTime: 0,
    totalAmount: 0,
    totalStaff: entries.length,
    waived: 0,
  };

  for (const entry of entries) {
    if (entry.isOnLeave) {
      summary.onLeave += 1;
      continue;
    }

    if (entry.isExcusedAbsence) summary.excused += 1;
    if (entry.isGeneralPardon) summary.generalPardon += 1;
    if (entry.noShowSignInWaived || entry.noSignOutWaived) summary.waived += 1;
    if (entry.didNotSignOut) summary.noSignOut += 1;
    summary.totalAmount += entry.amount;

    if (entry.arrivalTime && !entry.isExcusedAbsence && !entry.isGeneralPardon) {
      if (isOnTimeCheckIn(entry.arrivalTime)) summary.onTime += 1;
      else summary.late += 1;
      continue;
    }

    if (
      !entry.arrivalTime &&
      !entry.isExcusedAbsence &&
      !entry.isGeneralPardon &&
      !entry.noShowSignInWaived
    ) {
      summary.notCheckedIn += 1;
    }
  }

  return summary;
}
