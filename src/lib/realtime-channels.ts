// Live-update channel names shared by the server (publishing, tokens) and the browser (listening).

// Every signed-in staff member may listen to these (the check-in page uses them), so updates on
// them never say who they are about: one about a single person is only marked `personal: true`
// there, and goes in full to that person's own channel.
export const STAFF_CHANNELS = ['attendance', 'notifications', 'staff-penalty-history'] as const;

export function isStaffChannel(channel: string) {
  return (STAFF_CHANNELS as readonly string[]).includes(channel);
}

// One staff member's own updates: only they (and admins) may listen.
export function staffMemberChannel(staffId: string) {
  return `staff:${staffId}`;
}

// Where the browser listens to its own channel when Ably is unavailable. The server works out
// whose channel it is from the login; the browser never names it.
export const OWN_CHANNEL_STREAM_PATH = '/api/realtime/me';
