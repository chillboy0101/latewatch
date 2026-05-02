export function normalizeStaffEmail(value: unknown) {
  return typeof value === 'string' && value.trim()
    ? value.trim().toLowerCase()
    : null;
}

export function normalizeStaffName(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return '';

  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}
