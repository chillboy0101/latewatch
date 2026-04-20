'use client';

import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Plus, Search, UserCheck, UserX, Pencil, Loader2, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface StaffMember {
  id: string;
  fullName: string;
  department: string | null;
  unit: string | null;
  active: boolean | null;
}

export default function StaffPage() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [submitMessage, setSubmitMessage] = useState('');

  // Add form state
  const [newName, setNewName] = useState('');
  const [newDepartment, setNewDepartment] = useState('');
  const [newUnit, setNewUnit] = useState('');

  // Edit form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDepartment, setEditDepartment] = useState('');
  const [editUnit, setEditUnit] = useState('');

  const fetchStaff = useCallback(async () => {
    try {
      const response = await fetch('/api/staff');
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
          department: newDepartment.trim() || null,
          unit: newUnit.trim() || null,
        }),
      });

      if (response.ok) {
        const saved = await response.json();
        setStaff((prev) => [...prev, saved].sort((a, b) => a.fullName.localeCompare(b.fullName)));
        setNewName('');
        setNewDepartment('');
        setNewUnit('');
        setSubmitMessage('Staff member added successfully');
        setTimeout(() => {
          setSubmitMessage('');
          setIsAddDialogOpen(false);
        }, 1000);
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
    try {
      const response = await fetch(`/api/staff/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !currentActive }),
      });

      if (response.ok) {
        const updated = await response.json();
        setStaff((prev) => prev.map((s) => (s.id === id ? { ...s, ...updated } : s)));
      }
    } catch (error) {
      console.error('Failed to update staff:', error);
    }
  };

  const handleDeleteStaff = async (id: string, name: string) => {
    if (!confirm(`Remove "${name}" from active staff? They will be marked inactive.`)) return;
    setDeletingId(id);
    try {
      const response = await fetch(`/api/staff/${id}`, { method: 'DELETE' });
      if (response.ok) {
        setStaff((prev) => prev.filter((s) => s.id !== id));
      }
    } catch (error) {
      console.error('Failed to delete staff:', error);
    } finally {
      setDeletingId(null);
    }
  };

  const handleEdit = async () => {
    if (!editingId || !editName.trim()) return;
    try {
      const response = await fetch(`/api/staff/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: editName.trim(),
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
    }
  };

  const openEdit = (member: StaffMember) => {
    setEditingId(member.id);
    setEditName(member.fullName);
    setEditDepartment(member.department || '');
    setEditUnit(member.unit || '');
  };

  const filteredStaff = Array.isArray(staff)
    ? staff.filter((s) =>
        s.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (s.department?.toLowerCase().includes(searchTerm.toLowerCase()) || false)
      )
    : [];

  const activeCount = staff.filter((s) => s.active).length;
  const inactiveCount = staff.length - activeCount;

  return (
    <DashboardLayout title="Staff">
      <div className="space-y-6">
        {/* Stats Bar */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <div className="p-4 text-center">
              <p className="text-2xl font-bold font-mono">{staff.length}</p>
              <p className="text-xs text-muted-foreground">Total Staff</p>
            </div>
          </Card>
          <Card>
            <div className="p-4 text-center">
              <p className="text-2xl font-bold font-mono text-success">{activeCount}</p>
              <p className="text-xs text-muted-foreground">Active</p>
            </div>
          </Card>
          <Card>
            <div className="p-4 text-center">
              <p className="text-2xl font-bold font-mono text-muted-foreground">{inactiveCount}</p>
              <p className="text-xs text-muted-foreground">Inactive</p>
            </div>
          </Card>
        </div>

        {/* Search & Add */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search staff..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 w-64"
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

        {/* Staff Table */}
        <Card>
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin mr-2" />
              Loading staff...
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-border bg-card">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Name</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Department</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Unit</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wide">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredStaff.map((member) => (
                      <tr key={member.id} className="hover:bg-card/50 transition-colors">
                        {editingId === member.id ? (
                          <>
                            <td className="px-4 py-2">
                              <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8 text-sm" />
                            </td>
                            <td className="px-4 py-2">
                              <Input value={editDepartment} onChange={(e) => setEditDepartment(e.target.value)} className="h-8 text-sm" />
                            </td>
                            <td className="px-4 py-2">
                              <Input value={editUnit} onChange={(e) => setEditUnit(e.target.value)} className="h-8 text-sm" />
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                                member.active ? 'bg-success/10 text-success' : 'bg-muted/10 text-muted'
                              }`}>
                                {member.active ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-right">
                              <div className="flex justify-end gap-1">
                                <Button size="sm" onClick={handleEdit} className="h-7 text-xs">Save</Button>
                                <Button variant="outline" size="sm" onClick={() => setEditingId(null)} className="h-7 text-xs">Cancel</Button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-4 py-3 text-sm font-medium">{member.fullName}</td>
                            <td className="px-4 py-3 text-sm">{member.department || '—'}</td>
                            <td className="px-4 py-3 text-sm">{member.unit || '—'}</td>
                            <td className="px-4 py-3 text-sm">
                              <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                                member.active ? 'bg-success/10 text-success' : 'bg-muted/10 text-muted'
                              }`}>
                                {member.active ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex justify-end gap-1">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(member)} title="Edit">
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => handleToggleActive(member.id, !!member.active)}
                                  title={member.active ? 'Deactivate' : 'Activate'}
                                >
                                  {member.active ? <UserX className="h-3.5 w-3.5 text-muted-foreground" /> : <UserCheck className="h-3.5 w-3.5 text-success" />}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 hover:text-danger"
                                  onClick={() => handleDeleteStaff(member.id, member.fullName)}
                                  disabled={deletingId === member.id}
                                  title="Remove staff member"
                                >
                                  {deletingId === member.id
                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    : <Trash2 className="h-3.5 w-3.5" />}
                                </Button>
                              </div>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                    {filteredStaff.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-muted-foreground">
                          {searchTerm ? 'No staff members match your search' : 'No staff members found'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <p className="text-sm text-muted-foreground">
                  Showing {filteredStaff.length} of {staff.length} staff
                </p>
              </div>
            </>
          )}
        </Card>
      </div>
    </DashboardLayout>
  );
}