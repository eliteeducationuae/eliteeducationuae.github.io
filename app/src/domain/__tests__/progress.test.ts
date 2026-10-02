import { lessonsToICS } from '../ics';
import { focusTopics, masteryByTopic, summariseSyllabus, type Syllabus } from '../progress';
import type { Lesson, TopicRating } from '../types';

const rating = (topicId: string, value: TopicRating['rating'], ratedAt: string): TopicRating => ({
  id: `${topicId}-${ratedAt}`,
  studentId: 's1',
  topicId,
  rating: value,
  ratedAt,
});

const syllabus: Syllabus = {
  id: 'x',
  name: 'Test',
  curriculum: 'IB',
  units: [
    { id: 'u1', name: 'Algebra', topics: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] },
    { id: 'u2', name: 'Calculus', topics: [{ id: 'c', name: 'C' }, { id: 'd', name: 'D' }] },
  ],
};

describe('progress', () => {
  const ratings = [
    rating('a', 2, '2026-09-01'),
    rating('a', 4, '2026-09-20'),
    rating('b', 3, '2026-09-10'),
    rating('c', 1, '2026-09-15'),
  ];

  it('uses the latest rating per topic with a trend', () => {
    const m = masteryByTopic(ratings);
    expect(m.get('a')).toMatchObject({ rating: 4, trend: 2, count: 2 });
    expect(m.get('b')).toMatchObject({ rating: 3, trend: 0 });
  });

  it('summarises coverage and mastery by unit', () => {
    const s = summariseSyllabus(syllabus, masteryByTopic(ratings));
    expect(s.covered).toBe(3);
    expect(s.coveragePercent).toBe(75);
    expect(s.units[0]).toMatchObject({ covered: 2, average: 3.5 });
    expect(s.units[1]).toMatchObject({ covered: 1, average: 1 });
    // average rating (4+3+1)/3 = 2.67 → (2.67-1)/4 = 42%
    expect(s.masteryPercent).toBe(42);
  });

  it('picks weakest topics to focus on', () => {
    expect(focusTopics(masteryByTopic(ratings)).map((t) => t.topicId)).toEqual(['c', 'b']);
  });
});

describe('lessonsToICS', () => {
  it('emits events for active lessons only', () => {
    const base: Lesson = {
      id: 'l1',
      tutorId: 't',
      studentIds: ['s'],
      serviceId: 'svc',
      start: '2026-10-05T12:00:00.000Z',
      end: '2026-10-05T13:00:00.000Z',
      location: 'online',
      meetingUrl: 'https://meet.example/abc',
      status: 'scheduled',
    };
    const ics = lessonsToICS([base, { ...base, id: 'l2', status: 'cancelled' }], () => ({ title: 'Maths, Omar' }));
    expect(ics).toContain('DTSTART:20261005T120000Z');
    expect(ics).toContain('SUMMARY:Maths\\, Omar');
    expect(ics).toContain('LOCATION:https://meet.example/abc');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });
});
