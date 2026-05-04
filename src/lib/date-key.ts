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
