'use client';

import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { LoadingBuffer } from '@/components/ui/loading-buffer';
import { Archive, CalendarDays, Loader2, Pencil, Plus, RotateCcw, Search, ShieldCheck, Trash2, UserCheck, UserX } from 'lucide-react';
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
import { StaffLeaveDialog } from '@/components/attendance/staff-leave-dialog';
import { StaffTypeField, StaffTypeFromField } from '@/components/staff/staff-type-field';
import { getAccraDateKey } from '@/lib/date-key';
import { STAFF_TYPE_LABELS, staffTypeOf, undoableStaffTypeChange, type StaffType } from '@/lib/staff-type';
import { formatDateInputDisplay } from '@/lib/date-format';

interface StaffMember {
  id: string;
  fullName: string;
  email: string | null;
  staffNo: string | null;
  gender: string | null;
  rank: string | null;
  department: string | null;
  unit: string | null;
  isNssPersonnel: boolean;
  isAttendanceOnly: boolean;
  staffType?: string | null;
  typeChanges?: Array<{ effectiveFrom: string; staffType: string }>;
  active: boolean | null;
  archived: boolean | null;
  onLeave?: boolean;
  activeLeave?: {
    endDate: string | null;
    leaveType: string | null;
    returnedOn: string | null;
    source: string | null;
    staffId: string;
    startDate: string | null;
  } | null;
  archivedAt?: string | null;
}

