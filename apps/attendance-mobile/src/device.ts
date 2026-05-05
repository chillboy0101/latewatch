import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';

const DEVICE_TOKEN_KEY = 'latewatch.attendance.device.v1';

function randomToken() {
  return `lw_${Crypto.randomUUID()}_${Array.from(Crypto.getRandomBytes(16))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

export async function getOrCreateDeviceToken() {
  const existing = await SecureStore.getItemAsync(DEVICE_TOKEN_KEY);
  if (existing) return existing;

  const token = randomToken();
  await SecureStore.setItemAsync(DEVICE_TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return token;
}

export async function resetLocalDeviceToken() {
  await SecureStore.deleteItemAsync(DEVICE_TOKEN_KEY);
  return getOrCreateDeviceToken();
}

export function getDeviceLabel() {
  const parts = [
    Device.manufacturer,
    Device.modelName,
    Application.applicationName || 'LateWatch Attendance',
    Application.nativeApplicationVersion ? `v${Application.nativeApplicationVersion}` : null,
  ].filter(Boolean);

  return parts.join(' / ') || 'LateWatch mobile app';
}
