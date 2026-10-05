import { router, type ErrorBoundaryProps } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Colors, MaxContentWidth, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { reportError } from '@/lib/error-reporting';

import { Logo } from './logo';
import { Button, Card, Txt } from './ui';

/**
 * Shown by expo-router when a screen throws while rendering. Calm and branded, it reports the error once and
 * offers a retry. It relies on nothing but the theme, so it still works when data or session providers failed.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = Colors[scheme];

  useEffect(() => {
    reportError(error, { source: 'boundary' });
  }, [error]);

  return (
    <View style={[styles.page, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.inner}>
          <Logo width={110} />
          <Card style={{ gap: Spacing.three }}>
            <Txt variant="h2" accessibilityRole="header">
              Something has gone wrong
            </Txt>
            <View style={{ width: 28, height: 1.5, backgroundColor: palette.gold }} />
            <Txt>
              We are sorry for the inconvenience. The problem has been reported to Elite Education, and you may try again now.
            </Txt>
            <View style={{ gap: Spacing.two }}>
              <Button title="Try again" variant="gold" icon="repeat" onPress={() => retry()} />
              <Button title="Return to home" variant="outline" icon="home" onPress={() => router.replace('/')} />
            </View>
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  inner: { width: '100%', maxWidth: Math.min(MaxContentWidth, 520), gap: Spacing.four },
});
