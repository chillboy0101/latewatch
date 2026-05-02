'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Pencil, PhoneCall, Plus, Search, Trash2 } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingBuffer } from '@/components/ui/loading-buffer';
import { subscribeRealtimeChannel } from '@/lib/realtime-client';

interface StaffOption {
  active: boolean | null;
  archived: boolean | null;
  fullName: string;
  id: string;
}

interface EmergencyContact {
  active: boolean | null;
  address: string | null;
  alternatePhone: string | null;
  contactName: string;
  createdAt: string | null;
  email: string | null;
  id: string;
  notes: string | null;
  phone: string;
  relationship: string | null;
  staffId: string | null;
  staffName: string | null;
  updatedAt: string | null;
}

type ContactForm = {
  address: string;
  email: string;
  familyContactName: string;
  familyPhone: string;
  notes: string;
  relationship: string;
  staffId: string;
  staffPhone: string;
};

const emptyForm: ContactForm = {
  address: '',
  email: '',
  familyContactName: '',
  familyPhone: '',
  notes: '',
  relationship: '',
  staffId: '',
  staffPhone: '',
};

function formFromContact(contact: EmergencyContact): ContactForm {
  return {
    address: contact.address || '',
    email: contact.email || '',
    familyContactName: contact.contactName,
    familyPhone: contact.alternatePhone || '',
    notes: contact.notes || '',
    relationship: contact.relationship || '',
    staffId: contact.staffId || '',
    staffPhone: contact.phone,
  };
}

function payloadFromForm(form: ContactForm) {
  return {
    address: form.address.trim() || null,
    alternatePhone: form.familyPhone.trim(),
    contactName: form.familyContactName.trim(),
    email: form.email.trim() || null,
    notes: form.notes.trim() || null,
    phone: form.staffPhone.trim(),
    relationship: form.relationship.trim() || null,
    staffId: form.staffId,
  };
}

