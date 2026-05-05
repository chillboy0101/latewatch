/* eslint-disable jsx-a11y/alt-text */
import { ClerkLoaded, ClerkProvider, useAuth, useClerk, useNativeSession, useSSO, useUser, useUserProfileModal } from '@clerk/expo';
import { useSignIn as useLegacySignIn } from '@clerk/expo/legacy';
import { tokenCache } from '@clerk/expo/token-cache';
import * as Linking from 'expo-linking';
import * as LocalAuthentication from 'expo-local-authentication';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import type { ComponentType, ReactElement, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import type { RefreshControlProps } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { getAttendanceStatus, requestDeviceTransfer, submitAttendanceAction } from './src/api';
import { CLERK_PUBLISHABLE_KEY } from './src/config';
import { getDeviceLabel, getOrCreateDeviceToken } from './src/device';
import { getFreshLocationEvidence } from './src/location';
import type { AttendanceStatus } from './src/types';
import logo from './assets/latewatch-logo.png';

WebBrowser.maybeCompleteAuthSession();

type GetToken = (options?: { organizationId?: string; skipCache?: boolean }) => Promise<string | null>;

const palettes = {
  dark: {
    background: '#09090b',
    border: '#27272a',
    card: '#0f1117',
    danger: '#f87171',
    dangerSoft: '#2f1116',
    foreground: '#fafafa',
    muted: '#a1a1aa',
    primary: '#8fa9f4',
    primarySoft: '#15234a',
    success: '#10b981',
    successSoft: '#062c24',
    warning: '#f59e0b',
    warningSoft: '#35230a',
  },
  light: {
    background: '#ffffff',
    border: '#e5e7eb',
    card: '#ffffff',
    danger: '#dc2626',
    dangerSoft: '#fef2f2',
    foreground: '#020617',
    muted: '#94a3b8',
    primary: '#89a8f3',
    primarySoft: '#edf3ff',
    success: '#00b981',
    successSoft: '#e3f7ef',
    warning: '#d97706',
    warningSoft: '#fff7ed',
  },
};

type Palette = typeof palettes.light;
type MessageTone = 'danger' | 'success' | 'warning';
type StatusTone = 'neutral' | 'primary' | 'success' | 'warning';
type ClerkNativeUi = {
  AuthView: ComponentType<{ isDismissable?: boolean; mode?: 'signIn' | 'signUp' | 'signInOrUp' }>;
  UserButton: ComponentType;
};

declare const require: (id: string) => unknown;

function loadClerkNativeUi() {
  try {
    return require('@clerk/expo/native') as ClerkNativeUi;
  } catch {
    return null;
  }
}

function canSignOut(status: AttendanceStatus | null) {
  return Boolean(status?.attendance && !status.attendance.signOutTime && status.time.slice(0, 5) >= '16:30');
}

function statusTitle(status: AttendanceStatus | null) {
  if (!status) return 'Checking your attendance status';
  if (!status.locationConfigured) return 'Office location not configured';
  if (!status.staff) return 'Profile not matched';
  if (status.device?.registered && !status.device.trusted) return 'Registered device required';
  if (status.permission?.permissionType === 'absence') return 'Permission recorded';
  if (status.isHoliday) return status.holidayName || 'Public holiday';
  if (status.isWeekend) return 'Weekend';
  if (status.attendance?.signOutTime) return 'Checked out';
  if (status.attendance?.status === 'late') return 'Late check-in recorded';
  if (status.attendance?.status === 'present') return 'Checked in';
  if (status.isAfterWorkdayEnd) return 'Check-ins closed';
  return 'Ready to check in';
}

function statusDetail(status: AttendanceStatus | null, fallbackName: string | null | undefined) {
  const person = status?.staff?.fullName || fallbackName || 'Signed-in user';
  if (!status) return 'Verifying your account, location, and today\'s work calendar.';
  if (!status.locationConfigured) return 'Ask an admin to save the office location before staff check in.';
  if (!status.staff) {
    return 'Your login could not be matched to a staff profile yet. Ask an admin to confirm your staff email or staff name.';
  }
  if (status.device?.registered && !status.device.trusted) {
    return status.transferRequest
      ? 'Your device transfer request is waiting for admin approval.'
      : 'This account is linked to another device. Ask an admin to reset the attendance device.';
  }
  if (status.permission?.permissionType === 'absence') return 'You have an approved absence for today. No check-in is required.';
  if (status.isHoliday) return 'Check-ins are disabled today in observance of the public holiday.';
  if (status.isWeekend) return 'You cannot check in today because attendance check-in is closed on weekends.';
  if (status.attendance?.signOutTime) return `${person}, you have checked out for today.`;
  if (status.attendance && !canSignOut(status)) return `You can check out from ${status.signOutStartLabel}.`;
  if (status.attendance?.status === 'late') return `${person}, your late check-in has been recorded.`;
  if (status.attendance?.status === 'present') return `${person}, you are checked in for today.`;
  if (status.isAfterWorkdayEnd) return `Check-ins are closed after ${status.workdayEndLabel}. Ask an admin to correct attendance if needed.`;
  if (status.permission?.permissionType === 'late_arrival') return 'Your late arrival has been approved for today.';
  return `${person}, you can check in now.`;
}

function actionLabel(status: AttendanceStatus | null, busy: boolean) {
  if (busy) return status?.attendance && !status.attendance.signOutTime ? 'Checking out' : 'Checking in';
  if (status?.attendance?.signOutTime) return 'Already Checked Out';
  if (status?.attendance) return canSignOut(status) ? 'Check Out' : `Check Out Opens ${status.signOutStartLabel}`;
  if (status?.isHoliday) return 'Closed - Holiday';
  if (status?.isWeekend) return 'Closed - Weekend';
  if (status?.isAfterWorkdayEnd) return 'Closed - After Hours';
  if (status && !status.locationConfigured) return 'Location Not Configured';
  if (status && !status.staff) return 'Profile Not Matched';
  if (status?.device?.registered && !status.device.trusted) return 'Registered Device Required';
  if (status?.permission?.permissionType === 'absence') return 'Excused - No Check-In';
  return 'Check In';
}

function canSubmit(status: AttendanceStatus | null) {
  if (!status?.locationConfigured || !status.staff) return false;
  if (status.device?.registered && !status.device.trusted) return false;
  if (status.isHoliday || status.isWeekend) return false;
  if (status.permission?.permissionType === 'absence') return false;
  if (status.attendance && !status.attendance.signOutTime) return canSignOut(status);
  if (status.attendance?.signOutTime) return false;
  return !status.isAfterWorkdayEnd;
}

function statusTone(status: AttendanceStatus | null): StatusTone {
  if (!status) return 'neutral';
  if (status.attendance?.signOutTime || status.attendance?.status === 'present') return 'success';
  if (status.device?.registered && !status.device.trusted) return 'success';
  if (status.permission?.permissionType === 'absence') return 'primary';
  if (status.attendance?.status === 'late') return 'warning';
  if (!status.locationConfigured || !status.staff || status.isHoliday || status.isWeekend || status.isAfterWorkdayEnd) {
    return 'warning';
  }
  return 'primary';
}

function toneColors(palette: Palette, tone: StatusTone) {
  if (tone === 'success') {
    return {
      backgroundColor: palette.successSoft,
      borderColor: '#9debd5',
      color: palette.success,
    };
  }

  if (tone === 'warning') {
    return {
      backgroundColor: palette.warningSoft,
      borderColor: '#fed7aa',
      color: palette.warning,
    };
  }

  if (tone === 'primary') {
    return {
      backgroundColor: palette.primarySoft,
      borderColor: '#bfdbfe',
      color: palette.primary,
    };
  }

  return {
    backgroundColor: palette.card,
    borderColor: palette.border,
    color: palette.muted,
  };
}

function shouldShowCheckIcon(status: AttendanceStatus | null) {
  return Boolean(status?.attendance || (status?.device?.registered && !status.device.trusted));
}

async function confirmPresence() {
  const result = await LocalAuthentication.authenticateAsync({
    cancelLabel: 'Cancel',
    disableDeviceFallback: false,
    fallbackLabel: 'Use passcode',
    promptMessage: 'Confirm LateWatch attendance',
  });

  if (!result.success) {
    throw new Error('Attendance confirmation was cancelled.');
  }
}

export default function App() {
  const scheme = useColorScheme();
  const palette = palettes[scheme === 'dark' ? 'dark' : 'light'];

  if (!CLERK_PUBLISHABLE_KEY) {
    return (
      <SafeAreaProvider>
        <Shell palette={palette}>
          <PortalHeader palette={palette} />
          <PortalCard palette={palette}>
            <MessageCard
              detail="Add EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY to apps/attendance-mobile/.env before running the app."
              palette={palette}
              title="Clerk key missing"
              tone="warning"
            />
          </PortalCard>
        </Shell>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
        <ClerkLoaded>
          <AuthGate palette={palette} />
        </ClerkLoaded>
      </ClerkProvider>
    </SafeAreaProvider>
  );
}

function AuthGate({ palette }: { palette: Palette }) {
  const auth = useAuth();

  if (!auth.isLoaded) {
    return (
      <Shell palette={palette}>
        <PortalHeader palette={palette} />
        <PortalCard palette={palette}>
          <LoadingCard palette={palette} title="Loading check-in" />
        </PortalCard>
      </Shell>
    );
  }

  if (!auth.isSignedIn) {
    return <SignInScreen palette={palette} />;
  }

  return <AttendanceScreen getToken={auth.getToken} palette={palette} />;
}

function SignInScreen({ palette }: { palette: Palette }) {
  const { startSSOFlow } = useSSO();
  const { isAvailable: nativeClerkUiAvailable } = useNativeSession();
  const { isLoaded: isPasswordSignInLoaded, setActive: setPasswordSessionActive, signIn } = useLegacySignIn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busyProvider, setBusyProvider] = useState<'apple' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const nativeUi = nativeClerkUiAvailable ? loadClerkNativeUi() : null;
  const NativeAuthView = nativeUi?.AuthView;

  async function start(provider: 'apple' | 'google') {
    setBusyProvider(provider);
    setError(null);

    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        redirectUrl: Linking.createURL('/'),
        strategy: provider === 'google' ? 'oauth_google' : 'oauth_apple',
      });

      if (!createdSessionId) {
        throw new Error('Sign-in was not completed.');
      }

      await setActive?.({ session: createdSessionId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusyProvider(null);
    }
  }

  async function startPasswordSignIn() {
    const identifier = email.trim();

    if (!identifier || !password) {
      setError('Enter your email and password to continue.');
      return;
    }

    if (!isPasswordSignInLoaded || !signIn) {
      setError('Clerk is still loading. Try again in a moment.');
      return;
    }

    setPasswordBusy(true);
    setError(null);

    try {
      const result = await signIn.create({
        identifier,
        password,
        strategy: 'password',
      });

      if (result.status !== 'complete' || !result.createdSessionId) {
        throw new Error('This sign-in needs another verification step. Use Google or Apple to continue for now.');
      }

      await setPasswordSessionActive?.({ session: result.createdSessionId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setPasswordBusy(false);
    }
  }

  return (
    <AuthShell palette={palette}>
      {NativeAuthView ? (
        <View style={{
          backgroundColor: palette.card,
          borderColor: palette.border,
          borderRadius: 12,
          borderWidth: 1,
          height: 560,
          maxWidth: 410,
          overflow: 'hidden',
          width: '100%',
        }}>
          <NativeAuthView isDismissable={false} mode="signIn" />
        </View>
      ) : (
        <ExpoGoClerkAuthCard
          busyProvider={busyProvider}
          email={email}
          error={error}
          onApple={() => start('apple')}
          onGoogle={() => start('google')}
          onEmailChange={setEmail}
          onPasswordChange={setPassword}
          onPasswordSubmit={startPasswordSignIn}
          palette={palette}
          password={password}
          passwordBusy={passwordBusy}
        />
      )}
    </AuthShell>
  );
}

function AttendanceScreen({
  getToken,
  palette,
}: {
  getToken: GetToken;
  palette: Palette;
}) {
  const { signOut } = useClerk();
  const { user } = useUser();
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [status, setStatus] = useState<AttendanceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [requestingTransfer, setRequestingTransfer] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: MessageTone } | null>(null);

  const loadStatus = useCallback(async (token: string, silent = false) => {
    if (!silent) setLoading(true);
    setMessage(null);

    try {
      const nextStatus = await getAttendanceStatus({ deviceToken: token, getToken });
      setStatus(nextStatus);
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : 'Could not load attendance status',
        tone: 'danger',
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getToken]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const token = await getOrCreateDeviceToken();
        if (!mounted) return;
        setDeviceToken(token);
        await loadStatus(token);
      } catch (err) {
        if (!mounted) return;
        setLoading(false);
        setMessage({
          text: err instanceof Error ? err.message : 'Could not prepare this device',
          tone: 'danger',
        });
      }
    })();

    return () => {
      mounted = false;
    };
  }, [loadStatus]);

  const displayName = status?.staff?.fullName || user?.fullName || user?.primaryEmailAddress?.emailAddress || 'Staff member';
  const blockedDevice = Boolean(status?.device?.registered && !status.device.trusted);
  const action = status?.attendance && !status.attendance.signOutTime ? 'sign_out' : 'check_in';
  const tone = useMemo(() => statusTone(status), [status]);

  const refresh = useCallback(async () => {
    if (!deviceToken) return;
    setRefreshing(true);
    await loadStatus(deviceToken, true);
  }, [deviceToken, loadStatus]);

  async function submit() {
    if (!deviceToken) return;
    setSubmitting(true);
    setMessage(null);

    try {
      await confirmPresence();
      const location = await getFreshLocationEvidence();
      const nextStatus = await submitAttendanceAction({
        action,
        deviceLabel: getDeviceLabel(),
        deviceToken,
        getToken,
        location,
      });

      setStatus(nextStatus);
      setMessage({
        text: action === 'sign_out'
          ? 'You have checked out for today.'
          : 'You have checked in for today.',
        tone: 'success',
      });
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : 'Attendance action failed',
        tone: 'danger',
      });
      await loadStatus(deviceToken, true);
    } finally {
      setSubmitting(false);
    }
  }

  async function transferDevice() {
    if (!deviceToken) return;
    setRequestingTransfer(true);
    setMessage(null);

    try {
      await confirmPresence();
      const location = await getFreshLocationEvidence();
      const nextStatus = await requestDeviceTransfer({
        deviceLabel: getDeviceLabel(),
        deviceToken,
        getToken,
        location,
      });

      setStatus(nextStatus);
      setMessage({
        text: 'Device transfer request sent. Approve it from the attendance portal.',
        tone: 'success',
      });
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : 'Could not request device transfer',
        tone: 'danger',
      });
      await loadStatus(deviceToken, true);
    } finally {
      setRequestingTransfer(false);
    }
  }

  return (
    <Shell
      palette={palette}
      refreshControl={(
        <RefreshControl
          refreshing={refreshing}
          tintColor={palette.primary}
          onRefresh={refresh}
        />
      )}
    >
      <PortalHeader
        accountEmail={user?.primaryEmailAddress?.emailAddress || null}
        avatarLabel={displayName}
        onSignOut={() => signOut()}
        palette={palette}
        showAccount
      />
      <PortalCard palette={palette}>
        {loading ? (
          <LoadingCard palette={palette} title="Loading check-in" />
        ) : (
          <View style={{ gap: 14, padding: 14 }}>
            <StatusPanel
              detail={statusDetail(status, user?.primaryEmailAddress?.emailAddress)}
              name={displayName}
              palette={palette}
              showCheck={shouldShowCheckIcon(status)}
              status={status}
              title={statusTitle(status)}
              tone={tone}
            />

            <AttendanceDetails palette={palette} status={status} />

            {message && <InlineMessage message={message.text} palette={palette} tone={message.tone} />}

            <PrimaryButton
              disabled={!canSubmit(status)}
              label={actionLabel(status, submitting)}
              loading={submitting}
              onPress={submit}
              palette={palette}
            />

            {blockedDevice && (
              <PrimaryButton
                disabled={Boolean(status?.transferRequest)}
                label={status?.transferRequest ? 'Transfer Request Pending' : 'Request Device Transfer'}
                loading={requestingTransfer}
                onPress={transferDevice}
                palette={palette}
                variant="outline"
              />
            )}
          </View>
        )}
      </PortalCard>
    </Shell>
  );
}

