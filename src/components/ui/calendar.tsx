'use client';

import * as React from 'react';
import { DayPicker, DayPickerProps } from 'react-day-picker';
import { cn } from '@/lib/utils';

export type CalendarProps = DayPickerProps;

function Calendar({ className, ...props }: CalendarProps) {
  return (
    <DayPicker className={cn('p-2', className)} {...props} />
  );
}

export { Calendar };