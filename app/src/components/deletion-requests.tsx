import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useCancelDeletionRequest, useDeletionRequests, useFamilies, useProcessDeletionRequest, useRecordDeletionRequest, useTutors } from '@/data/hooks';
import {
  canCancelRequest,
  canProcessRequest,
  DELETION_STATUS_LABEL,
  DELETION_STATUS_ORDER,
  deletionSummaryText,
} from '@/domain/data-rights';
import { withoutClosed } from '@/domain/closed-accounts';
import { formatDate } from '@/domain/dates';
import type { DeletionRequest } from '@/domain/types';
import { confirm, notify } from '@/lib/confirm';

import { Badge, Banner, Button, Card, Chip, EmptyState, ErrorNote, Field, Loading, Row, Screen, Section, Segmented, Txt, type Tone } from './ui';

const STATUS_TONE: Record<DeletionRequest['status'], Tone> = {
  pending: 'gold',
  processing: 'info',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

/** What processing keeps, addressed to the office rather than to the person leaving. */
const PROCESS_NOTE: Record<DeletionRequest['targetKind'], string> = {
  family:
    'Future lessons will be cancelled. Invoices and payment records are kept for the period UAE law requires, without contact details.',
  tutor: 'Their invoices and lesson history are kept for tax and pay records. Any upcoming lessons will need another tutor.',
  profile: 'Only the login is removed. Business records are kept.',
};

const KIND_LABEL: Record<DeletionRequest['targetKind'], string> = { family: 'Family', tutor: 'Tutor', profile: 'Login' };

function RequestCard({ r }: { r: DeletionRequest }) {
  const process = useProcessDeletionRequest();
  const cancel = useCancelDeletionRequest();
  const summary = deletionSummaryText(r.summary);
  return (
    <Card style={{ gap: Spacing.two }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }} gap={Spacing.two}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="h3">{r.label}</Txt>
          <Txt variant="small">
            {KIND_LABEL[r.targetKind]} · requested {formatDate(r.createdAt)}
            {r.completedAt ? ` · completed ${formatDate(r.completedAt)}` : ''}
          </Txt>
        </View>
        <Badge label={DELETION_STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} />
      </Row>
      {r.reason ? <Txt variant="muted">{r.reason}</Txt> : null}
      {r.status === 'completed' && summary ? <Txt>{summary}</Txt> : null}
      {r.error ? <Banner tone="danger" icon="alert">{r.error}</Banner> : null}
      {canProcessRequest(r) || canCancelRequest(r) ? (
        <Row wrap>
          {canProcessRequest(r) ? (
            <Button
              title="Process now"
              size="sm"
              variant="gold"
              loading={process.isPending}
              onPress={() =>
                confirm(
                  'Process this deletion now?',
                  `${r.label}: personal details will be removed permanently. ${PROCESS_NOTE[r.targetKind]}`,
                  () =>
                    process.mutate(r.id, {
                      onSuccess: (s) => notify('Deletion completed', deletionSummaryText(s)),
                      onError: (err) => notify('The deletion could not be completed', err instanceof Error ? err.message : String(err)),
                    }),
                  'Delete',
                )
              }
            />
          ) : null}
          {canCancelRequest(r) ? (
            <Button
              title="Cancel"
              size="sm"
              variant="secondary"
              loading={cancel.isPending}
              onPress={() =>
                confirm('Cancel this request?', 'Nothing will be deleted. You can record a new request later.', () =>
                  cancel.mutate(r.id, { onError: (err) => notify('The request could not be cancelled', err instanceof Error ? err.message : String(err)) }),
                )
              }
            />
          ) : null}
        </Row>
      ) : null}
    </Card>
  );
}

function RecordRequestForm({ onDone }: { onDone: () => void }) {
  const families = useFamilies();
  const tutors = useTutors();
  const record = useRecordDeletionRequest();
  const [kind, setKind] = useState<'family' | 'tutor'>('family');
  const [search, setSearch] = useState('');
  const [targetId, setTargetId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const options = useMemo(() => {
    const term = search.trim().toLowerCase();
    const all =
      kind === 'family'
        ? withoutClosed(families.data).filter((f) => f.status !== 'archived').map((f) => ({ id: f.id, label: `${f.name} family`, hint: f.parentName }))
        : withoutClosed(tutors.data).map((t) => ({ id: t.id, label: t.fullName, hint: t.email }));
    return all.filter((o) => !term || o.label.toLowerCase().includes(term) || o.hint.toLowerCase().includes(term)).slice(0, 12);
  }, [kind, search, families.data, tutors.data]);

  const submit = () =>
    record.mutate(kind === 'family' ? { familyId: targetId!, reason } : { tutorId: targetId!, reason }, {
      onSuccess: () => {
        setTargetId(null);
        setReason('');
        setSearch('');
        onDone();
      },
    });

  return (
    <Card style={{ gap: Spacing.three }}>
      <Txt variant="muted">Record a request received by email or telephone. Nothing is deleted until you choose Process now.</Txt>
      <Segmented
        options={[
          { value: 'family', label: 'Family' },
          { value: 'tutor', label: 'Tutor' },
        ]}
        value={kind}
        onChange={(v) => {
          setKind(v);
          setTargetId(null);
        }}
      />
      <Field label={kind === 'family' ? 'Find a family' : 'Find a tutor'} value={search} onChangeText={setSearch} placeholder="Type a name" autoCorrect={false} />
      <Row wrap>
        {options.map((o) => (
          <Chip key={o.id} label={o.label} selected={targetId === o.id} onPress={() => setTargetId(o.id)} />
        ))}
        {!options.length ? <Txt variant="small">No matches.</Txt> : null}
      </Row>
      <Field label="Reason (optional)" value={reason} onChangeText={setReason} multiline placeholder="For example, requested by email on 3 October" />
      <ErrorNote error={record.error} />
      <Button title="Record request" variant="gold" icon="plus" disabled={!targetId} loading={record.isPending} onPress={submit} />
    </Card>
  );
}

/** Admin: account deletion requests, grouped by status. */
export function DeletionRequestsScreen() {
  const requests = useDeletionRequests();
  const [adding, setAdding] = useState(false);
  if (requests.isLoading) return <Loading />;
  const list = requests.data ?? [];
  return (
    <Screen onRefresh={() => requests.refetch()} refreshing={requests.isRefetching}>
      <ErrorNote error={requests.error} />
      <Section
        title="Record a request"
        action={<Button title={adding ? 'Close' : 'New request'} size="sm" variant="outline" icon={adding ? 'close' : 'plus'} onPress={() => setAdding((a) => !a)} />}>
        {adding ? (
          <RecordRequestForm onDone={() => setAdding(false)} />
        ) : (
          <Txt variant="muted">
            People can delete their own accounts from the app. Families and tutors who ask by email or telephone can be recorded here.
          </Txt>
        )}
      </Section>
      {list.length ? (
        DELETION_STATUS_ORDER.map((status) => {
          const group = list.filter((r) => r.status === status);
          if (!group.length) return null;
          return (
            <Section key={status} title={`${DELETION_STATUS_LABEL[status]} (${group.length})`}>
              {group.map((r) => (
                <RequestCard key={r.id} r={r} />
              ))}
            </Section>
          );
        })
      ) : (
        <EmptyState icon="check" title="No deletion requests" message="Accounts deleted from the app, and requests you record, will appear here." />
      )}
    </Screen>
  );
}