function AuthShell({
  children,
  palette,
}: {
  children: ReactNode;
  palette: Palette;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  return (
    <View style={{ backgroundColor: palette.background, flex: 1, overflow: 'hidden' }}>
      <StatusBar style={palette.background === palettes.dark.background ? 'light' : 'dark'} />
      <View
        pointerEvents="none"
        style={{
          backgroundColor: palette.primarySoft,
          bottom: 0,
          left: 0,
          opacity: palette.background === palettes.dark.background ? 0.16 : 0.42,
          position: 'absolute',
          right: 0,
          top: 0,
        }}
      />
      <View
        pointerEvents="none"
        style={{
          backgroundColor: palette.background,
          bottom: 0,
          left: 0,
          opacity: 0.76,
          position: 'absolute',
          right: 0,
          top: 0,
        }}
      />
      <AuthWatermark palette={palette} />
      <ScrollView
        contentContainerStyle={{
          alignItems: 'center',
          flexGrow: 1,
          justifyContent: 'center',
          minHeight: Math.max(520, height - insets.top - insets.bottom),
          paddingBottom: Math.max(insets.bottom + 24, 34),
          paddingHorizontal: 18,
          paddingTop: Math.max(insets.top + 24, 34),
        }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ maxWidth: 430, width: '100%' }}>
          {children}
        </View>
      </ScrollView>
    </View>
  );
}

