// Lessons: the admin books a lesson for the test family with the test tutor, the tutor records notes and
// homework, and the parent sees both. Usage: node lessons.js   (DEMO=1 for the demo build)
const { run } = require('./lib');
const { bookLesson } = require('./booking');

run('lessons', { need: ['admin', 'tutor', 'parent'] }, async (h) => {
  const { page } = h;

  h.step('admin books a one-off lesson');
  await h.signIn('admin');
  const lesson = await bookLesson(h, { label: 'lesson notes test', days: 14, location: 'in-person' });
  h.ok(!!lesson.lessonId, `lesson ${lesson.lessonId} booked on ${lesson.date} at ${lesson.time} with subject "${lesson.subject}"`);
  h.ok(await h.has(`Subject: ${lesson.subject}`), 'the lesson page shows the tagged subject');
  h.ok(await h.has(h.config.tutor, true), `the lesson is with ${h.config.tutor}`);
  h.ok(await h.has(h.config.student, true), `the lesson is for ${h.config.student}`);
  await h.signOut('admin');

  h.step('tutor records notes and homework');
  const summary = `${h.tag('notes')}: automated test lesson. We practised two exam-style questions.`;
  const homework = `${h.tag('homework')}: past paper questions 1 to 3`;
  await h.signIn('tutor');
  await h.go(`/lesson/${encodeURIComponent(lesson.lessonId)}`);
  h.ok(await h.tryWaitText(`Subject: ${lesson.subject}`), 'the tutor can open the lesson');
  await h.press(/^Record the lesson/);
  await h.box('What we covered').waitFor({ timeout: 20000 });
  await h.fill('What we covered', summary);
  await h.fill('Homework', homework);
  await h.shot('tutor-record');
  await h.press('Save and send to the family', { wait: 2500 });
  if (/\/complete\//.test(page.url())) await h.go(`/lesson/${encodeURIComponent(lesson.lessonId)}`);
  h.ok(await h.tryWaitText(summary), 'the lesson page shows the tutor’s notes');
  h.ok(await h.tryWaitText(/^Completed$/i, { timeout: 8000 }), 'the lesson shows as Completed');
  h.record('lesson-recorded', { lessonId: lesson.lessonId, summary, homework });
  await h.signOut('tutor');

  h.step('parent sees the notes and the homework');
  await h.signIn('parent');
  await h.go(`/lesson/${encodeURIComponent(lesson.lessonId)}`);
  h.ok(await h.tryWaitText(summary), 'the parent sees the notes on the lesson');
  // Families with more than one child choose the child by first name at the top of Progress.
  const pickChild = async () => {
    const first = h.config.student.split(' ')[0];
    if (await h.has(first, true)) await h.click(first, true, 1200);
  };
  await h.go('/parent/progress?tab=notes');
  await pickChild();
  h.ok(await h.tryWaitText(summary), 'the notes are on the parent’s Progress screen');
  await h.go('/parent/progress?tab=homework');
  await pickChild();
  h.ok(await h.tryWaitText(homework), 'the homework is on the parent’s Progress screen');
  await h.shot('parent-homework');
  await h.signOut('parent');
});
