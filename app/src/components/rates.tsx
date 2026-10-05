import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { font, Radius, Spacing } from '@/constants/theme';
import { useLookup, useServices } from '@/data/hooks';
import { useMe } from '@/data/session';
import { serviceForEnrolment } from '@/domain/rates';
import type { Enrolment, Role, Service, Student, Tutor } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';

import { customBadgeLabel, RATE_NOTE, rateSummary } from './rate-rules';
import { Badge, Card, Row, Txt } from './ui';

export * from './rate-rules';

/** The small gold badge on a custom rate. */
export function CustomBadge({ tutorPaySource }: { tutorPaySource?: Enrolment['tutorPaySource'] }) {
  return <Badge label={customBadgeLabel(tutorPaySource)} tone="gold" />;
}

/**
 * An AED-per-hour field for a custom rate. Blank means the default, which the placeholder names.
 * `custom` shows the Custom badge beside the label; `disabled` greys it out with the placeholder as the hint.
 */
export function RateField({
  label,
  value,
  placeholder,
  onChange,
  error,
  custom,
  disabled,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (text: string) => void;
  error?: string;
  custom?: boolean;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: Spacing.one }}>
      <Row gap={Spacing.two}>
        <Txt variant="label">{label}</Txt>
        {custom ? <CustomBadge /> : null}
      </Row>
      <TextInput
        accessibilityLabel={label}
        accessibilityState={{ disabled: !!disabled }}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        keyboardType="decimal-pad"
        inputMode="decimal"
        editable={!disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          styles.input,
          font('sans'),
          {
            backgroundColor: disabled ? theme.surfaceAlt : theme.surface,
            borderColor: error ? theme.danger : focused ? theme.gold : theme.border,
            color: theme.text,
          },
        ]}
      />
      {error ? (
        <Txt variant="small" color="danger">
          {error}
        </Txt>
      ) : (
        <Txt variant="small">{disabled ? placeholder : RATE_NOTE}</Txt>
      )}
    </View>
  );
}

/** A read-only summary of one subject's rates, worded for the viewer. Renders nothing when there is nothing they may see. */
export function EnrolmentRatesCard({
  enrolment,
  tutor,
  service,
  viewerRole,
  viewerTutorId,
}: {
  enrolment: Enrolment;
  tutor?: Tutor;
  service?: Service;
  viewerRole: Role;
  viewerTutorId?: string;
}) {
  const lines = rateSummary({ enrolment, tutor, service, viewer: { role: viewerRole, tutorId: viewerTutorId } });
  if (!lines.length) return null;
  if (lines.every((l) => l.sentence)) {
    return (
      <View style={{ gap: 2 }}>
        {lines.map((l) => (
          <Txt key={l.key} variant="muted">
            {l.label}: {l.value}
          </Txt>
        ))}
      </View>
    );
  }
  return (
    <Card style={{ gap: Spacing.two }}>
      {lines.map((l) => (
        <View key={l.key} style={{ gap: 2 }}>
          <Txt variant="label">{l.label}</Txt>
          <Row gap={Spacing.two}>
            <Txt variant="h3">{l.value}</Txt>
            {l.badge ? <Badge label={l.badge} tone="gold" /> : null}
          </Row>
          {l.note ? <Txt variant="small">{l.note}</Txt> : null}
        </View>
      ))}
    </Card>
  );
}

/** The rates card for a student's selected subject, wired to the signed-in viewer (used on the student page). */
export function StudentSubjectRates({ enrolment, student }: { enrolment?: Enrolment; student: Pick<Student, 'phase'> }) {
  const me = useMe();
  const lookup = useLookup();
  const services = useServices();
  if (!enrolment || me.role === 'student') return null;
  const tutor = enrolment.tutorId ? lookup.tutor(enrolment.tutorId) : undefined;
  const service = serviceForEnrolment(services.data ?? [], enrolment, student);
  return <EnrolmentRatesCard enrolment={enrolment} tutor={tutor} service={service} viewerRole={me.role} viewerTutorId={me.tutorId} />;
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: 14, paddingVertical: 11, fontSize: 16, minHeight: 48 },
});
