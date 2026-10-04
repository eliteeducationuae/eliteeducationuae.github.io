import { Carlito_400Regular } from '@expo-google-fonts/carlito/400Regular';
import { Carlito_700Bold } from '@expo-google-fonts/carlito/700Bold';
import { Gelasio_400Regular } from '@expo-google-fonts/gelasio/400Regular';
import { Gelasio_700Bold } from '@expo-google-fonts/gelasio/700Bold';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { stackOptions } from '@/components/stack-options';
import { Colors } from '@/constants/theme';
import { queryClient } from '@/data/query';
import { useSession } from '@/data/session';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { registerForPushNotifications } from '@/lib/push';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

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
