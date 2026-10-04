import type { TopicRating } from './types';

export interface SyllabusTopic {
  id: string;
  name: string;
}

export interface SyllabusUnit {
  id: string;
  name: string;
  topics: SyllabusTopic[];
}

export interface Syllabus {
  id: string;
  name: string;
  curriculum: string;
  subject?: string;
  level?: string;
  examBoard?: string;
  units: SyllabusUnit[];
}

export interface TopicMastery {
  topicId: string;
  /** Most recent rating. */
  rating: number;
  /** Change since the previous rating (0 if only one). */
  trend: number;
  count: number;
  lastRatedAt: string;
}

/** Latest rating per topic, with direction of travel. */
export function masteryByTopic(ratings: TopicRating[]): Map<string, TopicMastery> {
  const grouped = new Map<string, TopicRating[]>();
  for (const r of ratings) {
    const list = grouped.get(r.topicId) ?? [];
    list.push(r);
    grouped.set(r.topicId, list);
  }
  const out = new Map<string, TopicMastery>();
  for (const [topicId, list] of grouped) {
    list.sort((a, b) => a.ratedAt.localeCompare(b.ratedAt));
    const last = list[list.length - 1];
    const prev = list.length > 1 ? list[list.length - 2] : undefined;
    out.set(topicId, {
      topicId,
      rating: last.rating,
      trend: prev ? last.rating - prev.rating : 0,
      count: list.length,
      lastRatedAt: last.ratedAt,
    });
  }
  return out;
}

export interface UnitSummary {
  unit: SyllabusUnit;
  covered: number;
  total: number;
  /** Average of latest ratings for covered topics (0 if none). */
  average: number;
}

export interface SyllabusSummary {
  units: UnitSummary[];
  covered: number;
  total: number;
  /** 0–100, average mastery across covered topics. */
  masteryPercent: number;
  /** 0–100, share of the syllabus rated at least once. */
  coveragePercent: number;
}

export function summariseSyllabus(syllabus: Syllabus, mastery: Map<string, TopicMastery>): SyllabusSummary {
  let covered = 0;
  let total = 0;
  let ratingSum = 0;
  const units = syllabus.units.map((unit) => {
    const ratings = unit.topics.map((t) => mastery.get(t.id)?.rating).filter((r): r is number => r !== undefined);
    covered += ratings.length;
    total += unit.topics.length;
    ratingSum += ratings.reduce((a, b) => a + b, 0);
    return {
      unit,
      covered: ratings.length,
      total: unit.topics.length,
      average: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0,
    };
  });
  return {
    units,
    covered,
    total,
    masteryPercent: covered ? Math.round(((ratingSum / covered - 1) / 4) * 100) : 0,
    coveragePercent: total ? Math.round((covered / total) * 100) : 0,
  };
}

/** Topics most in need of work: lowest latest rating first, then falling trend. */
export function focusTopics(mastery: Map<string, TopicMastery>, limit = 3): TopicMastery[] {
  return [...mastery.values()]
    .filter((m) => m.rating <= 3)
    .sort((a, b) => a.rating - b.rating || a.trend - b.trend)
    .slice(0, limit);
}

export const RATING_LABELS: Record<number, string> = {
  1: 'Needs work',
  2: 'Emerging',
  3: 'Developing',
  4: 'Confident',
  5: 'Secure',
};