export default function EmergencyContactsPage() {
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<EmergencyContact | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EmergencyContact | null>(null);
  const [saving, setSaving] = useState(false);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [form, setForm] = useState<ContactForm>(emptyForm);
  const [formError, setFormError] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [contactsResponse, staffResponse] = await Promise.all([
        fetch('/api/emergency-contacts', { cache: 'no-store' }),
        fetch('/api/staff', { cache: 'no-store' }),
      ]);

      const [contactsData, staffData] = await Promise.all([
        contactsResponse.json(),
        staffResponse.json(),
      ]);

      setContacts(Array.isArray(contactsData) ? contactsData : []);
      setStaffOptions(Array.isArray(staffData) ? staffData : []);
    } catch (error) {
      console.error('Failed to load emergency contacts:', error);
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let mounted = true;

    (async () => {
      const unsubscribe = await subscribeRealtimeChannel({
        channel: 'dashboard',
        events: ['invalidate'],
        onEvent: fetchData,
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
  }, [fetchData]);

  const filteredContacts = useMemo(() => {
    const tokens = searchTerm
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (tokens.length === 0) return contacts;

    return contacts.filter((contact) => {
      const searchable = [
        contact.contactName,
        contact.staffName || '',
        contact.relationship || '',
        contact.phone,
        contact.alternatePhone || '',
        contact.email || '',
        contact.address || '',
        contact.notes || '',
      ].join(' ').toLowerCase();

      return tokens.every((token) => searchable.includes(token));
    });
  }, [contacts, searchTerm]);

  function openCreateDialog() {
    setEditingContact(null);
    setForm(emptyForm);
    setFormError('');
    setDialogOpen(true);
  }

  function openEditDialog(contact: EmergencyContact) {
    setEditingContact(contact);
    setForm(formFromContact(contact));
    setFormError('');
    setDialogOpen(true);
  }

  async function saveContact() {
    const payload = payloadFromForm(form);
    if (!payload.staffId || !payload.phone || !payload.contactName || !payload.alternatePhone) {
      setFormError('Staff, staff phone, family contact name, and family phone are required.');
      return;
    }

    setSaving(true);
    setFormError('');

    try {
      const response = await fetch(
        editingContact ? `/api/emergency-contacts/${editingContact.id}` : '/api/emergency-contacts',
        {
          body: JSON.stringify(payload),
          headers: { 'Content-Type': 'application/json' },
          method: editingContact ? 'PUT' : 'POST',
        },
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'Could not save emergency contact');
      }

      await fetchData();
      setDialogOpen(false);
      setEditingContact(null);
      setForm(emptyForm);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not save emergency contact');
    } finally {
      setSaving(false);
    }
  }

  async function deleteContact() {
    if (!deleteTarget) return;

    setActioningId(deleteTarget.id);
    try {
      const response = await fetch(`/api/emergency-contacts/${deleteTarget.id}`, { method: 'DELETE' });
      if (response.ok) {
        setContacts((current) => current.filter((contact) => contact.id !== deleteTarget.id));
        setDeleteTarget(null);
      }
    } catch (error) {
      console.error('Failed to delete emergency contact:', error);
    } finally {
      setActioningId(null);
    }
  }

  return (
    <DashboardLayout title="Emergency Contacts">
      <div className="space-y-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_220px_auto] lg:items-center">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-11 pl-10"
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search staff, family contact, phone..."
              value={searchTerm}
            />
          </div>

          <Card className="h-11">
            <div className="flex h-full items-center justify-center gap-2 px-4">
              <PhoneCall className="h-4 w-4 text-primary" />
              <span className="font-mono text-lg font-semibold">{contacts.length}</span>
              <span className="text-sm text-muted-foreground">Contacts</span>
            </div>
          </Card>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="h-11 gap-2" onClick={openCreateDialog}>
                <Plus className="h-4 w-4" />
                Add Contact
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>{editingContact ? 'Edit Emergency Contact' : 'Add Emergency Contact'}</DialogTitle>
                <DialogDescription className="sr-only">
                  Save staff phone and family emergency contact details.
                </DialogDescription>
              </DialogHeader>
              <ContactFormFields
                form={form}
                onChange={(updates) => setForm((current) => ({ ...current, ...updates }))}
                staffOptions={staffOptions}
              />
              {formError && (
                <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {formError}
                </p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                  Cancel
                </Button>
                <Button onClick={saveContact} disabled={saving}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Contact
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          {loading ? (
            <LoadingBuffer variant="section" label="Loading emergency contacts" description="Loading saved contacts." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-border bg-card">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Staff</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Staff Phone</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Family Contact</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Family Phone</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Relationship</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredContacts.map((contact) => (
                    <tr key={contact.id} className="transition-colors hover:bg-card/50">
                      <td className="px-4 py-3">
                        <p className="text-sm font-semibold">{contact.staffName || 'Staff not linked'}</p>
                        {contact.email && <p className="text-xs text-muted-foreground">{contact.email}</p>}
                      </td>
                      <td className="px-4 py-3 font-mono text-sm font-semibold">{contact.phone}</td>
                      <td className="px-4 py-3 text-sm font-medium">{contact.contactName}</td>
                      <td className="px-4 py-3 font-mono text-sm font-semibold">{contact.alternatePhone || '-'}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{contact.relationship || '-'}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <Button className="h-8 gap-2" size="sm" variant="outline" onClick={() => openEditDialog(contact)}>
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </Button>
                          <Button
                            className="h-8 gap-2 border-danger/40 text-danger hover:bg-danger/10"
                            size="sm"
                            variant="outline"
                            onClick={() => setDeleteTarget(contact)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredContacts.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        {searchTerm ? 'No contacts match your search' : 'No emergency contacts saved'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Emergency Contact</DialogTitle>
              <DialogDescription className="sr-only">
                Permanently remove an emergency contact record.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex gap-3 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{deleteTarget ? `${deleteTarget.contactName} will be removed from emergency contacts.` : 'This contact will be removed.'}</p>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDeleteTarget(null)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={deleteContact} disabled={!!deleteTarget && actioningId === deleteTarget.id}>
                  {deleteTarget && actioningId === deleteTarget.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Delete Contact
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

function ContactFormFields({
  form,
  onChange,
  staffOptions,
}: {
  form: ContactForm;
  onChange: (updates: Partial<ContactForm>) => void;
  staffOptions: StaffOption[];
}) {
  const availableStaff = staffOptions.filter((member) => !member.archived);

  return (
    <div className="grid gap-4 pt-2">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="staff-id">Staff Member *</Label>
          <select
            id="staff-id"
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/35"
            onChange={(event) => onChange({ staffId: event.target.value })}
            value={form.staffId}
          >
            <option value="">Select staff</option>
            {availableStaff.map((member) => (
              <option key={member.id} value={member.id}>
                {member.fullName}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="staff-phone">Staff Phone *</Label>
          <Input
            id="staff-phone"
            onChange={(event) => onChange({ staffPhone: event.target.value })}
            value={form.staffPhone}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2 sm:col-span-1">
          <Label htmlFor="family-contact-name">Family / Spouse Name *</Label>
          <Input
            id="family-contact-name"
            onChange={(event) => onChange({ familyContactName: event.target.value })}
            value={form.familyContactName}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="relationship">Relationship</Label>
          <Input
            id="relationship"
            onChange={(event) => onChange({ relationship: event.target.value })}
            placeholder="Spouse, parent, sibling..."
            value={form.relationship}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="family-phone">Family / Spouse Phone *</Label>
          <Input
            id="family-phone"
            onChange={(event) => onChange({ familyPhone: event.target.value })}
            value={form.familyPhone}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            onChange={(event) => onChange({ email: event.target.value })}
            type="email"
            value={form.email}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="address">Address</Label>
          <Input
            id="address"
            onChange={(event) => onChange({ address: event.target.value })}
            value={form.address}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="notes">Notes</Label>
          <Input
            id="notes"
            onChange={(event) => onChange({ notes: event.target.value })}
            value={form.notes}
          />
        </div>
      </div>
    </div>
  );
}
