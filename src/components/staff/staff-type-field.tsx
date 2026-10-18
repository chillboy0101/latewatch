'use client';

import { ChevronDown } from 'lucide-react';
import { DateField } from '@/components/ui/date-field';
import { formatDateInputDisplay } from '@/lib/date-format';
import {
  allowedStaffTypes,
  STAFF_TYPE_CHARGE_NOTES,
  STAFF_TYPE_LABELS,
  STAFF_TYPES,
  type StaffType,
} from '@/lib/staff-type';

// One choice of type. With `current`, only that type and later ones can be picked
// (intern → NSS → special staff → main staff; main staff is final).
export function StaffTypeField({
  current,
  id,
  onChange,
  value,
}: {
  current?: StaffType;
  id: string;
  onChange: (type: StaffType) => void;
  value: StaffType;
}) {
  const options = current ? allowedStaffTypes(current) : [...STAFF_TYPES];
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">Type</label>
      <div className="relative">
        <select
          id={id}
          className="h-10 w-full appearance-none rounded-md border border-border bg-background px-3 pr-9 text-sm leading-none outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
          value={value}
          disabled={options.length === 1}
          onChange={(event) => onChange(event.target.value as StaffType)}
        >
          {options.map((type) => (
            <option key={type} value={type}>{STAFF_TYPE_LABELS[type]}</option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      </div>
      <p className="text-xs text-muted-foreground">
        {current === 'main' ? 'Main staff stay main staff.' : STAFF_TYPE_CHARGE_NOTES[value]}
      </p>
    </div>
  );
}

// The date a new type (or a return) starts; earlier days keep the old type.
export function StaffTypeFromField({
  label = 'From',
  onChange,
  previous,
  value,
}: {
  label?: string;
  onChange: (value: string) => void;
  previous?: StaffType;
  value: string;
}) {
  return (
    <div className="space-y-1.5">
      <DateField label={label} value={value} onChange={onChange} />
      {previous && value && (
        <p className="text-xs text-muted-foreground">
          Days before {formatDateInputDisplay(value)} stay {STAFF_TYPE_LABELS[previous]}.
        </p>
      )}
    </div>
  );
}
