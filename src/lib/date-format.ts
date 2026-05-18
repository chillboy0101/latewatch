const ISO_DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function isValidDateParts(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1) return false;

  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

export function isIsoDateKey(value: string | null | undefined): boolean {
  if (!value || !ISO_DATE_KEY_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  return isValidDateParts(year, month, day);
}

export function isoDateKeyToLocalDate(value: string) {
  if (!isIsoDateKey(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function formatDateInputDisplay(value: string | null | undefined) {
  if (!value) return '';
  if (!isIsoDateKey(value)) return value;

  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

export function formatPartialDisplayDateInput(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function parseDisplayDateInput(value: string | null | undefined) {
  const trimmed = value?.trim() || '';
  if (!trimmed) return '';
  if (isIsoDateKey(trimmed)) return trimmed;

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length !== 8) return null;

  const day = Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const year = Number(digits.slice(4, 8));
  if (!isValidDateParts(year, month, day)) return null;

  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function formatDisplayDate(value: Date | string | null | undefined, fallback = '-') {
  if (!value) return fallback;

  if (typeof value === 'string' && isIsoDateKey(value)) {
    return formatDateInputDisplay(value);
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function formatLongDisplayDate(value: Date | string | null | undefined, fallback = '-') {
  if (!value) return fallback;

  const date = typeof value === 'string' && isIsoDateKey(value)
    ? isoDateKeyToLocalDate(value)
    : value instanceof Date
      ? value
      : new Date(value);

  if (!date || Number.isNaN(date.getTime())) return fallback;

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'long',
    weekday: 'long',
    year: 'numeric',
  }).format(date);
}

export function formatShortDisplayDate(value: Date | string | null | undefined, fallback = '-') {
  if (!value) return fallback;

  const date = typeof value === 'string' && isIsoDateKey(value)
    ? isoDateKeyToLocalDate(value)
    : value instanceof Date
      ? value
      : new Date(value);

  if (!date || Number.isNaN(date.getTime())) return fallback;

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
  }).format(date);
}

export function formatDisplayDateTime(value: Date | string | null | undefined, fallback = '-') {
  if (!value) return fallback;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;

  return `${formatDisplayDate(date)} ${new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)}`;
}
