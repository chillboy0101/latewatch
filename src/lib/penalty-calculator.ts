// lib/penalty-calculator.ts

import { WORKDAY_START_TIME } from '@/lib/work-hours';

export const NO_SHOW_SIGN_IN_AMOUNT = 50;
export const NO_SHOW_SIGN_IN_REASON = 'DIDN\'T SIGN IN BEFORE 4:30PM';
export const NO_SHOW_SIGN_IN_WAIVED_REASON = 'No-show waived';
export const NO_SHOW_SIGN_IN_EFFECTIVE_DATE = '2026-07-08';

interface PenaltyInput {
  arrivalTime: string | null;  // HH:MM format
  didNotSignOut: boolean;
  isAttendanceOnly?: boolean;
  isHoliday: boolean;
  isNssPersonnel?: boolean;
  noSignIn?: boolean;
}

interface PenaltyOutput {
  amount: number;
  reason: string;
}

function minutesFromTime(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function computePenalty(input: PenaltyInput): PenaltyOutput {
  const CUTOFF_TIME = WORKDAY_START_TIME;
  const BASE_PENALTY = 10;
  const HOURLY_INCREMENT = 5;
  const SIGN_OUT_PENALTY = 2;

  if (input.isAttendanceOnly) {
    return { amount: 0, reason: '' };
  }

  // Holiday: no penalty, block entry
  if (input.isHoliday) {
    return { amount: 0, reason: 'HOLIDAY' };
  }

  if (input.noSignIn) {
    return { amount: NO_SHOW_SIGN_IN_AMOUNT, reason: NO_SHOW_SIGN_IN_REASON };
  }

  // Blank time: not late
  if (!input.arrivalTime) {
    if (input.didNotSignOut) {
      return { amount: SIGN_OUT_PENALTY, reason: 'DID NOT SIGN OUT' };
    }
    return { amount: 0, reason: '' };
  }

  const isLate = input.arrivalTime > CUTOFF_TIME;

  if (!isLate && input.didNotSignOut) {
    return { amount: SIGN_OUT_PENALTY, reason: 'DID NOT SIGN OUT' };
  }

  if (isLate) {
    const base = BASE_PENALTY;

    const arrivalMinutes = minutesFromTime(input.arrivalTime);
    const cutoffMinutes = minutesFromTime(CUTOFF_TIME);
    const firstClockHourIncrement = (Math.floor(cutoffMinutes / 60) + 1) * 60 + 1;
    const clockHourIncrements = Math.max(
      0,
      Math.floor((arrivalMinutes - firstClockHourIncrement) / 60) + 1,
    );
    const hourly = input.isNssPersonnel ? 0 : HOURLY_INCREMENT * clockHourIncrements;

    let reason = 'DIDN\'T COME BEFORE 8:30AM';
    let total = Math.min(base + hourly, NO_SHOW_SIGN_IN_AMOUNT);

    if (input.didNotSignOut) {
      total += SIGN_OUT_PENALTY;
      reason = 'DIDN\'T COME BEFORE 8:30AM AND DID NOT SIGN OUT';
    }

    return { amount: total, reason };
  }

  return { amount: 0, reason: '' };
}
