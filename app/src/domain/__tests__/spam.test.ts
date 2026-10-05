import { enquiryConversion } from '../insights';
import {
  applicationPayloadProblem,
  countLinks,
  enquiryPayloadProblem,
  findDuplicateApplication,
  findDuplicateEnquiry,
  isPossibleSpam,
  isRateLimitError,
  mergeMessage,
  messageSimilarity,
  normaliseMessage,
  PAYLOAD_MESSAGES,
  RATE_LIMIT_CODE,
  RATE_LIMIT_MESSAGE,
  RateLimitError,
  rateLimited,
  SPAM_LIMITS,
  spamLabel,
  spamReasonPhrase,
  spamReasons,
  spamSummary,
  withoutSpam,
} from '../spam';
import type { Enquiry, TutorApplication } from '../types';

const NOW = new Date('2026-10-04T12:00:00Z');
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

const enquiry = (over: Partial<Enquiry> = {}): Enquiry => ({
  id: 'e1',
  createdAt: ago(30),
  status: 'new',
  source: 'website',
  parentName: 'Layla Haddad',
  email: 'layla@example.com',
  message: 'We would like help with IB Maths for our daughter',
  ...over,
});

const application = (over: Partial<TutorApplication> = {}): TutorApplication => ({
  id: 'a1',
  createdAt: ago(30),
  fullName: 'Sam Tutor',
  email: 'sam@example.com',
  curricula: ['IB'],
  status: 'applied',
  ...over,
});

describe('countLinks', () => {
  it('counts http, https and www links regardless of case', () => {
    expect(countLinks('see http://a.com and HTTPS://b.com or WWW.c.com and www.d.com')).toBe(4);
    expect(countLinks('no links here, just a full stop. www')).toBe(0);
    expect(countLinks(undefined)).toBe(0);
  });
});

describe('normaliseMessage', () => {
  it('lower-cases, replaces punctuation with spaces and collapses whitespace', () => {
    expect(normaliseMessage('  Hello,   World!!  How-are_you?  ')).toBe('hello world how are you');
    expect(normaliseMessage('a/b\\c[d]e{f}g~h`i')).toBe('a b c d e f g h i');
  });
  it('keeps Arabic and other non-ASCII text', () => {
    expect(normaliseMessage('مرحبا، كيف حالك؟ Thanks!')).toBe('مرحبا، كيف حالك؟ thanks');
  });
});

describe('messageSimilarity', () => {
  it('treats an empty message as matching', () => {
    expect(messageSimilarity('', '')).toBe(1);
    expect(messageSimilarity('Hello there', '  ')).toBe(1);
    expect(messageSimilarity(undefined, 'Hello')).toBe(1);
  });
  it('scores identical and reordered messages as 1', () => {
    expect(messageSimilarity('IB Maths help please', 'IB Maths help please')).toBe(1);
    expect(messageSimilarity('help please, IB Maths!', 'IB maths help please')).toBe(1);
  });
  it('scores unrelated messages low and partial overlaps in between', () => {
    expect(messageSimilarity('IB Maths help', 'cheap watches online')).toBe(0);
    expect(messageSimilarity('a b c d', 'a b c e')).toBeCloseTo(3 / 5);
  });
});

describe('spamReasons', () => {
  it('returns reasons in a fixed order', () => {
    expect(
      spamReasons({ names: ['Visit www.x.com'], text: ['http://a http://b', 'www.c'], elapsedMs: 800, captchaMissing: true }),
    ).toEqual(['link-in-name', 'links', 'too-fast', 'captcha']);
  });
  it('flags three links in total, not two', () => {
    expect(spamReasons({ names: ['Layla'], text: ['http://a', 'www.b'] })).toEqual([]);
    expect(spamReasons({ names: ['Layla'], text: ['http://a', 'www.b www.c'] })).toEqual(['links']);
  });
  it('never flags a missing elapsed time, and allows exactly the minimum', () => {
    expect(spamReasons({ names: ['Layla'], text: [], elapsedMs: undefined })).toEqual([]);
    expect(spamReasons({ names: ['Layla'], text: [], elapsedMs: null })).toEqual([]);
    expect(spamReasons({ names: ['Layla'], text: [], elapsedMs: 3000 })).toEqual([]);
    expect(spamReasons({ names: ['Layla'], text: [], elapsedMs: 2999 })).toEqual(['too-fast']);
  });
});

describe('spam helpers', () => {
  it('recognises possible spam and leaves it out', () => {
    expect(isPossibleSpam({})).toBe(false);
    expect(isPossibleSpam({ spamStatus: 'clean' })).toBe(false);
    expect(isPossibleSpam({ spamStatus: 'suspected' })).toBe(true);
    expect(isPossibleSpam({ spamStatus: 'spam' })).toBe(true);
    expect(withoutSpam([{ id: 1 }, { id: 2, spamStatus: 'spam' as const }, { id: 3, spamStatus: 'clean' as const }]).map((x) => x.id)).toEqual([1, 3]);
  });
  it('summarises reasons in words', () => {
    expect(spamSummary(['too-fast', 'links'])).toBe('Sent very quickly · Several links');
    expect(spamSummary(undefined)).toBe('');
  });
  it('uses the agreed rate-limit wording and code', () => {
    expect(RATE_LIMIT_MESSAGE).toBe(
      'Thank you. We have received several messages from you in a short time, so we have paused further submissions for now. We will be in touch shortly; if your enquiry is urgent, please email craig@craigobrieneducation.com.',
    );
    const err = new RateLimitError();
    expect(err.message).toBe(RATE_LIMIT_MESSAGE);
    expect(err.code).toBe(RATE_LIMIT_CODE);
    expect(RATE_LIMIT_CODE).toBe('PT429');
  });
});

