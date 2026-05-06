'use client';

import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { LoadingBuffer } from '@/components/ui/loading-buffer';
import { Archive, Loader2, Pencil, Plus, RotateCcw, Search, ShieldCheck, Trash2, UserCheck, UserX } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { subscribeRealtimeChannel } from '@/lib/realtime-client';
import { getStaffIdentitySyncCopy, type StaffIdentitySyncTone } from '@/lib/staff-identity-sync-copy';

interface StaffMember {
  id: string;
  fullName: string;
  email: string | null;
  department: string | null;
  unit: string | null;
  active: boolean | null;
  archived: boolean | null;
  archivedAt?: string | null;
}

type StaffFilter = 'all' | 'active' | 'inactive' | 'former';

export default function StaffPage() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [staffFilter, setStaffFilter] = useState<StaffFilter>('all');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [identityActioningId, setIdentityActioningId] = useState<string | null>(null);
  const [identityNotice, setIdentityNotice] = useState<{ detail: string; title: string; tone: StaffIdentitySyncTone } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [submitMessage, setSubmitMessage] = useState('');
  const [archiveTarget, setArchiveTarget] = useState<StaffMember | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StaffMember | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleteRecords, setDeleteRecords] = useState(false);

  // Add form state
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newDepartment, setNewDepartment] = useState('');
  const [newUnit, setNewUnit] = useState('');

  // Edit form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editDepartment, setEditDepartment] = useState('');
  const [editUnit, setEditUnit] = useState('');

  const fetchStaff = useCallback(async () => {
    try {
      const response = await fetch('/api/staff', { cache: 'no-store' });
      const data = await response.json();
      const staffList = Array.isArray(data) ? data : (data?.data ? data.data : []);
      setStaff(staffList);
    } catch (error) {
      console.error('Failed to fetch staff:', error);
      setStaff([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let mounted = true;

    (async () => {
      const unsubscribe = await subscribeRealtimeChannel({
        channel: 'dashboard',
        events: ['invalidate'],
        onEvent: fetchStaff,
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
  }, [fetchStaff]);

  const handleAddStaff = async () => {
    if (!newName.trim()) return;
    setIsSubmitting(true);
    setSubmitMessage('');

    try {
      const response = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: newName.trim(),
          email: newEmail.trim() || null,
          department: newDepartment.trim() || null,
          unit: newUnit.trim() || null,
        }),
      });

      if (response.ok) {
        const saved = await response.json();
        setStaff((prev) => {
          const exists = prev.some((member) => member.id === saved.id);
          const next = exists
            ? prev.map((member) => (member.id === saved.id ? { ...member, ...saved } : member))
            : [...prev, saved];

          return next.sort((a, b) => a.fullName.localeCompare(b.fullName));
        });
        setNewName('');
        setNewEmail('');
        setNewDepartment('');
        setNewUnit('');
        setSubmitMessage('');
        setIsAddDialogOpen(false);
      } else {
        const error = await response.json();
        setSubmitMessage(error.error || 'Failed to add staff member');
      }
    } catch (error) {
      console.error('Failed to add staff:', error);
      setSubmitMessage('Failed to add staff member');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (id: string, currentActive: boolean) => {
    const previousStaff = staff;
    const nextActive = !currentActive;
    setActioningId(id);
    setStaff((prev) => prev.map((s) => (s.id === id ? { ...s, active: nextActive } : s)));

    try {
      const response = await fetch(`/api/staff/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: nextActive }),
      });

      if (response.ok) {
        const updated = await response.json();
        setStaff((prev) => prev.map((s) => (s.id === id ? { ...s, ...updated } : s)));
      } else {
        setStaff(previousStaff);
      }
    } catch (error) {
      console.error('Failed to update staff:', error);
      setStaff(previousStaff);
    } finally {
      setActioningId(null);
    }
  };

  const handleToggleArchived = async (member: StaffMember, archived: boolean) => {
    const previousStaff = staff;
    setActioningId(member.id);
    setStaff((prev) => prev.map((s) => (
      s.id === member.id
        ? { ...s, archived, active: archived ? false : true, archivedAt: archived ? new Date().toISOString() : null }
        : s
    )));

    try {
      const response = await fetch(`/api/staff/${member.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived }),
      });

      if (response.ok) {
        const updated = await response.json();
        setStaff((prev) => prev.map((s) => (s.id === member.id ? { ...s, ...updated } : s)));
        setArchiveTarget(null);
      } else {
        setStaff(previousStaff);
      }
    } catch (error) {
      console.error('Failed to update staff archive state:', error);
      setStaff(previousStaff);
    } finally {
      setActioningId(null);
    }
  };

  const handlePermanentDelete = async () => {
    if (!deleteTarget) return;

    const targetId = deleteTarget.id;
    setActioningId(targetId);
    setDeleteError('');

    try {
      const response = await fetch(`/api/staff/${targetId}?permanent=true${deleteRecords ? '&purgeRecords=true' : ''}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setStaff((prev) => prev.filter((member) => member.id !== targetId));
        setDeleteTarget(null);
        setDeleteRecords(false);
      } else {
        const error = await response.json().catch(() => ({}));
        setDeleteError(error.error || 'Could not permanently delete this staff member');
      }
    } catch (error) {
      console.error('Failed to permanently delete staff:', error);
      setDeleteError('Could not permanently delete this staff member');
    } finally {
      setActioningId(null);
    }
  };

  const handleEdit = async () => {
    if (!editingId || !editName.trim()) return;
    setSavingEdit(true);
    try {
      const response = await fetch(`/api/staff/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: editName.trim(),
          email: editEmail.trim() || null,
          department: editDepartment.trim() || null,
          unit: editUnit.trim() || null,
        }),
      });

      if (response.ok) {
        const updated = await response.json();
        setStaff((prev) => prev.map((s) => (s.id === editingId ? { ...s, ...updated } : s)));
        setEditingId(null);
      }
    } catch (error) {
      console.error('Failed to update staff:', error);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleSyncIdentity = async (member: StaffMember) => {
    if (!member.email) {
      setIdentityNotice({
        detail: 'Add a login email to this staff profile, then sync again.',
        title: `${member.fullName}: Login email missing`,
        tone: 'error',
      });
      return;
    }

    setIdentityActioningId(member.id);
    setIdentityNotice(null);

    try {
      const response = await fetch(`/api/staff/${member.id}/identity`, {
        method: 'POST',
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        setIdentityNotice({
          detail: result.error || result.message || 'Could not sync login access.',
          title: `${member.fullName}: Login sync failed`,
          tone: 'error',
        });
        return;
      }

      setIdentityNotice(getStaffIdentitySyncCopy({
        email: member.email,
        fallbackMessage: result.message,
        staffName: member.fullName,
        status: result.status,
      }));
    } catch (error) {
      console.error('Failed to sync staff login access:', error);
      setIdentityNotice({
        detail: 'Could not reach the login sync endpoint. Try again after confirming the server is running.',
        title: `${member.fullName}: Login sync failed`,
        tone: 'error',
      });
    } finally {
      setIdentityActioningId(null);
    }
  };

  const openEdit = (member: StaffMember) => {
    setEditingId(member.id);
    setEditName(member.fullName);
    setEditEmail(member.email || '');
    setEditDepartment(member.department || '');
    setEditUnit(member.unit || '');
  };

  const searchTokens = searchTerm
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const statusFilteredStaff = Array.isArray(staff)
    ? staff.filter((s) => {
        if (staffFilter === 'active') return s.active && !s.archived;
        if (staffFilter === 'inactive') return !s.active && !s.archived;
        if (staffFilter === 'former') return s.archived;
        return true;
      })
    : [];

  const filteredStaff = statusFilteredStaff
    ? staff.filter((s) => {
        if (!statusFilteredStaff.some((member) => member.id === s.id)) return false;
        if (searchTokens.length === 0) return true;

        const searchable = [
          s.fullName,
          s.email || '',
          s.department || '',
          s.unit || '',
        ].join(' ').toLowerCase();

        return searchTokens.every((token) => searchable.includes(token));
      })
    : [];

  const activeCount = staff.filter((s) => s.active && !s.archived).length;
  const inactiveCount = staff.filter((s) => !s.active && !s.archived).length;
  const formerCount = staff.filter((s) => s.archived).length;
  const totalDisplay = loading ? '-' : staff.length.toString();
  const activeDisplay = loading ? '-' : activeCount.toString();
  const inactiveDisplay = loading ? '-' : inactiveCount.toString();
  const formerDisplay = loading ? '-' : formerCount.toString();
  const staffFilterCards: Array<{
    key: StaffFilter;
    label: string;
    value: string;
    valueClassName?: string;
  }> = [
    { key: 'all', label: 'Total Staff', value: totalDisplay },
    { key: 'active', label: 'Active', value: activeDisplay, valueClassName: 'text-success' },
    { key: 'inactive', label: 'Inactive', value: inactiveDisplay, valueClassName: 'text-muted-foreground' },
    { key: 'former', label: 'Former Personnel', value: formerDisplay, valueClassName: 'text-warning' },
  ];
  const activeFilterLabel = staffFilterCards.find((card) => card.key === staffFilter)?.label || 'staff';

  return (
    <DashboardLayout title="Staff">
      <div className="space-y-6">
        {/* Stats Bar */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {staffFilterCards.map((card) => {
            const selected = staffFilter === card.key;

            return (
              <Card
                key={card.key}
                className={cn(
                  'transition-colors',
                  selected && 'border-primary bg-primary/5 shadow-sm'
                )}
              >
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setStaffFilter(card.key)}
                  className="h-full w-full rounded-lg p-4 text-center outline-none transition-colors hover:bg-card/70 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                >
                  <p className={cn('text-2xl font-bold font-mono', card.valueClassName)}>
                    {card.value}
                  </p>
                  <p className="text-xs text-muted-foreground">{card.label}</p>
                </button>
              </Card>
            );
          })}
        </div>

        {/* Search & Add */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search staff..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10"
              />
            </div>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add Staff
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Staff Member</DialogTitle>
                <DialogDescription className="sr-only">
                  Create a staff profile with name, department, and unit.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="new-name">Full Name *</Label>
                  <Input
                    id="new-name"
                    placeholder="Enter full name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-email">Login Email</Label>
                  <Input
                    id="new-email"
                    type="email"
                    placeholder="name@example.com"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Used to match this staff member to their attendance check-in account.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="new-department">Department</Label>
                    <Input
                      id="new-department"
                      placeholder="e.g. Finance"
                      value={newDepartment}
                      onChange={(e) => setNewDepartment(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-unit">Unit</Label>
                    <Input
                      id="new-unit"
                      placeholder="e.g. Collections"
                      value={newUnit}
                      onChange={(e) => setNewUnit(e.target.value)}
                    />
                  </div>
                </div>
                {submitMessage && (
                  <p className={`text-sm font-medium ${submitMessage.includes('success') ? 'text-success' : 'text-danger'}`}>
                    {submitMessage}
                  </p>
                )}
                <div className="flex justify-end gap-2 pt-4">
                  <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleAddStaff} disabled={!newName.trim() || isSubmitting}>
                    {isSubmitting ? 'Adding...' : 'Add Staff Member'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {identityNotice && (
          <div className={cn(
            'rounded-md border px-4 py-3 text-sm',
            identityNotice.tone === 'success'
              ? 'border-success/30 bg-success/10 text-success'
              : identityNotice.tone === 'warning'
                ? 'border-warning/30 bg-warning/10 text-warning'
                : 'border-danger/30 bg-danger/10 text-danger',
          )}>
            <p className="font-semibold">{identityNotice.title}</p>
            <p className="mt-1 text-sm leading-5 text-foreground/70">{identityNotice.detail}</p>
          </div>
        )}

        {/* Staff Table */}
        <Card>
          {loading ? (
            <LoadingBuffer
              variant="section"
              label="Loading staff"
              description="Syncing active, inactive, and former personnel."
            />
          ) : (
            <>
              <div>
                <div className="hidden grid-cols-[1.15fr_1.2fr_.8fr_.7fr_.65fr_1.6fr] gap-4 border-b border-border bg-card px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground xl:grid">
                  <div>Name</div>
                  <div>Login Email</div>
                  <div>Department</div>
                  <div>Unit</div>
                  <div>Status</div>
                  <div className="text-right">Actions</div>
                </div>

                <div className="divide-y divide-border">
                  {filteredStaff.map((member) => (
                    <div key={member.id} className="transition-colors hover:bg-card/50">
                      {editingId === member.id ? (
                        <div className="space-y-4 px-4 py-4">
                          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <div className="space-y-1.5">
                              <Label htmlFor={`edit-name-${member.id}`}>Full Name</Label>
                              <Input
                                id={`edit-name-${member.id}`}
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                className="h-10 text-sm"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor={`edit-email-${member.id}`}>Login Email</Label>
                              <Input
                                id={`edit-email-${member.id}`}
                                type="email"
                                value={editEmail}
                                onChange={(e) => setEditEmail(e.target.value)}
                                className="h-10 text-sm"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor={`edit-department-${member.id}`}>Department</Label>
                              <Input
                                id={`edit-department-${member.id}`}
                                value={editDepartment}
                                onChange={(e) => setEditDepartment(e.target.value)}
                                className="h-10 text-sm"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor={`edit-unit-${member.id}`}>Unit</Label>
                              <Input
                                id={`edit-unit-${member.id}`}
                                value={editUnit}
                                onChange={(e) => setEditUnit(e.target.value)}
                                className="h-10 text-sm"
                              />
                            </div>
                          </div>
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <span className={`inline-flex w-fit items-center rounded-full px-2 py-1 text-xs font-medium ${getStaffStatusClass(member)}`}>
                              {getStaffStatusLabel(member)}
                            </span>
                            <div className="flex flex-wrap gap-2 sm:justify-end">
                              <Button size="sm" onClick={handleEdit} className="h-9 gap-2" disabled={savingEdit}>
                                {savingEdit && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                Save
                              </Button>
                              <Button variant="outline" size="sm" onClick={() => setEditingId(null)} className="h-9" disabled={savingEdit}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="grid gap-3 px-4 py-4 xl:grid-cols-[1.15fr_1.2fr_.8fr_.7fr_.65fr_1.6fr] xl:items-center">
                          <StaffField label="Name" value={member.fullName} strong />
                          <StaffField label="Login Email" value={member.email || 'Not linked'} muted={!member.email} />
                          <StaffField label="Department" value={member.department || '-'} />
                          <StaffField label="Unit" value={member.unit || '-'} />
                          <div className="min-w-0">
                            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground xl:hidden">Status</p>
                            <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${getStaffStatusClass(member)}`}>
                              {getStaffStatusLabel(member)}
                            </span>
                          </div>
                          <div className="flex min-w-0 flex-wrap gap-2 xl:justify-end">
                            <Button variant="outline" size="sm" className="h-8 gap-2" onClick={() => openEdit(member)}>
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </Button>
                            {!member.archived && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 gap-2"
                                onClick={() => handleSyncIdentity(member)}
                                disabled={!member.email || identityActioningId === member.id}
                              >
                                {identityActioningId === member.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <ShieldCheck className="h-3.5 w-3.5" />
                                )}
                                Sync / Invite
                              </Button>
                            )}
                            {member.archived ? (
                              <>
                                <Button
                                  variant="default"
                                  size="sm"
                                  className="h-8 gap-2"
                                  onClick={() => handleToggleArchived(member, false)}
                                  disabled={actioningId === member.id}
                                >
                                  {actioningId === member.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <RotateCcw className="h-3.5 w-3.5" />
                                  )}
                                  Restore
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 gap-2 border-danger/40 text-danger hover:bg-danger/10"
                                  onClick={() => {
                                    setDeleteError('');
                                    setDeleteTarget(member);
                                  }}
                                  disabled={actioningId === member.id}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Delete
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button
                                  variant={member.active ? 'outline' : 'default'}
                                  size="sm"
                                  className="h-8 gap-2"
                                  onClick={() => handleToggleActive(member.id, !!member.active)}
                                  disabled={actioningId === member.id}
                                >
                                  {actioningId === member.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : member.active ? (
                                    <UserX className="h-3.5 w-3.5" />
                                  ) : (
                                    <UserCheck className="h-3.5 w-3.5" />
                                  )}
                                  {member.active ? 'Deactivate' : 'Activate'}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 gap-2 border-warning/40 text-warning hover:bg-warning/10"
                                  onClick={() => setArchiveTarget(member)}
                                  disabled={actioningId === member.id}
                                >
                                  <Archive className="h-3.5 w-3.5" />
                                  Archive
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {filteredStaff.length === 0 && (
                    <div className="py-8 text-center text-muted-foreground">
                      {searchTerm ? 'No staff members match your search' : 'No staff members found'}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <p className="text-sm text-muted-foreground">
                  Showing {filteredStaff.length} of {statusFilteredStaff.length} {activeFilterLabel.toLowerCase()}
                </p>
              </div>
            </>
          )}
        </Card>

        <Dialog open={!!archiveTarget} onOpenChange={(open) => !open && setArchiveTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Archive Staff Member</DialogTitle>
              <DialogDescription className="sr-only">
                Mark a staff member as former personnel while preserving historical records.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <p className="text-sm text-muted-foreground">
                {archiveTarget
                  ? `${archiveTarget.fullName} will be marked as former personnel and removed from future daily entries and exports. Historical entries and audit records will remain intact.`
                  : 'This person will be marked as former personnel.'}
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setArchiveTarget(null)}>
                  Cancel
                </Button>
                <Button
                  className="gap-2"
                  onClick={() => archiveTarget && handleToggleArchived(archiveTarget, true)}
                  disabled={!archiveTarget || actioningId === archiveTarget.id}
                >
                  {archiveTarget && actioningId === archiveTarget.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Archive className="h-4 w-4" />
                  )}
                  Mark as Former
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={!!deleteTarget} onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteError('');
            setDeleteRecords(false);
          }
        }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Staff Permanently</DialogTitle>
              <DialogDescription className="sr-only">
                Permanently remove a staff profile that has no historical lateness records.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <p className="text-sm text-muted-foreground">
                {deleteTarget
                  ? `${deleteTarget.fullName} will be permanently removed from the staff list. Use record removal only for duplicate or test profiles where history should also be erased.`
                  : 'This staff member will be permanently removed.'}
              </p>
              <label className="flex items-start gap-3 rounded-md border border-border p-3 text-sm">
                <Checkbox
                  checked={deleteRecords}
                  onCheckedChange={(checked) => setDeleteRecords(checked === true)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">Also delete all lateness records for this person</span>
                  <span className="mt-1 block text-muted-foreground">
                    Leave this off for real former personnel. Turn it on only when removing test or duplicate staff data.
                  </span>
                </span>
              </label>
              {deleteError && (
                <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {deleteError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setDeleteTarget(null);
                    setDeleteError('');
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  className="gap-2"
                  onClick={handlePermanentDelete}
                  disabled={!deleteTarget || actioningId === deleteTarget.id}
                >
                  {deleteTarget && actioningId === deleteTarget.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  {deleteRecords ? 'Delete Staff and Records' : 'Delete Permanently'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

function getStaffStatusLabel(member: StaffMember) {
  if (member.archived) return 'Former';
  return member.active ? 'Active' : 'Inactive';
}

function getStaffStatusClass(member: StaffMember) {
  if (member.archived) return 'bg-warning/10 text-warning';
  return member.active ? 'bg-success/10 text-success' : 'bg-muted/10 text-muted-foreground';
}

function StaffField({
  label,
  muted,
  strong,
  value,
}: {
  label: string;
  muted?: boolean;
  strong?: boolean;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground xl:hidden">
        {label}
      </p>
      <p className={cn(
        'break-words text-sm',
        strong && 'font-medium',
        muted && 'text-muted-foreground',
      )}>
        {value}
      </p>
    </div>
  );
}
