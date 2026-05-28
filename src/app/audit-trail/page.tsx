'use client';

import { Fragment, useState, useEffect, useCallback } from 'react';
import { useUser } from '@clerk/nextjs';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LoadingBuffer } from '@/components/ui/loading-buffer';
import {
  ChevronLeft,
  ChevronRight,
  Search,
  User,
  FileText,
  Calendar,
  Download,
  Edit3,
  Trash2,
  Plus,
  Bell,
  ChevronDown,
  ChevronUp,
  PhoneCall,
  RefreshCw,
  Shield,
  UserCheck,
  UserX,
  Archive,
  Eye,
  RotateCcw,
} from 'lucide-react';
import {
  getAuditActionLabel,
  getAuditEntityLabel,
  getAuditOperation,
} from '@/lib/audit-taxonomy';
import { DateField } from '@/components/ui/date-field';
import { formatDisplayDate, formatDisplayDateTime, isIsoDateKey } from '@/lib/date-format';
import { subscribeRealtimeChannel } from '@/lib/realtime-client';
import {
  getAuditFieldChanges,
  getAuditRecordedValues,
  getAuditSummary,
  getAuditTargetName,
} from '@/lib/audit-display';

interface AuditEvent {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  beforeJson: AuditPayload | null;
  afterJson: AuditPayload | null;
  actorUserId: string | null;
  actorEmail: string;
  timestamp: Date | null;
}

type AuditPayload = Record<string, unknown> & {
  active?: boolean;
  archived?: boolean;
  allowedIp?: string;
  checkInTime?: string;
  computedAmount?: number | string;
  contactName?: string;
  date?: string;
  department?: string | null;
  fullName?: string;
  holidayNote?: string;
  phone?: string;
  permissionType?: string;
  priority?: string;
  relationship?: string;
  result?: string;
  staff?: { fullName?: string };
  staffName?: string;
  unit?: string | null;
  userEmail?: string;
  weekEnd?: string;
  weekStart?: string;
};

interface Pagination {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
}

