/**
 * Design-system kit (developer page): every block of the 2026 redesign in each of its states, for checking the
 * components against the prototypes in light and dark mode at phone and desktop widths. Admin only, in development and
 * demo builds only, linked from nowhere; open /kit directly. Everything here is sample copy for the page itself and
 * changes nothing.
 */
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Icon, ICON_NAMES } from '@/components/icon';
import { DaySeparator, MessageBubble, MessageComposer } from '@/components/messages';
import { HeaderActions } from '@/components/role-tabs';
import {
  Actions,
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  ChipField,
  Columns,
  CountBadge,
  EmptyState,
  Field,
  Figure,
  Figures,
  FieldsCard,
  Group,
  GroupRow,
  Hero,
  ListItem,
  Notice,
  PageHeader,
  Prose,
  Screen,
  Tabs,
  ToastCard,
  Toggle,
  Txt,
  useToast,
} from '@/components/ui';
import { DEMO_MODE } from '@/config';
import { AvatarColors, font, MasteryColors } from '@/constants/theme';
import { useSession } from '@/data/session';
import { useTheme } from '@/hooks/use-theme';

export default function Kit() {
  const role = useSession((s) => s.profile?.role);
  const theme = useTheme();
  const toast = useToast();
  const [tab, setTab] = useState<'overview' | 'notes' | 'homework' | 'ratings'>('overview');
  const [open, setOpen] = useState(true);
  const [name, setName] = useState('Reem Al Mansoori');
  const [when, setWhen] = useState<string | null>('Thu 8 Oct');
  const [days, setDays] = useState<string[]>(['Mon', 'Wed']);
  const [notify, setNotify] = useState(true);
  const [sms, setSms] = useState(false);
  const [draft, setDraft] = useState('');
  // A developer page: in a production build it does not exist, whoever opens it.
  if ((!__DEV__ && !DEMO_MODE) || role !== 'admin') return <Redirect href="/" />;

  return (
    <Screen topInset>
      <Hero
        kicker="Wednesday 7 October"
        title="Good afternoon, Reem."
        line="Layla has Chemistry with Sarah at 15:30 today. Her homework on rates of reaction is due on Friday."
        right={<Avatar name="Reem Al Mansoori" size={36} />}
      />

      <PageHeader
        back
        kicker="Design system"
        title="Kit"
        sub="Every block in each of its states. Sample copy only: nothing on this page changes anything."
        right={<HeaderActions search inbox />}
      />

      <Tabs
        accessibilityLabel="Kit sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'notes', label: 'Lesson notes' },
          { value: 'homework', label: 'Homework', badge: 2 },
          { value: 'ratings', label: 'Topic ratings' },
        ]}
      />

      <Group title="Type">
        <View style={{ padding: 18, gap: 10 }}>
          <Txt variant="kicker">Kicker · 11.5 bold</Txt>
          <Txt variant="display">Display · Georgia</Txt>
          <Txt variant="title">Title · Georgia</Txt>
          <Txt variant="figure">AED 12,400.50</Txt>
          <Txt variant="groupTitle">Group title · Georgia 21</Txt>
          <Txt variant="label">Label · 11 bold</Txt>
          <Txt variant="figureLabel">Figure label · 10.5 bold</Txt>
          <Txt>Body · 15.5. Calibri, falling back to Carlito.</Txt>
          <Txt variant="note">Note · 13.5 in grey.</Txt>
          <Text style={[font('sans'), { fontSize: 15.5, color: theme.textWarm }]}>Warm body #4A463F</Text>
          <Text style={[font('sans'), { fontSize: 15.5, color: theme.textBody }]}>Warm body #3F3B35</Text>
          <Text style={[font('sans'), { fontSize: 15.5, color: theme.textProse }]}>Prose #2E2B26</Text>
        </View>
      </Group>

      <Figures>
        <Figure label="Revenue" value="AED 48,250" hint="October to date" />
        <Figure label="Profit" value="AED 21,730" hint="45% margin" tone="good" />
        <Figure label="Overdue" value="AED 2,400" hint="1 invoice" tone="bad" />
        <Figure label="VAT payable" value="AED 2,708.30" hint="Q3, due 28 Oct" tone="highlight" />
        <Figure label="Lessons" value="64" hint="Tap me" onPress={() => toast('Figures can be tappable.')} />
      </Figures>

      <Columns>
        <Group title="Coming up" link={{ label: 'Book or change', onPress: () => toast('Link pressed.') }}>
          <GroupRow date={{ top: 'Wed', num: '7' }} title="15:30 · Chemistry with Sarah" note="Online · Today" onPress={() => toast('Row pressed.')} />
          <GroupRow
            date={{ top: 'Thu', num: '8' }}
            title="16:00 · Chemistry with Sarah"
            note="Online · Thu 8 Oct"
            value="Change offered"
            valueTone="accent"
            valueSize={12.5}
            onPress={() => toast('Row pressed.')}
          />
          <GroupRow date={{ top: 'Wed', num: '14' }} title="15:30 · Chemistry with Sarah" note="At home · Jumeirah 1" onPress={() => toast('Row pressed.')} />
        </Group>
        <Group title="People" meta="3 this week">
          <GroupRow avatar="Sarah Whitfield" title="Sarah Whitfield" note="Chemistry · cleared" value="AED 180" valueTone="text" />
          <GroupRow avatar="Omar Al Mansoori" title="Omar Al Mansoori" note="Year 12 · Economics" action={{ label: 'Message', onPress: () => toast('Action pressed.') }} />
          <GroupRow avatar="Yasmin Haddad" title="Yasmin Haddad" note="Year 11" action={{ label: 'Approve', variant: 'primary', onPress: () => toast('Approved.') }} />
          <GroupRow avatar="Karim Haddad" title="Karim Haddad" note="Disabled action" action={{ label: 'Remove', variant: 'danger', disabled: true, onPress: () => undefined }} />
        </Group>
      </Columns>

      <Columns>
        <Group title="Layla’s school search" link={{ label: 'Open', onPress: () => toast('Link pressed.') }}>
          <GroupRow icon="travel_explore" title="UK boarding · Sixth Form (16+)" note="Entry September 2027 · with Craig" progress={40} value="40%" valueTone="text" onPress={() => undefined} />
          <GroupRow icon="event" title="Benenden registration closes" note="Thursday 15 October" onPress={() => undefined} />
          <GroupRow icon="assignment" tone="warn" title="Ask Layla’s head of year for a reference" note="For you · by 1 November" onPress={() => undefined} />
        </Group>
        <Group title="Handed in" note="Tap a row to read the tutor’s comment.">
          <GroupRow
            icon="task_alt"
            tone="good"
            title="Electrolysis worksheet"
            note="Handed in 28 September"
            value="14 / 20"
            valueTone="good"
            expanded={open}
            onToggle={() => setOpen((o) => !o)}
            body="Sarah: Good on the products at each electrode. Half-equations need practice; the worked examples on page 2 will help."
          />
          <GroupRow icon="task_alt" tone="good" title="Moles quick quiz" note="Handed in 24 September" value="9 / 10" valueTone="good" body="Sarah: Excellent. Careful rounding throughout." />
          <GroupRow icon="report" tone="bad" title="Missing receipt" note="Zoom annual licence" value="AED 540" valueTone="bad" />
        </Group>
      </Columns>

      <Group title="Summary">
        <GroupRow title="Subtotal" titleWeight="regular" value="AED 2,285.71" valueTone="text" />
        <GroupRow title="VAT at 5%" titleWeight="regular" value="AED 114.29" valueTone="text" />
        <GroupRow title="Total" value="AED 2,400.00" valueTone="text" valueSize={17} />
        <GroupRow title="Balance due" value="AED 2,400.00" valueTone="warn" valueSize={17} />
      </Group>

      <Notice tone="info" title="Read only">
        You can see everything in the books. To change something, send a request to the office.
      </Notice>
      <Notice tone="warn" title="AED 2,400 is due on your account" link={{ label: 'Pay now', onPress: () => toast('Link pressed.') }}>
        INV-0412 for September’s lessons was due on 25 September.
      </Notice>
      <Notice tone="good" title="Paid">
        Thank you. Your receipt is on its way.
      </Notice>
      <Notice tone="danger" title="Something went wrong">
        We could not save that. Please try again.
      </Notice>
      <Banner tone="success">Legacy Banner, drawn as a Notice.</Banner>

      <Prose
        title="Lesson notes"
        by="Sarah Whitfield · Thursday 1 October"
        paragraphs={[
          'Layla worked carefully through collision theory and is now confident with rate graphs.',
          'Next week: catalysts. Two past-paper questions are set for Friday.',
        ]}
      />

      <FieldsCard title="Fields">
        <Field label="Your name" value={name} onChangeText={setName} placeholder="e.g. Fatima Hassan" />
        <Field label="Email" value="" onChangeText={() => undefined} placeholder="you@example.com" error />
        <Field label="Sign-in email" value="reem@example.com" editable={false} hint="Only the office can change this." />
        <Field label="Note for us (optional)" value="" onChangeText={() => undefined} multiline placeholder="Anything we should know" />
        <ChipField label="When" options={['Thu 8 Oct', 'Sun 11 Oct', 'Mon 12 Oct']} value={when} onChange={(v) => setWhen(v === when ? null : v)} />
        <ChipField label="Days (several)" options={['Mon', 'Tue', 'Wed', 'Thu', 'Fri']} value={days} onChange={(v) => setDays((d) => (d.includes(v) ? d.filter((x) => x !== v) : [...d, v]))} hint="Choose as many as suit you." />
        <ChipField label="Topic" options={['Missing receipt', 'Transaction', 'Something else']} value={null} onChange={() => undefined} error />
        <Toggle title="Email me invoices" note="Sent as soon as they are issued." value={notify} onValueChange={setNotify} />
        <Toggle title="Text reminders" value={sms} onValueChange={setSms} />
        <Toggle title="Autopay" note="Needs a saved card first." value={false} onValueChange={() => undefined} disabled />
      </FieldsCard>

      <Actions>
        <Button title="Pay AED 2,400" icon="lock" onPress={() => toast('Recorded. Reem has the note and AED 180 is on your October pay.')} />
        <Button title="Message us" icon="forum" variant="secondary" onPress={() => toast('Secondary pressed.')} />
        <Button title="Close my login" variant="danger" onPress={() => toast('Danger pressed.')} />
        <Button title="Send" variant="primary" disabled onPress={() => undefined} />
      </Actions>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Button title="Compact" size="sm" onPress={() => undefined} />
        <Button title="Compact secondary" size="sm" variant="secondary" onPress={() => undefined} />
        <Badge label="Overdue" tone="danger" />
        <Badge label="Paid" tone="success" />
        <Badge label="Draft" tone="gold" />
        <CountBadge count={3} />
        <CountBadge count={12} size={20} />
      </View>

      <Group title="Toast">
        <View style={{ padding: 18, gap: 12, alignItems: 'flex-start' }}>
          <ToastCard message="Recorded. Reem has the note and AED 180 is on your October pay." />
          <Button title="Show a toast" size="sm" variant="secondary" onPress={() => toast('Saved. The office has your request.')} />
        </View>
      </Group>

      <Group title="Messages">
        <View style={{ padding: 18, gap: 10 }}>
          <DaySeparator label="Yesterday" />
          <MessageBubble who="Sarah Whitfield · tutor" time="18:20">
            Hello Mrs Al Mansoori. I have shared a revision sheet on rate graphs with Layla.
          </MessageBubble>
          <MessageBubble mine time="08:05">
            Thank you, Sarah. She will look at it tonight.
          </MessageBubble>
          <MessageComposer value={draft} onChangeText={setDraft} onSend={() => setDraft('')} />
          <MessageComposer value="Ready to send" onChangeText={() => undefined} onSend={() => undefined} onAttach={() => undefined} />
        </View>
      </Group>

      <Group title="Legacy blocks">
        <View style={{ padding: 18, gap: 12 }}>
          <Card>
            <Txt>Card (restyled: radius 18, hairline, no shadow)</Txt>
          </Card>
          <ListItem title="ListItem" subtitle="Older single-row card" onPress={() => undefined} />
        </View>
      </Group>
      <EmptyState icon="inbox" title="Nothing to record" message="Lessons you teach appear here once they finish." />

      <Group title="Avatars and mastery">
        <View style={{ padding: 18, flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <Avatar name="Craig O'Brien" size={38} />
          {AvatarColors.map((c, i) => (
            <Avatar key={c} name={['Reem Mansoori', 'Sarah Whitfield', 'Omar Haddad', 'Noor Rahman', 'Arjun Sharma'][i]} color={c} size={38} />
          ))}
          {MasteryColors.map((c) => (
            <View key={c} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: c }} />
          ))}
        </View>
      </Group>

      <Group title="Icons" meta={`${ICON_NAMES.length} names · 300 and 500`}>
        <View style={{ padding: 18, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {ICON_NAMES.map((n) => (
            <View key={n} style={{ width: 96, alignItems: 'center', gap: 4, paddingVertical: 6 }}>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <Icon name={n} size={22} color={theme.accent} />
                <Icon name={n} size={22} color={theme.text} weight={500} />
              </View>
              <Txt variant="small" style={{ fontSize: 10.5 }} numberOfLines={1}>
                {n}
              </Txt>
            </View>
          ))}
        </View>
      </Group>
    </Screen>
  );
}
