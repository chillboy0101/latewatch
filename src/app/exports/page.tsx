// app/exports/page.tsx
'use client';

import { useState } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Download, Upload } from 'lucide-react';

export default function ExportsPage() {
  const [selectedWeek] = useState('March 24-28, 2026');
  const [selectedMonth] = useState('March 2026');

  return (
    <DashboardLayout title="Export Center">
      <div className="space-y-6">
        {/* Weekly Export */}
        <Card>
          <div className="p-6">
            <h2 className="mb-4 text-center text-lg font-semibold">
              WEEKLY EXPORT
            </h2>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-muted-foreground">
                  Select Week
                </label>
                <Button variant="outline" className="w-full justify-start">
                  {selectedWeek}
                </Button>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-medium text-muted-foreground">
                  Preview:
                </h3>
                <table className="w-full text-sm">
                  <thead className="border-b border-border">
                    <tr>
                      <th className="pb-2 text-left font-medium">Day</th>
                      <th className="pb-2 text-center font-medium">Entries</th>
                      <th className="pb-2 text-center font-medium">Late</th>
                      <th className="pb-2 text-center font-medium">Sign Out</th>
                      <th className="pb-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    <tr>
                      <td className="py-2">Monday</td>
                      <td className="py-2 text-center">47</td>
                      <td className="py-2 text-center">12</td>
                      <td className="py-2 text-center">3</td>
                      <td className="py-2 text-right font-mono">GHC 145</td>
                    </tr>
                    <tr>
                      <td className="py-2">Tuesday</td>
                      <td className="py-2 text-center">47</td>
                      <td className="py-2 text-center">8</td>
                      <td className="py-2 text-center">1</td>
                      <td className="py-2 text-right font-mono">GHC 95</td>
                    </tr>
                    <tr className="text-muted-foreground">
                      <td className="py-2">Wednesday</td>
                      <td className="py-2 text-center">—</td>
                      <td className="py-2 text-center">—</td>
                      <td className="py-2 text-center">—</td>
                      <td className="py-2 text-right font-mono">—</td>
                    </tr>
                    <tr className="text-muted-foreground">
                      <td className="py-2">Thursday</td>
                      <td className="py-2 text-center">🎉 Holiday</td>
                      <td className="py-2 text-center">—</td>
                      <td className="py-2 text-center">—</td>
                      <td className="py-2 text-right font-mono">—</td>
                    </tr>
                    <tr className="text-muted-foreground">
                      <td className="py-2">Friday</td>
                      <td className="py-2 text-center">—</td>
                      <td className="py-2 text-center">—</td>
                      <td className="py-2 text-center">—</td>
                      <td className="py-2 text-right font-mono">—</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="border-t border-border pt-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Week Total:</span>
                  <span className="font-mono font-semibold">GHC 240</span>
                </div>
              </div>

              <Button className="w-full gap-2">
                <Download className="h-4 w-4" />
                Download Weekly Excel
              </Button>
            </div>
          </div>
        </Card>

        {/* Monthly Export */}
        <Card>
          <div className="p-6">
            <h2 className="mb-4 text-center text-lg font-semibold">
              MONTHLY EXPORT
            </h2>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-muted-foreground">
                  Select Month
                </label>
                <Button variant="outline" className="w-full justify-start">
                  {selectedMonth}
                </Button>
              </div>

              <div className="text-sm text-muted-foreground">
                Weeks included: Week 1, Week 2, Week 3, Week 4
              </div>

              <div className="border-t border-border pt-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Month Total:</span>
                  <span className="font-mono font-semibold">GHC 1,250</span>
                </div>
              </div>

              <Button className="w-full gap-2">
                <Download className="h-4 w-4" />
                Download Monthly Excel
              </Button>
            </div>
          </div>
        </Card>

        {/* Template Management */}
        <Card>
          <div className="p-6">
            <h2 className="mb-4 text-center text-lg font-semibold">
              TEMPLATE MANAGEMENT (Admin)
            </h2>
            <div className="space-y-4">
              <div className="text-sm">
                <div className="mb-1">
                  <span className="text-muted-foreground">Active Template:</span>{' '}
                  <span className="font-medium">LATENESS BOOK MARCH 2026.xlsx (v1)</span>
                </div>
                <div className="text-muted-foreground">
                  Last Updated: 2026-03-01 by admin@company.com
                </div>
              </div>

              <Button variant="outline" className="w-full gap-2">
                <Upload className="h-4 w-4" />
                Upload New Template
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
