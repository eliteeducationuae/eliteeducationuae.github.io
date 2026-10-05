// AI writing help, powered by Claude. Four tasks:
//   report-draft  – strengths / next steps / comment for an end-of-term report, from facts the app computed
//   parent-update – a short, warm message to a family from a lesson's notes
//   insights      – a plain-English summary of the business numbers for the admin
//   admissions-update – a monthly or ad hoc admissions advisory update for a family, from the case's records
// Every read goes through the caller's own client, so row-level security limits what the model can see.
// Secrets: ANTHROPIC_API_KEY.
import Anthropic from 'npm:@anthropic-ai/sdk';

import { admissionsFacts, admissionsLetterInstructions } from '../_shared/admissions-letter.ts';
import { corsHeaders, json, userClient } from '../_shared/supabase.ts';
import { refuseViewAs } from '../_shared/view-as.ts';

const MODEL = 'claude-opus-5-5';

const STYLE = `You write for Elite Education, a premium tutoring company in the UAE teaching every subject, phase and curriculum.
Write in British English, in a formal, refined and empathetic tone; parents read these. Use full sentences and no slang. Use only the facts given and never
invent marks, grades, topics or events. Refer to the student by first name. No headings, bullet symbols or markdown.`;

type Schema = { type: 'object'; properties: Record<string, { type: 'string'; description: string }>; required: string[]; additionalProperties: false };

const schema = (fields: Record<string, string>): Schema => ({
  type: 'object',
  properties: Object.fromEntries(Object.entries(fields).map(([k, description]) => [k, { type: 'string', description }])),
  required: Object.keys(fields),
  additionalProperties: false,
});

const REPORT_SCHEMA = schema({
  strengths: '2–4 sentences on what the student does well, naming topics from the facts.',
  nextSteps: '2–4 sentences of concrete, actionable next steps, naming topics from the facts.',
  comment: 'An overall comment of 60–120 words covering attendance, homework, progress and encouragement.',
});
const UPDATE_SCHEMA = schema({ message: 'A message of 50–90 words to the family, ready to send. Sign off as the tutor.' });
const INSIGHTS_SCHEMA = schema({ summary: '4–6 short sentences: how the month is going, what changed, and 1–2 things worth acting on.' });
const ADMISSIONS_SCHEMA = schema({
  title: 'A short title, e.g. "October advisory update"',
  body: '180–320 words in 3–5 paragraphs separated by blank lines, no headings or bullets.',
});

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

async function ask(system: string, prompt: string, format: Schema): Promise<Record<string, string>> {
  const client = new Anthropic();
  // Server-side fallbacks: if the model declines, the API retries on a recommended fallback model in the same call.
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages: [{ role: 'user', content: prompt }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: format } },
  } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming);
  if (response.stop_reason === 'refusal') throw new Error('The AI declined this request');
  if (response.stop_reason === 'max_tokens') throw new Error('The AI response was cut short');
  const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  return JSON.parse(text);
}

