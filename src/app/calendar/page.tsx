'use client';

import { useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { LoadingBuffer } from '@/components/ui/loading-buffer';

const GOOGLE_GHANA_HOLIDAYS_EMBED =
  'https://calendar.google.com/calendar/embed?src=en.gh%23holiday%40group.v.calendar.google.com&ctz=Africa%2FAccra&showTitle=0&showPrint=0&showCalendars=0&showTz=0&mode=MONTH';

function useDarkTheme() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => setIsDark(root.classList.contains('dark'));

    syncTheme();

    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributeFilter: ['class'], attributes: true });

    return () => observer.disconnect();
  }, []);

  return isDark;
}

export default function CalendarPage() {
  const isDark = useDarkTheme();
  const [loadedCalendarSrc, setLoadedCalendarSrc] = useState('');
  const calendarSrc = useMemo(() => {
    const background = isDark ? '111827' : 'ffffff';

    return `${GOOGLE_GHANA_HOLIDAYS_EMBED}&bgcolor=%23${background}`;
  }, [isDark]);
  const calendarLoaded = loadedCalendarSrc === calendarSrc;

  return (
    <DashboardLayout title="Calendar">
      <div className="google-calendar-shell relative h-[calc(100dvh-112px)] min-h-0 overflow-hidden rounded-md border border-border bg-background">
        {!calendarLoaded && (
          <LoadingBuffer
            variant="section"
            label="Loading calendar"
            description="Opening Ghana public holidays."
            className="absolute inset-0 z-10 min-h-0 bg-background py-0"
          />
        )}
        <iframe
          key={calendarSrc}
          title="Google Ghana public holidays calendar"
          src={calendarSrc}
          className={`google-calendar-frame h-full w-full border-0 bg-background transition-opacity duration-200 ${isDark ? 'google-calendar-frame-dark' : ''} ${calendarLoaded ? 'opacity-100' : 'opacity-0'}`}
          loading="lazy"
          onLoad={() => setLoadedCalendarSrc(calendarSrc)}
          scrolling="no"
        />
      </div>
    </DashboardLayout>
  );
}
