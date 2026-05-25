'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
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
  displayOrder: number;
  entries: ContributionEntry[];
  id: string;
  title: string;
  totalAmount: string;
}

interface ContributionsResponse {
  sections: ContributionSection[];
  totals: {
    entryCount: number;
    sectionCount: number;
    totalAmount: string;
  };
}

type Message = { text: string; type: 'error' | 'success' };
type SavingAction =
  | 'create-section'
  | 'export'
  | 'refresh'
  | `section:${string}`
  | `delete-section:${string}`
  | `entry:${string}`
  | `delete-entry:${string}`
  | `create-entry:${string}`;

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

function money(value: string | number | null | undefined) {
  return `GHC ${Number(value || 0).toFixed(2)}`;
}

function normalizeMoneyInput(value: string) {
  const cleaned = value.replace(/[^\d.]/g, '');
  const [whole, ...decimalParts] = cleaned.split('.');

  if (decimalParts.length === 0) return whole;

  return `${whole}.${decimalParts.join('').slice(0, 2)}`;
}

function downloadBlob(response: Response, fallbackFileName: string) {
  return response.blob().then((blob) => {
    const disposition = response.headers.get('Content-Disposition') || '';
    const fileNameMatch = disposition.match(/filename="([^"]+)"/);
    const fileName = fileNameMatch?.[1] || fallbackFileName;
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(url);
  });
}

function sectionMatchesSearch(section: ContributionSection, query: string) {
  const text = [
    section.title,
    section.totalAmount,
    ...section.entries.flatMap((entry) => [
      entry.contributorName,
      entry.amount,
      entry.note || '',
    ]),
  ].join(' ').toLowerCase();

  return text.includes(query);
}

