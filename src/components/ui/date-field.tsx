'use client';

import { useEffect, useRef, useState } from 'react';
import { Calendar, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  formatDateInputDisplay,
  formatPartialDisplayDateInput,
  isIsoDateKey,
  parseDisplayDateInput,
} from '@/lib/date-format';
import { cn } from '@/lib/utils';

interface DateFieldProps {
  ariaLabel?: string;
  className?: string;
  clearable?: boolean;
  inputClassName?: string;
  label?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}

export function DateField({
  ariaLabel,
  className,
  clearable = false,
  inputClassName,
  label,
  onChange,
  placeholder = 'DD/MM/YYYY',
  value,
}: DateFieldProps) {
  const pickerRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState(formatDateInputDisplay(value));

  useEffect(() => {
    setText(formatDateInputDisplay(value));
  }, [value]);

  function openPicker() {
    const picker = pickerRef.current;
    if (!picker) return;

    if (typeof picker.showPicker === 'function') {
      picker.showPicker();
      return;
    }

    picker.click();
  }

  function handleTextChange(rawValue: string) {
    const nextText = formatPartialDisplayDateInput(rawValue);
    setText(nextText);

    const parsed = parseDisplayDateInput(nextText);
    if (parsed !== null) onChange(parsed);
  }

  function handleBlur() {
    const parsed = parseDisplayDateInput(text);
    if (parsed) {
      setText(formatDateInputDisplay(parsed));
      onChange(parsed);
      return;
    }

    setText(formatDateInputDisplay(value));
  }

  function clearDate() {
    setText('');
    onChange('');
  }

  return (
    <div className={className}>
      {label && (
        <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground">{label}</label>
      )}
      <div className="relative">
        <Input
          aria-label={ariaLabel || label}
          type="text"
          inputMode="numeric"
          placeholder={placeholder}
          value={text}
          onBlur={handleBlur}
          onChange={(event) => handleTextChange(event.target.value)}
          className={cn('h-10 pr-11 font-mono text-sm', clearable && text && 'pr-20', inputClassName)}
        />
        {clearable && text && (
          <button
            type="button"
            aria-label={`Clear ${label?.toLowerCase() || 'date'}`}
            onClick={clearDate}
            className="absolute right-9 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          aria-label={`Open ${label?.toLowerCase() || 'date'} picker`}
          onClick={openPicker}
          className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
        >
          <Calendar className="h-4 w-4" />
        </button>
        <input
          ref={pickerRef}
          type="date"
          value={isIsoDateKey(value) ? value : ''}
          onChange={(event) => onChange(event.target.value)}
          tabIndex={-1}
          className="pointer-events-none absolute right-2 top-2 h-6 w-6 opacity-0"
        />
      </div>
    </div>
  );
}
