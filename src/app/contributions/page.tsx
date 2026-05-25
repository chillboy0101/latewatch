'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  WalletCards,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { LoadingBuffer } from '@/components/ui/loading-buffer';
import { subscribeRealtimeChannel } from '@/lib/realtime-client';
import { cn } from '@/lib/utils';

interface ContributionEntry {
  amount: string;
  contributorName: string;
  displayOrder: number;
  id: string;
  note: string | null;
  sectionId: string;
}

interface ContributionSection {
  createdAt?: string | null;
  displayOrder: number;
  entries: ContributionEntry[];
  id: string;
  title: string;
  totalAmount: string;
  updatedAt?: string | null;
}

type VisibleContributionSection = ContributionSection & {
  visibleEntries: ContributionEntry[];
};

interface ContributionsResponse {
  sections: ContributionSection[];
  totals: {
    entryCount: number;
    sectionCount: number;
    totalAmount: string;
  };
}

type Message = { text: string; type: 'error' | 'success' };
type SectionSortMode = 'default' | 'az' | 'za' | 'newest' | 'oldest';
type SavingAction =
  | 'create-section'
  | 'refresh'
  | `section:${string}`
  | `delete-section:${string}`
  | `delete-entry:${string}`
  | `create-entry:${string}`;

type EntryDraft = {
  amount: string;
  contributorName: string;
  note: string;
};

type SectionDraft = {
  entries: Record<string, EntryDraft>;
  title: string;
};

type NewEntryDraft = {
  amount: string;
  contributorName: string;
  note: string;
};

const emptyNewEntry: NewEntryDraft = {
  amount: '',
  contributorName: '',
  note: '',
};

const sortOptions: Array<{ label: string; value: SectionSortMode }> = [
  { label: 'Default order', value: 'default' },
  { label: 'A-Z', value: 'az' },
  { label: 'Z-A', value: 'za' },
  { label: 'Newest first', value: 'newest' },
  { label: 'Oldest first', value: 'oldest' },
];

function money(value: string | number | null | undefined) {
  return `GHC ${Number(value || 0).toFixed(2)}`;
}

function normalizeMoneyInput(value: string) {
  const cleaned = value.replace(/[^\d.]/g, '');
  const [whole, ...decimalParts] = cleaned.split('.');

  if (decimalParts.length === 0) return whole;

  return `${whole}.${decimalParts.join('').slice(0, 2)}`;
}

function normalizeDraftText(value: string | null | undefined) {
  return String(value ?? '').trim();
}

function normalizeDraftAmount(value: string | number | null | undefined) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00';
}

