export type PhoneOs = 'android' | 'ios' | 'other';

// Which phone system this is, for showing the right steps (installing, turning location on).
export function detectPhoneOs(): PhoneOs {
  if (typeof window === 'undefined') return 'other';

  const userAgent = window.navigator.userAgent.toLowerCase();
  const platform = window.navigator.platform?.toLowerCase() || '';
  const maxTouchPoints = window.navigator.maxTouchPoints || 0;
  const isIpadOS = platform.includes('mac') && maxTouchPoints > 1;

  if (/iphone|ipad|ipod/.test(userAgent) || isIpadOS) return 'ios';
  if (/android/.test(userAgent)) return 'android';
  return 'other';
}
