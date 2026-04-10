// app/settings/page.tsx
'use client';

import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function SettingsPage() {
  return (
    <DashboardLayout title="Settings">
      <div className="space-y-6">
        {/* Profile Section */}
        <Card>
          <div className="p-6">
            <h2 className="mb-6 text-lg font-semibold">PROFILE</h2>
            <div className="flex items-start gap-6">
              <div className="text-center">
                <div className="mb-2 flex h-24 w-24 items-center justify-center rounded-full bg-card">
                  <span className="text-3xl">👤</span>
                </div>
                <Button variant="outline" size="sm">
                  Upload
                </Button>
              </div>
              <div className="flex-1 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="fullName">Full Name</Label>
                  <Input id="fullName" defaultValue="John Admin" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" defaultValue="admin@company.com" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">Role</Label>
                  <Input id="role" defaultValue="Admin" disabled />
                </div>
                <Button variant="outline">Change Password</Button>
              </div>
            </div>
          </div>
        </Card>

        {/* Preferences Section */}
        <Card>
          <div className="p-6">
            <h2 className="mb-6 text-lg font-semibold">PREFERENCES</h2>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Theme</Label>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1">
                    Light
                  </Button>
                  <Button className="flex-1">Dark</Button>
                  <Button variant="outline" className="flex-1">
                    System
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="defaultDate">Default Date View</Label>
                <Input id="defaultDate" defaultValue="Today" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="defaultExport">Default Export Format</Label>
                <Input id="defaultExport" defaultValue="Weekly" />
              </div>
            </div>
          </div>
        </Card>

        {/* Audit Trail Section */}
        <Card>
          <div className="p-6">
            <h2 className="mb-4 text-lg font-semibold">AUDIT TRAIL</h2>
            <div className="space-y-3">
              <AuditItem
                action="Entry Updated"
                user="admin@company.com"
                time="2 minutes ago"
              />
              <AuditItem
                action="Staff Member Added"
                user="admin@company.com"
                time="1 hour ago"
              />
              <AuditItem
                action="Holiday Marked"
                user="admin@company.com"
                time="3 hours ago"
              />
              <AuditItem
                action="Weekly Export Generated"
                user="hr@company.com"
                time="yesterday"
              />
            </div>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function AuditItem({ action, user, time }: { action: string; user: string; time: string }) {
  return (
    <div className="flex items-start gap-3 border-b border-border pb-3 text-sm">
      <div className="mt-1 h-2 w-2 rounded-full bg-primary" />
      <div className="flex-1">
        <p className="font-medium">{action}</p>
        <p className="text-xs text-muted-foreground">
          by {user} • {time}
        </p>
      </div>
    </div>
  );
}