export default function AuditTrailPage() {
  const { user } = useUser();
  const [logs, setLogs] = useState<AuditEvent[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    query: '',
  });
  const [dateInputs, setDateInputs] = useState({
    startDate: '',
    endDate: '',
  });
  const appliedStartDate = isIsoDateKey(dateInputs.startDate) ? dateInputs.startDate : '';
  const appliedEndDate = isIsoDateKey(dateInputs.endDate) ? dateInputs.endDate : '';
  const currentUserEmail = user?.primaryEmailAddress?.emailAddress || user?.emailAddresses[0]?.emailAddress || '';

  const getActorDisplayName = useCallback((actorEmail: string | null | undefined) => {
    if (actorEmail && user?.id && actorEmail === user.id && currentUserEmail) {
      return currentUserEmail;
    }

    return actorEmail || 'Unknown';
  }, [currentUserEmail, user?.id]);

  const fetchAuditTrail = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) {
      setLoading(true);
      setError(null);
    }

    try {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: '20',
      });

      if (filters.query) params.set('q', filters.query);
      if (appliedStartDate) params.set('startDate', appliedStartDate);
      if (appliedEndDate) params.set('endDate', appliedEndDate);

      const response = await fetch(`/api/audit-trail?${params}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Audit request failed: ${response.status}`);
      }

      const data = await response.json();

      setLogs(data.data || []);
      setPagination(data.pagination);
    } catch (error) {
      console.error('Failed to fetch audit trail:', error);
      if (!silent) {
        setError('Could not load the audit trail. Please try again.');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [appliedEndDate, appliedStartDate, currentPage, filters]);

  useEffect(() => {
    fetchAuditTrail();
  }, [fetchAuditTrail]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let mounted = true;

    (async () => {
      const unsubscribe = await subscribeRealtimeChannel({
        channel: 'audit-trail',
        events: ['invalidate'],
        onEvent: () => fetchAuditTrail({ silent: true }),
      });

      if (mounted) {
        cleanup = unsubscribe;
      } else {
        unsubscribe();
      }
    })();

    return () => {
      mounted = false;
      cleanup?.();
    };
  }, [fetchAuditTrail]);

  function getActionIcon(action: string) {
    switch (action) {
      case 'CREATE': return <Plus className="h-3.5 w-3.5" />;
      case 'UPDATE': return <Edit3 className="h-3.5 w-3.5" />;
      case 'DELETE': return <Trash2 className="h-3.5 w-3.5" />;
      case 'GENERATE': return <Download className="h-3.5 w-3.5" />;
      case 'EXPORT': return <Download className="h-3.5 w-3.5" />;
      case 'PREVIEW': return <Eye className="h-3.5 w-3.5" />;
      case 'SYNC': return <RefreshCw className="h-3.5 w-3.5" />;
      case 'ACTIVATE': return <UserCheck className="h-3.5 w-3.5" />;
      case 'DEACTIVATE': return <UserX className="h-3.5 w-3.5" />;
      case 'ARCHIVE': return <Archive className="h-3.5 w-3.5" />;
      case 'RESTORE': return <RotateCcw className="h-3.5 w-3.5" />;
      case 'DISMISS': return <Bell className="h-3.5 w-3.5" />;
      case 'ALERT': return <Bell className="h-3.5 w-3.5" />;
      default: return <FileText className="h-3.5 w-3.5" />;
    }
  }

  function getActionColor(action: string) {
    switch (action) {
      case 'CREATE': return 'bg-success/10 text-success border border-success/20';
      case 'UPDATE': return 'bg-primary/10 text-primary border border-primary/20';
      case 'DELETE': return 'bg-danger/10 text-danger border border-danger/20';
      case 'GENERATE': return 'bg-success/10 text-success border border-success/20';
      case 'EXPORT': return 'bg-warning/10 text-warning border border-warning/20';
      case 'PREVIEW': return 'bg-primary/10 text-primary border border-primary/20';
      case 'SYNC': return 'bg-primary/10 text-primary border border-primary/20';
      case 'ACTIVATE': return 'bg-success/10 text-success border border-success/20';
      case 'DEACTIVATE': return 'bg-warning/10 text-warning border border-warning/20';
      case 'ARCHIVE': return 'bg-muted/10 text-muted-foreground border border-border';
      case 'RESTORE': return 'bg-success/10 text-success border border-success/20';
      case 'DISMISS': return 'bg-muted/10 text-muted-foreground border border-border';
      case 'ALERT': return 'bg-danger/10 text-danger border border-danger/20';
      default: return 'bg-muted/10 text-muted-foreground border border-border';
    }
  }

  function getEntityIcon(entityType: string) {
    switch (entityType) {
      case 'staff': return <User className="h-3 w-3" />;
      case 'attendance': return <UserCheck className="h-3 w-3" />;
      case 'attendance_attempt': return <Bell className="h-3 w-3" />;
      case 'attendance_permission': return <Shield className="h-3 w-3" />;
      case 'emergency_contact': return <PhoneCall className="h-3 w-3" />;
      case 'entry': return <FileText className="h-3 w-3" />;
      case 'entry_submission': return <FileText className="h-3 w-3" />;
      case 'calendar': return <Calendar className="h-3 w-3" />;
      case 'export': return <Download className="h-3 w-3" />;
      case 'notification': return <Bell className="h-3 w-3" />;
      case 'office_network': return <Shield className="h-3 w-3" />;
      case 'system': return <Shield className="h-3 w-3" />;
      default: return <FileText className="h-3 w-3" />;
    }
  }

function getEntityLabel(entityType: string) {
  return getAuditEntityLabel(entityType);
}