function AuthWatermark({ palette }: { palette: Palette }) {
  const { height, width } = useWindowDimensions();
  const drift = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const isCompact = width <= 640 || (height <= 720 && width <= 900);
  const markSize = isCompact ? Math.min(940, Math.max(760, width * 2.35)) : Math.min(1280, Math.max(width, height) * 1.18);
  const ringInset = isCompact ? markSize * 0.1 : markSize * 0.16;
  const ringSize = markSize - ringInset * 2;
  const coreSize = markSize * (isCompact ? 0.3 : 0.33);
  const dotSize = markSize * 0.18;
  const primary = palette.background === palettes.dark.background ? 'rgba(143, 169, 244, 1)' : 'rgba(137, 168, 243, 1)';

  useEffect(() => {
    const driftLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, {
          duration: 4000,
          easing: Easing.inOut(Easing.sin),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(drift, {
          duration: 4000,
          easing: Easing.inOut(Easing.sin),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    const spinLoop = Animated.loop(
      Animated.timing(spin, {
        duration: 8500,
        easing: Easing.linear,
        toValue: 1,
        useNativeDriver: true,
      }),
    );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 1600,
          easing: Easing.inOut(Easing.sin),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 1600,
          easing: Easing.inOut(Easing.sin),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );

    driftLoop.start();
    spinLoop.start();
    pulseLoop.start();

    return () => {
      driftLoop.stop();
      spinLoop.stop();
      pulseLoop.stop();
    };
  }, [drift, pulse, spin]);

  const translateX = drift.interpolate({
    inputRange: [0, 1],
    outputRange: isCompact ? [-6, 7] : [-22, 19],
  });
  const translateY = drift.interpolate({
    inputRange: [0, 1],
    outputRange: isCompact ? [6, -7] : [11, -14],
  });
  const floatScale = drift.interpolate({
    inputRange: [0, 1],
    outputRange: isCompact ? [1, 1.02] : [0.98, 1.03],
  });
  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  const coreScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.92, 1],
  });
  const coreOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.72, 1],
  });

  return (
    <View
      pointerEvents="none"
      style={{
        alignItems: 'center',
        bottom: 0,
        justifyContent: 'center',
        left: 0,
        overflow: 'hidden',
        position: 'absolute',
        right: 0,
        top: 0,
      }}
    >
      <Animated.View
        style={{
          alignItems: 'center',
          height: markSize,
          justifyContent: 'center',
          opacity: palette.background === palettes.dark.background ? 0.34 : isCompact ? 0.72 : 0.28,
          transform: [{ translateX }, { translateY }, { scale: floatScale }],
          width: markSize,
        }}
      >
        <Animated.View
          style={{
            borderColor: 'rgba(137, 168, 243, 0.28)',
            borderRadius: 9999,
            borderRightColor: 'rgba(137, 168, 243, 0.7)',
            borderTopColor: 'rgba(137, 168, 243, 0.92)',
            borderWidth: isCompact ? Math.min(26, Math.max(16, width * 0.056)) : 18,
            height: ringSize,
            position: 'absolute',
            transform: [{ rotate }],
            width: ringSize,
          }}
        />
        <Animated.View
          style={{
            backgroundColor: primary,
            borderRadius: 9999,
            height: coreSize,
            opacity: coreOpacity,
            transform: [{ scale: coreScale }],
            width: coreSize,
          }}
        />
        <View
          style={{
            backgroundColor: primary,
            borderColor: palette.background,
            borderRadius: 9999,
            borderWidth: isCompact ? Math.min(12, Math.max(7, width * 0.025)) : 10,
            height: dotSize,
            position: 'absolute',
            right: markSize * 0.17,
            top: markSize * 0.17,
            width: dotSize,
          }}
        />
      </Animated.View>
    </View>
  );
}