async function role(supabase: ReturnType<typeof userClient>) {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase.from('profiles').select('role, full_name').eq('id', auth.user.id).single();
  return data as { role: string; full_name: string } | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!Deno.env.get('ANTHROPIC_API_KEY')) return json({ error: 'AI is not set up' }, 503);
  try {
    const body = await req.json();
    const supabase = userClient(req);
    const me = await role(supabase);
    if (!me || (me.role !== 'admin' && me.role !== 'tutor')) return json({ error: 'Not allowed' }, 403);
    // A View as session (read only) cannot use the AI.
    const refused = await refuseViewAs(req);
    if (refused) return refused;

    if (body.task === 'report-draft') {
      // Only proceed if the caller can see this report (their own, or any for admins).
      const { data: report } = await supabase.from('student_reports').select('id, status').eq('id', body.reportId).single();
      if (!report) return json({ error: 'Report not found' }, 404);
      const facts = (body.facts ?? {}) as { subject?: unknown; curriculum?: unknown };
      const subject = typeof facts.subject === 'string' && facts.subject.trim() ? facts.subject.trim().slice(0, 80) : null;
      const curriculum = typeof facts.curriculum === 'string' && facts.curriculum.trim() ? facts.curriculum.trim().slice(0, 80) : null;
      const course = [curriculum, subject].filter(Boolean).join(' ');
      const out = await ask(
        `${STYLE}\nYou are helping a tutor draft an end-of-term progress report${course ? ` for ${course}` : ''}. ` +
          `Write about ${subject ?? 'the subject in the facts'} only, using the language and skills of that subject. The tutor will edit it before it is sent.`,
        `Facts about the student this term${course ? ` in ${course}` : ''} (JSON):\n${JSON.stringify(body.facts).slice(0, 8000)}\n\nDraft the report.`,
        REPORT_SCHEMA,
      );
      return json({ task: 'report-draft', strengths: out.strengths, nextSteps: out.nextSteps, comment: out.comment });
    }

    if (body.task === 'parent-update') {
      const { data: lesson } = await supabase
        .from('lessons')
        .select('id, start_at, subject, student_ids, lesson_notes(summary), tutors(full_name)')
        .eq('id', body.lessonId)
        .single();
      const notes = (lesson as { lesson_notes?: { summary: string } | null } | null)?.lesson_notes?.summary;
      if (!lesson || !notes) return json({ error: 'No lesson notes to work from' }, 404);
      const { data: students } = await supabase.from('students').select('full_name').in('id', lesson.student_ids);
      const tutor = (lesson as { tutors?: { full_name: string } | null }).tutors?.full_name ?? me.full_name;
      const out = await ask(
        `${STYLE}\nYou turn a tutor's lesson notes into a short update for the student's family.`,
        `Student(s): ${(students ?? []).map((s) => s.full_name).join(', ')}\nTutor: ${tutor}\nSubject: ${(lesson as { subject?: string | null }).subject ?? 'not recorded'}\nLesson date: ${lesson.start_at.slice(0, 10)}\nNotes:\n${notes.slice(0, 4000)}`,
        UPDATE_SCHEMA,
      );
      return json({ task: 'parent-update', message: out.message });
    }

    if (body.task === 'insights') {
      if (me.role !== 'admin') return json({ error: 'Not allowed' }, 403);
      const out = await ask(
        `${STYLE}\nYou are a concise business analyst for the owner. Amounts are in AED. Speak to the owner directly.`,
        `Business figures (JSON):\n${JSON.stringify(body.figures).slice(0, 12000)}`,
        INSIGHTS_SCHEMA,
      );
      return json({ task: 'insights', summary: out.summary });
    }

    if (body.task === 'admissions-update') {
      // Read through the caller's client: row-level security limits this to admins and the case's own adviser.
      const caseId = typeof body.caseId === 'string' ? body.caseId : '';
      const { data: found } = await supabase
        .from('admissions_cases')
        .select('id, title, kind, entry_year, status, summary, adviser_tutor_id, students(full_name), tutors(full_name), families(parent_name)')
        .eq('id', caseId)
        .maybeSingle();
      const c = found as unknown as
        | {
            id: string;
            title: string;
            kind: string;
            entry_year: string | null;
            status: string;
            summary: string | null;
            adviser_tutor_id: string | null;
            students: { full_name: string } | null;
            tutors: { full_name: string } | null;
            families: { parent_name: string } | null;
          }
        | null;
      if (!c) return json({ error: 'Case not found' }, 404);

      const now = Date.now();
      const day = 86_400_000;
      const [targets, dates, tasks, events] = await Promise.all([
        supabase.from('admissions_targets').select('institution, country, programme, status, decision_date').eq('case_id', c.id).order('sort'),
        supabase
          .from('admissions_dates')
          .select('kind, title, due_on, time_of_day, done, admissions_targets(institution)')
          .eq('case_id', c.id)
          .gte('due_on', isoDay(new Date(now - 31 * day)))
          .lte('due_on', isoDay(new Date(now + 90 * day)))
          .order('due_on'),
        supabase
          .from('admissions_tasks')
          .select('title, due_on, owner, done_at')
          .eq('case_id', c.id)
          .or(`done_at.is.null,done_at.gte.${new Date(now - 31 * day).toISOString()}`),
        supabase
          .from('admissions_events')
          .select('at, kind, title, detail, family_visible')
          .eq('case_id', c.id)
          // The letter goes to the family: adviser-only entries (confidential references and documents) stay out.
          .eq('family_visible', true)
          .gte('at', new Date(now - 45 * day).toISOString())
          .order('at'),
      ]);
      const firstName = (c.students?.full_name ?? '').split(' ')[0] || 'the student';
      const kind = body.kind === 'ad-hoc' ? 'ad-hoc' : 'monthly';
      const period = typeof body.period === 'string' ? body.period.trim().slice(0, 60) : '';
      const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) : '';
      // Who signs: the case's adviser, or the admissions team when the office leads the case. The app sends the names it
      // shows as a fallback for when row-level security hides the adviser's or the family's record from this caller.
      const text = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 120) : '');
      const adviser = c.adviser_tutor_id ? c.tutors?.full_name?.trim() || text(body.adviser) || null : null;
      const parentName = c.families?.parent_name?.trim() || text(body.addressee) || null;
      const facts = admissionsFacts({
        today: isoDay(new Date(now)),
        studentFirstName: firstName,
        caseInfo: { title: c.title, kind: c.kind, entryYear: c.entry_year, status: c.status, summary: c.summary },
        targets: targets.data ?? [],
        keyDates: dates.data ?? [],
        tasks: tasks.data ?? [],
        events: events.data ?? [],
      });
      const out = await ask(
        `${STYLE}\n${admissionsLetterInstructions({ kind, studentFirstName: firstName, parentName, adviser })}`,
        `${period ? `Period: ${period}\n` : ''}Facts about the admissions case (JSON):\n${JSON.stringify(facts).slice(0, 12000)}` +
          `${notes ? `\n\nThe adviser's notes for this update:\n${notes}` : ''}\n\nDraft the update.`,
        ADMISSIONS_SCHEMA,
      );
      return json({ task: 'admissions-update', title: out.title, body: out.body });
    }

    return json({ error: 'Unknown task' }, 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
