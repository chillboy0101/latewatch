/* eslint-disable jsx-a11y/alt-text */
import { ClerkLoaded, ClerkProvider, useAuth, useClerk, useSSO, useUser } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import * as Linking from 'expo-linking';
import * as LocalAuthentication from 'expo-local-authentication';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import type { ReactElement, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import type { RefreshControlProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
    background: '#05070b',
    border: '#1f2937',
    card: '#111827',
    danger: '#ef4444',
    dangerSoft: '#3a1118',
    foreground: '#f8fafc',
    muted: '#94a3b8',
    primary: '#2f6df6',
    primarySoft: '#102246',
    success: '#10b981',
    successSoft: '#062b22',
    warning: '#f59e0b',
    warningSoft: '#35230a',
  },
  light: {
    background: '#f6f9ff',
    border: '#dbe4f0',
    card: '#ffffff',
    danger: '#dc2626',
    dangerSoft: '#fee2e2',
    foreground: '#0f172a',
    muted: '#64748b',
    primary: '#2563eb',
    primarySoft: '#dbeafe',
    success: '#059669',
    successSoft: '#d1fae5',
    warning: '#d97706',
    warningSoft: '#fef3c7',
  },
};

function canSignOut(status: AttendanceStatus | null) {
  return Boolean(status?.attendance && !status.attendance.signOutTime && status.time.slice(0, 5) >= '16:30');
}

function statusTitle(status: AttendanceStatus | null) {
  if (!status) return 'Checking status';
  if (!status.locationConfigured) return 'Office location missing';
  if (!status.staff) return 'Access not set up';
  if (status.device?.registered && !status.device.trusted) return 'Device not recognized';
  if (status.permission?.permissionType === 'absence') return 'Excused today';
  if (status.isHoliday) return status.holidayName || 'Public holiday';
  if (status.isWeekend) return 'Weekend';
  if (status.attendance?.signOutTime) return 'Checked out';
  if (status.attendance?.status === 'late') return 'Late check-in recorded';
  if (status.attendance?.status === 'present') return 'Checked in';
  if (status.isAfterWorkdayEnd) return 'Check-in closed';
  return 'Ready to check in';
}

function statusDetail(status: AttendanceStatus | null) {
  if (!status) return 'Loading your LateWatch attendance profile.';
  if (!status.locationConfigured) return 'Ask an admin to save the office location first.';
  if (!status.staff) return 'Ask an admin to link your staff email to your LateWatch profile.';
  if (status.device?.registered && !status.device.trusted) {
    return status.transferRequest
      ? 'Your transfer request is waiting for admin approval.'
      : 'This account is linked to another phone or browser. Request a device transfer here.';
  }
  if (status.permission?.permissionType === 'absence') return 'You have approved absence today.';
  if (status.isHoliday) return 'Check-ins are disabled today in observance of the public holiday.';
  if (status.isWeekend) return 'Attendance is closed on weekends.';
  if (status.attendance?.signOutTime) return 'Your attendance for today is complete.';
  if (status.attendance && !canSignOut(status)) return `You can check out from ${status.signOutStartLabel}.`;
  if (status.attendance?.status === 'late') return 'Your lateness and penalty have been recorded.';
  if (status.attendance?.status === 'present') return 'You are marked present for today.';
  if (status.isAfterWorkdayEnd) return `Check-ins close after ${status.workdayEndLabel}.`;
  return 'Confirm with biometrics or phone passcode when you are at the office.';
}