function ExpoGoClerkAuthCard({
  busyProvider,
  email,
  error,
  onApple,
  onEmailChange,
  onGoogle,
  onPasswordChange,
  onPasswordSubmit,
  palette,
  password,
  passwordBusy,
}: {
  busyProvider: 'apple' | 'google' | null;
  email: string;
  error: string | null;
  onApple: () => void;
  onEmailChange: (value: string) => void;
  onGoogle: () => void;
  onPasswordChange: (value: string) => void;
  onPasswordSubmit: () => void;
  palette: Palette;
  password: string;
  passwordBusy: boolean;
}) {
  const inputBackground = palette.background === palettes.dark.background ? '#18181b' : '#ffffff';

  return (
    <View style={{
      backgroundColor: palette.card,
      borderColor: palette.border,
      borderRadius: 12,
      borderWidth: 1,
      overflow: 'hidden',
      width: '100%',
    }}>
      <View style={{ gap: 16, paddingHorizontal: 24, paddingBottom: 18, paddingTop: 24 }}>
        <View style={{ alignItems: 'center', gap: 8 }}>
          <Image source={logo} style={{ borderRadius: 5, height: 20, width: 20 }} />
          <View style={{ alignItems: 'center', gap: 3 }}>
            <Text selectable style={{ color: palette.foreground, fontSize: 14, fontWeight: '800', textAlign: 'center' }}>
              Sign in to LateWatch
            </Text>
            <Text selectable style={{ color: palette.muted, fontSize: 11, lineHeight: 15, textAlign: 'center' }}>
              Welcome back! Please sign in to continue.
            </Text>
          </View>
        </View>

        <View style={{ gap: 7 }}>
          <AuthProviderButton
            label="Continue with Google"
            loading={busyProvider === 'google'}
            onPress={onGoogle}
            palette={palette}
            provider="google"
            tag="Last used"
          />
          <AuthProviderButton
            label="Continue with Apple"
            loading={busyProvider === 'apple'}
            onPress={onApple}
            palette={palette}
            provider="apple"
          />
        </View>

        <AuthDivider palette={palette} />

        <View style={{ gap: 11 }}>
          <AuthTextField
            autoComplete="email"
            autoCorrect={false}
            inputBackground={inputBackground}
            inputMode="email"
            keyboardType="email-address"
            label="Email address"
            onChangeText={onEmailChange}
            palette={palette}
            placeholder="Enter your email address"
            returnKeyType="next"
            textContentType="username"
            value={email}
          />
          <AuthTextField
            autoComplete="password"
            inputBackground={inputBackground}
            label="Password"
            onChangeText={onPasswordChange}
            onSubmitEditing={onPasswordSubmit}
            palette={palette}
            placeholder="Enter your password"
            returnKeyType="go"
            secureTextEntry
            textContentType="password"
            value={password}
          />

          <Pressable
            disabled={passwordBusy}
            onPress={onPasswordSubmit}
            style={{
              alignItems: 'center',
              backgroundColor: palette.background === palettes.dark.background ? '#f4f4f5' : '#2f3037',
              borderRadius: 6,
              minHeight: 34,
              justifyContent: 'center',
              opacity: passwordBusy ? 0.62 : 1,
              paddingHorizontal: 12,
            }}
          >
            {passwordBusy ? (
              <ActivityIndicator color={palette.background} size="small" />
            ) : (
              <Text selectable style={{
                color: palette.background === palettes.dark.background ? '#09090b' : '#ffffff',
                fontSize: 12,
                fontWeight: '800',
                textAlign: 'center',
              }}>
                Continue &gt;
              </Text>
            )}
          </Pressable>
        </View>

        {error && <InlineMessage message={error} palette={palette} tone="danger" />}
      </View>

      <View style={{
        alignItems: 'center',
        backgroundColor: palette.background === palettes.dark.background ? '#121216' : '#f8fafc',
        borderTopColor: palette.border,
        borderTopWidth: 1,
        paddingHorizontal: 18,
        paddingVertical: 14,
      }}>
        <Text selectable style={{ color: palette.muted, fontSize: 11, lineHeight: 15, textAlign: 'center' }}>
          {"Don't have an account? "}<Text style={{ color: palette.foreground, fontWeight: '700' }}>Sign up</Text>
        </Text>
      </View>

      <ClerkDevelopmentFooter palette={palette} />
    </View>
  );
}

