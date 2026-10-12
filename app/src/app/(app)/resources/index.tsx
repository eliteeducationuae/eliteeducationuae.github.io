import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { NoHeader } from '@/components/admin-people/kit';
import { applyResourceFilter, openAttachment, ResourceFilters, type ResourceFilterValue } from '@/components/resources';
import { Actions, Button, Chip, Columns, EmptyState, ErrorNote, Group, GroupRow, Loading, Notice, PageHeader, Screen, Txt, useToast } from '@/components/ui';
import { source } from '@/data';
import { useAction, useResources, useStudents } from '@/data/hooks';
import { useMe, useViewing } from '@/data/session';
import { formatDate } from '@/domain/dates';
import { resourceAttachment, resourceMeta } from '@/domain/homework';
import type { Resource } from '@/domain/types';
import { withoutClosed } from '@/domain/closed-accounts';
import { confirm } from '@/lib/confirm';

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
  const [openId, setOpenId] = useState<string | null>(null);
  const viewing = useViewing();
  const toast = useToast();

  if (!staff) {
    return (
      <Screen topInset>
        <NoHeader title="Resource library" />
        <PageHeader back={{ fallback: '/' }} kicker="Library" title="Resource library" />
        <EmptyState icon="folder" title="For tutors only" message="Resources your tutor shares with you appear alongside your homework." />
      </Screen>
    );
  }
  if (resources.isLoading) return <Loading />;

  const all = resources.data ?? [];
  const list = applyResourceFilter(all, filter);
  const myStudents = withoutClosed(students.data).sort((a, b) => a.fullName.localeCompare(b.fullName));
  const canChange = (r: Resource) => me.role === 'admin' || r.uploadedBy === me.id;
  // Grouped by subject, in name order, with anything unfiled last.
  const groups = [...new Set(list.map((r) => r.subject?.trim() || ''))].sort((a, b) => (!a ? 1 : !b ? -1 : a.localeCompare(b)));

  async function shareWith(r: Resource, studentId: string) {
    const student = myStudents.find((s) => s.id === studentId);
    const firstName = student?.fullName.split(' ')[0] ?? 'the student';
    if (r.studentIds.includes(studentId)) {
      confirm(
        'Stop sharing?',
        `${r.title} will no longer be available to ${firstName} and their family. Homework already set keeps its copy.`,
        () => {
          share.reset();
          unshare.mutate([r.id, studentId], { onSuccess: () => toast(`${r.title} is no longer shared with ${firstName}.`) });
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
    toast(`Shared. ${r.title} is now available to ${firstName} and their family.`);
  }

  const sharingLine = (r: Resource) => {
    const n = r.studentIds.length;
    if (me.role === 'admin') return n ? `Shared with ${n} ${n === 1 ? 'student' : 'students'}` : 'Not yet shared';
    return n ? `Shared with ${n} of your students` : 'Not yet shared';
  };

  const addButton = <Button title="Add a resource" icon="upload" onPress={() => router.push('/resources/edit')} />;

  return (
    <Screen topInset onRefresh={() => resources.refetch()} refreshing={resources.isRefetching}>
      <NoHeader title="Resource library" />
      <PageHeader
        back={{ fallback: '/' }}
        kicker={me.role === 'admin' ? 'Team' : 'Library'}
        title="Resource library"
        sub="Worksheets, past papers and useful links in one place. Share them with a student or attach them to homework."
      />
      {all.length === 0 ? (
        <EmptyState icon="folder" title="The library is empty" message="Add your first worksheet, past paper or link so that every tutor can use it." action={addButton} />
      ) : (
        <>
          <ResourceFilters resources={all} value={filter} onChange={setFilter} />
          <ErrorNote error={remove.error} />
          {list.length === 0 ? <Notice tone="info" title="No resources">Nothing matches. Try another subject or search term.</Notice> : null}
          <Columns>
            {groups.map((g) => {
              const items = list.filter((r) => (r.subject?.trim() || '') === g);
              return (
                <Group key={g || 'other'} title={g || 'Other'} meta={String(items.length)}>
                  {items.map((r) => (
                    <GroupRow
                      key={r.id}
                      icon={r.kind === 'link' ? 'link' : 'description'}
                      title={r.title}
                      note={[resourceMeta(r), r.uploadedByName ? `Added by ${r.uploadedByName}` : null, formatDate(r.createdAt)].filter(Boolean).join(' · ')}
                      value={r.studentIds.length ? `${r.studentIds.length} shared` : 'Library'}
                      valueTone={r.studentIds.length ? 'accent' : 'muted'}
                      valueSize={12.5}
                      expanded={openId === r.id}
                      onToggle={() => {
                        setOpenId(openId === r.id ? null : r.id);
                        setSharingId(null);
                      }}
                      body={
                        <View style={{ gap: 12 }}>
                          {r.description ? <Txt style={{ fontSize: 14.5, lineHeight: 22 }}>{r.description}</Txt> : null}
                          <Txt variant="small">{[sharingLine(r), r.tags.length ? `Tags: ${r.tags.join(', ')}` : null].filter(Boolean).join(' · ')}</Txt>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                            <Button title="Open" icon={r.kind === 'link' ? 'link' : 'description'} size="sm" variant="secondary" onPress={() => openAttachment(resourceAttachment(r))} />
                            {viewing ? null : (
                              <Button
                                title="Share with a student"
                                icon="share"
                                size="sm"
                                variant="secondary"
                                onPress={() => {
                                  share.reset();
                                  setSharingId(sharingId === r.id ? null : r.id);
                                }}
                              />
                            )}
                            {canChange(r) && !viewing ? (
                              <>
                                <Button title="Edit" icon="edit" size="sm" variant="secondary" onPress={() => router.push(`/resources/edit?id=${r.id}`)} />
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
                          </View>
                          {sharingId === r.id ? (
                            <View style={{ gap: 8 }}>
                              <Txt variant="label">Share with</Txt>
                              {myStudents.length === 0 ? (
                                <Txt variant="muted">You have no students to share with yet.</Txt>
                              ) : (
                                <Txt variant="small">Tap a name to share. Tap a selected name to stop sharing.</Txt>
                              )}
                              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                                {myStudents.map((s) => (
                                  <Chip key={s.id} label={s.fullName} selected={r.studentIds.includes(s.id)} onPress={() => shareWith(r, s.id)} />
                                ))}
                              </View>
                              {share.isPending || unshare.isPending ? <Loading /> : null}
                              <ErrorNote error={share.error ?? unshare.error} />
                            </View>
                          ) : null}
                        </View>
                      }
                    />
                  ))}
                </Group>
              );
            })}
          </Columns>
          {viewing ? null : <Actions>{addButton}</Actions>}
        </>
      )}
    </Screen>
  );
}
