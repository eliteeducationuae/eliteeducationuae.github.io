import { politeError } from '../polite-error';

describe('politeError', () => {
  it('turns short not-found errors into full sentences', () => {
    expect(politeError('Lesson not found')).toBe('This lesson could not be found. Please refresh and try again.');
    expect(politeError('Hand-in not found')).toBe('This hand-in could not be found. Please refresh and try again.');
    expect(politeError('Family not found.')).toBe('This family could not be found. Please refresh and try again.');
  });
  it('leaves other messages as they are', () => {
    expect(politeError('You can only set homework for your own students.')).toBe('You can only set homework for your own students.');
    expect(politeError('Please give the homework a title.')).toBe('Please give the homework a title.');
  });
});
