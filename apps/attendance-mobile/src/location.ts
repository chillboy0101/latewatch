import * as Location from 'expo-location';

import type { LocationEvidence } from './types';

export async function getFreshLocationEvidence(): Promise<LocationEvidence> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== Location.PermissionStatus.GRANTED) {
    throw new Error('Location permission is required to record attendance.');
  }

  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Highest,
    mayShowUserSettingsDialog: true,
  });

  return {
    accuracy: position.coords.accuracy ?? 9999,
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    mocked: Boolean(position.mocked),
    timestamp: new Date(position.timestamp).toISOString(),
  };
}
