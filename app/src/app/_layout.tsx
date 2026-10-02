import { QueryClientProvider } from '@tanstack/react-query';
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

export default function RootLayout() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = Colors[scheme];
  const status = useSession((s) => s.status);
  const restore = useSession((s) => s.restore);

  useEffect(() => {
    restore();
  }, [restore]);

  useEffect(() => {
    if (status !== 'loading') SplashScreen.hideAsync().catch(() => undefined);
    if (status === 'signed-in') registerForPushNotifications();
  }, [status]);

  const navTheme = scheme === 'dark' ? DarkTheme : DefaultTheme;

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        value={{
          ...navTheme,
          colors: { ...navTheme.colors, primary: palette.accent, background: palette.background, card: palette.surface, text: palette.text, border: palette.border },
        }}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <Stack screenOptions={stackOptions(palette)}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
          <Stack.Screen name="(app)" options={{ headerShown: false }} />
          <Stack.Screen name="enquire" options={{ title: 'Book a free consultation' }} />
        </Stack>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
