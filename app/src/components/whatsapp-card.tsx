import { useState } from 'react';
import { Switch, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useMe, useSession } from '@/data/session';
import {
  canUseWhatsApp,
  formatWhatsAppNumber,
  isLikelyWhatsAppMobile,
  normaliseWhatsAppNumber,
  whatsAppMessageKinds,
} from '@/domain/whatsapp';
import { useTheme } from '@/hooks/use-theme';
import { notify } from '@/lib/confirm';

import { Badge, Button, Card, ErrorNote, Field, Row, Txt } from './ui';

const INVALID_NUMBER = 'Please enter your WhatsApp number with its country code, for example +971 50 123 4567.';

/**
 * The number to show in the field: the saved WhatsApp number, else the profile phone when it could take WhatsApp
 * (a UAE mobile or any number abroad, never a UAE landline), else empty.
 */
function initialNumber(saved: string | undefined, phone: string | undefined): string {
  if (saved) return formatWhatsAppNumber(saved);
  const fromPhone = phone ? normaliseWhatsAppNumber(phone) : null;
  return fromPhone && isLikelyWhatsAppMobile(fromPhone) ? formatWhatsAppNumber(fromPhone) : '';
}

/** Opt in to WhatsApp reminders (parents, tutors and teaching office accounts). Hidden otherwise, and when the backend lacks it. */
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

  if (!canUseWhatsApp(me.role, me.tutorId) || !source.setWhatsApp) return null;

  const changed = optIn !== savedOn || number.trim() !== baseline.trim();
  const showNumber = optIn || !!me.whatsappNumber;

  async function save() {
    setError(null);
    setInvalid(false);
    const normalised = normaliseWhatsAppNumber(number);
    // Any text that is not a usable number is an error, whether the switch is on or off, so nothing is silently dropped.
    if ((optIn || number.trim()) && !normalised) {
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
    <Card style={{ gap: Spacing.three }}>
      {/* Same heading pattern as the Google Calendar and calendar subscription cards: the title, then the status badge. */}
      <Row gap={Spacing.two} style={{ justifyContent: 'space-between' }}>
        <Txt variant="h3">WhatsApp reminders</Txt>
        <Badge label={savedOn ? 'On' : 'Off'} tone={savedOn ? 'gold' : 'neutral'} />
      </Row>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt style={{ flex: 1 }}>Send me reminders on WhatsApp</Txt>
        <Switch
          value={optIn}
          onValueChange={(v) => {
            setOptIn(v);
            setInvalid(false);
          }}
          // The track shows the state: gold (the accent) when on, muted when off. When on, the thumb is noir in both
          // themes so it stands out on the gold track (an ivory thumb on dark mode's light gold was too faint); when
          // off it is the text colour, standing out from the card.
          trackColor={{ true: theme.accent, false: theme.textMuted }}
          thumbColor={optIn ? theme.onGold : theme.text}
          // react-native-web paints the "on" thumb teal unless told otherwise.
          {...({ activeThumbColor: theme.onGold } as object)}
          accessibilityLabel="WhatsApp reminders"
        />
      </Row>
      <View style={{ gap: Spacing.one }}>
        {whatsAppMessageKinds(me.role).map((kind) => (
          <Row key={kind} style={{ alignItems: 'flex-start' }}>
            <Txt variant="muted" style={{ width: 10 }} aria-hidden>
              •
            </Txt>
            <Txt variant="muted" style={{ flex: 1 }}>
              {kind}
            </Txt>
          </Row>
        ))}
      </View>
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
          // While the error shows it says the same thing, so the hint steps aside.
          hint={invalid ? undefined : 'Include your country code, for example +971 50 123 4567.'}
          style={invalid ? { borderColor: theme.danger } : undefined}
          {...({ 'aria-invalid': invalid } as object)}
        />
      ) : null}
      {invalid ? (
        <Txt variant="small" color="danger" accessibilityRole="alert">
          {INVALID_NUMBER}
        </Txt>
      ) : null}
      <Txt variant="small">
        We send only the messages listed above, during the day (UAE time). We never send marketing or bank details by
        WhatsApp, and you can switch this off at any time.
        {optIn ? ' By saving, you agree to receive these messages from Elite Education on WhatsApp at this number.' : ''}
      </Txt>
      {source.kind === 'demo' ? <Txt variant="small">Demo mode: no WhatsApp messages are sent.</Txt> : null}
      <ErrorNote error={error} />
      <Button title="Save WhatsApp settings" variant="primary" loading={saving} disabled={!changed || saving} onPress={save} />
    </Card>
  );
}
