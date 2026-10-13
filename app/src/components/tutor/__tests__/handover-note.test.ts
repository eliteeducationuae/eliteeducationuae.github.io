import { joinHandoverNote, splitHandoverNote } from '@/components/tutor/handover-note';

describe('handover note prompts', () => {
  it('joins the three prompts into one note and splits it back', () => {
    const note = joinHandoverNote(['Explains it back first.', 'Equilibrium improving.', 'Two questions a lesson.'], 'Yousef');
    expect(note).toBe('How Yousef learns best:\nExplains it back first.\n\nWhere Yousef is now:\nEquilibrium improving.\n\nWhat should come next:\nTwo questions a lesson.');
    expect(splitHandoverNote(note, 'Yousef')).toEqual(['Explains it back first.', 'Equilibrium improving.', 'Two questions a lesson.']);
  });
  it('leaves out an empty prompt and keeps an older free-text note in the first box', () => {
    const note = joinHandoverNote(['A', 'B', ''], 'Layla');
    expect(note).not.toContain('What should come next');
    expect(splitHandoverNote(note, 'Layla')).toEqual(['A', 'B', '']);
    expect(splitHandoverNote('Uses retrieval quizzes.', 'Layla')).toEqual(['Uses retrieval quizzes.', '', '']);
  });
});
