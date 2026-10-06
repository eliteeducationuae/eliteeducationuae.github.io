import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Icon, type IconName } from '../icon';
import { Button, Card, Row, Txt } from '../ui';

const SERVICES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'school', title: 'School entry', text: 'Guidance on leading schools in the UAE and abroad, entrance assessments and interviews.' },
  { icon: 'book', title: 'UK boarding schools', text: 'Shortlisting, registrations, 11+, 13+ and Sixth Form entrance tests, and visits.' },
  { icon: 'doc', title: 'UK universities (UCAS)', text: 'Course choices, personal statements, admissions tests and Oxford and Cambridge interviews.' },
  { icon: 'trend', title: 'US universities (Common App)', text: 'College lists, essays, activities, testing strategy and Early Decision planning.' },
];

/** A refined introduction for families who do not yet have an admissions case. */
export function AdmissionsIntro({ onSpeak }: { onSpeak?: () => void }) {
  const theme = useTheme();
  return (
    <>
      <Card variant="hero" style={{ gap: Spacing.two + 2, padding: Spacing.four }}>
        <Txt variant="label">Elite Education</Txt>
        <Txt variant="title" accessibilityRole="header">
          Admissions advisory
        </Txt>
        <View style={[styles.rule, { backgroundColor: theme.gold }]} />
        <Txt>
          Personal, discreet guidance through every stage of a school or university application, from the first shortlist to the
          offer, with a dedicated adviser and a clear record of every deadline.
        </Txt>
      </Card>
      {SERVICES.map((s) => (
        <Card key={s.title} style={{ gap: Spacing.one }}>
          <Row gap={Spacing.three} style={{ alignItems: 'flex-start' }}>
            <View style={[styles.icon, { backgroundColor: theme.champagne, borderColor: theme.gold }]}>
              <Icon name={s.icon} size={18} color={theme.accent} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="h3">{s.title}</Txt>
              <Txt variant="muted">{s.text}</Txt>
            </View>
          </Row>
        </Card>
      ))}
      <Txt variant="muted" style={{ textAlign: 'center' }}>
        Excellence. Discretion. Results.
      </Txt>
      {onSpeak ? <Button title="Speak to us" icon="chat" variant="gold" onPress={onSpeak} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  rule: { width: 28, height: 2 },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
