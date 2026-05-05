# LateWatch Attendance Mobile

Production-intended Expo app for staff check-in and check-out.

Expo Go is the temporary runtime until the Apple Developer and Google Play accounts are ready. The app still uses the real LateWatch backend, Clerk login, SecureStore device binding, biometric/passcode confirmation, and GPS geofence evidence.

## Setup

1. Copy `.env.example` to `.env`.
2. Set `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`.
3. Keep `EXPO_PUBLIC_API_URL=https://latewatch.vercel.app` for live use.
4. Run:

```bash
npm install
npm start
```

Staff scan the Expo QR in Expo Go, sign in with their invited Clerk account, and record attendance from their trusted device at the office location.

## Security Flow

- First valid office check-in links the staff profile to this phone through a SecureStore device secret.
- Every check-in and sign-out requires Clerk session, device secret, biometric/passcode confirmation, and fresh accurate GPS evidence.
- New phones or browsers are blocked until the staff requests a device transfer and an admin approves it.
- Mocked, stale, weak, denied, or outside-office locations are rejected by the server and audited.
