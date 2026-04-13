'use client';

import { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  ChevronLeft,
  ChevronRight,
  Search,
  Filter,
  X,
  User,
  FileText,
  Calendar,
  Download,
  Edit3,
  Trash2,
  Plus,
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

export default function AuditTrailPage() {
  const [logs, setLogs] = useState<AuditEvent[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    totalCount: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    entityType: 'all',
    action: 'all',
    actorEmail: '',
    startDate: '',
    endDate: '',
  });
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    fetchAuditTrail();
  }, [pagination.page, filters]);

  async function fetchAuditTrail() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
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
  }

  function clearFilters() {
    setFilters({
      entityType: 'all',
      action: 'all',
      actorEmail: '',
      startDate: '',
      endDate: '',
    });
  }

  function getActionIcon(action: string) {
    switch (action) {
      case 'CREATE': return <Plus className="h-4 w-4" />;
      case 'UPDATE': return <Edit3 className="h-4 w-4" />;
      case 'DELETE': return <Trash2 className="h-4 w-4" />;
      case 'EXPORT': return <Download className="h-4 w-4" />;
      default: return <FileText className="h-4 w-4" />;
    }
  }

  function getActionColor(action: string) {
    switch (action) {
      case 'CREATE': return 'bg-success/10 text-success';
      case 'UPDATE': return 'bg-primary/10 text-primary';
      case 'DELETE': return 'bg-danger/10 text-danger';
      case 'EXPORT': return 'bg-warning/10 text-warning';
      default: return 'bg-muted/10 text-muted-foreground';
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

  function getActionLabel(action: string) {
    return action.charAt(0) + action.slice(1).toLowerCase();
  }

  function getDetails(event: AuditEvent) {
    if (event.action === 'CREATE') {
      return `Created new ${getEntityLabel(event.entityType).toLowerCase()}`;
    }
    if (event.action === 'UPDATE') {
      return `Updated ${getEntityLabel(event.entityType).toLowerCase()}`;
    }
    if (event.action === 'DELETE') {
      return `Deleted ${getEntityLabel(event.entityType).toLowerCase()}`;
    }
    if (event.action === 'EXPORT') {
      const afterData = event.afterJson as any;
      return afterData?.weekStart ? `Exported week of ${afterData.weekStart}` : 'Generated export';
    }
    return '';
  }

  const hasActiveFilters = filters.entityType !== 'all' || filters.action !== 'all' || filters.actorEmail || filters.startDate || filters.endDate;

  return (
    <DashboardLayout title="Audit Trail">
      <div className="space-y-4">
        {/* Filters */}
        <Card>
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Filters</span>
                {hasActiveFilters && (
                  <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={clearFilters}>
                    <X className="h-3 w-3 mr-1" />
                    Clear
                  </Button>
                )}
              </div>
              <Button variant="ghost" size="sm" className="h-8" onClick={() => setShowFilters(!showFilters)}>
                {showFilters ? 'Hide' : 'Show'}
              </Button>
            </div>

            {showFilters && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                {/* Entity Type Filter */}
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Entity Type</label>
                  <select
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    value={filters.entityType}
                    onChange={(e) => setFilters({ ...filters, entityType: e.target.value })}
                  >
                    <option value="all">All Types</option>
                    <option value="staff">Staff</option>
                    <option value="entry">Entries</option>
                    <option value="calendar">Calendar</option>
                    <option value="export">Exports</option>
                  </select>
                </div>

                {/* Action Filter */}
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Action</label>
                  <select
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    value={filters.action}
                    onChange={(e) => setFilters({ ...filters, action: e.target.value })}
                  >
                    <option value="all">All Actions</option>
                    <option value="CREATE">Create</option>
                    <option value="UPDATE">Update</option>
                    <option value="DELETE">Delete</option>
                    <option value="EXPORT">Export</option>
                  </select>
                </div>

                {/* User Filter */}
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">User Email</label>
                  <Input
                    placeholder="Search user..."
                    value={filters.actorEmail}
                    onChange={(e) => setFilters({ ...filters, actorEmail: e.target.value })}
                    className="h-9 text-sm"
                  />
                </div>

                {/* Start Date Filter */}
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">From Date</label>
                  <Input
                    type="date"
                    value={filters.startDate}
                    onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                    className="h-9 text-sm"
                  />
                </div>

                {/* End Date Filter */}
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">To Date</label>
                  <Input
                    type="date"
                    value={filters.endDate}
                    onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                    className="h-9 text-sm"
                  />
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Audit Trail Table */}
        <Card>
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-muted-foreground">
                Showing {logs.length} of {pagination.totalCount} events
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-border bg-card">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Timestamp</th>
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
                        {hasActiveFilters ? 'No audit events match your filters' : 'No audit events found'}
                      </td>
                    </tr>
                  ) : (
                    logs.map((log) => (
                      <tr key={log.id} className="hover:bg-card/50 transition-colors">
                        <td className="px-4 py-3 text-sm whitespace-nowrap">
                          {log.timestamp ? format(new Date(log.timestamp), 'MMM d, yyyy h:mm a') : '—'}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className="font-medium">{log.actorEmail || 'Unknown'}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${getActionColor(log.action)}`}>
                            {getActionIcon(log.action)}
                            {getActionLabel(log.action)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/50 px-2.5 py-1 text-xs font-medium">
                            {getEntityIcon(log.entityType)}
                            {getEntityLabel(log.entityType)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {getDetails(log)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
                <p className="text-sm text-muted-foreground">
                  Page {pagination.page} of {pagination.totalPages}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPagination({ ...pagination, page: pagination.page - 1 })}
                    disabled={pagination.page === 1}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPagination({ ...pagination, page: pagination.page + 1 })}
                    disabled={pagination.page >= pagination.totalPages}
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