function AuthTextField({
  autoComplete,
  autoCorrect,
  inputBackground,
  inputMode,
  keyboardType,
  label,
  onChangeText,
  onSubmitEditing,
  palette,
  placeholder,
  returnKeyType,
  secureTextEntry,
  textContentType,
  value,
}: {
  autoComplete?: 'email' | 'password';
  autoCorrect?: boolean;
  inputBackground: string;
  inputMode?: 'email';
  keyboardType?: 'email-address';
  label: string;
  onChangeText: (value: string) => void;
  onSubmitEditing?: () => void;
  palette: Palette;
  placeholder: string;
  returnKeyType?: 'next' | 'go';
  secureTextEntry?: boolean;
  textContentType?: 'username' | 'password';
  value: string;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text selectable style={{ color: palette.foreground, fontSize: 11, fontWeight: '700' }}>
        {label}
      </Text>
      <TextInput
        autoCapitalize="none"
        autoComplete={autoComplete}
        autoCorrect={autoCorrect}
        inputMode={inputMode}
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
        placeholder={placeholder}
        placeholderTextColor={palette.muted}
        returnKeyType={returnKeyType}
        secureTextEntry={secureTextEntry}
        style={{
          backgroundColor: inputBackground,
          borderColor: palette.border,
          borderRadius: 6,
          borderWidth: 1,
          color: palette.foreground,
          fontSize: 12,
          minHeight: 34,
          paddingHorizontal: 10,
        }}
        textContentType={textContentType}
        value={value}
      />
    </View>
  );
}

function AuthDivider({ palette }: { palette: Palette }) {
  return (
    <View style={{ alignItems: 'center', flexDirection: 'row', gap: 10 }}>
      <View style={{ backgroundColor: palette.border, flex: 1, height: 1 }} />
      <Text selectable style={{ color: palette.muted, fontSize: 10, fontWeight: '600' }}>
        or
      </Text>
      <View style={{ backgroundColor: palette.border, flex: 1, height: 1 }} />
    </View>
  );
}

