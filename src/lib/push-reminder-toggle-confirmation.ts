export type ReminderToggleState = {
  signInEnabled: boolean;
  signOutEnabled: boolean;
};

export type ReminderToggleConfirmation = ReminderToggleState & {
  body: string;
  title: 'Reminder turned on';
};

function reminderToggleConfirmationBody(state: ReminderToggleState) {
  if (state.signInEnabled && state.signOutEnabled) {
    return 'Sign-in and sign-out reminders are now active on this device.';
  }

  if (state.signInEnabled) {
    return 'Sign-in reminder is now active on this device.';
  }

  return 'Sign-out reminder is now active on this device.';
}

export function getEnabledReminderToggleConfirmation(
  previous: ReminderToggleState,
  next: ReminderToggleState,
): ReminderToggleConfirmation | null {
  const enabled = {
    signInEnabled: next.signInEnabled && !previous.signInEnabled,
    signOutEnabled: next.signOutEnabled && !previous.signOutEnabled,
  };

  if (!enabled.signInEnabled && !enabled.signOutEnabled) return null;

  return {
    ...enabled,
    body: reminderToggleConfirmationBody(enabled),
    title: 'Reminder turned on',
  };
}
