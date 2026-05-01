export const WORKDAY_START_TIME = '08:30';
export const WORKDAY_END_TIME = '17:00';
export const WORKDAY_START_LABEL = '8:30 AM';
export const WORKDAY_END_LABEL = '5:00 PM';

const MINUTE_TIME_PATTERN = /^\d{2}:\d{2}$/;

export function toMinuteTime(value: string | null | undefined) {
  return typeof value === 'string' ? value.slice(0, 5) : '';
}

export function isAfterWorkdayEnd(value: string | null | undefined) {
  const time = toMinuteTime(value);
  return MINUTE_TIME_PATTERN.test(time) && time > WORKDAY_END_TIME;
}
