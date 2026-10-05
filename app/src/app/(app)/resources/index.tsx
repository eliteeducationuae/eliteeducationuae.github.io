import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { applyResourceFilter, openAttachment, ResourceCard, ResourceFilters, type ResourceFilterValue } from '@/components/resources';
import { Button, Card, Chip, EmptyState, ErrorNote, Loading, Row, Screen, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useResources, useStudents } from '@/data/hooks';
import { useMe } from '@/data/session';
import { resourceAttachment } from '@/domain/homework';
import type { Resource } from '@/domain/types';
import { withoutClosed } from '@/domain/closed-accounts';
import { confirm, notify } from '@/lib/confirm';

/** Worksheets, past papers and links that tutors share with students or attach to homework. */
export default function ResourceLibrary() {
  const me = useMe();
  const staff = me.role === 'admin' || me.role === 'tutor';
  const resources = useResources();
  const students = useStudents();
  const share = useAction(source.shareResource);
  const unshare = useAction(source.unshareResource);
  const remove = useAction(source.deleteResource);
  const [filter, setFilter] = useState<ResourceFilterValue>({ query: '' });
  const [sharingId, setSharingId] = useState<string | null>(null);

  if (!staff) {
    return (
      <Screen>
        <EmptyState icon="folder" title="For tutors only" message="Resources your tutor shares with you appear alongside your homework." />
      </Screen>
    );
  }
  if (resources.isLoading) return <Loading />;

  const all = resources.data ?? [];
  const list = applyResourceFilter(all, filter);
  const myStudents = withoutClosed(students.data).sort((a, b) => a.fullName.localeCompare(b.fullName));
  const canChange = (r: Resource) => me.role === 'admin' || r.uploadedBy === me.id;

  async function shareWith(r: Resource, studentId: string) {
    const student = myStudents.find((s) => s.id === studentId);
    const firstName = student?.fullName.split(' ')[0] ?? 'the student';
    if (r.studentIds.includes(studentId)) {
      confirm(
        'Stop sharing?',
        `${r.title} will no longer be available to ${firstName} and their family. Homework already set keeps its copy.`,
        () => {
          share.reset();
          unshare.mutate([r.id, studentId]);
        },
        'Stop sharing',
      );
      return;
    }
    unshare.reset();
    try {
      await share.mutateAsync([r.id, studentId]);
    } catch {
      return; // shown by ErrorNote
    }
    setSharingId(null);
    notify('Shared', `${r.title} is now available to ${firstName} and their family.`);
  }

  const addButton = <Button title="Add a resource" icon="plus" variant="gold" onPress={() => router.push('/resources/edit')} />;

  return (
    <Screen onRefresh={() => resources.refetch()} refreshing={resources.isRefetching}>
      <Txt variant="muted">Keep worksheets, past papers and useful links in one place, then share them with a student or attach them to homework.</Txt>
      {all.length === 0 ? (
        <EmptyState icon="folder" title="The library is empty" message="Add your first worksheet, past paper or link so that every tutor can use it." action={addButton} />
      ) : (
        <>
          <ResourceFilters resources={all} value={filter} onChange={setFilter} />
          {addButton}
          <ErrorNote error={remove.error} />
          {list.length === 0 ? <Txt variant="muted">No resources match your search.</Txt> : null}
          {list.map((r) => (
            <View key={r.id} style={{ gap: Spacing.two }}>
              <ResourceCard
                resource={r}
                actions={
                  <>
                    <Button title="Open" icon={r.kind === 'link' ? 'link' : 'doc'} size="sm" variant="outline" onPress={() => openAttachment(resourceAttachment(r))} />
                    <Button
                      title="Share with a student"
                      icon="share"
                      size="sm"
                      variant="outline"
                      onPress={() => {
                        share.reset();
                        setSharingId(sharingId === r.id ? null : r.id);
                      }}
                    />
                    {canChange(r) ? (
                      <>
                        <Button title="Edit" size="sm" variant="ghost" onPress={() => router.push(`/resources/edit?id=${r.id}`)} />
                        <Button
                          title="Delete"
                          size="sm"
                          variant="danger"
                          loading={remove.isPending && remove.variables?.[0] === r.id}
                          onPress={() =>
                            confirm(
                              'Delete this resource?',
                              `${r.title} will be removed from the library and from the students with whom it has been shared. Homework that has already been set keeps its copy.`,
                              () => remove.mutate([r.id]),
                              'Delete',
                            )
                          }
                        />
                      </>
                    ) : null}
                  </>
                }
              />
              {sharingId === r.id ? (
                <Card style={{ gap: Spacing.two }}>
                  <Txt variant="label">Share with</Txt>
                  {myStudents.length === 0 ? (
                    <Txt variant="muted">You have no students to share with yet.</Txt>
                  ) : (
                    <Txt variant="small">Tap a name to share. Tap a selected name to stop sharing.</Txt>
                  )}
                  <Row gap={Spacing.one} wrap>
                    {myStudents.map((s) => (
                      <Chip key={s.id} label={s.fullName} selected={r.studentIds.includes(s.id)} onPress={() => shareWith(r, s.id)} />
                    ))}
                  </Row>
                  {share.isPending || unshare.isPending ? <Loading /> : null}
                  <ErrorNote error={share.error ?? unshare.error} />
                </Card>
              ) : null}
            </View>
          ))}
        </>
      )}
    </Screen>
  );
}
