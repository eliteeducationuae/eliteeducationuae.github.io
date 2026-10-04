import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { source } from '@/data';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Ask for notification permission and store this device's Expo push token so the
 * `send-reminders` Edge Function can send lesson reminders. Silently does nothing in the
 * demo, on the web or on simulators.
 */
export async function registerForPushNotifications(): Promise<void> {
  if (!source.savePushToken || Platform.OS === 'web' || !Device.isDevice) return;
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    if (!projectId) return; // Set by `eas init`.
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'Lessons', importance: Notifications.AndroidImportance.DEFAULT });
    }
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    await source.savePushToken(data);
  } catch {
    // Notifications are a nice-to-have; never block sign-in on them.
  }
}