type StaffFilter = 'all' | 'active' | 'onLeave' | 'inactive' | 'former' | 'nss' | 'intern' | 'special';

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
  const [editError, setEditError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [submitMessage, setSubmitMessage] = useState('');
  const [archiveTarget, setArchiveTarget] = useState<StaffMember | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StaffMember | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleteRecords, setDeleteRecords] = useState(false);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [leaveDialogStaffId, setLeaveDialogStaffId] = useState('');

  // Add form state
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newStaffNo, setNewStaffNo] = useState('');
  const [newGender, setNewGender] = useState('');
  const [newRank, setNewRank] = useState('');
  const [newDepartment, setNewDepartment] = useState('');
  const [newUnit, setNewUnit] = useState('');
  const [newStaffType, setNewStaffType] = useState<StaffType>('main');

  // Edit form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editStaffNo, setEditStaffNo] = useState('');
  const [editGender, setEditGender] = useState('');
  const [editRank, setEditRank] = useState('');
  const [editDepartment, setEditDepartment] = useState('');
  const [editUnit, setEditUnit] = useState('');
  const [editStaffType, setEditStaffType] = useState<StaffType>('main');
  const [editOriginalType, setEditOriginalType] = useState<StaffType>('main');
  const [editTypeFrom, setEditTypeFrom] = useState('');

  // Bringing someone back (restore or activate) on the same profile, as the same or a later type.
  const [returnTarget, setReturnTarget] = useState<{ member: StaffMember; mode: 'activate' | 'restore' } | null>(null);
  const [returnType, setReturnType] = useState<StaffType>('main');
  const [returnFrom, setReturnFrom] = useState('');
  const [returnError, setReturnError] = useState('');

  // A type change is confirmed before saving; the latest one can be undone if it was a mistake.
  const [confirmTypeChange, setConfirmTypeChange] = useState(false);
  const [undoTarget, setUndoTarget] = useState<StaffMember | null>(null);
  const [undoError, setUndoError] = useState('');

  const fetchStaff = useCallback(async () => {
    try {
      const response = await fetch('/api/staff', { cache: 'no-store' });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || `Staff could not be loaded (${response.status})`);
      const staffList = Array.isArray(data) ? data : (data?.data ? data.data : []);
      setStaff(staffList);
      setLoadError('');
    } catch (error) {
      // Keep the list already on screen: a failed refresh is not an empty staff list.
      console.error('Failed to fetch staff:', error);
      setLoadError(error instanceof Error ? error.message : 'Staff could not be loaded');
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
          staffNo: newStaffNo.trim() || null,
          gender: newGender.trim() || null,
          rank: newRank.trim() || null,
          department: newDepartment.trim() || null,
          unit: newUnit.trim() || null,
          staffType: newStaffType,
        }),
      });

      if (response.ok) {
        await fetchStaff();
        setNewName('');
        setNewEmail('');
        setNewStaffNo('');
        setNewGender('');
        setNewRank('');
        setNewDepartment('');
        setNewUnit('');
        setNewStaffType('main');
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

  const openLeaveDialog = (member: StaffMember) => {
    setLeaveDialogStaffId(member.id);
    setLeaveDialogOpen(true);
  };

  const handleEdit = async () => {
    if (!editingId || !editName.trim()) return;
    setSavingEdit(true);
    setEditError('');
    try {
      const response = await fetch(`/api/staff/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: editName.trim(),
          email: editEmail.trim() || null,
          staffNo: editStaffNo.trim() || null,
          gender: editGender.trim() || null,
          rank: editRank.trim() || null,
          department: editDepartment.trim() || null,
          unit: editUnit.trim() || null,
          staffType: editStaffType,
          typeEffectiveFrom: editStaffType !== editOriginalType ? editTypeFrom : undefined,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Changes could not be saved (${response.status})`);
      }
      await fetchStaff();
      setEditingId(null);
    } catch (error) {
      console.error('Failed to update staff:', error);
      setEditError(error instanceof Error ? error.message : 'Changes could not be saved');
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
    setEditError('');
    setEditingId(member.id);
    setEditName(member.fullName);
    setEditEmail(member.email || '');
    setEditStaffNo(member.staffNo || '');
    setEditGender(member.gender || '');
    setEditRank(member.rank || '');
    setEditDepartment(member.department || '');
    setEditUnit(member.unit || '');
    setEditStaffType(staffTypeOf(member));
    setEditOriginalType(staffTypeOf(member));
    setEditTypeFrom(getAccraDateKey());
  };

  const handleUndoTypeChange = async () => {
    if (!undoTarget) return;
    const member = undoTarget;
    setActioningId(member.id);
    setUndoError('');
    try {
      const undo = undoableStaffTypeChange(member.typeChanges);
      if (!undo) throw new Error('There is no type change to undo.');
      // Names the change confirmed here, so a change made meanwhile is never undone by mistake.
      const query = new URLSearchParams({ effectiveFrom: undo.effectiveFrom, staffType: undo.staffType });
      const response = await fetch(`/api/staff/${member.id}/type-change?${query}`, { method: 'DELETE' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Could not undo the type change (${response.status})`);
      if (body.identitySync === 'sync_failed') {
        setIdentityNotice({
          detail: 'The type was undone, but their sign-in details could not be updated. Use Sync / Invite to fix it.',
          title: `${member.fullName}: Login sync failed`,
          tone: 'error',
        });
      }
      await fetchStaff();
      setUndoTarget(null);
      setEditingId(null);
    } catch (error) {
      setUndoError(error instanceof Error ? error.message : 'Could not undo the type change');
    } finally {
      setActioningId(null);
    }
  };

  const openReturn = (member: StaffMember, mode: 'activate' | 'restore') => {
    setReturnError('');
    setReturnType(staffTypeOf(member));
    setReturnFrom(getAccraDateKey());
    setReturnTarget({ member, mode });
  };

  const handleReturn = async () => {
    if (!returnTarget) return;
    const { member, mode } = returnTarget;
    setActioningId(member.id);
    setReturnError('');
    try {
      const response = await fetch(`/api/staff/${member.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(mode === 'restore' ? { archived: false } : { active: true }),
          staffType: returnType,
          typeEffectiveFrom: returnFrom,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Could not bring ${member.fullName} back (${response.status})`);
      setStaff((prev) => prev.map((s) => (s.id === member.id ? { ...s, ...body } : s)));
      setReturnTarget(null);
    } catch (error) {
      setReturnError(error instanceof Error ? error.message : 'Could not bring this person back');
    } finally {
      setActioningId(null);
    }
  };

  const searchTokens = searchTerm
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const statusFilteredStaff = Array.isArray(staff)
    ? staff.filter((s) => {
        if (staffFilter === 'active') return s.active && !s.archived;
        if (staffFilter === 'onLeave') return s.onLeave && !s.archived;
        if (staffFilter === 'inactive') return !s.active && !s.archived && !s.onLeave;
        if (staffFilter === 'former') return s.archived;
        if (staffFilter === 'nss') return staffTypeOf(s) === 'nss' && !s.archived;
        if (staffFilter === 'intern') return staffTypeOf(s) === 'intern' && !s.archived;
        if (staffFilter === 'special') return staffTypeOf(s) === 'special' && !s.archived;
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
          s.staffNo || '',
          s.gender || '',
          s.rank || '',
          s.department || '',
          s.unit || '',
          s.onLeave ? 'on leave leave' : '',
          {
            intern: 'intern interns attendance monitoring only no penalty',
            main: 'main staff',
            nss: 'nss national service personnel',
            special: 'special staff attendance monitoring only no penalty',
          }[staffTypeOf(s)],
        ].join(' ').toLowerCase();

        return searchTokens.every((token) => searchable.includes(token));
      })
    : [];

  const activeCount = staff.filter((s) => s.active && !s.archived).length;
  const onLeaveCount = staff.filter((s) => s.onLeave && !s.archived).length;
  const inactiveCount = staff.filter((s) => !s.active && !s.archived && !s.onLeave).length;
  const formerCount = staff.filter((s) => s.archived).length;
  // Cards and their filters count the same people; NSS and Special are current staff only.
  const nssCount = staff.filter((s) => staffTypeOf(s) === 'nss' && !s.archived).length;
  const internCount = staff.filter((s) => staffTypeOf(s) === 'intern' && !s.archived).length;
  const specialCount = staff.filter((s) => staffTypeOf(s) === 'special' && !s.archived).length;
  const totalDisplay = loading ? '-' : staff.length.toString();
  const activeDisplay = loading ? '-' : activeCount.toString();
  const onLeaveDisplay = loading ? '-' : onLeaveCount.toString();
  const inactiveDisplay = loading ? '-' : inactiveCount.toString();
  const formerDisplay = loading ? '-' : formerCount.toString();
  const nssDisplay = loading ? '-' : nssCount.toString();
  const internDisplay = loading ? '-' : internCount.toString();
  const specialDisplay = loading ? '-' : specialCount.toString();
  const staffFilterCards: Array<{
    key: StaffFilter;
    label: string;
    value: string;
    valueClassName?: string;
  }> = [
    { key: 'all', label: 'Total Staff', value: totalDisplay },
    { key: 'active', label: 'Active', value: activeDisplay, valueClassName: 'text-success' },
    { key: 'onLeave', label: 'On Leave', value: onLeaveDisplay, valueClassName: 'text-warning' },
    { key: 'inactive', label: 'Inactive', value: inactiveDisplay, valueClassName: 'text-muted-foreground' },
    { key: 'former', label: 'Former Personnel', value: formerDisplay, valueClassName: 'text-warning' },
    { key: 'nss', label: 'NSS Personnel', value: nssDisplay, valueClassName: 'text-primary' },
    { key: 'intern', label: 'Interns', value: internDisplay, valueClassName: 'text-success' },
    { key: 'special', label: 'Special Staff', value: specialDisplay, valueClassName: 'text-success' },
  ];
  const activeFilterLabel = staffFilterCards.find((card) => card.key === staffFilter)?.label || 'staff';
  const tableSections = [
    { key: 'main', members: filteredStaff.filter((member) => staffTypeOf(member) === 'main'), title: 'Main Staff' },
    { key: 'nss', members: filteredStaff.filter((member) => staffTypeOf(member) === 'nss'), title: 'NSS Personnel' },
    { key: 'special', members: filteredStaff.filter((member) => staffTypeOf(member) === 'special'), title: 'Special Staff (not charged)' },
    { key: 'intern', members: filteredStaff.filter((member) => staffTypeOf(member) === 'intern'), title: 'Interns (not charged)' },
  ].filter((section) => section.members.length > 0);
  const newIsMainStaff = newStaffType === 'main';
  const addStaffMissingRequiredMetadata = !newGender.trim()
    || (newIsMainStaff && (!newStaffNo.trim() || !newRank.trim()));

  return (
    <DashboardLayout title="Staff">
      <div className="space-y-6">
        <StaffLeaveDialog
          open={leaveDialogOpen}
          onOpenChange={setLeaveDialogOpen}
          initialStaffId={leaveDialogStaffId}
          staffOptions={staff.filter((member) => !member.archived).map((member) => ({ fullName: member.fullName, id: member.id }))}
          onChanged={fetchStaff}
        />
        {loadError && (
          <div role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {loadError}
          </div>
        )}
        {/* Stats Bar */}
        <div className="grid auto-cols-[minmax(10.5rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-1 xl:grid-flow-row xl:grid-cols-8 xl:overflow-visible xl:pb-0">
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
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="new-staff-no">Staff No.</Label>
                    <Input
                      id="new-staff-no"
                      placeholder="e.g. GRA003825"
                      value={newStaffNo}
                      onChange={(e) => setNewStaffNo(e.target.value)}
                      required={newIsMainStaff}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-gender">Gender</Label>
                    <Input
                      id="new-gender"
                      placeholder="e.g. Female"
                      value={newGender}
                      onChange={(e) => setNewGender(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-rank">Rank</Label>
                    <Input
                      id="new-rank"
                      placeholder="e.g. ARO"
                      value={newRank}
                      onChange={(e) => setNewRank(e.target.value)}
                      required={newIsMainStaff}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Gender is required for every profile. Staff No. and Rank are required for main staff.
                </p>
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
                <StaffTypeField id="new-staff-type" value={newStaffType} onChange={setNewStaffType} />
                {submitMessage && (
                  <p className={`text-sm font-medium ${submitMessage.includes('success') ? 'text-success' : 'text-danger'}`}>
                    {submitMessage}
                  </p>
                )}
                <div className="flex justify-end gap-2 pt-4">
                  <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleAddStaff} disabled={!newName.trim() || addStaffMissingRequiredMetadata || isSubmitting}>
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
                <div className="hidden grid-cols-[1fr_1.05fr_.65fr_.55fr_.55fr_.75fr_.65fr_.65fr_.65fr_1.45fr] gap-4 border-b border-border bg-card px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground xl:grid">
                  <div>Name</div>
                  <div>Login Email</div>
                  <div>Staff No.</div>
                  <div>Gender</div>
                  <div>Rank</div>
                  <div>Department</div>
                  <div>Unit</div>
                  <div>Type</div>
                  <div>Status</div>
                  <div className="text-right">Actions</div>
                </div>

                <div className="divide-y divide-border">
                  {tableSections.map((section) => (
                    <div key={section.key}>
                      <div className="bg-muted/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {section.title}
                      </div>
                      <div className="divide-y divide-border">
                        {section.members.map((member) => (
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
                              <Label htmlFor={`edit-staff-no-${member.id}`}>Staff No.</Label>
                              <Input
                                id={`edit-staff-no-${member.id}`}
                                value={editStaffNo}
                                onChange={(e) => setEditStaffNo(e.target.value)}
                                className="h-10 text-sm"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor={`edit-gender-${member.id}`}>Gender</Label>
                              <Input
                                id={`edit-gender-${member.id}`}
                                value={editGender}
                                onChange={(e) => setEditGender(e.target.value)}
                                className="h-10 text-sm"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor={`edit-rank-${member.id}`}>Rank</Label>
                              <Input
                                id={`edit-rank-${member.id}`}
                                value={editRank}
                                onChange={(e) => setEditRank(e.target.value)}
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
                          <div className="grid gap-3 sm:grid-cols-2 lg:max-w-xl">
                            <StaffTypeField
                              id={`edit-type-${member.id}`}
                              current={editOriginalType}
                              disabledNote={!member.active || member.archived ? 'Change the type when you Activate or Restore them.' : undefined}
                              value={editStaffType}
                              onChange={setEditStaffType}
                            />
                            {editStaffType !== editOriginalType && (
                              <StaffTypeFromField value={editTypeFrom} onChange={setEditTypeFrom} previous={editOriginalType} />
                            )}
                          </div>
                          {(() => {
                            const undo = member.active && !member.archived ? undoableStaffTypeChange(member.typeChanges) : null;
                            return undo && editStaffType === editOriginalType ? (
                              <button
                                type="button"
                                className="w-fit text-sm font-medium text-primary underline-offset-4 hover:underline"
                                onClick={() => {
                                  setUndoError('');
                                  setUndoTarget(member);
                                }}
                              >
                                Undo last type change ({STAFF_TYPE_LABELS[undo.staffType]} from {formatDateInputDisplay(undo.effectiveFrom)})
                              </button>
                            ) : null;
                          })()}
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <span className={`inline-flex w-fit items-center rounded-full px-2 py-1 text-xs font-medium ${getStaffStatusClass(member)}`}>
                              {getStaffStatusLabel(member)}
                            </span>
                            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                              {editError && <span role="alert" className="text-sm text-danger">{editError}</span>}
                              <Button
                                size="sm"
                                onClick={() => (editStaffType !== editOriginalType ? setConfirmTypeChange(true) : handleEdit())}
                                className="h-9 gap-2"
                                disabled={savingEdit}
                              >
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
                        <div className="grid gap-3 px-4 py-4 xl:grid-cols-[1fr_1.05fr_.65fr_.55fr_.55fr_.75fr_.65fr_.65fr_.65fr_1.45fr] xl:items-center">
                          <StaffField label="Name" value={member.fullName} strong />
                          <StaffField label="Login Email" value={member.email || 'Not linked'} muted={!member.email} />
                          <StaffField label="Staff No." value={member.staffNo || '-'} />
                          <StaffField label="Gender" value={member.gender || '-'} />
                          <StaffField label="Rank" value={member.rank || '-'} />
                          <StaffField label="Department" value={member.department || '-'} />
                          <StaffField label="Unit" value={member.unit || '-'} />
                          <StaffField label="Type" value={STAFF_TYPE_LABELS[staffTypeOf(member)]} />
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
                                  onClick={() => openReturn(member, 'restore')}
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
                            ) : member.onLeave ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 gap-2"
                                onClick={() => openLeaveDialog(member)}
                              >
                                <CalendarDays className="h-3.5 w-3.5" />
                                Manage leave
                              </Button>
                            ) : (
                              <>
                                <Button
                                  variant={member.active ? 'outline' : 'default'}
                                  size="sm"
                                  className="h-8 gap-2"
                                  onClick={() => (member.active ? handleToggleActive(member.id, true) : openReturn(member, 'activate'))}
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
                      </div>
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

        <Dialog open={confirmTypeChange} onOpenChange={setConfirmTypeChange}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Change type?</DialogTitle>
              <DialogDescription>
                {editName.trim()} becomes {STAFF_TYPE_LABELS[editStaffType]} from {formatDateInputDisplay(editTypeFrom)}.
                Days before stay {STAFF_TYPE_LABELS[editOriginalType]}.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setConfirmTypeChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setConfirmTypeChange(false);
                  void handleEdit();
                }}
              >
                Change type
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={!!undoTarget} onOpenChange={(open) => !open && setUndoTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Undo type change?</DialogTitle>
              <DialogDescription>
                {(() => {
                  const undo = undoTarget ? undoableStaffTypeChange(undoTarget.typeChanges) : null;
                  return undoTarget && undo
                    ? `${undoTarget.fullName} goes back to ${STAFF_TYPE_LABELS[undo.previousType]} from ${formatDateInputDisplay(undo.effectiveFrom)}, instead of ${STAFF_TYPE_LABELS[undo.staffType]}. Charges from then are worked out again; paid or pardoned ones stay.`
                    : '';
                })()}
              </DialogDescription>
            </DialogHeader>
            {undoError && <p role="alert" className="text-sm text-danger">{undoError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setUndoTarget(null)}>
                Cancel
              </Button>
              <Button className="gap-2" onClick={handleUndoTypeChange} disabled={!undoTarget || actioningId === undoTarget.id}>
                {undoTarget && actioningId === undoTarget.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                Undo
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={!!returnTarget} onOpenChange={(open) => !open && setReturnTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{returnTarget?.mode === 'restore' ? 'Restore' : 'Activate'} {returnTarget?.member.fullName}</DialogTitle>
              <DialogDescription>
                Same profile, sign-in and history. Days they were away are never charged.
              </DialogDescription>
            </DialogHeader>
            {returnTarget && (
              <div className="space-y-4 pt-2">
                <StaffTypeField
                  id="return-staff-type"
                  current={staffTypeOf(returnTarget.member)}
                  value={returnType}
                  onChange={setReturnType}
                />
                <StaffTypeFromField label="Back from" value={returnFrom} onChange={setReturnFrom} />
                {returnError && <p role="alert" className="text-sm text-danger">{returnError}</p>}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setReturnTarget(null)}>
                    Cancel
                  </Button>
                  <Button className="gap-2" onClick={handleReturn} disabled={actioningId === returnTarget.member.id || !returnFrom}>
                    {actioningId === returnTarget.member.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                    {returnTarget.mode === 'restore' ? 'Restore' : 'Activate'}
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

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
  if (member.onLeave) return 'On leave';
  return member.active ? 'Active' : 'Inactive';
}

function getStaffStatusClass(member: StaffMember) {
  if (member.archived) return 'bg-warning/10 text-warning';
  if (member.onLeave) return 'bg-primary/10 text-primary';
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