export default function ContributionsPage() {
  const [data, setData] = useState<ContributionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingAction, setSavingAction] = useState<SavingAction | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [search, setSearch] = useState('');
  const [newSectionTitle, setNewSectionTitle] = useState('');
  const [newEntryDrafts, setNewEntryDrafts] = useState<Record<string, NewEntryDraft>>({});

  const loadContributions = useCallback(async (action: SavingAction | null = null) => {
    if (action) setSavingAction(action);
    setMessage(null);

    try {
      const response = await fetch('/api/contributions', { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Contributions request failed (${response.status})`);
      setData(body);
    } catch (error) {
      console.error('Failed to load contributions:', error);
      setData(null);
      setMessage({
        text: error instanceof Error ? error.message : 'Could not load contributions',
        type: 'error',
      });
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

  const visibleSections = useMemo(() => {
    const query = search.trim().toLowerCase();
    const sections = data?.sections || [];
    if (!query) return sections;

    return sections
      .filter((section) => sectionMatchesSearch(section, query))
      .map((section) => ({
        ...section,
        entries: section.entries.filter((entry) => [
          section.title,
          entry.contributorName,
          entry.amount,
          entry.note || '',
        ].join(' ').toLowerCase().includes(query)),
      }));
  }, [data?.sections, search]);

  function updateSectionTitle(id: string, title: string) {
    setData((current) => current ? {
      ...current,
      sections: current.sections.map((section) => section.id === id ? { ...section, title } : section),
    } : current);
  }

  function updateEntry(sectionId: string, entryId: string, patch: Partial<ContributionEntry>) {
    setData((current) => current ? {
      ...current,
      sections: current.sections.map((section) => section.id === sectionId
        ? {
          ...section,
          entries: section.entries.map((entry) => entry.id === entryId ? { ...entry, ...patch } : entry),
        }
        : section),
    } : current);
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
    successMessage: string;
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
      setMessage({ text: input.successMessage, type: 'success' });
      await loadContributions();
    } catch (error) {
      console.error('Contribution update failed:', error);
      setMessage({
        text: error instanceof Error ? error.message : 'Contribution update failed',
        type: 'error',
      });
    } finally {
      setSavingAction(null);
    }
  }

  async function createSection() {
    const title = newSectionTitle.trim();
    if (!title) return;

    await requestContributions({
      actionKey: 'create-section',
      body: { title, type: 'section' },
      method: 'POST',
      successMessage: 'Section created.',
    });
    setNewSectionTitle('');
  }

  async function saveSection(section: ContributionSection) {
    await requestContributions({
      actionKey: `section:${section.id}`,
      body: { id: section.id, title: section.title, type: 'section' },
      method: 'PATCH',
      successMessage: 'Section saved.',
    });
  }

  async function deleteSection(section: ContributionSection) {
    if (!window.confirm(`Delete ${section.title}?`)) return;

    await requestContributions({
      actionKey: `delete-section:${section.id}`,
      body: { id: section.id, type: 'section' },
      method: 'DELETE',
      successMessage: 'Section deleted.',
    });
  }

  async function createEntry(section: ContributionSection) {
    const draft = newEntryDrafts[section.id] || emptyNewEntry;
    if (!draft.contributorName.trim() || !draft.amount.trim()) return;

    await requestContributions({
      actionKey: `create-entry:${section.id}`,
      body: {
        amount: draft.amount,
        contributorName: draft.contributorName,
        note: draft.note,
        sectionId: section.id,
        type: 'entry',
      },
      method: 'POST',
      successMessage: 'Entry added.',
    });
    setNewEntryDrafts((current) => ({ ...current, [section.id]: emptyNewEntry }));
  }

  async function saveEntry(entry: ContributionEntry) {
    await requestContributions({
      actionKey: `entry:${entry.id}`,
      body: {
        amount: entry.amount,
        contributorName: entry.contributorName,
        id: entry.id,
        note: entry.note,
        type: 'entry',
      },
      method: 'PATCH',
      successMessage: 'Entry saved.',
    });
  }

  async function deleteEntry(entry: ContributionEntry) {
    if (!window.confirm(`Delete ${entry.contributorName}?`)) return;

    await requestContributions({
      actionKey: `delete-entry:${entry.id}`,
      body: { id: entry.id, type: 'entry' },
      method: 'DELETE',
      successMessage: 'Entry deleted.',
    });
  }

  async function exportContributions() {
    setSavingAction('export');
    setMessage(null);

    try {
      const response = await fetch('/api/export/contributions', { cache: 'no-store' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Export failed (${response.status})`);
      }
      await downloadBlob(response, 'Contributions.xlsx');
      setMessage({ text: 'Export downloaded.', type: 'success' });
    } catch (error) {
      console.error('Contribution export failed:', error);
      setMessage({
        text: error instanceof Error ? error.message : 'Could not download export',
        type: 'error',
      });
    } finally {
      setSavingAction(null);
    }
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

          <div className="grid gap-3 border-b border-border p-4 lg:grid-cols-[minmax(220px,1fr)_minmax(280px,28rem)_auto] lg:items-center">
            <div className="flex min-w-0 gap-2">
              <Input
                aria-label="New contribution section"
                value={newSectionTitle}
                onChange={(event) => setNewSectionTitle(event.target.value)}
                placeholder="Section title"
              />
              <Button
                type="button"
                className="shrink-0 gap-2"
                disabled={savingAction === 'create-section' || !newSectionTitle.trim()}
                onClick={createSection}
              >
                {savingAction === 'create-section' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Create section
              </Button>
            </div>

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

            <div className="flex gap-2 lg:justify-end">
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
              <Button
                type="button"
                className="gap-2"
                disabled={savingAction === 'export' || loading}
                onClick={exportContributions}
              >
                {savingAction === 'export' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Export
              </Button>
            </div>
          </div>
        </Card>

        {loading ? (
          <LoadingBuffer variant="section" label="Loading contributions" description="Reading contribution records." />
        ) : (
          <div className="space-y-4">
            {visibleSections.map((section) => {
              const draft = newEntryDrafts[section.id] || emptyNewEntry;

              return (
                <Card key={section.id} className="overflow-hidden">
                  <div className="grid gap-3 border-b border-border p-4 lg:grid-cols-[minmax(260px,1fr)_auto_auto] lg:items-center">
                    <Input
                      aria-label={`${section.title} title`}
                      className="font-semibold"
                      value={section.title}
                      onChange={(event) => updateSectionTitle(section.id, event.target.value)}
                    />
                    <div className="rounded-md border border-border bg-background px-3 py-2 text-sm">
                      <span className="text-muted-foreground">Total</span>
                      <span className="ml-2 font-mono font-semibold">{money(section.totalAmount)}</span>
                    </div>
                    <div className="flex gap-2 lg:justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        disabled={savingAction === `section:${section.id}` || !section.title.trim()}
                        onClick={() => saveSection(section)}
                      >
                        {savingAction === `section:${section.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Save
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-2 text-danger hover:text-danger"
                        disabled={savingAction === `delete-section:${section.id}`}
                        onClick={() => deleteSection(section)}
                      >
                        {savingAction === `delete-section:${section.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        Delete
                      </Button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[860px] text-sm">
                      <thead className="border-b border-border bg-muted/20 text-left text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="w-16 px-4 py-3 font-medium">No.</th>
                          <th className="px-4 py-3 font-medium">Name</th>
                          <th className="w-40 px-4 py-3 font-medium">Amount</th>
                          <th className="px-4 py-3 font-medium">Note</th>
                          <th className="w-48 px-4 py-3 text-right font-medium">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {section.entries.map((entry, index) => (
                          <tr key={entry.id} className="border-b border-border">
                            <td className="px-4 py-3 text-muted-foreground">{index + 1}</td>
                            <td className="px-4 py-3">
                              <Input
                                aria-label="Contributor name"
                                value={entry.contributorName}
                                onChange={(event) => updateEntry(section.id, entry.id, { contributorName: event.target.value })}
                              />
                            </td>
                            <td className="px-4 py-3">
                              <Input
                                aria-label="Contribution amount"
                                inputMode="decimal"
                                value={entry.amount}
                                onChange={(event) => updateEntry(section.id, entry.id, { amount: normalizeMoneyInput(event.target.value) })}
                              />
                            </td>
                            <td className="px-4 py-3">
                              <Input
                                aria-label="Contribution note"
                                value={entry.note || ''}
                                onChange={(event) => updateEntry(section.id, entry.id, { note: event.target.value })}
                                placeholder="Note"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex justify-end gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="gap-2"
                                  disabled={savingAction === `entry:${entry.id}` || !entry.contributorName.trim() || !entry.amount.trim()}
                                  onClick={() => saveEntry(entry)}
                                >
                                  {savingAction === `entry:${entry.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                  Save
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon"
                                  title="Delete"
                                  aria-label={`Delete ${entry.contributorName}`}
                                  className="h-9 w-9 text-danger hover:text-danger"
                                  disabled={savingAction === `delete-entry:${entry.id}`}
                                  onClick={() => deleteEntry(entry)}
                                >
                                  {savingAction === `delete-entry:${entry.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}

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

                        {section.entries.length === 0 && (
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
