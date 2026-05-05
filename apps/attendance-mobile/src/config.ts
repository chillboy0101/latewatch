export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL || 'https://latewatch.vercel.app'
).replace(/\/+$/, '');

export const CLERK_ORGANIZATION_ID =
  process.env.EXPO_PUBLIC_CLERK_ORGANIZATION_ID?.trim() || undefined;

export const CLERK_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() || '';
