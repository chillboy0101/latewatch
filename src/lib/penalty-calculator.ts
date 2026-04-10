// lib/penalty-calculator.ts

interface PenaltyInput {
  arrivalTime: string | null;  // HH:MM format
  didNotSignOut: boolean;
  isHoliday: boolean;
}

interface PenaltyOutput {
  amount: number;
  reason: string;
}

export function computePenalty(input: PenaltyInput): PenaltyOutput {
  const CUTOFF_TIME = '08:30';
  const BASE_PENALTY = 10;
  const HOURLY_INCREMENT = 5;
  const SIGN_OUT_PENALTY = 2;

  // Holiday: no penalty, block entry
  if (input.isHoliday) {
    return { amount: 0, reason: 'HOLIDAY' };
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

    // Count full hours completed after 8:30
    const [hours, minutes] = input.arrivalTime.split(':').map(Number);
    const arrivalMinutes = hours * 60 + minutes;
    const cutoffMinutes = 8 * 60 + 30; // 8:30 = 510 minutes
    const minutesLate = arrivalMinutes - cutoffMinutes;

    // Full hours completed (each 60-minute block after cutoff)
    const fullHoursLate = Math.floor(minutesLate / 60);
    const hourly = HOURLY_INCREMENT * fullHoursLate;

    let reason = 'DIDN\'T COME BEFORE 8:30AM';
    let total = base + hourly;

    if (input.didNotSignOut) {
      total += SIGN_OUT_PENALTY;
      reason = 'DIDN\'T COME BEFORE 8:30AM AND DID NOT SIGN OUT';
    }

    return { amount: total, reason };
  }

  return { amount: 0, reason: '' };
}
