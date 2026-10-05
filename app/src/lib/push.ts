import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { source } from '@/data';
import { notificationRoute } from '@/lib/notification-route';

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

/**
 * Open the screen a notification points at when it is tapped, including the tap that launched the app.
 * Runs only while signed in, so the route's own access checks apply.
 */
export function useNotificationTaps(active: boolean): void {
  useEffect(() => {
    if (!active || Platform.OS === 'web') return;
    const open = (response: Notifications.NotificationResponse | null) => {
      const to = notificationRoute(response?.notification.request.content.data);
      if (!to) return;
      // Handle each tap once, so signing out and in again does not reopen it.
      Notifications.clearLastNotificationResponse();
      router.push(to as Href);
    };
    // The tap that launched the app: wait a tick so the home screen's own redirect happens first.
    const launch = setTimeout(() => {
      try {
        open(Notifications.getLastNotificationResponse());
      } catch {
        // Not available on this platform.
      }
    }, 0);
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => {
      clearTimeout(launch);
      sub.remove();
    };
  }, [active]);
}
