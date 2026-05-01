import { addDays, eachDayOfInterval, endOfMonth, format, isWeekend, parseISO, startOfMonth } from 'date-fns';

export interface WorkingWeekRange {
  weekNumber: number;
  weekStart: string;
  weekEnd: string;
  exportStart: string;
  exportEnd: string;
  dates: string[];
}

function mondayFor(date: Date) {
  const day = date.getDay();
  const distanceToMonday = day === 0 ? -6 : 1 - day;
  return addDays(date, distanceToMonday);
}

export function getWorkweekDateKeys(weekStart: string) {
  const monday = parseISO(weekStart);
  return Array.from({ length: 5 }, (_, index) => format(addDays(monday, index), 'yyyy-MM-dd'));
}

export function getMonthWorkingWeeks(year: number, month: number): WorkingWeekRange[] {
  const monthStart = startOfMonth(new Date(year, month, 1));
  const monthEnd = endOfMonth(monthStart);
  const daysByMonday = new Map<string, Date[]>();

  for (const day of eachDayOfInterval({ start: monthStart, end: monthEnd })) {
    if (isWeekend(day)) continue;

    const mondayKey = format(mondayFor(day), 'yyyy-MM-dd');
    const days = daysByMonday.get(mondayKey) || [];
    days.push(day);
    daysByMonday.set(mondayKey, days);
  }

  return Array.from(daysByMonday.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([weekStart, days], index) => {
      const sortedDays = days.sort((left, right) => left.getTime() - right.getTime());
      const dateKeys = sortedDays.map((day) => format(day, 'yyyy-MM-dd'));

      return {
        weekNumber: index + 1,
        weekStart,
        weekEnd: format(addDays(parseISO(weekStart), 4), 'yyyy-MM-dd'),
        exportStart: dateKeys[0],
        exportEnd: dateKeys[dateKeys.length - 1],
        dates: dateKeys,
      };
    });
}