function AuthProviderButton({
  label,
  loading,
  onPress,
  palette,
  provider,
  tag,
}: {
  label: string;
  loading?: boolean;
  onPress: () => void;
  palette: Palette;
  provider: 'apple' | 'google';
  tag?: string;
}) {
  return (
    <Pressable
      disabled={loading}
      onPress={onPress}
      style={{
        alignItems: 'center',
        backgroundColor: palette.card,
        borderColor: palette.border,
        borderRadius: 6,
        borderWidth: 1,
        flexDirection: 'row',
        gap: 8,
        minHeight: 34,
        opacity: loading ? 0.62 : 1,
        paddingHorizontal: 10,
      }}
    >
      <View style={{ alignItems: 'center', height: 18, justifyContent: 'center', width: 22 }}>
        {provider === 'google' ? <GoogleIcon /> : <AppleIcon color={palette.foreground} />}
      </View>
      <Text selectable style={{ color: palette.foreground, flex: 1, fontSize: 11, fontWeight: '700', textAlign: 'center' }}>
        {label}
      </Text>
      <View style={{ alignItems: 'flex-end', minWidth: 54 }}>
        {loading ? (
          <ActivityIndicator color={palette.primary} size="small" />
        ) : tag ? (
          <View style={{
            backgroundColor: palette.background === palettes.dark.background ? '#1f2937' : '#f8fafc',
            borderColor: palette.border,
            borderRadius: 999,
            borderWidth: 1,
            paddingHorizontal: 6,
            paddingVertical: 2,
          }}>
            <Text selectable style={{ color: palette.muted, fontSize: 8, fontWeight: '700' }}>
              {tag}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function GoogleIcon() {
  return (
    <View style={{ alignItems: 'center', height: 22, justifyContent: 'center', width: 22 }}>
      <View style={{
        borderColor: '#4285f4',
        borderLeftColor: '#fbbc05',
        borderRadius: 999,
        borderRightColor: '#34a853',
        borderTopColor: '#ea4335',
        borderWidth: 3,
        height: 20,
        position: 'absolute',
        width: 20,
      }} />
      <View style={{ backgroundColor: '#4285f4', height: 3, left: 11, position: 'absolute', top: 10, width: 8 }} />
      <View style={{
        backgroundColor: paletteWhite,
        height: 8,
        position: 'absolute',
        right: 0,
        top: 3,
        width: 8,
      }} />
    </View>
  );
}

const paletteWhite = '#ffffff';

function AppleIcon({ color }: { color: string }) {
  return (
    <View style={{ alignItems: 'center', height: 23, justifyContent: 'center', width: 22 }}>
      <View style={{
        backgroundColor: color,
        borderBottomLeftRadius: 8,
        borderBottomRightRadius: 7,
        borderTopLeftRadius: 9,
        borderTopRightRadius: 9,
        height: 15,
        top: 5,
        transform: [{ rotate: '-7deg' }],
        width: 15,
      }} />
      <View style={{
        backgroundColor: color,
        borderRadius: 999,
        height: 6,
        position: 'absolute',
        right: 5,
        top: 1,
        transform: [{ rotate: '-35deg' }],
        width: 4,
      }} />
      <View style={{
        backgroundColor: '#ffffff',
        borderRadius: 999,
        height: 7,
        position: 'absolute',
        right: 2,
        top: 9,
        width: 5,
      }} />
    </View>
  );
}

function Shell({
  children,
  palette,
  refreshControl,
}: {
  children: ReactNode;
  palette: Palette;
  refreshControl?: ReactElement<RefreshControlProps>;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const horizontalPadding = width < 390 ? 16 : 24;

  return (
    <View style={{ backgroundColor: palette.background, flex: 1 }}>
      <StatusBar style={palette.background === palettes.dark.background ? 'light' : 'dark'} />
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingBottom: Math.max(insets.bottom + 18, 28),
          paddingHorizontal: horizontalPadding,
          paddingTop: Math.max(insets.top + 14, 26),
        }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={refreshControl}
      >
        <View style={{ alignSelf: 'center', gap: 20, maxWidth: 576, width: '100%' }}>
          {children}
        </View>
      </ScrollView>
    </View>
  );
}

function PortalHeader({
  accountEmail,
  avatarLabel,
  onSignOut,
  palette,
  showAccount,
}: {
  accountEmail?: string | null;
  avatarLabel?: string;
  onSignOut?: () => void;
  palette: Palette;
  showAccount?: boolean;
}) {
  const initial = (avatarLabel || 'L').trim().slice(0, 1).toUpperCase() || 'L';

  return (
    <View style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 44 }}>
      <View style={{ alignItems: 'center', flexDirection: 'row', gap: 10 }}>
        <Image source={logo} style={{ borderRadius: 6, height: 28, width: 28 }} />
        <Text selectable style={{ color: palette.foreground, fontSize: 18, fontWeight: '800' }}>
          LateWatch
        </Text>
      </View>

      {showAccount && (
        <AccountControl
          email={accountEmail}
          initial={initial}
          name={avatarLabel || null}
          onSignOut={onSignOut}
          palette={palette}
        />
      )}
    </View>
  );
}

function AccountControl({
  email,
  initial,
  name,
  onSignOut,
  palette,
}: {
  email?: string | null;
  initial: string;
  name?: string | null;
  onSignOut?: () => void;
  palette: Palette;
}) {
  const { isAvailable: nativeProfileAvailable } = useUserProfileModal();
  const nativeUi = nativeProfileAvailable ? loadClerkNativeUi() : null;
  const NativeUserButton = nativeUi?.UserButton;

  if (NativeUserButton) {
    return (
      <View style={{ borderRadius: 999, height: 30, overflow: 'hidden', width: 30 }}>
        <NativeUserButton />
      </View>
    );
  }

  return (
    <ProfileMenu
      email={email}
      initial={initial}
      name={name}
      onSignOut={onSignOut}
      palette={palette}
    />
  );
}

function ProfileMenu({
  email,
  initial,
  name,
  onSignOut,
  palette,
}: {
  email?: string | null;
  initial: string;
  name?: string | null;
  onSignOut?: () => void;
  palette: Palette;
}) {
  const [open, setOpen] = useState(false);

  async function handleSignOut() {
    setOpen(false);
    await onSignOut?.();
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={{
          alignItems: 'center',
          backgroundColor: '#f59e0b',
          borderRadius: 999,
          height: 30,
          justifyContent: 'center',
          width: 30,
        }}
      >
        <Text selectable style={{ color: '#ffffff', fontSize: 13, fontWeight: '800' }}>
          {initial}
        </Text>
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}
      >
        <Pressable
          onPress={() => setOpen(false)}
          style={{
            backgroundColor: 'rgba(2, 6, 23, 0.18)',
            flex: 1,
            paddingHorizontal: 18,
            paddingTop: 64,
          }}
        >
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={{
              alignSelf: 'flex-end',
              backgroundColor: palette.card,
              borderColor: palette.border,
              borderRadius: 8,
              borderWidth: 1,
              maxWidth: 310,
              overflow: 'hidden',
              width: '82%',
            }}
          >
            <View style={{ alignItems: 'center', flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingVertical: 13 }}>
              <View style={{
                alignItems: 'center',
                backgroundColor: '#f59e0b',
                borderRadius: 999,
                height: 38,
                justifyContent: 'center',
                width: 38,
              }}>
                <Text selectable style={{ color: '#ffffff', fontSize: 15, fontWeight: '800' }}>
                  {initial}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text selectable numberOfLines={1} style={{ color: palette.foreground, fontSize: 14, fontWeight: '800' }}>
                  {name || 'LateWatch user'}
                </Text>
                {email && (
                  <Text selectable numberOfLines={1} style={{ color: palette.muted, fontSize: 12, marginTop: 2 }}>
                    {email}
                  </Text>
                )}
              </View>
            </View>

            <MenuRow
              icon={<ManageAccountIcon color={palette.foreground} />}
              label="Manage account"
              onPress={() => setOpen(false)}
              palette={palette}
            />
            <MenuRow
              icon={<SignOutMenuIcon color={palette.foreground} />}
              label="Sign out"
              onPress={handleSignOut}
              palette={palette}
            />
            <ClerkDevelopmentFooter palette={palette} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function MenuRow({
  icon,
  label,
  onPress,
  palette,
}: {
  icon: ReactNode;
  label: string;
  onPress: () => void;
  palette: Palette;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        alignItems: 'center',
        borderTopColor: palette.border,
        borderTopWidth: 1,
        flexDirection: 'row',
        gap: 12,
        minHeight: 44,
        paddingHorizontal: 14,
      }}
    >
      <View style={{ alignItems: 'center', height: 16, justifyContent: 'center', width: 16 }}>
        {icon}
      </View>
      <Text selectable style={{ color: palette.foreground, fontSize: 12, fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}

function ClerkDevelopmentFooter({ palette }: { palette: Palette }) {
  return (
    <View style={{
      alignItems: 'center',
      backgroundColor: palette.background === palettes.dark.background ? '#1a1511' : '#fff7ed',
      borderTopColor: palette.border,
      borderTopWidth: 1,
      gap: 3,
      paddingHorizontal: 16,
      paddingVertical: 12,
    }}>
      <Text selectable style={{ color: palette.muted, fontSize: 10, lineHeight: 13, textAlign: 'center' }}>
        Secured by <Text style={{ color: palette.foreground, fontWeight: '800' }}>clerk</Text>
      </Text>
      <Text selectable style={{ color: '#f97316', fontSize: 10, fontWeight: '800', lineHeight: 13, textAlign: 'center' }}>
        Development mode
      </Text>
    </View>
  );
}

function ManageAccountIcon({ color }: { color: string }) {
  return (
    <View style={{ alignItems: 'center', height: 15, justifyContent: 'center', width: 15 }}>
      <View style={{
        borderColor: color,
        borderRadius: 999,
        borderWidth: 1.5,
        height: 9,
        width: 9,
      }} />
      <View style={{ backgroundColor: color, borderRadius: 999, height: 3, position: 'absolute', width: 3 }} />
      <View style={{ backgroundColor: color, height: 2, position: 'absolute', top: 0, width: 1.5 }} />
      <View style={{ backgroundColor: color, bottom: 0, height: 2, position: 'absolute', width: 1.5 }} />
      <View style={{ backgroundColor: color, height: 1.5, left: 0, position: 'absolute', width: 2 }} />
      <View style={{ backgroundColor: color, height: 1.5, position: 'absolute', right: 0, width: 2 }} />
    </View>
  );
}

function SignOutMenuIcon({ color }: { color: string }) {
  return (
    <View style={{ height: 15, justifyContent: 'center', width: 15 }}>
      <View style={{
        borderBottomWidth: 1.4,
        borderColor: color,
        borderLeftWidth: 1.4,
        borderTopWidth: 1.4,
        height: 11,
        left: 0,
        position: 'absolute',
        width: 7,
      }} />
      <View style={{ backgroundColor: color, height: 1.4, left: 5, position: 'absolute', width: 8 }} />
      <View style={{
        borderColor: color,
        borderRightWidth: 1.4,
        borderTopWidth: 1.4,
        height: 5,
        position: 'absolute',
        right: 1,
        transform: [{ rotate: '45deg' }],
        width: 5,
      }} />
    </View>
  );
}

function PortalCard({
  children,
  palette,
}: {
  children: ReactNode;
  palette: Palette;
}) {
  return (
    <View style={{
      backgroundColor: palette.card,
      borderColor: palette.border,
      borderRadius: 8,
      borderWidth: 1,
      overflow: 'hidden',
      width: '100%',
    }}>
      {children}
    </View>
  );
}

function StatusPanel({
  detail,
  name,
  palette,
  showCheck,
  showMeta = true,
  status,
  title,
  tone,
}: {
  detail: string;
  name?: string;
  palette: Palette;
  showCheck?: boolean;
  showMeta?: boolean;
  status?: AttendanceStatus | null;
  title: string;
  tone: StatusTone;
}) {
  const colors = toneColors(palette, tone);

  return (
    <View style={{
      alignItems: 'center',
      backgroundColor: colors.backgroundColor,
      borderColor: colors.borderColor,
      borderRadius: 8,
      borderWidth: 1,
      paddingHorizontal: 16,
      paddingVertical: 18,
    }}>
      <View style={{
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.74)',
        borderRadius: 999,
        height: 48,
        justifyContent: 'center',
        width: 48,
      }}>
        <StatusIcon color={colors.color} showCheck={showCheck} />
      </View>
      <Text selectable style={{ color: colors.color, fontSize: 20, fontWeight: '800', marginTop: 12, textAlign: 'center' }}>
        {title}
      </Text>
      <Text selectable style={{
        color: palette.muted,
        fontSize: 14,
        lineHeight: 20,
        marginTop: 8,
        maxWidth: 390,
        textAlign: 'center',
      }}>
        {detail}
      </Text>

      {showMeta && (
      <View style={{ alignItems: 'center', gap: 10, marginTop: 14 }}>
        {name && (
          <View style={{
            backgroundColor: 'rgba(255,255,255,0.72)',
            borderColor: 'rgba(229,231,235,0.8)',
            borderRadius: 999,
            borderWidth: 1,
            maxWidth: 310,
            paddingHorizontal: 15,
            paddingVertical: 8,
          }}>
            <Text selectable numberOfLines={1} style={{ color: palette.foreground, fontSize: 13, fontWeight: '600' }}>
              {name.toUpperCase()}
            </Text>
          </View>
        )}

        <StatusChip
          icon={<ClockIcon color={palette.foreground} />}
          label="Time"
          palette={palette}
          value={status?.time?.slice(0, 5) || '-'}
        />
        <StatusChip
          icon={<WifiIcon color={palette.foreground} />}
          label="WiFi"
          palette={palette}
          value={status?.locationConfigured ? <VerifiedBadge /> : 'Not set'}
        />
      </View>
      )}
    </View>
  );
}

function AttendanceDetails({
  palette,
  status,
}: {
  palette: Palette;
  status: AttendanceStatus | null;
}) {
  if (!status?.attendance) return null;

  const amount = Number(status.attendance.computedAmount || 0);

  return (
    <View style={{
      backgroundColor: palette.card,
      borderColor: palette.border,
      borderRadius: 6,
      borderWidth: 1,
      overflow: 'hidden',
    }}>
      <DataRow label="Checked in at" palette={palette} value={status.attendance.checkInTime.slice(0, 5)} />
      <DataRow label="Checked out at" palette={palette} value={status.attendance.signOutTime?.slice(0, 5) || '-'} />
      {amount > 0 ? (
        <DataRow label="Penalty" palette={palette} tone="warning" value={`GHC ${amount.toFixed(2)}`} />
      ) : status.attendance.reason ? (
        <View style={{ borderTopColor: palette.border, borderTopWidth: 1, paddingHorizontal: 12, paddingVertical: 13 }}>
          <Text selectable style={{ color: palette.muted, fontSize: 13, lineHeight: 19 }}>
            {status.attendance.reason}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function LoadingCard({
  palette,
  title,
}: {
  palette: Palette;
  title: string;
}) {
  return (
    <View style={{ alignItems: 'center', gap: 12, padding: 28 }}>
      <ActivityIndicator color={palette.primary} size="large" />
      <Text selectable style={{ color: palette.foreground, fontSize: 16, fontWeight: '700' }}>
        {title}
      </Text>
      <Text selectable style={{ color: palette.muted, fontSize: 13, textAlign: 'center' }}>
        Verifying your account and location.
      </Text>
    </View>
  );
}

function MessageCard({
  detail,
  palette,
  title,
  tone,
}: {
  detail: string;
  palette: Palette;
  title: string;
  tone: MessageTone;
}) {
  return (
    <View style={{ gap: 10, padding: 16 }}>
      <Text selectable style={{ color: palette.foreground, fontSize: 18, fontWeight: '800' }}>
        {title}
      </Text>
      <InlineMessage message={detail} palette={palette} tone={tone} />
    </View>
  );
}

function PrimaryButton({
  disabled,
  label,
  loading,
  onPress,
  palette,
  variant = 'solid',
}: {
  disabled?: boolean;
  label: string;
  loading?: boolean;
  onPress: () => void;
  palette: Palette;
  variant?: 'outline' | 'solid';
}) {
  const isDisabled = Boolean(disabled || loading);
  const solid = variant === 'solid';

  return (
    <Pressable
      disabled={isDisabled}
      onPress={onPress}
      style={{
        alignItems: 'center',
        backgroundColor: solid ? palette.primary : 'transparent',
        borderColor: solid ? palette.primary : palette.border,
        borderRadius: 6,
        borderWidth: 1,
        flexDirection: 'row',
        gap: 8,
        minHeight: 44,
        justifyContent: 'center',
        opacity: isDisabled ? 0.58 : 1,
        paddingHorizontal: 14,
      }}
    >
      {loading ? (
        <ActivityIndicator color={solid ? '#ffffff' : palette.primary} />
      ) : (
        <>
          <ButtonIcon color={solid ? '#ffffff' : palette.foreground} />
          <Text selectable style={{
            color: solid ? '#ffffff' : palette.foreground,
            fontSize: 15,
            fontWeight: '800',
            textAlign: 'center',
          }}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

function InlineMessage({
  message,
  palette,
  tone,
}: {
  message: string;
  palette: Palette;
  tone: MessageTone;
}) {
  const color = tone === 'success' ? palette.success : tone === 'warning' ? palette.warning : palette.danger;
  const backgroundColor = tone === 'success' ? palette.successSoft : tone === 'warning' ? palette.warningSoft : palette.dangerSoft;

  return (
    <View style={{
      alignItems: 'center',
      backgroundColor,
      borderColor: color,
      borderRadius: 6,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 11,
      paddingVertical: 10,
    }}>
      <StatusIcon color={color} compact showCheck={tone === 'success'} />
      <Text selectable style={{ color, flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 18 }}>
        {message}
      </Text>
    </View>
  );
}

function StatusChip({
  icon,
  label,
  palette,
  value,
}: {
  icon: ReactNode;
  label: string;
  palette: Palette;
  value: ReactNode;
}) {
  return (
    <View style={{
      alignItems: 'center',
      backgroundColor: 'rgba(255,255,255,0.72)',
      borderColor: 'rgba(229,231,235,0.86)',
      borderRadius: 999,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 7,
      minHeight: 34,
      paddingHorizontal: 13,
    }}>
      {icon}
      <Text selectable style={{ color: palette.foreground, fontSize: 13, fontWeight: '600' }}>
        {label}
      </Text>
      {typeof value === 'string' ? (
        <Text selectable style={{ color: palette.foreground, fontSize: 14, fontVariant: ['tabular-nums'], fontWeight: '800' }}>
          {value}
        </Text>
      ) : value}
    </View>
  );
}

function DataRow({
  label,
  palette,
  tone = 'neutral',
  value,
}: {
  label: string;
  palette: Palette;
  tone?: 'neutral' | 'warning';
  value: string;
}) {
  return (
    <View style={{
      alignItems: 'center',
      borderBottomColor: label === 'Checked out at' ? 'transparent' : palette.border,
      borderBottomWidth: label === 'Checked out at' ? 0 : 1,
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 13,
    }}>
      <Text selectable style={{ color: palette.muted, fontSize: 14 }}>
        {label}
      </Text>
      <Text selectable style={{
        color: tone === 'warning' ? palette.warning : palette.foreground,
        fontSize: 18,
        fontVariant: ['tabular-nums'],
        fontWeight: '800',
        letterSpacing: 0,
      }}>
        {value}
      </Text>
    </View>
  );
}

function StatusIcon({
  color,
  compact,
  showCheck,
}: {
  color: string;
  compact?: boolean;
  showCheck?: boolean;
}) {
  const size = compact ? 18 : 24;

  return (
    <View style={{
      alignItems: 'center',
      borderColor: color,
      borderRadius: 999,
      borderWidth: 2,
      height: size,
      justifyContent: 'center',
      width: size,
    }}>
      <Text selectable style={{
        color,
        fontSize: compact ? 10 : 14,
        fontWeight: '900',
        lineHeight: compact ? 12 : 16,
      }}>
        {showCheck ? '✓' : '!'}
      </Text>
    </View>
  );
}

function ClockIcon({ color }: { color: string }) {
  return (
    <View style={{
      borderColor: color,
      borderRadius: 999,
      borderWidth: 1.5,
      height: 14,
      width: 14,
    }}>
      <View style={{ backgroundColor: color, height: 4.5, left: 6, position: 'absolute', top: 2.5, width: 1.5 }} />
      <View style={{ backgroundColor: color, height: 1.5, left: 6, position: 'absolute', top: 7, width: 4 }} />
    </View>
  );
}

function WifiIcon({ color }: { color: string }) {
  return (
    <View style={{ alignItems: 'center', height: 14, justifyContent: 'center', width: 15 }}>
      <View style={{
        borderColor: color,
        borderLeftWidth: 1.5,
        borderRadius: 999,
        borderRightWidth: 1.5,
        borderTopWidth: 1.5,
        height: 8,
        opacity: 0.8,
        position: 'absolute',
        top: 1,
        width: 14,
      }} />
      <View style={{
        borderColor: color,
        borderLeftWidth: 1.5,
        borderRadius: 999,
        borderRightWidth: 1.5,
        borderTopWidth: 1.5,
        height: 5,
        opacity: 0.85,
        position: 'absolute',
        top: 5,
        width: 9,
      }} />
      <View style={{ backgroundColor: color, borderRadius: 999, bottom: 1, height: 2.5, position: 'absolute', width: 2.5 }} />
    </View>
  );
}

function VerifiedBadge() {
  return (
    <View style={{
      alignItems: 'center',
      backgroundColor: '#1d9bf0',
      borderRadius: 999,
      height: 15,
      justifyContent: 'center',
      width: 15,
    }}>
      <Text selectable style={{ color: '#ffffff', fontSize: 10, fontWeight: '900', lineHeight: 12 }}>
        ✓
      </Text>
    </View>
  );
}

function ButtonIcon({ color }: { color: string }) {
  return (
    <View style={{ height: 16, justifyContent: 'center', width: 16 }}>
      <View style={{
        borderColor: color,
        borderRightWidth: 1.8,
        borderTopWidth: 1.8,
        height: 7,
        position: 'absolute',
        right: 1,
        transform: [{ rotate: '45deg' }],
        width: 7,
      }} />
      <View style={{ backgroundColor: color, height: 1.8, position: 'absolute', right: 2, width: 10 }} />
      <View style={{
        borderBottomWidth: 1.8,
        borderColor: color,
        borderLeftWidth: 1.8,
        borderTopWidth: 1.8,
        height: 12,
        left: 0,
        position: 'absolute',
        width: 9,
      }} />
    </View>
  );
}