function actionLabel(status: AttendanceStatus | null, busy: boolean) {
  if (busy) return status?.attendance && !status.attendance.signOutTime ? 'Checking out' : 'Checking in';
  if (status?.attendance?.signOutTime) return 'Already checked out';
  if (status?.attendance) return canSignOut(status) ? 'Check out' : `Check-out opens ${status.signOutStartLabel}`;
  if (status?.isHoliday) return 'Closed - holiday';
  if (status?.isWeekend) return 'Closed - weekend';
  if (status?.isAfterWorkdayEnd) return 'Closed - after hours';
  if (status && !status.locationConfigured) return 'Location not configured';
  if (status && !status.staff) return 'Access not set up';
  if (status?.device?.registered && !status.device.trusted) return 'Device not recognized';
  if (status?.permission?.permissionType === 'absence') return 'Excused - no check-in';
  return 'Check in';
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
      <Shell palette={palette}>
        <MessageCard
          detail="Add EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY to apps/attendance-mobile/.env before running the app."
          palette={palette}
          title="Clerk key missing"
          tone="warning"
        />
      </Shell>
    );
  }

  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <ClerkLoaded>
        <AuthGate palette={palette} />
      </ClerkLoaded>
    </ClerkProvider>
  );
}

function AuthGate({ palette }: { palette: typeof palettes.light }) {
  const auth = useAuth();

  if (!auth.isLoaded) {
    return (
      <Shell palette={palette}>
        <LoadingCard palette={palette} title="Starting LateWatch" />
      </Shell>
    );
  }

  if (!auth.isSignedIn) {
    return <SignInScreen palette={palette} />;
  }

  return <AttendanceScreen getToken={auth.getToken} palette={palette} />;
}

