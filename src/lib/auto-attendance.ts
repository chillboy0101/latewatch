export const AUTO_ATTENDANCE_DEBOUNCE_MS = 2 * 60 * 1000;

type AutoAttendanceAction = 'check_in' | 'sign_out';

export function resolveAutoAttendanceAction(input: {
  autoCheckInEnabled: boolean;
  autoSignOutEnabled: boolean;
  canCheckIn: boolean;
  canSubmitSignOut: boolean;
  lastAutoActionAt?: number | null;
  now?: number;
  officeVerified: boolean;
}) {
  if (!input.officeVerified) return null;

  const now = input.now ?? Date.now();
  if (input.lastAutoActionAt && now - input.lastAutoActionAt < AUTO_ATTENDANCE_DEBOUNCE_MS) {
    return null;
  }

  if (input.autoSignOutEnabled && input.canSubmitSignOut) {
    return 'sign_out' satisfies AutoAttendanceAction;
  }

  if (input.autoCheckInEnabled && input.canCheckIn) {
    return 'check_in' satisfies AutoAttendanceAction;
  }

  return null;
}
