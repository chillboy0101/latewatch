'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  ChevronLeft,
  ChevronRight,
  Search,
  SlidersHorizontal,
  RotateCcw,
  User,
  FileText,
  Calendar,
  Download,
  Edit3,
  Trash2,
  Plus,
  Clock,
} from 'lucide-react';
import { format } from 'date-fns';

interface AuditEvent {
  id: string;
  entityType: string;
  entityId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'EXPORT';
  beforeJson: any;
  afterJson: any;
  actorUserId: string | null;
  actorEmail: string;
  timestamp: Date | null;
}

interface Pagination {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
}

const ENTITY_FILTERS = [
  { value: 'all', label: 'All Types', icon: null },
  { value: 'staff', label: 'Staff', icon: User },
  { value: 'entry', label: 'Entries', icon: FileText },
  { value: 'calendar', label: 'Holidays', icon: Calendar },
  { value: 'export', label: 'Exports', icon: Download },
] as const;

const ACTION_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'CREATE', label: 'Created', color: 'bg-success/10 text-success border-success/20' },
  { value: 'UPDATE', label: 'Updated', color: 'bg-primary/10 text-primary border-primary/20' },
  { value: 'DELETE', label: 'Deleted', color: 'bg-danger/10 text-danger border-danger/20' },
  { value: 'EXPORT', label: 'Exported', color: 'bg-warning/10 text-warning border-warning/20' },
] as const;