function SignInScreen({ palette }: { palette: typeof palettes.light }) {
  const { startSSOFlow } = useSSO();
  const [busyProvider, setBusyProvider] = useState<'apple' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <Shell palette={palette}>
      <View style={{ alignItems: 'center', gap: 16 }}>
        <BrandHeader palette={palette} subtitle="Staff attendance" />
        <View style={{
          backgroundColor: palette.card,
          borderColor: palette.border,
          borderRadius: 26,
          borderWidth: 1,
          gap: 14,
          padding: 18,
          width: '100%',
        }}>
          <Text selectable style={{ color: palette.foreground, fontSize: 22, fontWeight: '800', textAlign: 'center' }}>
            Sign in to LateWatch
          </Text>
          <Text selectable style={{ color: palette.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' }}>
            Use your invited staff account to check in and check out.
          </Text>
          <PrimaryButton
            label="Continue with Google"
            loading={busyProvider === 'google'}
            onPress={() => start('google')}
            palette={palette}
            variant="outline"
          />
          <PrimaryButton
            label="Continue with Apple"
            loading={busyProvider === 'apple'}
            onPress={() => start('apple')}
            palette={palette}
            variant="outline"
          />
          {error && <InlineMessage message={error} palette={palette} tone="danger" />}
        </View>
      </View>
    </Shell>
  );
}

function AttendanceScreen({
  getToken,
  palette,
}: {
  getToken: GetToken;
  palette: typeof palettes.light;
}) {
  const { signOut } = useClerk();
  const { user } = useUser();
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [status, setStatus] = useState<AttendanceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [requestingTransfer, setRequestingTransfer] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'danger' | 'success' | 'warning' } | null>(null);

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
          ? 'You have checked out successfully.'
          : 'You have checked in successfully.',
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
        text: 'Device transfer request sent for admin approval.',
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

  const tone = useMemo(() => {
    if (!status) return 'neutral';
    if (status.attendance?.status === 'present' || status.attendance?.signOutTime) return 'success';
    if (status.attendance?.status === 'late' || blockedDevice || status.isHoliday || status.isWeekend || !status.locationConfigured) return 'warning';
    return 'neutral';
  }, [blockedDevice, status]);

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
      <View style={{ gap: 16 }}>
        <View style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }}>
          <BrandHeader palette={palette} subtitle="Attendance" />
          <Pressable
            onPress={() => signOut()}
            style={{
              borderColor: palette.border,
              borderRadius: 999,
              borderWidth: 1,
              paddingHorizontal: 14,
              paddingVertical: 9,
            }}
          >
            <Text selectable style={{ color: palette.foreground, fontSize: 13, fontWeight: '700' }}>Sign out</Text>
          </Pressable>
        </View>

        {loading ? (
          <LoadingCard palette={palette} title="Checking attendance" />
        ) : (
          <>
            <View style={{
              backgroundColor: palette.card,
              borderColor: palette.border,
              borderRadius: 28,
              borderWidth: 1,
              gap: 18,
              padding: 18,
            }}>
              <View style={{
                alignItems: 'center',
                backgroundColor: tone === 'success'
                  ? palette.successSoft
                  : tone === 'warning'
                    ? palette.warningSoft
                    : palette.primarySoft,
                borderColor: tone === 'success'
                  ? palette.success
                  : tone === 'warning'
                    ? palette.warning
                    : palette.primary,
                borderRadius: 24,
                borderWidth: 1,
                gap: 10,
                padding: 18,
              }}>
                <Text selectable style={{
                  color: tone === 'success'
                    ? palette.success
                    : tone === 'warning'
                      ? palette.warning
                      : palette.primary,
                  fontSize: 22,
                  fontWeight: '900',
                  textAlign: 'center',
                }}>
                  {statusTitle(status)}
                </Text>
                <Text selectable style={{
                  color: palette.muted,
                  fontSize: 14,
                  lineHeight: 20,
                  textAlign: 'center',
                }}>
                  {statusDetail(status)}
                </Text>
                <Text selectable style={{
                  backgroundColor: palette.background,
                  borderRadius: 999,
                  color: palette.foreground,
                  fontSize: 12,
                  fontWeight: '800',
                  overflow: 'hidden',
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  textAlign: 'center',
                }}>
                  {displayName.toUpperCase()}
                </Text>
              </View>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                <InfoPill label="Time" palette={palette} value={status?.time.slice(0, 5) || '-'} />
                <InfoPill
                  label="Location"
                  palette={palette}
                  value={status?.locationConfigured ? 'Configured' : 'Not set'}
                />
                <InfoPill
                  label="Device"
                  palette={palette}
                  value={status?.device?.registered
                    ? status.device.trusted ? 'Trusted' : 'Blocked'
                    : 'First use'}
                />
              </View>

              {status?.attendance && (
                <View style={{ borderColor: palette.border, borderRadius: 18, borderWidth: 1, overflow: 'hidden' }}>
                  <DataRow label="Check-in" palette={palette} value={status.attendance.checkInTime.slice(0, 5)} />
                  <DataRow label="Check-out" palette={palette} value={status.attendance.signOutTime?.slice(0, 5) || '-'} />
                  <DataRow
                    label="Penalty"
                    palette={palette}
                    tone={Number(status.attendance.computedAmount || 0) > 0 ? 'warning' : 'neutral'}
                    value={`GHC ${Number(status.attendance.computedAmount || 0).toFixed(2)}`}
                  />
                </View>
              )}

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
                  label={status?.transferRequest ? 'Transfer request pending' : 'Request device transfer'}
                  loading={requestingTransfer}
                  onPress={transferDevice}
                  palette={palette}
                  variant="outline"
                />
              )}
            </View>
          </>
        )}
      </View>
    </Shell>
  );
}

function Shell({
  children,
  palette,
  refreshControl,
}: {
  children: ReactNode;
  palette: typeof palettes.light;
  refreshControl?: ReactElement<RefreshControlProps>;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ backgroundColor: palette.background, flex: 1 }}>
      <StatusBar style={palette.background === palettes.dark.background ? 'light' : 'dark'} />
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          paddingBottom: Math.max(insets.bottom + 24, 32),
          paddingHorizontal: 18,
          paddingTop: Math.max(insets.top + 24, 44),
        }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={refreshControl}
      >
        <View style={{ alignSelf: 'center', maxWidth: 520, width: '100%' }}>
          {children}
        </View>
      </ScrollView>
    </View>
  );
}

