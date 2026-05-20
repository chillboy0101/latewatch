export const WORKDAY_START_TIME = '08:30';
export const WORKDAY_END_TIME = '17:00';
export const SIGN_OUT_START_TIME = '16:30';
export const NO_SIGN_OUT_ALERT_TIME = '20:00';
export const WORKDAY_START_LABEL = '8:30 AM';
export const WORKDAY_END_LABEL = '5:00 PM';
export const SIGN_OUT_START_LABEL = '4:30 PM';
export const NO_SIGN_OUT_ALERT_LABEL = '8:00 PM';

const MINUTE_TIME_PATTERN = /^\d{2}:\d{2}$/;

export function toMinuteTime(value: string | null | undefined) {
  return typeof value === 'string' ? value.slice(0, 5) : '';
}

export function isAfterWorkdayEnd(value: string | null | undefined) {
  const time = toMinuteTime(value);
  return MINUTE_TIME_PATTERN.test(time) && time > WORKDAY_END_TIME;
}

export function canSignOutNow(value: string | null | undefined) {
  const time = toMinuteTime(value);
  return MINUTE_TIME_PATTERN.test(time) && time >= SIGN_OUT_START_TIME;
}

export function shouldAlertNoSignOut(value: string | null | undefined) {
  const time = toMinuteTime(value);
  return MINUTE_TIME_PATTERN.test(time) && time >= NO_SIGN_OUT_ALERT_TIME;
}

export function isOnTimeCheckIn(value: string | null | undefined) {
  const time = toMinuteTime(value);
  return MINUTE_TIME_PATTERN.test(time) && time <= WORKDAY_START_TIME;
}