describe('rateLimited', () => {
  const email = 'layla@example.com';
  it('allows three enquiries an hour from one email address and stops the fourth', () => {
    const history = [ago(10), ago(20), ago(59)].map((at) => ({ at, email }));
    expect(rateLimited(history.slice(0, 2), { email }, SPAM_LIMITS.enquiry, NOW)).toBe(false);
    expect(rateLimited(history, { email: 'LAYLA@example.com' }, SPAM_LIMITS.enquiry, NOW)).toBe(true);
    expect(rateLimited(history, { email: 'someone@example.com' }, SPAM_LIMITS.enquiry, NOW)).toBe(false);
  });
  it('forgets submissions more than an hour old for the hourly limit', () => {
    const history = [ago(10), ago(20), ago(61)].map((at) => ({ at, email }));
    expect(rateLimited(history, { email }, SPAM_LIMITS.enquiry, NOW)).toBe(false);
  });
  it('applies the daily limit over 24 hours', () => {
    const day = [ago(90), ago(200), ago(300), ago(400), ago(500), ago(23 * 60)].map((at) => ({ at, email }));
    expect(rateLimited(day, { email }, SPAM_LIMITS.enquiry, NOW)).toBe(true);
    const older = [...day.slice(0, 5), { at: ago(25 * 60), email }];
    expect(rateLimited(older, { email }, SPAM_LIMITS.enquiry, NOW)).toBe(false);
  });
  it('limits by network address too', () => {
    const history = [1, 2, 3, 4, 5].map((m) => ({ at: ago(m), ipHash: 'abc', email: `p${m}@example.com` }));
    expect(rateLimited(history, { ipHash: 'abc', email: 'new@example.com' }, SPAM_LIMITS.enquiry, NOW)).toBe(true);
    expect(rateLimited(history.slice(0, 4), { ipHash: 'abc' }, SPAM_LIMITS.enquiry, NOW)).toBe(false);
    expect(rateLimited(history.slice(0, 3), { ipHash: 'abc' }, SPAM_LIMITS.application, NOW)).toBe(true);
  });
});

describe('findDuplicateEnquiry', () => {
  const candidate = { email: 'Layla@Example.com', message: 'We would like help with IB Maths for our daughter please' };
  it('finds a similar enquiry from the same email within 24 hours', () => {
    expect(findDuplicateEnquiry([enquiry()], candidate, NOW)?.id).toBe('e1');
  });
  it('ignores enrolled, lost and spam enquiries, and those outside 24 hours', () => {
    expect(findDuplicateEnquiry([enquiry({ status: 'enrolled' })], candidate, NOW)).toBeUndefined();
    expect(findDuplicateEnquiry([enquiry({ status: 'lost' })], candidate, NOW)).toBeUndefined();
    expect(findDuplicateEnquiry([enquiry({ spamStatus: 'spam' })], candidate, NOW)).toBeUndefined();
    expect(findDuplicateEnquiry([enquiry({ createdAt: ago(25 * 60) })], candidate, NOW)).toBeUndefined();
    expect(findDuplicateEnquiry([enquiry({ spamStatus: 'suspected' })], candidate, NOW)?.id).toBe('e1');
  });
  it('keeps enquiries about different children, or different messages, apart', () => {
    expect(findDuplicateEnquiry([enquiry({ studentName: 'Omar' })], { ...candidate, studentName: 'Sara' }, NOW)).toBeUndefined();
    expect(findDuplicateEnquiry([enquiry({ studentName: 'Omar' })], { ...candidate, studentName: ' omar ' }, NOW)?.id).toBe('e1');
    expect(findDuplicateEnquiry([enquiry({ studentName: 'Omar' })], candidate, NOW)?.id).toBe('e1');
    expect(findDuplicateEnquiry([enquiry()], { ...candidate, message: 'Could Sarah move Thursday to Friday next week' }, NOW)).toBeUndefined();
    expect(findDuplicateEnquiry([enquiry()], { message: candidate.message }, NOW)).toBeUndefined();
  });
});

describe('findDuplicateApplication', () => {
  it('merges only into a new application from the same email within 24 hours', () => {
    expect(findDuplicateApplication([application()], { email: 'SAM@example.com' }, NOW)?.id).toBe('a1');
    expect(findDuplicateApplication([application({ status: 'interview' })], { email: 'sam@example.com' }, NOW)).toBeUndefined();
    expect(findDuplicateApplication([application({ spamStatus: 'spam' })], { email: 'sam@example.com' }, NOW)).toBeUndefined();
    expect(findDuplicateApplication([application({ createdAt: ago(24 * 60 + 1) })], { email: 'sam@example.com' }, NOW)).toBeUndefined();
  });
});

