export const ACCRA_TIME_ZONE = 'Africa/Accra';

export function getDateKeyInTimeZone(date = new Date(), timeZone = ACCRA_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
}

export function getAccraDateKey(date = new Date()) {
  return getDateKeyInTimeZone(date, ACCRA_TIME_ZONE);
}

/** Current Accra time as HH:MM. */
export function getAccraTimeKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    timeZone: ACCRA_TIME_ZONE,
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === 'hour')?.value || '00';
  const minute = parts.find((part) => part.type === 'minute')?.value || '00';
  return `${hour === '24' ? '00' : hour}:${minute}`;
}
