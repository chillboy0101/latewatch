import 'server-only';

import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { contributionEntry, contributionSection } from '@/db/schema';

export type ContributionEntryRecord = {
  amount: string;
  contributorName: string;
  displayOrder: number;
  id: string;
  note: string | null;
  sectionId: string;
};

export type ContributionSectionRecord = {
  displayOrder: number;
  entries: ContributionEntryRecord[];
  id: string;
  title: string;
  totalAmount: string;
};

export function formatContributionAmount(value: number | string | null | undefined) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00';
}

export function contributionTotal(entries: Array<Pick<ContributionEntryRecord, 'amount'>>) {
  return formatContributionAmount(
    entries.reduce((total, entry) => total + Number(entry.amount || 0), 0),
  );
}

export async function getContributionSections(): Promise<ContributionSectionRecord[]> {
  const [sectionRows, entryRows] = await Promise.all([
    db.select({
      displayOrder: contributionSection.displayOrder,
      id: contributionSection.id,
      title: contributionSection.title,
    })
      .from(contributionSection)
      .where(eq(contributionSection.active, true))
      .orderBy(asc(contributionSection.displayOrder), asc(contributionSection.title)),
    db.select({
      amount: contributionEntry.amount,
      contributorName: contributionEntry.contributorName,
      displayOrder: contributionEntry.displayOrder,
      id: contributionEntry.id,
      note: contributionEntry.note,
      sectionId: contributionEntry.sectionId,
    })
      .from(contributionEntry)
      .orderBy(asc(contributionEntry.displayOrder), asc(contributionEntry.contributorName)),
  ]);

  const entriesBySection = new Map<string, ContributionEntryRecord[]>();
  for (const entry of entryRows) {
    const entries = entriesBySection.get(entry.sectionId) || [];
    entries.push({
      ...entry,
      amount: formatContributionAmount(entry.amount),
    });
    entriesBySection.set(entry.sectionId, entries);
  }

  return sectionRows.map((section) => {
    const entries = entriesBySection.get(section.id) || [];

    return {
      ...section,
      entries,
      totalAmount: contributionTotal(entries),
    };
  });
}
