import { inviteRedirect, isAlreadyRegisteredError, normaliseInviteEmail } from '../../../supabase/functions/_shared/invite';

describe('normaliseInviteEmail', () => {
  it('trims and lower-cases an email address', () => {
    expect(normaliseInviteEmail('  Fay.Accountant@Firm.AE ')).toBe('fay.accountant@firm.ae');
  });

  it.each([undefined, null, 42, '', '   ', 'fay', 'fay@', '@firm.ae', 'fay@firm', 'fay @firm.ae', `${'a'.repeat(250)}@firm.ae`])(
    'refuses %p',
    (value) => {
      expect(normaliseInviteEmail(value)).toBeNull();
    },
  );
});

describe('isAlreadyRegisteredError', () => {
  it('recognises Supabase Auth saying the address already has a login', () => {
    expect(isAlreadyRegisteredError({ code: 'email_exists', message: 'x' })).toBe(true);
    expect(isAlreadyRegisteredError({ code: 'user_already_exists' })).toBe(true);
    expect(isAlreadyRegisteredError({ message: 'A user with this email address has already been registered' })).toBe(true);
    expect(isAlreadyRegisteredError({ message: 'User already registered' })).toBe(true);
  });

  it('does not hide other errors', () => {
    expect(isAlreadyRegisteredError(null)).toBe(false);
    expect(isAlreadyRegisteredError('email_exists')).toBe(false);
    expect(isAlreadyRegisteredError({ code: 'over_email_send_rate_limit', message: 'Email rate limit exceeded' })).toBe(false);
    expect(isAlreadyRegisteredError({ message: 'Unable to validate email address: invalid format' })).toBe(false);
  });
});

describe('inviteRedirect', () => {
  it('sends the accountant to the app sign-in screen', () => {
    expect(inviteRedirect('https://eliteeducationuae.github.io/app')).toBe('https://eliteeducationuae.github.io/app/sign-in');
    expect(inviteRedirect(' https://app.example.com// ')).toBe('https://app.example.com/sign-in');
  });

  it('is null without an app address', () => {
    expect(inviteRedirect(undefined)).toBeNull();
    expect(inviteRedirect('')).toBeNull();
    expect(inviteRedirect('  ')).toBeNull();
  });
});