function BrandHeader({
  palette,
  subtitle,
}: {
  palette: typeof palettes.light;
  subtitle: string;
}) {
  return (
    <View style={{ alignItems: 'center', flexDirection: 'row', gap: 10 }}>
      <Image source={logo} style={{ borderRadius: 12, height: 44, width: 44 }} />
      <View>
        <Text selectable style={{ color: palette.foreground, fontSize: 20, fontWeight: '900' }}>LateWatch</Text>
        <Text selectable style={{ color: palette.muted, fontSize: 13 }}>{subtitle}</Text>
      </View>
    </View>
  );
}

function LoadingCard({
  palette,
  title,
}: {
  palette: typeof palettes.light;
  title: string;
}) {
  return (
    <View style={{
      alignItems: 'center',
      backgroundColor: palette.card,
      borderColor: palette.border,
      borderRadius: 24,
      borderWidth: 1,
      gap: 12,
      padding: 28,
    }}>
      <ActivityIndicator color={palette.primary} size="large" />
      <Text selectable style={{ color: palette.foreground, fontSize: 16, fontWeight: '800' }}>{title}</Text>
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
  palette: typeof palettes.light;
  title: string;
  tone: 'danger' | 'success' | 'warning';
}) {
  return (
    <View style={{
      backgroundColor: palette.card,
      borderColor: palette.border,
      borderRadius: 24,
      borderWidth: 1,
      gap: 10,
      padding: 20,
    }}>
      <Text selectable style={{ color: palette.foreground, fontSize: 20, fontWeight: '900' }}>{title}</Text>
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
  palette: typeof palettes.light;
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
        borderRadius: 16,
        borderWidth: 1,
        minHeight: 52,
        justifyContent: 'center',
        opacity: isDisabled ? 0.55 : 1,
        paddingHorizontal: 16,
      }}
    >
      {loading ? (
        <ActivityIndicator color={solid ? '#ffffff' : palette.primary} />
      ) : (
        <Text selectable style={{
          color: solid ? '#ffffff' : palette.foreground,
          fontSize: 16,
          fontWeight: '800',
          textAlign: 'center',
        }}>
          {label}
        </Text>
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
  palette: typeof palettes.light;
  tone: 'danger' | 'success' | 'warning';
}) {
  const color = tone === 'success' ? palette.success : tone === 'warning' ? palette.warning : palette.danger;
  const backgroundColor = tone === 'success' ? palette.successSoft : tone === 'warning' ? palette.warningSoft : palette.dangerSoft;

  return (
    <View style={{ backgroundColor, borderColor: color, borderRadius: 16, borderWidth: 1, padding: 12 }}>
      <Text selectable style={{ color, fontSize: 13, fontWeight: '700', lineHeight: 18 }}>{message}</Text>
    </View>
  );
}

function InfoPill({
  label,
  palette,
  value,
}: {
  label: string;
  palette: typeof palettes.light;
  value: string;
}) {
  return (
    <View style={{
      backgroundColor: palette.background,
      borderColor: palette.border,
      borderRadius: 999,
      borderWidth: 1,
      flexGrow: 1,
      minWidth: 140,
      paddingHorizontal: 14,
      paddingVertical: 11,
    }}>
      <Text selectable style={{ color: palette.muted, fontSize: 12, fontWeight: '700' }}>{label}</Text>
      <Text selectable style={{ color: palette.foreground, fontSize: 16, fontWeight: '900', marginTop: 2 }}>{value}</Text>
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
  palette: typeof palettes.light;
  tone?: 'neutral' | 'warning';
  value: string;
}) {
  return (
    <View style={{
      alignItems: 'center',
      borderBottomColor: palette.border,
      borderBottomWidth: label === 'Penalty' ? 0 : 1,
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 13,
    }}>
      <Text selectable style={{ color: palette.muted, fontSize: 13, fontWeight: '700' }}>{label}</Text>
      <Text selectable style={{
        color: tone === 'warning' ? palette.warning : palette.foreground,
        fontSize: 16,
        fontVariant: ['tabular-nums'],
        fontWeight: '900',
      }}>
        {value}
      </Text>
    </View>
  );
}
