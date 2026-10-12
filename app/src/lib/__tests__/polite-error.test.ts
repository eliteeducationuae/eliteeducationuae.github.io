import { GENERIC_ERROR, politeError, publicErrorMessage } from '../polite-error';

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

describe('raw server errors are never shown', () => {
  const cases: [string, RegExp][] = [
    ['duplicate key value violates unique constraint "profiles_email_key"', /already been saved/],
    ['new row violates row-level security policy for table "lessons"', /permission/],
    ['permission denied for table invoices', /permission/],
    ['insert or update on table "lessons" violates foreign key constraint "lessons_tutor_id_fkey"', /no longer matches/],
    ['null value in column "family_id" of relation "students" violates not-null constraint', /no longer matches/],
    ['invalid input syntax for type uuid: "abc"', /Something went wrong/],
    ['column lessons.foo does not exist', /Something went wrong/],
    ['Could not find the function public.book_lesson(p_x) in the schema cache', /Something went wrong/],
    ['JSON object requested, multiple (or no) rows returned', /Something went wrong/],
    ['Edge Function returned a non-2xx status code', /Something went wrong/],
    ['Database error saving new user', /Something went wrong/],
    ['JWT expired', /session has ended/],
    ['TypeError: Failed to fetch', /could not reach/],
    ['Network request failed', /could not reach/],
    ["No such customer: 'cus_123'", /Something went wrong/],
    ['Invalid API Key provided: sk_live_****1234', /Something went wrong/],
    ['Unexpected end of JSON input', /Something went wrong/],
  ];
  it.each(cases)('%s', (raw, shown) => {
    const text = politeError(raw);
    expect(text).toMatch(shown);
    expect(text).not.toMatch(/constraint|relation|column|uuid|schema|row-level|JWT|PGRST|lessons|profiles/i);
  });
  it('keeps the app’s own messages and Supabase sign-in messages', () => {
    for (const msg of ['Invalid login credentials', 'Only an administrator can do this', 'Please enter a valid email address', 'Email not confirmed']) {
      expect(publicErrorMessage(msg)).toBe(msg);
    }
    expect(publicErrorMessage('')).toBe(GENERIC_ERROR);
  });
});
