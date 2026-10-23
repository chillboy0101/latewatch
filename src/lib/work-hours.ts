export const WORKDAY_START_TIME = '08:30';
export const WORKDAY_END_TIME = '17:00';
export const SIGN_OUT_START_TIME = '16:30';
export const NO_SHOW_SIGN_IN_CUTOFF_TIME = '16:30';
export const NO_SIGN_OUT_ALERT_TIME = '20:00';
export const WORKDAY_START_LABEL = '8:30 AM';
export const WORKDAY_END_LABEL = '5:00 PM';
export const SIGN_OUT_START_LABEL = '4:30 PM';
export const NO_SHOW_SIGN_IN_CUTOFF_LABEL = '4:30 PM';
export const NO_SIGN_OUT_ALERT_LABEL = '8:00 PM';

const MINUTE_TIME_PATTERN = /^\d{2}:\d{2}$/;

export function toMinuteTime(value: string | null | undefined) {
  return typeof value === 'string' ? value.slice(0, 5) : '';
}

/**
 * Sign-in closes when the no sign-in fee applies (4:30 PM), so a late sign-in can never
 * replace that fee with a bigger late fee.
 */
export function isSignInClosed(value: string | null | undefined) {
  const time = toMinuteTime(value);
  return MINUTE_TIME_PATTERN.test(time) && time >= NO_SHOW_SIGN_IN_CUTOFF_TIME;
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

// The GHC 2 no-sign-out charge was dropped for all of October 2026 onwards; earlier days keep it.
export const NO_SIGN_OUT_CHARGE_END_DATE = '2026-10-01';

// A missing or malformed date keeps the charge (fails closed) rather than silently dropping it.
export function chargesNoSignOut(dateKey: string) {
  if (typeof dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return true;
  const day = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== dateKey) return true;
  return dateKey < NO_SIGN_OUT_CHARGE_END_DATE;
}

/**
 * The no-sign-out charge belongs to a finished day: any past day, or today once the
 * no-sign-out cut-off has passed. Before that a missing sign-out is simply "not yet".
 */
export function isNoSignOutChargeDue(dateKey: string, todayKey: string, nowTimeKey: string) {
  if (!chargesNoSignOut(dateKey)) return false;
  if (dateKey < todayKey) return true;
  if (dateKey > todayKey) return false;
  return shouldAlertNoSignOut(nowTimeKey);
}
