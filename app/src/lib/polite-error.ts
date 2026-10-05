/**
 * Server errors shown to people. Short database errors such as 'Lesson not found' become a full sentence in the
 * brand's tone; everything else is shown as written.
 */
export function politeError(message: string): string {
  const text = message.trim();
  const notFound = /^([A-Za-z][A-Za-z -]{0,40}) not found\.?$/.exec(text);
  if (notFound) {
    return `This ${notFound[1].toLowerCase()} could not be found. Please refresh and try again.`;
  }
  return text;
}
