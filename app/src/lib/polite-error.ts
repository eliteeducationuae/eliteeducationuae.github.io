/**
 * Server errors shown to people. Short database errors such as 'Lesson not found' become a full sentence in the
 * brand's tone; technical errors from the database, the API or the network are replaced with a calm message (see
 * publicErrorMessage); everything else, such as the app's own messages from its database functions, is shown as written.
 */
export function politeError(message: string): string {
  const text = publicErrorMessage(message);
  const notFound = /^([A-Za-z][A-Za-z -]{0,40}) not found\.?$/.exec(text);
  if (notFound) {
    return `This ${notFound[1].toLowerCase()} could not be found. Please refresh and try again.`;
  }
  return text;
}

export const GENERIC_ERROR = 'Something went wrong on our side. Please try again, and contact Elite Education if it keeps happening.';
export const CONNECTION_ERROR = 'We could not reach Elite Education. Please check your connection and try again.';
export const PERMISSION_ERROR = 'You do not have permission to do that. If you think you should, please contact Elite Education.';
export const SESSION_ERROR = 'Your session has ended. Please sign out and sign in again.';
export const DUPLICATE_ERROR = 'This has already been saved. Please refresh to see the latest details.';
export const CONFLICT_ERROR = 'This could not be saved because it no longer matches the latest details. Please refresh and try again.';

/** [pattern, message] pairs, checked in order. Raw texts come from PostgreSQL, PostgREST, Supabase Auth and fetch. */
const TECHNICAL: [RegExp, string][] = [
  [/failed to fetch|networkerror|network request failed|fetch failed|load failed|err_network|err_internet|AuthRetryableFetchError|timed? ?out|aborted/i, CONNECTION_ERROR],
  [/\bjwt\b|invalid claim|refresh token|session (?:missing|not found|expired)|auth session missing/i, SESSION_ERROR],
  [/row-level security|permission denied for|insufficient_privilege|must be owner of/i, PERMISSION_ERROR],
  [/duplicate key value|violates unique constraint|already exists \(sqlstate/i, DUPLICATE_ERROR],
  [/violates (?:foreign key|check|not-null|exclusion) constraint|null value in column|update or delete on table/i, CONFLICT_ERROR],
  [
    /invalid input (?:syntax|value)|syntax error|(?:relation|column|function|type|schema|table) .* does not exist|schema cache|\bPGRST\d|sqlstate|could not (?:find|choose) the (?:best candidate )?function|JSON object requested|multiple \(or no\) rows|non-2xx status code|edge function|database error|internal server error|unexpected token|is not valid JSON|cannot read propert|undefined is not|stack depth|deadlock|canceling statement|out of range for type|value too long for type|operator does not exist|\bat [\w.$<>]+ \(|\bTypeError\b|\bReferenceError\b|\bSyntaxError\b|unexpected end of json|\bno such [a-z_]+: |invalid api key|provide an api key|\b(?:sk|rk|pk)_(?:live|test)_/i,
    GENERIC_ERROR,
  ],
];

/**
 * The text to show for an error from the server. The app's own messages (raised in its database functions and edge
 * functions as full sentences) are kept; raw technical errors, which can reveal table, column and constraint names,
 * are replaced with one of the calm messages above. The original is kept on the error's `cause` for the error log.
 */
export function publicErrorMessage(raw: string | null | undefined): string {
  const text = (raw ?? '').trim();
  if (!text) return GENERIC_ERROR;
  for (const [pattern, message] of TECHNICAL) if (pattern.test(text)) return message;
  // Very long texts are traces or dumps, not messages written for people.
  if (text.length > 400) return GENERIC_ERROR;
  return text;
}
