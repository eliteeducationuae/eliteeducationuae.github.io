import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

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
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: palette.surface },
            headerTintColor: palette.text,
            headerShadowVisible: false,
            headerBackTitle: 'Back',
            contentStyle: { backgroundColor: palette.background },
          }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
          <Stack.Screen name="admin" options={{ headerShown: false }} />
          <Stack.Screen name="tutor" options={{ headerShown: false }} />
          <Stack.Screen name="parent" options={{ headerShown: false }} />
          <Stack.Screen name="student" options={{ headerShown: false }} />
          <Stack.Screen name="lesson/[id]" options={{ title: 'Lesson' }} />
          <Stack.Screen name="lesson/new" options={{ title: 'Schedule lessons', presentation: 'modal' }} />
          <Stack.Screen name="complete/[id]" options={{ title: 'Record lesson', presentation: 'modal' }} />
          <Stack.Screen name="students/[id]" options={{ title: 'Student' }} />
          <Stack.Screen name="students/edit" options={{ title: 'Student', presentation: 'modal' }} />
          <Stack.Screen name="invoice/[id]" options={{ title: 'Invoice' }} />
          <Stack.Screen name="manage/tutors" options={{ title: 'Tutors' }} />
          <Stack.Screen name="manage/tutor-edit" options={{ title: 'Tutor', presentation: 'modal' }} />
          <Stack.Screen name="manage/families" options={{ title: 'Families' }} />
          <Stack.Screen name="manage/family-edit" options={{ title: 'Family', presentation: 'modal' }} />
          <Stack.Screen name="manage/services" options={{ title: 'Services & rates' }} />
          <Stack.Screen name="manage/package-new" options={{ title: 'Sell a package', presentation: 'modal' }} />
          <Stack.Screen name="manage/payroll" options={{ title: 'Tutor pay' }} />
          <Stack.Screen name="manage/settings" options={{ title: 'Business settings' }} />
        </Stack>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