function displayAuditDate(value: unknown, fallback = 'date') {
  return typeof value === 'string' ? formatDisplayDate(value, fallback) : fallback;
}

  function getDetails(event: AuditEvent) {
    const afterData = event.afterJson && typeof event.afterJson === 'object' ? event.afterJson : null;
    const beforeData = event.beforeJson && typeof event.beforeJson === 'object' ? event.beforeJson : null;
    const operation = getAuditOperation(event.action, event.entityType, beforeData, afterData);

    if (operation === 'CREATE') {
      if (event.entityType === 'staff') {
        return `Added "${afterData?.fullName || 'staff member'}"`;
      }
      if (event.entityType === 'entry') {
        const name = afterData?.staff?.fullName;
        const amount = afterData?.computedAmount;
        const amountValue = amount === undefined ? 0 : parseFloat(String(amount));
        return name
          ? `Entry for ${name}${amountValue > 0 ? ` - GHC ${amount}` : ''}`
          : `New entry created`;
      }
      if (event.entityType === 'entry_submission') {
        const count = Number(afterData?.entryCount || 0);
        return `Entries submitted for ${displayAuditDate(afterData?.date)} (${count} late record${count === 1 ? '' : 's'})`;
      }
      if (event.entityType === 'attendance') {
        const name = afterData?.staff?.fullName || 'Staff member';
        return `${name} checked in at ${afterData?.checkInTime || 'the recorded time'}`;
      }
      if (event.entityType === 'attendance_permission') {
        const name = afterData?.staffName || 'Staff member';
        return `${name} approved for ${afterData?.permissionType === 'absence' ? 'excused absence' : 'late arrival'} on ${displayAuditDate(afterData?.date)}`;
      }
      if (event.entityType === 'emergency_contact') {
        const name = afterData?.contactName || 'Emergency contact';
        const staffName = afterData?.staffName;
        return staffName ? `${name} linked to ${staffName}` : `${name} saved`;
      }
      if (event.entityType === 'calendar') {
        return `Holiday: "${afterData?.holidayNote || 'Unknown'}" on ${displayAuditDate(afterData?.date)}`;
      }
      return `Created new ${getEntityLabel(event.entityType).toLowerCase()}`;
    }

    if (operation === 'ACTIVATE' || operation === 'DEACTIVATE') {
      const name = afterData?.fullName || beforeData?.fullName || 'staff member';
      return `${name} ${operation === 'ACTIVATE' ? 'activated' : 'deactivated'}`;
    }

    if (operation === 'UPDATE') {
      if (event.entityType === 'staff') {
        const name = afterData?.fullName || beforeData?.fullName || 'staff';
        const changes: string[] = [];
        if (beforeData && afterData) {
          if (beforeData.active !== afterData.active) changes.push(afterData.active ? 'activated' : 'deactivated');
          if (beforeData.fullName !== afterData.fullName) changes.push('renamed');
          if (beforeData.department !== afterData.department) changes.push('department changed');
          if (beforeData.unit !== afterData.unit) changes.push('unit changed');
        }
        return changes.length > 0
          ? `${name} — ${changes.join(', ')}`
          : `${name} updated`;
      }
      if (event.entityType === 'entry') {
        const name = afterData?.staff?.fullName || 'entry';
        return `Entry for ${name} modified`;
      }
      if (event.entityType === 'entry_submission') {
        const count = Number(afterData?.entryCount || 0);
        return `Entries updated for ${displayAuditDate(afterData?.date)} (${count} late record${count === 1 ? '' : 's'})`;
      }
      if (event.entityType === 'attendance_permission') {
        return `Permission updated for ${afterData?.staffName || beforeData?.staffName || 'staff member'}`;
      }
      if (event.entityType === 'emergency_contact') {
        return `${afterData?.contactName || beforeData?.contactName || 'Emergency contact'} updated`;
      }
      if (event.entityType === 'calendar') {
        return `Calendar entry for ${displayAuditDate(afterData?.date)} updated`;
      }
      if (event.entityType === 'office_network') {
        return `Office network updated${afterData?.allowedIp ? ` for ${afterData.allowedIp}` : ''}`;
      }
      return `${getEntityLabel(event.entityType).toLowerCase()} modified`;
    }

    if (operation === 'ALERT' && event.entityType === 'attendance_attempt') {
      return `Blocked check-in attempt: ${afterData?.result || 'review required'}`;
    }

    if (operation === 'DELETE') {
      if (event.entityType === 'staff') {
        return `Removed "${beforeData?.fullName || 'staff member'}"`;
      }
      if (event.entityType === 'entry') {
        const name = beforeData?.staff?.fullName;
        return name ? `Deleted entry for ${name}` : 'Entry deleted';
      }
      if (event.entityType === 'emergency_contact') {
        return `Removed ${beforeData?.contactName || afterData?.contactName || 'emergency contact'}`;
      }
      if (event.entityType === 'attendance_permission') {
        return `Removed permission for ${beforeData?.staffName || afterData?.staffName || 'staff member'}`;
      }
      return `Deleted ${getEntityLabel(event.entityType).toLowerCase()}`;
    }

    if (operation === 'GENERATE') {
      if (afterData?.weekStart) {
        return `Weekly export (${displayAuditDate(afterData.weekStart)} to ${displayAuditDate(afterData.weekEnd, '?')})`;
      }
      return 'Monthly export generated';
    }

    if (operation === 'PREVIEW') {
      const fileName = typeof afterData?.fileName === 'string' ? afterData.fileName : 'export workbook';
      return `Previewed ${fileName}`;
    }

    if (operation === 'SYNC') {
      const added = Number(afterData?.totalAdded || 0);
      const updated = Number(afterData?.totalUpdated || 0);
      const skipped = Number(afterData?.totalSkipped || 0);
      return `Holiday sync: ${added} added, ${updated} updated, ${skipped} skipped`;
    }

    if (event.entityType === 'notification') {
      const count = Number(afterData?.count || 0);
      return count > 0 ? `${count} notification${count === 1 ? '' : 's'} updated` : 'Notification state changed';
    }

    return '';
  }

  const hasActiveFilters = filters.query || appliedStartDate || appliedEndDate;

  return (
    <DashboardLayout title="Audit Trail">
      <div className="space-y-4">
        <Card>
          <div className="p-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(280px,1fr)_180px_180px] lg:items-end">
              <div>
                <label className="mb-2 block text-xs font-medium uppercase text-muted-foreground">Search</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search user, entity, action, ID"
                    value={filters.query}
                    onChange={(e) => { setFilters({ ...filters, query: e.target.value }); setCurrentPage(1); }}
                    className="h-10 pl-10"
                  />
                </div>
              </div>

              <DateFilter
                label="From"
                value={dateInputs.startDate}
                onChange={(value) => {
                  setDateInputs((current) => ({ ...current, startDate: value }));
                  setCurrentPage(1);
                }}
              />

              <DateFilter
                label="To"
                value={dateInputs.endDate}
                onChange={(value) => {
                  setDateInputs((current) => ({ ...current, endDate: value }));
                  setCurrentPage(1);
                }}
              />

            </div>
          </div>
        </Card>

        {/* Audit Trail Table */}
        <Card>
          <div className="p-4">
            {error && (
              <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {error}
              </div>
            )}

            <div className="overflow-hidden">
              <table className="w-full table-fixed">
                <thead className="border-b border-border bg-card">
                  <tr>
                    <th className="w-36 px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">When</th>
                    <th className="w-44 px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">User</th>
                    <th className="w-32 px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Action</th>
                    <th className="w-36 px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Entity</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Details</th>
                    <th className="w-10 px-2 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wide"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6">
                        <LoadingBuffer
                          variant="inline"
                          label="Loading audit trail"
                          description="Retrieving the latest system activity."
                        />
                      </td>
                    </tr>
                  ) : logs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-muted-foreground">
                        {hasActiveFilters ? 'No matching audit activity' : 'No audit activity yet'}
                      </td>
                    </tr>
                  ) : (
                    logs.map((log) => {
                      const isExpanded = expandedLogId === log.id;
                      const changedFields = getAuditFieldChanges(log);
                      const recordedValues = getAuditRecordedValues(log);
                      const operation = getAuditOperation(log.action, log.entityType, log.beforeJson, log.afterJson);
                      const targetName = getAuditTargetName(log);
                      const summary = getAuditSummary(log) || getDetails(log);
                      const actorDisplayName = getActorDisplayName(log.actorEmail);

                      return (
                        <Fragment key={log.id}>
                      <tr className="hover:bg-card/50 transition-colors">
                        <td className="px-3 py-3 text-sm">
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            {log.timestamp ? formatDisplayDateTime(log.timestamp) : '—'}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-sm">
                          <span className="break-words font-medium">{actorDisplayName}</span>
                        </td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${getActionColor(operation)}`}>
                            {getActionIcon(operation)}
                            {getAuditActionLabel(operation)}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/50 px-2.5 py-1 text-xs font-medium border border-border">
                            {getEntityIcon(log.entityType)}
                            {getEntityLabel(log.entityType)}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-sm text-muted-foreground">
                          <div className="break-words">{summary || 'No summary available'}</div>
                          <div className="mt-1 break-all font-mono text-[11px] text-muted-foreground/70">
                            {log.entityId}
                          </div>
                        </td>
                        <td className="px-2 py-3 text-right">
                          <button
                            type="button"
                            title={isExpanded ? 'Hide audit details' : 'Show audit details'}
                            onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-accent transition-colors"
                          >
                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-muted/10">
                          <td colSpan={6} className="px-4 py-4">
                            <div className="space-y-4">
                              <div className="grid gap-3 md:grid-cols-4">
                                <AuditFact label="Actor" value={actorDisplayName} />
                                <AuditFact label="Action" value={getAuditActionLabel(operation)} />
                                <AuditFact label="Target" value={targetName} />
                                <AuditFact label="Result" value="Recorded" />
                              </div>

                              <div className="grid gap-3 text-sm lg:grid-cols-[1fr_1fr]">
                                <div className="rounded-md border border-border bg-background p-3">
                                  <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Audit identity</p>
                                  <div className="space-y-2">
                                    <KeyValue label="Event ID" value={log.id} mono />
                                    <KeyValue label="Entity ID" value={log.entityId} mono />
                                    <KeyValue label="Time" value={log.timestamp ? formatDisplayDateTime(log.timestamp) : '-'} />
                                    {log.actorUserId && <KeyValue label="Actor ID" value={log.actorUserId} mono />}
                                  </div>
                                </div>

                                <div className="rounded-md border border-border bg-background p-3">
                                  <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                                    {changedFields.length > 0 ? 'Changed fields' : 'Recorded values'}
                                  </p>
                                  {changedFields.length > 0 ? (
                                    <div className="overflow-hidden rounded-md border border-border">
                                      <table className="w-full table-fixed text-sm">
                                        <thead className="bg-card text-xs uppercase text-muted-foreground">
                                          <tr>
                                            <th className="px-3 py-2 text-left font-medium">Field</th>
                                            <th className="px-3 py-2 text-left font-medium">Previous</th>
                                            <th className="px-3 py-2 text-left font-medium">Current</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                          {changedFields.map((change) => (
                                            <tr key={change.field}>
                                              <td className="break-words px-3 py-2 font-medium">{change.label}</td>
                                              <td className="break-words px-3 py-2 text-muted-foreground">{change.before}</td>
                                              <td className="break-words px-3 py-2">{change.after}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  ) : recordedValues.length > 0 ? (
                                    <div className="grid gap-2 sm:grid-cols-2">
                                      {recordedValues.map((item) => (
                                        <KeyValue key={item.field} label={item.label} value={item.value} />
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-sm text-muted-foreground">No structured field details were recorded for this event.</p>
                                  )}
                                </div>
                              </div>

                            </div>
                          </td>
                        </tr>
                      )}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pagination && pagination.totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
                <p className="text-sm text-muted-foreground">
                  Page {currentPage} of {pagination.totalPages}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(currentPage - 1)}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(currentPage + 1)}
                    disabled={currentPage >= pagination.totalPages}
                  >
                    Next
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function AuditFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold" title={value}>{value}</p>
    </div>
  );
}

function DateFilter({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <DateField
      clearable
      label={label}
      value={value}
      onChange={onChange}
    />
  );
}

function KeyValue({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <p className={`mt-0.5 truncate text-sm ${mono ? 'font-mono text-xs' : ''}`} title={value}>
        {value}
      </p>
    </div>
  );
}
