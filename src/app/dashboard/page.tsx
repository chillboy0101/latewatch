import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TrendingUp, Plus, Download, Eye } from 'lucide-react';
import Link from 'next/link';
import { db } from '@/db';
import { latenessEntry, staff as staffTable, workCalendar } from '@/db/schema';
import { eq, gte, lte, and, sql } from 'drizzle-orm';
import { startOfWeek, addDays, format } from 'date-fns';
import { getCurrentUser } from '@/lib/auth/roles';

function getWeekRange() {
  const today = new Date();
  const start = startOfWeek(today, { weekStartsOn: 1 }); // Monday
  const end = addDays(start, 4); // Friday
  return {
    start: format(start, 'yyyy-MM-dd'),
    end: format(end, 'yyyy-MM-dd'),
    label: `${format(start, 'MMM dd')} - ${format(end, 'MMM dd')}`,
  };
}

export default async function DashboardPage() {
  let user: any = null;
  try {
    user = await getCurrentUser();
  } catch (error) {
    console.error('Error fetching user:', error);
  }
  const weekRange = getWeekRange();

  // Fetch real data
  let weekEntries: any[] = [];
  let weekTotal = 0;
  let pendingCount = 0;
  const dailyData: { day: string; entries: string; amount: string; status: string }[] = [];

  try {
    // Get all entries for this week
    weekEntries = await db.query.latenessEntry.findMany({
      where: (entry, { and, gte, lte }) =>
        and(
          gte(entry.date, weekRange.start),
          lte(entry.date, weekRange.end)
        ),
      with: {
        staff: true,
      },
    });

    // Calculate totals
    weekTotal = weekEntries.reduce((sum, e) => sum + parseFloat(e.computedAmount || '0'), 0);
    pendingCount = weekEntries.filter((e) => !e.date).length;

    // Get holidays for this week (wrapped in try-catch to prevent failures)
    let holidays: any[] = [];
    try {
      holidays = await db.query.workCalendar.findMany({
        where: (cal, { and, gte, lte, eq }) =>
          and(
            gte(cal.date, weekRange.start),
            lte(cal.date, weekRange.end),
            eq(cal.isHoliday, true)
          ),
      });
    } catch (error) {
      console.warn('Failed to fetch holidays for dashboard:', error);
    }

    const holidayDates = new Set(holidays.map((h) => h.date));
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    let currentDate = new Date(weekRange.start);

    for (let i = 0; i < 5; i++) {
      const dateStr = format(currentDate, 'yyyy-MM-dd');
      const dayEntries = weekEntries.filter((e) => e.date === dateStr);
      const dayTotal = dayEntries.reduce((sum, e) => sum + parseFloat(e.computedAmount || '0'), 0);

      if (holidayDates.has(dateStr)) {
        dailyData.push({ day: `${days[i]} ${format(currentDate, 'dd')}`, entries: '🎉 Hol', amount: '—', status: 'holiday' });
      } else if (dayEntries.length > 0) {
        dailyData.push({ day: `${days[i]} ${format(currentDate, 'dd')}`, entries: `✓ ${dayEntries.length}`, amount: `GHC ${dayTotal}`, status: 'complete' });
      } else {
        dailyData.push({ day: `${days[i]} ${format(currentDate, 'dd')}`, entries: '○ Empty', amount: '—', status: 'empty' });
      }

      currentDate = addDays(currentDate, 1);
    }
  } catch (error) {
    console.error('Failed to fetch dashboard data:', error);
  }

  return (
    <DashboardLayout title="Dashboard" userRole={user?.role}>
      <div className="space-y-6">
        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard
            title="Total Penalties (Week)"
            value={`GHC ${weekTotal.toLocaleString()}`}
            change="+0%"
            changeType="increase"
            icon="penalty"
          />
          <StatCard
            title="Entries Recorded"
            value={weekEntries.length.toString()}
            change="+0%"
            changeType="increase"
            icon="entries"
          />
          <StatCard
            title="Staff Members"
            value={pendingCount > 0 ? pendingCount.toString() : '0'}
            change="—"
            changeType="increase"
            icon="pending"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {/* Quick Actions */}
          <Card className="col-span-1">
            <CardHeader>
              <CardTitle className="text-lg">⚡ Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link href="/entries">
                <Button className="w-full justify-start gap-2">
                  <Plus className="h-4 w-4" />
                  Enter Today's Data
                </Button>
              </Link>
              <Link href="/exports">
                <Button variant="outline" className="w-full justify-start gap-2">
                  <Download className="h-4 w-4" />
                  Export Weekly
                </Button>
              </Link>
              <Link href="/staff">
                <Button variant="outline" className="w-full justify-start gap-2">
                  <Eye className="h-4 w-4" />
                  View Staff
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Week Summary */}
          <Card className="col-span-2">
            <CardHeader>
              <CardTitle className="text-lg">📅 Week of {weekRange.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {dailyData.map((day, index) => (
                  <WeekDayRow key={index} {...day} />
                ))}
              </div>
              <div className="mt-4 border-t border-border pt-4">
                <div className="flex justify-between text-sm font-medium">
                  <span>Week Total:</span>
                  <span className="font-mono">GHC {weekTotal.toLocaleString()}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recent Activity */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">📋 Recent Activity</CardTitle>
            <Button variant="link" size="sm">
              View all
            </Button>
          </CardHeader>
          <CardContent>
            {weekEntries.length > 0 ? (
              <div className="space-y-3">
                {weekEntries.slice(-5).reverse().map((entry, index) => (
                  <ActivityItem
                    key={index}
                    text={`${entry.staff?.fullName || 'Unknown'} marked ${parseFloat(entry.computedAmount || '0') > 0 ? 'late' : 'on time'} (${entry.arrivalTime || 'N/A'})`}
                    time={entry.createdAt ? new Date(entry.createdAt).toLocaleString() : 'Recently'}
                  />
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-muted-foreground">
                <p className="text-lg mb-2">📝</p>
                <p>No entries yet this week</p>
                <p className="text-sm mt-1">Start by adding staff members and recording daily entries</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function StatCard({
  title,
  value,
  change,
  changeType,
  icon,
}: {
  title: string;
  value: string;
  change: string;
  changeType: 'increase' | 'decrease';
  icon: 'penalty' | 'entries' | 'pending';
}) {
  const icons = {
    penalty: '💰',
    entries: '📊',
    pending: '👥',
  };

  return (
    <Card>
      <CardContent className="p-6">
        <div className="text-center">
          <div className="mb-2 text-3xl">{icons[icon]}</div>
          <div className="mb-1 text-2xl font-bold font-mono">{value}</div>
          <div className="text-sm text-muted-foreground">{title}</div>
          <div
            className={`mt-2 text-xs font-medium ${
              changeType === 'increase' ? 'text-success' : 'text-danger'
            }`}
          >
            <TrendingUp
              className={`inline h-3 w-3 ${
                changeType === 'decrease' ? 'rotate-180' : ''
              }`}
            />{' '}
            {change} vs last week
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function WeekDayRow({
  day,
  entries,
  amount,
  status,
}: {
  day: string;
  entries: string;
  amount: string;
  status: string;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="font-medium">{day}</span>
      <span className={
        status === 'complete' ? 'text-success' : 
        status === 'holiday' ? 'text-muted' : 
        'text-warning'
      }>
        {entries}
      </span>
      <span className="font-mono">{amount}</span>
    </div>
  );
}

function ActivityItem({ text, time }: { text: string; time: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-1 h-2 w-2 rounded-full bg-primary" />
      <div>
        <p className="text-sm">{text}</p>
        <p className="text-xs text-muted-foreground">{time}</p>
      </div>
    </div>
  );
}
