import { useState } from 'react';
import { Switch } from 'react-native';

import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useMe, useSession } from '@/data/session';
import { canUseWhatsApp, formatWhatsAppNumber, normaliseWhatsAppNumber, whatsAppMessageKinds } from '@/domain/whatsapp';
import { useTheme } from '@/hooks/use-theme';
import { notify } from '@/lib/confirm';

import { Badge, Button, Card, ErrorNote, Field, Row, Section, Txt } from './ui';

const INVALID_NUMBER = 'Please enter your WhatsApp number with its country code, for example +971 50 123 4567.';

/** The number to show in the field: the saved WhatsApp number, else the profile phone, formatted when possible. */
function initialNumber(saved: string | undefined, phone: string | undefined): string {
  if (saved) return formatWhatsAppNumber(saved);
  const fromPhone = phone ? normaliseWhatsAppNumber(phone) : null;
  return fromPhone ? formatWhatsAppNumber(fromPhone) : (phone ?? '');
}

/** Opt in to WhatsApp reminders (parents and tutors). Hidden for students and when the backend lacks it. */
export function WhatsAppCard() {
  const me = useMe();
  const theme = useTheme();
  const setWhatsApp = useSession((s) => s.setWhatsApp);
  const savedOn = me.whatsappOptIn ?? false;
  const [optIn, setOptIn] = useState(() => savedOn);
  const [number, setNumber] = useState(() => initialNumber(me.whatsappNumber, me.phone));
  // What the number field held after the last save, so an untouched form is not offered for saving.
  const [baseline, setBaseline] = useState(() => initialNumber(me.whatsappNumber, me.phone));
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  if (!canUseWhatsApp(me.role) || !source.setWhatsApp) return null;

  const changed = optIn !== savedOn || number.trim() !== baseline.trim();
  const showNumber = optIn || !!me.whatsappNumber;

  async function save() {
    setError(null);
    setInvalid(false);
    const normalised = normaliseWhatsAppNumber(number);
    if (optIn && !normalised) {
      setInvalid(true);
      return;
    }
    setSaving(true);
    try {
      await setWhatsApp({ optIn, number: normalised });
      const shown = normalised ? formatWhatsAppNumber(normalised) : number;
      setNumber(shown);
      setBaseline(shown);
      if (optIn && normalised) notify('WhatsApp reminders are on', `We will send them to ${formatWhatsAppNumber(normalised)}.`);
      else notify('WhatsApp reminders are off', 'You will no longer receive WhatsApp messages from us.');
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="WhatsApp reminders" action={<Badge label={savedOn ? 'On' : 'Off'} tone={savedOn ? 'gold' : 'neutral'} />}>
      <Card style={{ gap: Spacing.three }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt style={{ flex: 1 }}>Send me reminders on WhatsApp</Txt>
          <Switch
            value={optIn}
            onValueChange={(v) => {
              setOptIn(v);
              setInvalid(false);
            }}
            trackColor={{ true: theme.gold, false: theme.border }}
            thumbColor={theme.onHero}
            // react-native-web paints the "on" thumb teal unless told otherwise.
            {...({ activeThumbColor: theme.onHero } as object)}
            accessibilityLabel="WhatsApp reminders"
          />
        </Row>
        <Txt variant="muted">{whatsAppMessageKinds(me.role).map((kind) => `• ${kind}`).join('\n')}</Txt>
        {showNumber ? (
          <Field
            label="WhatsApp number"
            value={number}
            onChangeText={(t) => {
              setNumber(t);
              setInvalid(false);
            }}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            hint="Include your country code, for example +971 50 123 4567."
          />
        ) : null}
        {invalid ? (
          <Txt variant="small" color="danger" accessibilityRole="alert">
            {INVALID_NUMBER}
          </Txt>
        ) : null}
        <Txt variant="small">
          We send only the messages listed above. We never send marketing or bank details by WhatsApp, and you can switch
          this off at any time.
          {optIn ? ' By saving, you agree to receive these messages from Elite Education on WhatsApp at this number.' : ''}
        </Txt>
        {source.kind === 'demo' ? <Txt variant="small">Demo mode: no WhatsApp messages are sent.</Txt> : null}
        <ErrorNote error={error} />
        <Button title="Save WhatsApp settings" variant="primary" loading={saving} disabled={!changed || saving} onPress={save} />
      </Card>
    </Section>
  );
}