function sectionTimestamp(section: ContributionSection) {
  const parsed = Date.parse(section.createdAt || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function entryDraftFromEntry(entry: ContributionEntry): EntryDraft {
  return {
    amount: entry.amount,
    contributorName: entry.contributorName,
    note: entry.note || '',
  };
}

function sectionDraftFromSection(section: ContributionSection): SectionDraft {
  return {
    entries: Object.fromEntries(section.entries.map((entry) => [entry.id, entryDraftFromEntry(entry)])),
    title: section.title,
  };
}

function buildSectionDrafts(sections: ContributionSection[]) {
  return Object.fromEntries(sections.map((section) => [section.id, sectionDraftFromSection(section)]));
}

function sectionMatchesSearch(section: ContributionSection, draft: SectionDraft, query: string) {
  const text = [
    draft.title,
    section.totalAmount,
    ...section.entries.flatMap((entry) => {
      const entryDraft = draft.entries[entry.id] || entryDraftFromEntry(entry);
      return [
        entryDraft.contributorName,
        entryDraft.amount,
        entryDraft.note,
      ];
    }),
  ].join(' ').toLowerCase();

  return text.includes(query);
}

function entryMatchesSearch(section: ContributionSection, entry: ContributionEntry, draft: SectionDraft, query: string) {
  const entryDraft = draft.entries[entry.id] || entryDraftFromEntry(entry);
  return [
    draft.title,
    entryDraft.contributorName,
    entryDraft.amount,
    entryDraft.note,
  ].join(' ').toLowerCase().includes(query);
}

function sectionIsDirty(section: ContributionSection, draft: SectionDraft) {
  if (normalizeDraftText(draft.title) !== normalizeDraftText(section.title)) return true;

  return section.entries.some((entry) => {
    const entryDraft = draft.entries[entry.id] || entryDraftFromEntry(entry);

    return (
      normalizeDraftText(entryDraft.contributorName) !== normalizeDraftText(entry.contributorName) ||
      normalizeDraftAmount(entryDraft.amount) !== normalizeDraftAmount(entry.amount) ||
      normalizeDraftText(entryDraft.note) !== normalizeDraftText(entry.note)
    );
  });
}

function sortSections(sections: ContributionSection[], sortMode: SectionSortMode) {
  return sections
    .map((section, index) => ({ index, section }))
    .sort((left, right) => {
      switch (sortMode) {
        case 'az':
          return left.section.title.localeCompare(right.section.title) || left.index - right.index;
        case 'za':
          return right.section.title.localeCompare(left.section.title) || left.index - right.index;
        case 'newest': {
          const dateDifference = sectionTimestamp(right.section) - sectionTimestamp(left.section);
          return dateDifference || (right.section.displayOrder - left.section.displayOrder) || left.index - right.index;
        }
        case 'oldest': {
          const dateDifference = sectionTimestamp(left.section) - sectionTimestamp(right.section);
          return dateDifference || (left.section.displayOrder - right.section.displayOrder) || left.index - right.index;
        }
        default:
          return left.section.displayOrder - right.section.displayOrder || left.index - right.index;
      }
    })
    .map(({ section }) => section);
}

export default function ContributionsPage() {
  const [data, setData] = useState<ContributionsResponse | null>(null);
  const [sectionDrafts, setSectionDrafts] = useState<Record<string, SectionDraft>>({});
  const [loading, setLoading] = useState(true);
  const [savingAction, setSavingAction] = useState<SavingAction | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [search, setSearch] = useState('');
  const [sectionSort, setSectionSort] = useState<SectionSortMode>('default');
  const [createSectionOpen, setCreateSectionOpen] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState('');
  const [newEntryDrafts, setNewEntryDrafts] = useState<Record<string, NewEntryDraft>>({});
  const [pendingSectionId, setPendingSectionId] = useState<string | null>(null);
  const [highlightedSectionId, setHighlightedSectionId] = useState<string | null>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const loadContributions = useCallback(async (action: SavingAction | null = null) => {
    if (action) setSavingAction(action);
    setMessage(null);

    try {
      const response = await fetch('/api/contributions', { cache: 'no-store' });
      const body = await response.json().catch(() => ({})) as Partial<ContributionsResponse> & { error?: string };
      if (!response.ok) throw new Error(body.error || `Contributions request failed (${response.status})`);
      const sections = Array.isArray(body.sections) ? body.sections : [];
      const nextData = {
        sections,
        totals: body.totals || { entryCount: 0, sectionCount: 0, totalAmount: '0.00' },
      };

      setData(nextData);
      setSectionDrafts(buildSectionDrafts(nextData.sections));
      return nextData;
    } catch (error) {
      console.error('Failed to load contributions:', error);
      setData(null);
      setSectionDrafts({});
      setMessage({
        text: error instanceof Error ? error.message : 'Could not load contributions',
        type: 'error',
      });
      return null;
    } finally {
      setLoading(false);
      if (action) setSavingAction(null);
    }
  }, []);

  useEffect(() => {
    void loadContributions();
  }, [loadContributions]);

  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let mounted = true;

    (async () => {
      const unsubscribe = await subscribeRealtimeChannel({
        channel: 'contributions',
        events: ['invalidate'],
        onEvent: () => {
          void loadContributions();
        },
      });

      if (mounted) cleanup = unsubscribe;
      else unsubscribe();
    })();

    return () => {
      mounted = false;
      cleanup?.();
    };
  }, [loadContributions]);

  useEffect(() => {
    if (!pendingSectionId || !data?.sections.some((section) => section.id === pendingSectionId)) return;

    const timeout = window.setTimeout(() => {
      sectionRefs.current[pendingSectionId]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setHighlightedSectionId(pendingSectionId);
    }, 80);
    const clearHighlight = window.setTimeout(() => {
      setHighlightedSectionId(null);
      setPendingSectionId(null);
    }, 2600);

    return () => {
      window.clearTimeout(timeout);
      window.clearTimeout(clearHighlight);
    };
  }, [data?.sections, pendingSectionId]);

  const visibleSections = useMemo(() => {
    const query = search.trim().toLowerCase();
    const sortedSections = sortSections(data?.sections || [], sectionSort);
    if (!query) {
      return sortedSections.map((section) => ({
        ...section,
        visibleEntries: section.entries,
      }));
    }

    return sortedSections
      .filter((section) => {
        const draft = sectionDrafts[section.id] || sectionDraftFromSection(section);
        return sectionMatchesSearch(section, draft, query);
      })
      .map((section) => {
        const draft = sectionDrafts[section.id] || sectionDraftFromSection(section);
        return {
          ...section,
          visibleEntries: section.entries.filter((entry) => entryMatchesSearch(section, entry, draft, query)),
        };
      }) satisfies VisibleContributionSection[];
  }, [data?.sections, search, sectionDrafts, sectionSort]);

  function getSectionDraft(section: ContributionSection) {
    return sectionDrafts[section.id] || sectionDraftFromSection(section);
  }

  function updateSectionTitle(id: string, title: string) {
    setSectionDrafts((current) => ({
      ...current,
      [id]: {
        ...(current[id] || { entries: {}, title: '' }),
        title,
      },
    }));
  }

  function updateEntry(section: ContributionSection, entry: ContributionEntry, patch: Partial<EntryDraft>) {
    setSectionDrafts((current) => {
      const currentSection = current[section.id] || sectionDraftFromSection(section);
      const currentEntry = currentSection.entries[entry.id] || entryDraftFromEntry(entry);

      return {
        ...current,
        [section.id]: {
          ...currentSection,
          entries: {
            ...currentSection.entries,
            [entry.id]: {
              ...currentEntry,
              ...patch,
            },
          },
        },
      };
    });
  }

  function updateNewEntryDraft(sectionId: string, patch: Partial<NewEntryDraft>) {
    setNewEntryDrafts((current) => ({
      ...current,
      [sectionId]: {
        ...(current[sectionId] || emptyNewEntry),
        ...patch,
      },
    }));
  }

  async function requestContributions(input: {
    actionKey: SavingAction;
    body: Record<string, unknown>;
    method: 'DELETE' | 'PATCH' | 'POST';
  }) {
    setSavingAction(input.actionKey);
    setMessage(null);

    try {
      const response = await fetch('/api/contributions', {
        body: JSON.stringify(input.body),
        headers: { 'Content-Type': 'application/json' },
        method: input.method,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Contribution update failed (${response.status})`);
      return body;
    } catch (error) {
      console.error('Contribution update failed:', error);
      setMessage({
        text: error instanceof Error ? error.message : 'Contribution update failed',
        type: 'error',
      });
      return null;
    } finally {
      setSavingAction(null);
    }
  }

  async function createSection() {
    const title = newSectionTitle.trim();
    if (!title) return;

    const body = await requestContributions({
      actionKey: 'create-section',
      body: { title, type: 'section' },
      method: 'POST',
    });

    if (!body?.section?.id) return;

    setPendingSectionId(body.section.id);
    setCreateSectionOpen(false);
    setNewSectionTitle('');
    setMessage({ text: 'Section created.', type: 'success' });
    await loadContributions();
  }

  async function saveSectionChanges(section: ContributionSection) {
    const draft = getSectionDraft(section);
    if (!sectionIsDirty(section, draft)) return;

    const body = await requestContributions({
      actionKey: `section:${section.id}`,
      body: {
        entries: section.entries.map((entry) => {
          const entryDraft = draft.entries[entry.id] || entryDraftFromEntry(entry);
          return {
            amount: entryDraft.amount,
            contributorName: entryDraft.contributorName,
            id: entry.id,
            note: entryDraft.note,
          };
        }),
        id: section.id,
        title: draft.title,
        type: 'section_batch',
      },
      method: 'PATCH',
    });

    if (!body?.success) return;

    setMessage({ text: 'Section saved.', type: 'success' });
    await loadContributions();
  }

  async function deleteSection(section: ContributionSection) {
    const draft = getSectionDraft(section);
    if (!window.confirm(`Delete ${draft.title || section.title}?`)) return;

    const body = await requestContributions({
      actionKey: `delete-section:${section.id}`,
      body: { id: section.id, type: 'section' },
      method: 'DELETE',
    });

    if (!body?.success) return;

    setMessage({ text: 'Section deleted.', type: 'success' });
    await loadContributions();
  }

  async function createEntry(section: ContributionSection) {
    const draft = newEntryDrafts[section.id] || emptyNewEntry;
    if (!draft.contributorName.trim() || !draft.amount.trim()) return;

    const body = await requestContributions({
      actionKey: `create-entry:${section.id}`,
      body: {
        amount: draft.amount,
        contributorName: draft.contributorName,
        note: draft.note,
        sectionId: section.id,
        type: 'entry',
      },
      method: 'POST',
    });

    if (!body?.success) return;

    setNewEntryDrafts((current) => ({ ...current, [section.id]: emptyNewEntry }));
    setMessage({ text: 'Entry added.', type: 'success' });
    await loadContributions();
  }

  async function deleteEntry(entry: ContributionEntry) {
    const draftName = sectionDrafts[entry.sectionId]?.entries[entry.id]?.contributorName || entry.contributorName;
    if (!window.confirm(`Delete ${draftName}?`)) return;

    const body = await requestContributions({
      actionKey: `delete-entry:${entry.id}`,
      body: { id: entry.id, type: 'entry' },
      method: 'DELETE',
    });

    if (!body?.success) return;

    setMessage({ text: 'Entry deleted.', type: 'success' });
    await loadContributions();
  }

  const totals = data?.totals || { entryCount: 0, sectionCount: 0, totalAmount: '0.00' };

  return (
    <DashboardLayout title="Contributions">
      <div className="space-y-5">
        {message && (
          <div className={cn(
            'flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
            message.type === 'success'
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-danger/30 bg-danger/10 text-danger',
          )}>
            {message.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <WalletCards className="h-4 w-4" />}
            {message.text}
          </div>
        )}

        <Card className="overflow-hidden">
          <div className="grid gap-px border-b border-border bg-border sm:grid-cols-3">
            <ContributionStat label="Sections" value={String(totals.sectionCount)} />
            <ContributionStat label="Entries" value={String(totals.entryCount)} />
            <ContributionStat label="Total" value={money(totals.totalAmount)} mono />
          </div>

          <div className="grid gap-3 border-b border-border p-4 lg:grid-cols-[minmax(240px,1fr)_minmax(180px,14rem)_auto] lg:items-center">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search contributions"
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, amount, note"
              />
            </div>

            <div className="relative">
              <select
                aria-label="Sort contribution sections"
                className="h-10 w-full appearance-none rounded-md border border-border bg-background px-3 pr-9 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                value={sectionSort}
                onChange={(event) => setSectionSort(event.target.value as SectionSortMode)}
              >
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </div>

            <div className="flex gap-2 lg:justify-end">
              <Button
                type="button"
                size="icon"
                title="Create section"
                aria-label="Create section"
                disabled={Boolean(savingAction)}
                onClick={() => setCreateSectionOpen(true)}
              >
                <Plus className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                title="Refresh"
                aria-label="Refresh"
                disabled={Boolean(savingAction)}
                onClick={() => loadContributions('refresh')}
              >
                {savingAction === 'refresh' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </Card>

        {loading ? (
          <LoadingBuffer variant="section" label="Loading contributions" description="Reading contribution records." />
        ) : (
          <div className="space-y-4">
            {visibleSections.map((section) => {
              const sectionDraft = getSectionDraft(section);
              const isDirty = sectionIsDirty(section, sectionDraft);
              const draft = newEntryDrafts[section.id] || emptyNewEntry;
              const displayedEntries = section.visibleEntries;

              return (
                <Card
                  key={section.id}
                  ref={(element) => {
                    sectionRefs.current[section.id] = element;
                  }}
                  className={cn(
                    'scroll-mt-20 overflow-hidden transition-[box-shadow,border-color,background-color] duration-500',
                    highlightedSectionId === section.id && 'border-primary/70 bg-primary/5 shadow-md shadow-primary/10',
                  )}
                >
                  <div className="grid gap-3 border-b border-border p-4 lg:grid-cols-[minmax(260px,1fr)_auto_auto] lg:items-center">
                    <div className="min-w-0">
                      <Input
                        aria-label={`${section.title} title`}
                        className="font-semibold"
                        value={sectionDraft.title}
                        onChange={(event) => updateSectionTitle(section.id, event.target.value)}
                      />
                      {isDirty && (
                        <div className="mt-1 text-xs font-medium text-warning">Unsaved changes</div>
                      )}
                    </div>
                    <div className="rounded-md border border-border bg-background px-3 py-2 text-sm">
                      <span className="text-muted-foreground">Total</span>
                      <span className="ml-2 font-mono font-semibold">{money(section.totalAmount)}</span>
                    </div>
                    <div className="flex gap-2 lg:justify-end">
                      <Button
                        type="button"
                        variant={isDirty ? 'default' : 'outline'}
                        size="sm"
                        className="gap-2"
                        disabled={
                          savingAction === `section:${section.id}` ||
                          !isDirty ||
                          !sectionDraft.title.trim()
                        }
                        onClick={() => saveSectionChanges(section)}
                      >
                        {savingAction === `section:${section.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Save
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        title="Delete section"
                        aria-label={`Delete ${sectionDraft.title || section.title}`}
                        className="h-9 w-9 text-danger hover:text-danger"
                        disabled={savingAction === `delete-section:${section.id}`}
                        onClick={() => deleteSection(section)}
                      >
                        {savingAction === `delete-section:${section.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[780px] text-sm">
                      <thead className="border-b border-border bg-muted/20 text-left text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="w-16 px-4 py-3 font-medium">No.</th>
                          <th className="px-4 py-3 font-medium">Name</th>
                          <th className="w-40 px-4 py-3 font-medium">Amount</th>
                          <th className="px-4 py-3 font-medium">Note</th>
                          <th className="w-20 px-4 py-3 text-right font-medium">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayedEntries.map((entry, index) => {
                          const entryDraft = sectionDraft.entries[entry.id] || entryDraftFromEntry(entry);

                          return (
                            <tr key={entry.id} className="border-b border-border">
                              <td className="px-4 py-3 text-muted-foreground">{index + 1}</td>
                              <td className="px-4 py-3">
                                <Input
                                  aria-label="Contributor name"
                                  value={entryDraft.contributorName}
                                  onChange={(event) => updateEntry(section, entry, { contributorName: event.target.value })}
                                />
                              </td>
                              <td className="px-4 py-3">
                                <Input
                                  aria-label="Contribution amount"
                                  inputMode="decimal"
                                  value={entryDraft.amount}
                                  onChange={(event) => updateEntry(section, entry, { amount: normalizeMoneyInput(event.target.value) })}
                                />
                              </td>
                              <td className="px-4 py-3">
                                <Input
                                  aria-label="Contribution note"
                                  value={entryDraft.note}
                                  onChange={(event) => updateEntry(section, entry, { note: event.target.value })}
                                  placeholder="Note"
                                />
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex justify-end">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    title="Delete"
                                    aria-label={`Delete ${entryDraft.contributorName || entry.contributorName}`}
                                    className="h-9 w-9 text-danger hover:text-danger"
                                    disabled={savingAction === `delete-entry:${entry.id}`}
                                    onClick={() => deleteEntry(entry)}
                                  >
                                    {savingAction === `delete-entry:${entry.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}

                        <tr className="border-b border-border bg-muted/10">
                          <td className="px-4 py-3 text-muted-foreground">New</td>
                          <td className="px-4 py-3">
                            <Input
                              aria-label="New contributor name"
                              value={draft.contributorName}
                              onChange={(event) => updateNewEntryDraft(section.id, { contributorName: event.target.value })}
                              placeholder="Contributor name"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <Input
                              aria-label="New contribution amount"
                              inputMode="decimal"
                              value={draft.amount}
                              onChange={(event) => updateNewEntryDraft(section.id, { amount: normalizeMoneyInput(event.target.value) })}
                              placeholder="Amount"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <Input
                              aria-label="New contribution note"
                              value={draft.note}
                              onChange={(event) => updateNewEntryDraft(section.id, { note: event.target.value })}
                              placeholder="Note"
                            />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              type="button"
                              size="sm"
                              className="gap-2"
                              disabled={
                                savingAction === `create-entry:${section.id}` ||
                                !draft.contributorName.trim() ||
                                !draft.amount.trim()
                              }
                              onClick={() => createEntry(section)}
                            >
                              {savingAction === `create-entry:${section.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                              Add
                            </Button>
                          </td>
                        </tr>

                        {displayedEntries.length === 0 && (
                          <tr>
                            <td className="px-4 py-8 text-center text-muted-foreground" colSpan={5}>
                              No contribution entries found.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>
              );
            })}

            {visibleSections.length === 0 && (
              <Card className="px-4 py-10 text-center text-sm text-muted-foreground">
                No contribution sections found.
              </Card>
            )}
          </div>
        )}

        <Dialog open={createSectionOpen} onOpenChange={setCreateSectionOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create section</DialogTitle>
              <DialogDescription className="sr-only">
                Create a new contribution section.
              </DialogDescription>
            </DialogHeader>
            <Input
              aria-label="Create contribution section"
              value={newSectionTitle}
              onChange={(event) => setNewSectionTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void createSection();
                }
              }}
              placeholder="Section title"
              autoFocus
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateSectionOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="gap-2"
                disabled={savingAction === 'create-section' || !newSectionTitle.trim()}
                onClick={createSection}
              >
                {savingAction === 'create-section' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

function ContributionStat({ label, mono, value }: { label: string; mono?: boolean; value: string }) {
  return (
    <div className="min-w-0 bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('mt-1 truncate text-base font-semibold', mono && 'font-mono')}>{value}</div>
    </div>
  );
}