export default function AuditTrailPage() {
  const [logs, setLogs] = useState<AuditEvent[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    entityType: 'all',
    action: 'all',
    actorEmail: '',
    startDate: '',
    endDate: '',
  });
  const [showFilters, setShowFilters] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setShowFilters(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchAuditTrail = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: '20',
      });

      if (filters.entityType !== 'all') params.set('entityType', filters.entityType);
      if (filters.action !== 'all') params.set('action', filters.action);
      if (filters.actorEmail) params.set('actorEmail', filters.actorEmail);
      if (filters.startDate) params.set('startDate', filters.startDate);
      if (filters.endDate) params.set('endDate', filters.endDate);

      const response = await fetch(`/api/audit-trail?${params}`);
      const data = await response.json();

      setLogs(data.data || []);
      setPagination(data.pagination);
    } catch (error) {
      console.error('Failed to fetch audit trail:', error);
    } finally {
      setLoading(false);
    }
  }, [currentPage, filters]);

  useEffect(() => {
    fetchAuditTrail();
  }, [fetchAuditTrail]);

  function clearFilters() {
    setFilters({
      entityType: 'all',
      action: 'all',
      actorEmail: '',
      startDate: '',
      endDate: '',
    });
    setCurrentPage(1);
  }

  function getActionIcon(action: string) {
    switch (action) {
      case 'CREATE': return <Plus className="h-3.5 w-3.5" />;
      case 'UPDATE': return <Edit3 className="h-3.5 w-3.5" />;
      case 'DELETE': return <Trash2 className="h-3.5 w-3.5" />;
      case 'EXPORT': return <Download className="h-3.5 w-3.5" />;
      default: return <FileText className="h-3.5 w-3.5" />;
    }
  }

  function getActionColor(action: string) {
    switch (action) {
      case 'CREATE': return 'bg-success/10 text-success border border-success/20';
      case 'UPDATE': return 'bg-primary/10 text-primary border border-primary/20';
      case 'DELETE': return 'bg-danger/10 text-danger border border-danger/20';
      case 'EXPORT': return 'bg-warning/10 text-warning border border-warning/20';
      default: return 'bg-muted/10 text-muted-foreground border border-border';
    }
  }

  function getEntityIcon(entityType: string) {
    switch (entityType) {
      case 'staff': return <User className="h-3 w-3" />;
      case 'entry': return <FileText className="h-3 w-3" />;
      case 'calendar': return <Calendar className="h-3 w-3" />;
      case 'export': return <Download className="h-3 w-3" />;
      default: return <FileText className="h-3 w-3" />;
    }
  }

  function getEntityLabel(entityType: string) {
    switch (entityType) {
      case 'staff': return 'Staff';
      case 'entry': return 'Entry';
      case 'calendar': return 'Calendar';
      case 'export': return 'Export';
      default: return entityType;
    }
  }

  function getDetails(event: AuditEvent) {
    const afterData = event.afterJson && typeof event.afterJson === 'object' ? event.afterJson : null;
    const beforeData = event.beforeJson && typeof event.beforeJson === 'object' ? event.beforeJson : null;

    if (event.action === 'CREATE') {
      if (event.entityType === 'staff') {
        return `Added "${afterData?.fullName || 'staff member'}"`;
      }
      if (event.entityType === 'entry') {
        const name = afterData?.staff?.fullName;
        const amount = afterData?.computedAmount;
        return name
          ? `Entry for ${name}${amount && parseFloat(amount) > 0 ? ` — GHC ${amount}` : ''}`
          : `New entry created`;
      }
      if (event.entityType === 'calendar') {
        return `Holiday: "${afterData?.holidayNote || 'Unknown'}" on ${afterData?.date || 'date'}`;
      }
      return `Created new ${getEntityLabel(event.entityType).toLowerCase()}`;
    }

    if (event.action === 'UPDATE') {
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
      if (event.entityType === 'calendar') {
        return `Calendar entry for ${afterData?.date || 'date'} updated`;
      }
      return `${getEntityLabel(event.entityType).toLowerCase()} modified`;
    }

    if (event.action === 'DELETE') {
      if (event.entityType === 'staff') {
        return `Removed "${beforeData?.fullName || 'staff member'}"`;
      }
      if (event.entityType === 'entry') {
        const name = beforeData?.staff?.fullName;
        return name ? `Deleted entry for ${name}` : 'Entry deleted';
      }
      return `Deleted ${getEntityLabel(event.entityType).toLowerCase()}`;
    }

    if (event.action === 'EXPORT') {
      if (afterData?.weekStart) {
        return `Weekly export (${afterData.weekStart} to ${afterData.weekEnd || '?'})`;
      }
      return 'Monthly export generated';
    }

    return '';
  }

  const hasActiveFilters = filters.entityType !== 'all' || filters.action !== 'all' || filters.actorEmail || filters.startDate || filters.endDate;
  const activeFilterCount = [filters.entityType !== 'all', filters.action !== 'all', !!filters.actorEmail, !!filters.startDate, !!filters.endDate].filter(Boolean).length;
  const dropdownFilterCount = [filters.entityType !== 'all', filters.action !== 'all'].filter(Boolean).length;

  return (
    <DashboardLayout title="Audit Trail">
      <div className="space-y-4">
        {/* Search & Date Row - always visible */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by email..."
              value={filters.actorEmail}
              onChange={(e) => { setFilters({ ...filters, actorEmail: e.target.value }); setCurrentPage(1); }}
              className="h-9 pl-9"
            />
          </div>
          {/* Date range */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0">From</span>
            <Input
              type="date"
              value={filters.startDate}
              onChange={(e) => { setFilters({ ...filters, startDate: e.target.value }); setCurrentPage(1); }}
              className="h-9 w-[160px] pr-8"
            />
            <span className="text-xs text-muted-foreground shrink-0">To</span>
            <Input
              type="date"
              value={filters.endDate}
              onChange={(e) => { setFilters({ ...filters, endDate: e.target.value }); setCurrentPage(1); }}
              className="h-9 w-[160px] pr-8"
            />
          </div>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" className="h-9 gap-2" onClick={clearFilters}>
              <RotateCcw className="h-4 w-4" />
              Clear
            </Button>
          )}

          {/* Filter dropdown for entity type & action */}
          <div className="relative" ref={filterRef}>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-2"
              onClick={() => setShowFilters(!showFilters)}
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filters
              {dropdownFilterCount > 0 && (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                  {dropdownFilterCount}
                </span>
              )}
            </Button>

            {showFilters && (
              <div className="absolute right-0 z-50 mt-2 w-72 rounded-lg border border-border bg-background shadow-lg">
                <div className="p-4 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-2">Entity Type</label>
                    <div className="flex flex-wrap gap-1.5">
                      {ENTITY_FILTERS.map((f) => {
                        const Icon = f.icon;
                        const isActive = filters.entityType === f.value;
                        return (
                          <button
                            key={f.value}
                            onClick={() => { setFilters({ ...filters, entityType: f.value }); setCurrentPage(1); }}
                            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all border ${
                              isActive
                                ? 'bg-primary/10 text-primary border-primary/30'
                                : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground'
                            }`}
                          >
                            {Icon && <Icon className="h-3 w-3" />}
                            {f.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-2">Action</label>
                    <div className="flex flex-wrap gap-1.5">
                      {ACTION_FILTERS.map((f) => {
                        const isActive = filters.action === f.value;
                        return (
                          <button
                            key={f.value}
                            onClick={() => { setFilters({ ...filters, action: f.value }); setCurrentPage(1); }}
                            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all border ${
                              isActive && f.value !== 'all'
                                ? f.color
                                : isActive
                                ? 'bg-primary/10 text-primary border-primary/30'
                                : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground'
                            }`}
                          >
                            {f.value !== 'all' && getActionIcon(f.value)}
                            {f.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Audit Trail Table */}
        <Card>
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-muted-foreground">
                {pagination ? `${pagination.totalCount} event${pagination.totalCount !== 1 ? 's' : ''} found` : 'Loading...'}
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-border bg-card">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">When</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">User</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Action</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Entity</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-muted-foreground">
                        <div className="flex items-center justify-center gap-2">
                          <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                          Loading audit trail...
                        </div>
                      </td>
                    </tr>
                  ) : logs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-muted-foreground">
                        {hasActiveFilters ? 'No events match your filters' : 'No audit events found'}
                      </td>
                    </tr>
                  ) : (
                    logs.map((log) => (
                      <tr key={log.id} className="hover:bg-card/50 transition-colors">
                        <td className="px-4 py-3 text-sm whitespace-nowrap">
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {log.timestamp ? format(new Date(log.timestamp), 'MMM d, yyyy h:mm a') : '—'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className="font-medium">{log.actorEmail || 'Unknown'}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${getActionColor(log.action)}`}>
                            {getActionIcon(log.action)}
                            {log.action.charAt(0) + log.action.slice(1).toLowerCase()}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/50 px-2.5 py-1 text-xs font-medium border border-border">
                            {getEntityIcon(log.entityType)}
                            {getEntityLabel(log.entityType)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground max-w-xs truncate">
                          {getDetails(log)}
                        </td>
                      </tr>
                    ))
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