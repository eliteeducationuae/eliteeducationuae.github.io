import { enrolmentTitle, topicListKey } from './enrolments';
import type { Syllabus, SyllabusUnit } from './progress';
import type { Enrolment, Topic, TopicList } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolves topic ids (built-in syllabus ids and stored topic ids) to names, units, subjects and trees. */
export interface TopicLookup {
  /** The topic's name. An unknown stored topic (a UUID) reads 'Topic'; any other unknown id is shown as it is. */
  name(topicId: string): string;
  /** The unit name, when the topic has one. */
  unit(topicId: string): string | undefined;
  /** The subject the topic belongs to. */
  subjectOf(topicId: string): string | undefined;
  /** The topic tree for an enrolment: the built-in syllabus (if any) plus the stored topics of its shared list. */
  treeFor(e: Pick<Enrolment, 'subject' | 'curriculum' | 'level' | 'syllabusId' | 'topicListId'>): Syllabus;
  /** A built-in syllabus by id, for students and reports recorded before subjects existed. */
  builtIn(syllabusId: string | null | undefined): Syllabus | undefined;
}

/** Name of the unit that stored topics without a unit are grouped under. */
export const DEFAULT_UNIT = 'Topics';

interface Entry {
  name: string;
  unit?: string;
  subject?: string;
}

export function buildTopicLookup(builtIns: Syllabus[], lists: TopicList[], topics: Topic[]): TopicLookup {
  const index = new Map<string, Entry>();
  for (const s of builtIns) {
    for (const u of s.units) for (const t of u.topics) index.set(t.id, { name: t.name, unit: u.name, subject: s.subject });
  }
  const listById = new Map(lists.map((l) => [l.id, l]));
  const listByKey = new Map(lists.map((l) => [topicListKey(l.subject, l.curriculum, l.level), l]));
  const topicsByList = new Map<string, Topic[]>();
  for (const t of topics) {
    index.set(t.id, { name: t.name, unit: t.unit?.trim() || undefined, subject: listById.get(t.listId)?.subject });
    const arr = topicsByList.get(t.listId) ?? [];
    arr.push(t);
    topicsByList.set(t.listId, arr);
  }
  for (const arr of topicsByList.values()) arr.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  const builtInById = new Map(builtIns.map((s) => [s.id, s]));

  return {
    name: (id) => index.get(id)?.name ?? (UUID.test(id) ? 'Topic' : id),
    unit: (id) => index.get(id)?.unit,
    subjectOf: (id) => index.get(id)?.subject,
    builtIn: (id) => (id ? builtInById.get(id) : undefined),
    treeFor(e) {
      const key = topicListKey(e.subject, e.curriculum, e.level);
      const builtIn = e.syllabusId ? builtInById.get(e.syllabusId) : undefined;
      const units: SyllabusUnit[] = (builtIn?.units ?? []).map((u) => ({ ...u, topics: [...u.topics] }));
      const list = (e.topicListId ? listById.get(e.topicListId) : undefined) ?? listByKey.get(key);
      if (list) {
        for (const t of topicsByList.get(list.id) ?? []) {
          const unitName = t.unit?.trim() || DEFAULT_UNIT;
          let unit = units.find((u) => u.name.toLowerCase() === unitName.toLowerCase());
          if (!unit) {
            unit = { id: `${list.id}:${unitName.toLowerCase()}`, name: unitName, topics: [] };
            units.push(unit);
          }
          unit.topics.push({ id: t.id, name: t.name });
        }
      }
      return {
        id: e.syllabusId ?? e.topicListId ?? `custom:${key}`,
        name: builtIn?.name ?? enrolmentTitle(e),
        curriculum: e.curriculum ?? '',
        subject: e.subject,
        level: e.level,
        units,
      };
    },
  };
}
