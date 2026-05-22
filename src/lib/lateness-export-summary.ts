export type LatenessExportSummaryEntry = {
  computedAmount: string | number | null;
  didNotSignOut?: boolean | null;
  reason?: string | null;
};

export type LatenessExportSummary = {
  amount: number;
  lateArrivals: number;
  signOut: number;
};

function entryAmount(entry: LatenessExportSummaryEntry) {
  const amount = Number(entry.computedAmount || 0);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function isLateArrivalEntry(entry: LatenessExportSummaryEntry) {
  return entryAmount(entry) > 0 && (entry.reason || '').includes("DIDN'T COME BEFORE");
}

export function countLateArrivals(entries: LatenessExportSummaryEntry[]) {
  return entries.filter(isLateArrivalEntry).length;
}

export function countSignOutEntries(entries: LatenessExportSummaryEntry[]) {
  return entries.filter((entry) => entry.didNotSignOut === true).length;
}

export function sumAmounts(entries: LatenessExportSummaryEntry[]) {
  return entries.reduce((sum, entry) => sum + entryAmount(entry), 0);
}

export function summarizeLatenessExportEntries(entries: LatenessExportSummaryEntry[]): LatenessExportSummary {
  return {
    amount: sumAmounts(entries),
    lateArrivals: countLateArrivals(entries),
    signOut: countSignOutEntries(entries),
  };
}
