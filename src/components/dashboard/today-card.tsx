import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// Today's attendance, as /api/attendance returns it (only the parts this card uses).
export interface TodayAttendance {
  rows: {
    attendance: { checkInTime: string; computedAmount: string } | null;
    penaltyAmount?: string | null;
    staff: { fullName: string; id: string };
    statuses?: string[];
    status: string;
  }[];
  totals: { late: number; notCheckedIn: number; onLeave: number; onTime: number; present: number };
}

const MAX_NAMES = 5;

function hasStatus(row: TodayAttendance['rows'][number], status: string) {
  return row.statuses ? row.statuses.includes(status) : row.status === status;
}

function ghc(value: string | null | undefined) {
  const amount = Number(value || 0);
  return amount > 0 ? `GHC ${amount.toLocaleString()}` : null;
}

// Who is late and who isn't in yet, today. Sits under the stat cards; the rest of the dashboard is unchanged.
export function TodayCard({ today }: { today: TodayAttendance }) {
  const { totals } = today;
  const late = today.rows
    .filter((row) => hasStatus(row, 'late'))
    .sort((a, b) => (b.attendance?.checkInTime || '').localeCompare(a.attendance?.checkInTime || ''));
  const notIn = today.rows.filter((row) => hasStatus(row, 'not_checked_in'));
  const counts = [
    { className: 'bg-success/10 text-success', label: 'on time', value: totals.onTime },
    { className: 'bg-warning/10 text-warning', label: 'late', value: totals.late },
    { className: 'bg-danger/10 text-danger', label: 'not in', value: totals.notCheckedIn },
    { className: 'bg-muted/15 text-muted-foreground', label: 'on leave', value: totals.onLeave },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="text-lg">Today</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {counts.map((count) => (
            <span key={count.label} className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', count.className)}>
              {count.value} {count.label}
            </span>
          ))}
          <Link href="/attendance/overview">
            <Button variant="link" size="sm">View all</Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {late.length === 0 && notIn.length === 0 ? (
          <p className="py-2 text-center text-sm text-muted-foreground">Everyone is in</p>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            <TodayList
              empty="No one late"
              label="Late"
              labelClassName="text-warning"
              rows={late.map((row) => ({
                id: row.staff.id,
                name: row.staff.fullName,
                detail: [row.attendance?.checkInTime.slice(0, 5), ghc(row.penaltyAmount ?? row.attendance?.computedAmount)]
                  .filter(Boolean)
                  .join(' · '),
              }))}
            />
            <TodayList
              empty="Everyone has checked in"
              label="Not in yet"
              labelClassName="text-danger"
              rows={notIn.map((row) => ({ detail: '-', id: row.staff.id, name: row.staff.fullName }))}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TodayList({
  empty,
  label,
  labelClassName,
  rows,
}: {
  empty: string;
  label: string;
  labelClassName: string;
  rows: { detail: string; id: string; name: string }[];
}) {
  const shown = rows.slice(0, MAX_NAMES);
  const more = rows.length - shown.length;

  return (
    <div>
      <p className={cn('border-b border-border pb-1.5 text-sm font-semibold', labelClassName)}>{label}</p>
      {shown.length === 0 ? (
        <p className="py-2.5 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {shown.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="min-w-0 truncate">{row.name}</span>
              <span className="shrink-0 font-mono text-muted-foreground">{row.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {more > 0 && (
        <Link href="/attendance/overview" className="mt-1 inline-block text-sm text-primary hover:underline">
          +{more} more
        </Link>
      )}
    </div>
  );
}
