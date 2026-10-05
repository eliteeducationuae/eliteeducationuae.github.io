// AI writing help, powered by Claude. Three tasks:
//   report-draft  – strengths / next steps / comment for an end-of-term report, from facts the app computed
//   parent-update – a short, warm message to a family from a lesson's notes
//   insights      – a plain-English summary of the business numbers for the admin
// Every read goes through the caller's own client, so row-level security limits what the model can see.
// Secrets: ANTHROPIC_API_KEY.
import Anthropic from 'npm:@anthropic-ai/sdk';

import { adminClient, corsHeaders, json, userClient } from '../_shared/supabase.ts';
import { withMonitoring } from '../_shared/monitoring.ts';

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

Deno.serve(withMonitoring('ai-assist', adminClient, async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!Deno.env.get('ANTHROPIC_API_KEY')) return json({ error: 'AI is not set up' }, 503);
  try {
    const body = await req.json();
    const supabase = userClient(req);
    const me = await role(supabase);
    if (!me || (me.role !== 'admin' && me.role !== 'tutor')) return json({ error: 'Not allowed' }, 403);

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

    return json({ error: 'Unknown task' }, 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}));
