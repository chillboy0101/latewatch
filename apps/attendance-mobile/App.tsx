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
      <PortalHeader palette={palette} />
      <PortalCard palette={palette}>
        <View style={{ gap: 14, padding: 14 }}>
          <StatusPanel
            detail="Use your invited staff account to continue."
            palette={palette}
            showCheck
            showMeta={false}
            title="Sign in to LateWatch"
            tone="primary"
          />
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
      </PortalCard>
    </Shell>
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
  avatarLabel,
  onSignOut,
  palette,
  showAccount,
}: {
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
        <View style={{ alignItems: 'center', flexDirection: 'row', gap: 8 }}>
          <Pressable
            onPress={onSignOut}
            style={{
              alignItems: 'center',
              borderColor: palette.border,
              borderRadius: 6,
              borderWidth: 1,
              height: 36,
              justifyContent: 'center',
              paddingHorizontal: 12,
            }}
          >
            <Text selectable style={{ color: palette.foreground, fontSize: 13, fontWeight: '600' }}>
              Sign out
            </Text>
          </Pressable>
          <View style={{
            alignItems: 'center',
            backgroundColor: '#f59e0b',
            borderRadius: 999,
            height: 28,
            justifyContent: 'center',
            width: 28,
          }}>
            <Text selectable style={{ color: '#ffffff', fontSize: 13, fontWeight: '800' }}>
              {initial}
            </Text>
          </View>
        </View>
      )}
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
