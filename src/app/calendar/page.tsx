'use client';

import { useState } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { LoadingBuffer } from '@/components/ui/loading-buffer';

const GOOGLE_GHANA_HOLIDAYS_EMBED =
  'https://calendar.google.com/calendar/embed?src=en.gh%23holiday%40group.v.calendar.google.com&ctz=Africa%2FAccra&showTitle=0&showPrint=0&showCalendars=0&showTz=0&mode=MONTH';

export default function CalendarPage() {
  const [calendarLoaded, setCalendarLoaded] = useState(false);

  return (
    <DashboardLayout title="Calendar">
      <div className="relative h-[calc(100dvh-112px)] min-h-0 overflow-hidden rounded-md border border-border bg-background">
        {!calendarLoaded && (
          <LoadingBuffer
            variant="section"
            label="Loading calendar"
            description="Opening Ghana public holidays."
            className="absolute inset-0 z-10 min-h-0 bg-background py-0"
          />
        )}
        <iframe
          title="Google Ghana public holidays calendar"
          src={GOOGLE_GHANA_HOLIDAYS_EMBED}
          className={`h-full w-full border-0 bg-background transition-opacity duration-200 ${calendarLoaded ? 'opacity-100' : 'opacity-0'}`}
          loading="lazy"
          onLoad={() => setCalendarLoaded(true)}
          scrolling="no"
        />
      </div>
    </DashboardLayout>
  );
}