describe('payload limits', () => {
  const long = (n: number) => 'x'.repeat(n);
  it('checks enquiries', () => {
    expect(enquiryPayloadProblem({ parentName: 'Layla', message: long(4000) })).toBeNull();
    expect(enquiryPayloadProblem({ parentName: long(201) })).toBe(PAYLOAD_MESSAGES.name);
    expect(enquiryPayloadProblem({ parentName: 'Layla', studentName: long(201) })).toBe('Please shorten the name to 200 characters or fewer');
    expect(enquiryPayloadProblem({ parentName: 'Layla', phone: long(51) })).toBe('Please check the email address or telephone number');
    expect(enquiryPayloadProblem({ parentName: 'Layla', email: long(201) })).toBe(PAYLOAD_MESSAGES.contact);
    expect(enquiryPayloadProblem({ parentName: 'Layla', message: long(4001) })).toBe('Please shorten your message to 4,000 characters or fewer');
    expect(enquiryPayloadProblem({ parentName: 'Layla', preferredTimes: long(1001) })).toBe('Please shorten your answers a little');
    expect(enquiryPayloadProblem({ parentName: 'Layla', yearGroup: long(101) })).toBe(PAYLOAD_MESSAGES.other);
  });
  it('checks applications', () => {
    const ok = { fullName: 'Sam', email: 'sam@example.com', curricula: ['IB'] };
    expect(applicationPayloadProblem(ok)).toBeNull();
    expect(applicationPayloadProblem({ ...ok, fullName: long(201) })).toBe(PAYLOAD_MESSAGES.name);
    expect(applicationPayloadProblem({ ...ok, experience: long(4001) })).toBe(PAYLOAD_MESSAGES.message);
    expect(applicationPayloadProblem({ ...ok, qualifications: long(2001) })).toBe(PAYLOAD_MESSAGES.other);
    expect(applicationPayloadProblem({ ...ok, subjects: long(501) })).toBe(PAYLOAD_MESSAGES.other);
    expect(applicationPayloadProblem({ ...ok, availability: long(1001) })).toBe(PAYLOAD_MESSAGES.other);
    expect(applicationPayloadProblem({ ...ok, curricula: Array.from({ length: 21 }, (_, i) => `c${i}`) })).toBe(PAYLOAD_MESSAGES.other);
    expect(applicationPayloadProblem({ ...ok, phases: Array.from({ length: 21 }, (_, i) => `p${i}`) })).toBe(PAYLOAD_MESSAGES.other);
  });
});

describe('enquiryConversion and possible spam', () => {
  it('leaves suspected and confirmed spam out of the figures', () => {
    const list = [
      { createdAt: '2026-09-01', status: 'enrolled' as const },
      { createdAt: '2026-09-02', status: 'new' as const, spamStatus: 'suspected' as const },
      { createdAt: '2026-09-03', status: 'lost' as const, spamStatus: 'spam' as const },
      { createdAt: '2026-09-04', status: 'new' as const, spamStatus: 'clean' as const },
    ];
    expect(enquiryConversion(list, '2026-08-01')).toEqual({ total: 2, enrolled: 1, lost: 0, open: 1, rate: 1 });
  });
});

describe('mergeMessage', () => {
  const at = new Date('2026-10-05T22:00:00Z'); // 6 October in the UAE
  it('never overwrites the earlier message', () => {
    expect(mergeMessage('Hello', undefined, at)).toBe('Hello');
    expect(mergeMessage(undefined, ' Hi ', at)).toBe('Hi');
    expect(mergeMessage('Hello there, friend', 'hello there friend!', at)).toBe('Hello there, friend');
    expect(mergeMessage('We need help with maths and physics', 'help with maths', at)).toBe('We need help with maths and physics');
    expect(mergeMessage('Help with maths', 'Help with maths please, urgently', at)).toBe('Help with maths\n\nRe-sent on 6 October 2026: Help with maths please, urgently');
  });
});

describe('isRateLimitError and spamLabel', () => {
  it('recognises the limit from either data source', () => {
    expect(isRateLimitError(new RateLimitError())).toBe(true);
    expect(isRateLimitError(new Error(RATE_LIMIT_MESSAGE))).toBe(true);
    expect(isRateLimitError({ code: 'PT429', message: 'x' })).toBe(true);
    expect(isRateLimitError(new Error('Please enter your name'))).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
  });
  it('marks possible spam in lists', () => {
    expect(spamLabel({ spamStatus: 'suspected' })).toBe('Possible spam');
    expect(spamLabel({ spamStatus: 'spam' })).toBe('Marked as spam');
    expect(spamLabel({ spamStatus: 'clean' })).toBeUndefined();
    expect(spamReasonPhrase(['too-fast', 'links'])).toBe('sent very quickly; several links');
  });
});
