// lib/utils.ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return `GHC ${amount.toFixed(2)}`;
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatTime(time: string): string {
  if (!time) return '';
  const [hours, minutes] = time.split(':');
  const h = parseInt(hours, 10);
  const m = parseInt(minutes, 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 || 12;
  return `${displayH}:${m.toString().padStart(2, '0')} ${ampm}`;
}

export function getWeekRange(date: Date): { start: Date; end: Date } {
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Monday start
  const start = new Date(date.setDate(diff));
  const end = new Date(start);
  end.setDate(start.getDate() + 4); // Friday
  return { start, end };
}

export function getMonthWeeks(year: number, month: number): { start: Date; end: Date }[] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const weeks: { start: Date; end: Date }[] = [];
  
  let current = new Date(firstDay);
  while (current <= lastDay) {
    const weekStart = new Date(current);
    const weekEnd = new Date(current);
    weekEnd.setDate(current.getDate() + 4); // Friday
    
    if (weekEnd > lastDay) {
      weekEnd.setTime(lastDay.getTime());
    }
    
    weeks.push({ start: weekStart, end: weekEnd });
    current.setDate(current.getDate() + 7);
  }
  
  return weeks;
}
