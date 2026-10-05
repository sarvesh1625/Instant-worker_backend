import { Alert, Linking, Platform } from 'react-native';
import * as Location from 'expo-location';

// Shared location handling — used by the "Go Online" button and by Find Workers.
//
//   getCoordsIfAvailable()  quiet: returns coordinates only if permission is
//                           already granted AND the phone's location is on.
//                           Never shows a popup. Returns null otherwise.
//
//   requireLocation(t, why) interactive: walks the user through everything
//                           needed (explanation popup → permission → turning
//                           the phone's location on) and returns coordinates,
//                           or null if they said no / it couldn't be done.
//
// Coordinates are always { lat, lng }.

const toCoords = (pos) => ({ lat: pos.coords.latitude, lng: pos.coords.longitude });

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

// Two-button popup. Resolves true if the user taps the action button.
const ask = (title, message, cancelLabel, actionLabel) =>
  new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
        { text: actionLabel, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });

const openAppSettings = async () => {
  try { await Linking.openSettings(); } catch {}
};

// Opens the phone's own location switch on Android (falls back to app settings).
const openLocationSettings = async () => {
  try {
    if (Platform.OS === 'android') await Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS');
    else await Linking.openSettings();
  } catch {
    await openAppSettings();
  }
};

const readPosition = async () => {
  try {
    return toCoords(await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 15000));
  } catch {
    // No fresh fix in time — a position from the last few minutes is good enough.
    const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 }).catch(() => null);
    return last ? toCoords(last) : null;
  }
};

export async function getCoordsIfAvailable() {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') return null;
    if (!(await Location.hasServicesEnabledAsync())) return null;

    const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 }).catch(() => null);
    if (last) return toCoords(last);
    return await readPosition();
  } catch {
    return null;
  }
}

export async function requireLocation(t, why) {
  try {
    const perm0 = await Location.getForegroundPermissionsAsync();
    const ready = perm0.status === 'granted' && (await Location.hasServicesEnabledAsync());

    // Not ready yet → say WHY we need it before the system prompts appear.
    if (!ready && why) {
      const go = await ask(t('locTurnOnTitle'), why, t('locNotNow'), t('locBannerAction'));
      if (!go) return null;
    }

    // 1) App permission
    let perm = perm0;
    if (perm.status !== 'granted') {
      if (perm.canAskAgain !== false) perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        const open = await ask(t('locTurnOnTitle'), t('locPermissionDenied'), t('locNotNow'), t('locOpenSettings'));
        if (open) await openAppSettings();
        return null;
      }
    }

    // 2) The phone's location switch
    let enabled = await Location.hasServicesEnabledAsync();
    if (!enabled && Platform.OS === 'android') {
      // Android's own "turn on location" popup. Throws if the user declines.
      try { await Location.enableNetworkProviderAsync(); } catch {}
      enabled = await Location.hasServicesEnabledAsync();
    }
    if (!enabled) {
      const open = await ask(t('locTurnOnTitle'), t('locServicesOff'), t('locNotNow'), t('locOpenSettings'));
      if (open) await openLocationSettings();
      return null;
    }

    // 3) A position
    const coords = await readPosition();
    if (!coords) {
      Alert.alert(t('locTurnOnTitle'), t('locCouldNotGet'));
      return null;
    }
    return coords;
  } catch {
    Alert.alert(t('locTurnOnTitle'), t('locCouldNotGet'));
    return null;
  }
}