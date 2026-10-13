'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export type StaffPickerOption = { fullName: string; hint?: string; id: string };

/**
 * Staff chooser that opens inside its dialog (not the browser's native dropdown, which can run off
 * the bottom of the screen): a search box and a short list with its own scrollbar, so every name
 * is always reachable at any screen size or zoom.
 */
export function StaffPicker({
  allLabel,
  className,
  disabled = false,
  label,
  onChange,
  options,
  placeholder = 'Select staff',
  value,
}: {
  allLabel?: string;
  className?: string;
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  options: StaffPickerOption[];
  placeholder?: string;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = options
      .filter((option) => !needle || option.fullName.toLowerCase().includes(needle))
      .sort((left, right) => left.fullName.localeCompare(right.fullName));
    return allLabel && !needle ? [{ fullName: allLabel, id: '' }, ...matches] : matches;
  }, [allLabel, options, query]);

  const selected = options.find((option) => option.id === value);
  const shown = selected?.fullName || (value === '' && allLabel) || placeholder;

  // Close when tapping anywhere outside the picker.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Keep the highlighted row in view while using the arrow keys.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function toggle() {
    if (disabled) return;
    setQuery('');
    setActive(Math.max(0, rows.findIndex((row) => row.id === value)));
    setOpen((current) => !current);
  }

  function choose(id: string) {
    onChange(id);
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(rows.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter' && rows[active]) {
      event.preventDefault();
      choose(rows[active].id);
    }
  }

  return (
    <div ref={rootRef} className={cn('relative min-w-0', className)}>
      <span className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground">{label}</span>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={toggle}
        className={cn(
          'flex h-10 w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-3 text-left text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/35 disabled:cursor-not-allowed disabled:opacity-60',
          open && 'border-primary/60',
          !selected && !(value === '' && allLabel) && 'text-muted-foreground',
        )}
      >
        <span className="truncate">{shown}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        // Floats over the fields below (like a dropdown) so the dialog never grows a second scrollbar.
        <div className="absolute inset-x-0 top-full z-50 mt-1.5 overflow-hidden rounded-md border border-border bg-card shadow-xl" onKeyDown={onKeyDown}>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              aria-label={`Search ${label.toLowerCase()}`}
              placeholder="Search name"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <ul ref={listRef} id={listId} role="listbox" aria-label={label} className="max-h-48 overflow-y-auto overscroll-contain py-1">
            {rows.map((row, index) => (
              <li
                key={row.id || 'all'}
                role="option"
                aria-selected={row.id === value}
                data-index={index}
                onPointerEnter={() => setActive(index)}
                onClick={() => choose(row.id)}
                className={cn(
                  'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm',
                  index === active && 'bg-primary/10',
                  row.id === value && 'font-semibold text-primary',
                )}
              >
                <Check className={cn('h-4 w-4 shrink-0', row.id === value ? 'opacity-100' : 'opacity-0')} />
                <span className="min-w-0 flex-1 truncate">{row.fullName}</span>
                {'hint' in row && row.hint && <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{row.hint}</span>}
              </li>
            ))}
            {rows.length === 0 && <li className="px-3 py-3 text-center text-sm text-muted-foreground">No match</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
