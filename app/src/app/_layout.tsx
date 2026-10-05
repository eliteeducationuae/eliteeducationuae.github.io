import { Carlito_400Regular } from '@expo-google-fonts/carlito/400Regular';
import { Carlito_700Bold } from '@expo-google-fonts/carlito/700Bold';
import { Gelasio_400Regular } from '@expo-google-fonts/gelasio/400Regular';
import { Gelasio_700Bold } from '@expo-google-fonts/gelasio/700Bold';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { stackOptions } from '@/components/stack-options';
import { Colors } from '@/constants/theme';
import { queryClient } from '@/data/query';
import { useSession } from '@/data/session';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { registerForPushNotifications } from '@/lib/push';
// Launch readiness
import { source } from '@/data';
import { configureErrorReporting, installGlobalErrorHandlers } from '@/lib/error-reporting';

import { ErrorBoundary } from '@/components/error-boundary';

export { ErrorBoundary };
// Each screen gets its own boundary (inherited by every nested layout), so a screen that fails to render shows the
// recovery screen in place, the navigators and the address stay as they were, and Try again re-renders that screen.
export const unstable_settings = { screenErrorBoundary: ErrorBoundary };

SplashScreen.preventAutoHideAsync().catch(() => undefined);

// Launch readiness: send app errors to the office's error log, and catch uncaught errors too.
configureErrorReporting({
  platform: Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web' ? Platform.OS : 'unknown',
  appVersion: Constants.expoConfig?.version,
  send: (input) => source.logAppError(input),
  getRoute: () => (Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.pathname : undefined),
});
installGlobalErrorHandlers();

// Metric-compatible twins of Georgia (Gelasio) and Calibri (Carlito); family names match font() in theme.ts.
const BRAND_FONTS = { Gelasio_400Regular, Gelasio_700Bold, Carlito_400Regular, Carlito_700Bold };

export default function RootLayout() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = Colors[scheme];
  const status = useSession((s) => s.status);
  const restore = useSession((s) => s.restore);
  const [fontsLoaded, fontError] = useFonts(BRAND_FONTS);
  const fontsReady = fontsLoaded || !!fontError;

  useEffect(() => {
    restore();
  }, [restore]);

  useEffect(() => {
    if (fontsReady && status !== 'loading') SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsReady, status]);

  useEffect(() => {
    if (status === 'signed-in') registerForPushNotifications();
  }, [status]);

  if (!fontsReady) return null;

  const navTheme = scheme === 'dark' ? DarkTheme : DefaultTheme;

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        value={{
          ...navTheme,
          colors: {
            ...navTheme.colors,
            primary: palette.accent,
            background: palette.background,
            card: palette.surface,
            text: palette.text,
            border: palette.border,
            notification: palette.gold,
          },
        }}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <Stack screenOptions={stackOptions(palette)}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
          <Stack.Screen name="(app)" options={{ headerShown: false }} />
          <Stack.Screen name="enquire" options={{ title: 'Book a free consultation' }} />
          <Stack.Screen name="teach" options={{ title: 'Teach with Elite Education' }} />
        </Stack>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
