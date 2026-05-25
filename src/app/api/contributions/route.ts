import { currentUser } from '@clerk/nextjs/server';
import { asc, desc, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { contributionEntry, contributionSection } from '@/db/schema';
import {
  contributionTotal,
  formatContributionAmount,
  getContributionSections,
} from '@/lib/contributions';
import { writeAuditEvent } from '@/lib/audit';
import { publishRealtime } from '@/lib/realtime';

export const dynamic = 'force-dynamic';

function actorFromUser(user: Awaited<ReturnType<typeof currentUser>>) {
  return {
    email: user?.primaryEmailAddress?.emailAddress || user?.emailAddresses[0]?.emailAddress || 'system',
    id: user?.id || null,
  };
}

function normalizeText(value: unknown, maxLength = 200) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeNullableText(value: unknown, maxLength = 200) {
  const text = normalizeText(value, maxLength);
  return text || null;
}

function normalizeAmount(value: unknown) {
  const amount = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function normalizeBatchEntries(value: unknown) {
  if (!Array.isArray(value)) return null;

  return value.map((item) => {
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return {
      amount: normalizeAmount(record.amount),
      contributorName: normalizeText(record.contributorName),
      id: normalizeText(record.id, 80),
      note: normalizeNullableText(record.note),
    };
  });
}

async function nextSectionOrder() {
  const [lastSection] = await db.select({ displayOrder: contributionSection.displayOrder })
    .from(contributionSection)
    .orderBy(desc(contributionSection.displayOrder))
    .limit(1);

  return (lastSection?.displayOrder || 0) + 1;
}

async function nextEntryOrder(sectionId: string) {
  const [lastEntry] = await db.select({ displayOrder: contributionEntry.displayOrder })
    .from(contributionEntry)
    .where(eq(contributionEntry.sectionId, sectionId))
    .orderBy(desc(contributionEntry.displayOrder))
    .limit(1);

  return (lastEntry?.displayOrder || 0) + 1;
}

async function publishContributionChange(input: {
  action: string;
  actor: ReturnType<typeof actorFromUser>;
  after: unknown;
  before: unknown;
  entityId: string;
  entityType: string;
}) {
  await writeAuditEvent({
    action: input.action,
    actor: input.actor,
    after: input.after,
    before: input.before,
    entityId: input.entityId,
    entityType: input.entityType,
    reason: 'contributions',
  });

  publishRealtime('contributions', 'invalidate', {
    action: input.action,
    entityId: input.entityId,
    entityType: input.entityType,
    reason: 'contributions',
  });
}

export async function GET() {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const sections = await getContributionSections();
    const entries = sections.flatMap((section) => section.entries);

    return NextResponse.json({
      sections,
      totals: {
        entryCount: entries.length,
        sectionCount: sections.length,
        totalAmount: contributionTotal(entries),
      },
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Failed to load contributions:', error);
    return NextResponse.json({ error: 'Failed to load contributions' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const actor = actorFromUser(user);

    if (body?.type === 'section') {
      const title = normalizeText(body?.title);
      if (!title) {
        return NextResponse.json({ error: 'Section title is required' }, { status: 400 });
      }

      const [created] = await db.insert(contributionSection)
        .values({
          displayOrder: await nextSectionOrder(),
          title,
        })
        .returning();

      await publishContributionChange({
        action: 'CREATE',
        actor,
        after: created,
        before: null,
        entityId: created.id,
        entityType: 'contribution_section',
      });

      return NextResponse.json({ section: created, success: true });
    }

    if (body?.type === 'entry') {
      const sectionId = normalizeText(body?.sectionId, 80);
      const contributorName = normalizeText(body?.contributorName);
      const amount = normalizeAmount(body?.amount);
      const note = normalizeNullableText(body?.note);

      if (!sectionId || !contributorName || amount === null) {
        return NextResponse.json({ error: 'Section, contributor name, and amount are required' }, { status: 400 });
      }

      const [section] = await db.select()
        .from(contributionSection)
        .where(eq(contributionSection.id, sectionId))
        .limit(1);

      if (!section) {
        return NextResponse.json({ error: 'Contribution section was not found' }, { status: 404 });
      }

      const [created] = await db.insert(contributionEntry)
        .values({
          amount: formatContributionAmount(amount),
          contributorName,
          displayOrder: await nextEntryOrder(sectionId),
          note,
          sectionId,
        })
        .returning();

      await publishContributionChange({
        action: 'CREATE',
        actor,
        after: created,
        before: null,
        entityId: created.id,
        entityType: 'contribution_entry',
      });

      return NextResponse.json({ entry: created, success: true });
    }

    return NextResponse.json({ error: 'Valid contribution action is required' }, { status: 400 });
  } catch (error) {
    console.error('Failed to create contribution record:', error);
    return NextResponse.json({ error: 'Failed to create contribution record' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const actor = actorFromUser(user);
    const id = normalizeText(body?.id, 80);

    if (!id) {
      return NextResponse.json({ error: 'Contribution record is required' }, { status: 400 });
    }

    if (body?.type === 'section_batch') {
      const title = normalizeText(body?.title);
      const entries = normalizeBatchEntries(body?.entries);

      if (!title || !entries || entries.some((entry) => !entry.id || !entry.contributorName || entry.amount === null)) {
        return NextResponse.json({ error: 'Section title and valid contribution entries are required' }, { status: 400 });
      }

      const [beforeSection] = await db.select()
        .from(contributionSection)
        .where(eq(contributionSection.id, id))
        .limit(1);

      if (!beforeSection) {
        return NextResponse.json({ error: 'Contribution section was not found' }, { status: 404 });
      }

      const beforeEntries = await db.select()
        .from(contributionEntry)
        .where(eq(contributionEntry.sectionId, id))
        .orderBy(asc(contributionEntry.displayOrder), asc(contributionEntry.contributorName));
      const beforeEntryIds = new Set(beforeEntries.map((entry) => entry.id));

      if (entries.some((entry) => !beforeEntryIds.has(entry.id))) {
        return NextResponse.json({ error: 'One or more contribution entries were not found in this section' }, { status: 404 });
      }

      const updatedAt = new Date();
      const [updatedSection] = await db.update(contributionSection)
        .set({ title, updatedAt })
        .where(eq(contributionSection.id, id))
        .returning();
      const updatedEntries = [];

      for (const entry of entries) {
        const [updatedEntry] = await db.update(contributionEntry)
          .set({
            amount: formatContributionAmount(entry.amount),
            contributorName: entry.contributorName,
            note: entry.note,
            updatedAt,
          })
          .where(eq(contributionEntry.id, entry.id))
          .returning();

        if (updatedEntry) updatedEntries.push(updatedEntry);
      }

      await publishContributionChange({
        action: 'UPDATE',
        actor,
        after: { entries: updatedEntries, section: updatedSection },
        before: { entries: beforeEntries, section: beforeSection },
        entityId: updatedSection.id,
        entityType: 'contribution_section',
      });

      return NextResponse.json({ entries: updatedEntries, section: updatedSection, success: true });
    }

    if (body?.type === 'section') {
      const title = normalizeText(body?.title);
      if (!title) {
        return NextResponse.json({ error: 'Section title is required' }, { status: 400 });
      }

      const [before] = await db.select()
        .from(contributionSection)
        .where(eq(contributionSection.id, id))
        .limit(1);

      if (!before) {
        return NextResponse.json({ error: 'Contribution section was not found' }, { status: 404 });
      }

      const [updated] = await db.update(contributionSection)
        .set({ title, updatedAt: new Date() })
        .where(eq(contributionSection.id, id))
        .returning();

      await publishContributionChange({
        action: 'UPDATE',
        actor,
        after: updated,
        before,
        entityId: updated.id,
        entityType: 'contribution_section',
      });

      return NextResponse.json({ section: updated, success: true });
    }

    if (body?.type === 'entry') {
      const contributorName = normalizeText(body?.contributorName);
      const amount = normalizeAmount(body?.amount);
      const note = normalizeNullableText(body?.note);

      if (!contributorName || amount === null) {
        return NextResponse.json({ error: 'Contributor name and amount are required' }, { status: 400 });
      }

      const [before] = await db.select()
        .from(contributionEntry)
        .where(eq(contributionEntry.id, id))
        .limit(1);

      if (!before) {
        return NextResponse.json({ error: 'Contribution entry was not found' }, { status: 404 });
      }

      const [updated] = await db.update(contributionEntry)
        .set({
          amount: formatContributionAmount(amount),
          contributorName,
          note,
          updatedAt: new Date(),
        })
        .where(eq(contributionEntry.id, id))
        .returning();

      await publishContributionChange({
        action: 'UPDATE',
        actor,
        after: updated,
        before,
        entityId: updated.id,
        entityType: 'contribution_entry',
      });

      return NextResponse.json({ entry: updated, success: true });
    }

    return NextResponse.json({ error: 'Valid contribution action is required' }, { status: 400 });
  } catch (error) {
    console.error('Failed to update contribution record:', error);
    return NextResponse.json({ error: 'Failed to update contribution record' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const actor = actorFromUser(user);
    const id = normalizeText(body?.id, 80);

    if (!id) {
      return NextResponse.json({ error: 'Contribution record is required' }, { status: 400 });
    }

    if (body?.type === 'section') {
      const [before] = await db.select()
        .from(contributionSection)
        .where(eq(contributionSection.id, id))
        .limit(1);

      if (!before) {
        return NextResponse.json({ error: 'Contribution section was not found' }, { status: 404 });
      }

      await db.delete(contributionSection).where(eq(contributionSection.id, id));
      await publishContributionChange({
        action: 'DELETE',
        actor,
        after: null,
        before,
        entityId: id,
        entityType: 'contribution_section',
      });

      return NextResponse.json({ success: true });
    }

    if (body?.type === 'entry') {
      const [before] = await db.select()
        .from(contributionEntry)
        .where(eq(contributionEntry.id, id))
        .limit(1);

      if (!before) {
        return NextResponse.json({ error: 'Contribution entry was not found' }, { status: 404 });
      }

      await db.delete(contributionEntry).where(eq(contributionEntry.id, id));
      await publishContributionChange({
        action: 'DELETE',
        actor,
        after: null,
        before,
        entityId: id,
        entityType: 'contribution_entry',
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Valid contribution action is required' }, { status: 400 });
  } catch (error) {
    console.error('Failed to delete contribution record:', error);
    return NextResponse.json({ error: 'Failed to delete contribution record' }, { status: 500 });
  }
}
