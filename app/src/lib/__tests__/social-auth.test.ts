import {
  appleDisplayName,
  friendlySocialError,
  redirectErrorNotice,
  isAppleRelayEmail,
  isPlaceholderName,
  NATIVE_AUTH_PATH,
  nameFromEmail,
  parseAuthCallback,
  surnameOf,
  webRedirectTo,
} from '../social-auth';

describe('parseAuthCallback', () => {
  it('reads a PKCE code from the query', () => {
    expect(parseAuthCallback('eliteeducation://auth-callback?code=abc123')).toEqual({ code: 'abc123' });
  });

  it('reads implicit-flow tokens from the hash', () => {
    expect(
      parseAuthCallback('https://eliteeducation.me/app/#access_token=at.1&refresh_token=rt-2&token_type=bearer&expires_in=3600'),
    ).toEqual({ accessToken: 'at.1', refreshToken: 'rt-2' });
  });

  it('combines query and hash, with the hash winning', () => {
    expect(parseAuthCallback('x://y?code=q&access_token=old#access_token=new')).toEqual({
      code: 'q',
      accessToken: 'new',
    });
  });

  it('prefers error_description and decodes + and percent-encoding', () => {
    expect(
      parseAuthCallback(
        'https://eliteeducation.me/app/?error=server_error&error_description=Unsupported+provider%3A+provider+is+not+enabled',
      ),
    ).toEqual({ error: 'Unsupported provider: provider is not enabled' });
  });

  it('falls back to error when there is no description', () => {
    expect(parseAuthCallback('https://x.test/#error=access_denied')).toEqual({ error: 'access_denied' });
  });

  it('copes with empty, plain and malformed URLs', () => {
    expect(parseAuthCallback('')).toEqual({});
    expect(parseAuthCallback('https://eliteeducation.me/app/')).toEqual({});
    expect(parseAuthCallback('https://x.test/?error=%E0%A4%A')).toEqual({ error: '%E0%A4%A' });
  });
});

describe('webRedirectTo', () => {
  it('adds the base URL with a trailing slash', () => {
    expect(webRedirectTo('https://eliteeducation.me', '/app')).toBe('https://eliteeducation.me/app/');
    expect(webRedirectTo('https://eliteeducation.me', '/app/')).toBe('https://eliteeducation.me/app/');
    expect(webRedirectTo('https://eliteeducation.me/', 'app')).toBe('https://eliteeducation.me/app/');
  });

  it('uses the root without a base URL', () => {
    expect(webRedirectTo('http://localhost:8081')).toBe('http://localhost:8081/');
    expect(webRedirectTo('http://localhost:8081', '')).toBe('http://localhost:8081/');
    expect(webRedirectTo('http://localhost:8081', '/')).toBe('http://localhost:8081/');
  });
});

describe('appleDisplayName', () => {
  it('joins given, middle and family names', () => {
    expect(appleDisplayName({ givenName: 'Fatima', middleName: 'A.', familyName: 'Al Mansoori' })).toBe(
      'Fatima A. Al Mansoori',
    );
    expect(appleDisplayName({ givenName: ' Fatima ', middleName: null, familyName: 'Al Mansoori' })).toBe(
      'Fatima Al Mansoori',
    );
  });

  it('falls back to the nickname', () => {
    expect(appleDisplayName({ givenName: '', familyName: null, nickname: 'Fats' })).toBe('Fats');
  });

  it('returns null when nothing is shared', () => {
    expect(appleDisplayName(null)).toBeNull();
    expect(appleDisplayName(undefined)).toBeNull();
    expect(appleDisplayName({ givenName: ' ', familyName: null, nickname: '' })).toBeNull();
  });
});

describe('isAppleRelayEmail', () => {
  it('spots Hide My Email addresses', () => {
    expect(isAppleRelayEmail('abc123@privaterelay.appleid.com')).toBe(true);
    expect(isAppleRelayEmail('ABC@PrivateRelay.AppleID.com ')).toBe(true);
    expect(isAppleRelayEmail('parent@gmail.com')).toBe(false);
    expect(isAppleRelayEmail(null)).toBe(false);
  });
});

describe('friendlySocialError', () => {
  it('explains a provider that is not switched on', () => {
    expect(friendlySocialError('google', 'Unsupported provider: provider is not enabled')).toBe(
      'Google sign-in is not available yet. Please sign in with your email.',
    );
    expect(friendlySocialError('apple', 'Unsupported provider: provider is not enabled')).toBe(
      'Apple sign-in is not available yet. Please sign in with your email.',
    );
  });

  it('treats denial and cancellation politely', () => {
    expect(friendlySocialError('google', 'access_denied')).toBe('Sign-in was cancelled.');
    expect(friendlySocialError('apple', 'The user canceled the authorization attempt.')).toBe('Sign-in was cancelled.');
  });

  it('falls back to a general message', () => {
    expect(friendlySocialError('google', 'Database error saving new user')).toBe(
      'We could not sign you in with Google. Please try again, or use your email address.',
    );
    expect(friendlySocialError('apple', undefined)).toBe(
      'We could not sign you in with Apple. Please try again, or use your email address.',
    );
  });
});

it('uses the auth-callback path for native redirects', () => {
  expect(NATIVE_AUTH_PATH).toBe('auth-callback');
});

describe('redirectErrorNotice', () => {
  it('stays quiet when there is no error or the person cancelled', () => {
    expect(redirectErrorNotice('google', undefined)).toBeNull();
    expect(redirectErrorNotice('google', 'access_denied')).toBeNull();
    expect(redirectErrorNotice(null, 'The user cancelled the request')).toBeNull();
  });

  it('names the provider it remembers', () => {
    expect(redirectErrorNotice('apple', 'Something went wrong')).toBe(
      'We could not sign you in with Apple. Please try again, or use your email address.',
    );
  });

  it('explains an expired email link instead of blaming Apple or Google', () => {
    const url =
      'https://eliteeducation.me/app/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
    const { error, errorCode } = parseAuthCallback(url);
    expect(errorCode).toBe('otp_expired');
    const expired = 'This link has expired. Please request a new one from the sign-in screen.';
    expect(redirectErrorNotice(null, error, errorCode)).toBe(expired);
    expect(redirectErrorNotice('google', error, errorCode)).toBe(expired);
    expect(redirectErrorNotice('apple', 'Email link is invalid or has expired')).toBe(expired);
  });

  it('gives a neutral message when the provider is unknown', () => {
    expect(redirectErrorNotice(null, 'Something went wrong')).toBe(
      'We could not complete your sign-in. Please try again, or use your email address and password.',
    );
  });
});

describe('isPlaceholderName', () => {
  it('treats blank, New parent and email-derived single words as placeholders', () => {
    expect(isPlaceholderName('')).toBe(true);
    expect(isPlaceholderName('  ')).toBe(true);
    expect(isPlaceholderName(undefined)).toBe(true);
    expect(isPlaceholderName('New parent')).toBe(true);
    expect(isPlaceholderName('new PARENT')).toBe(true);
    expect(isPlaceholderName('Jsmith1984', 'jsmith1984@icloud.com')).toBe(true);
    expect(isPlaceholderName('Jsmith', 'jsmith@icloud.com')).toBe(true);
  });

  it('accepts real names', () => {
    expect(isPlaceholderName('Mona Ahmed', 'known@x')).toBe(false);
    expect(isPlaceholderName('Sara Lee', 'sara.lee@x')).toBe(false);
    expect(isPlaceholderName('Fatima Al Mansoori')).toBe(false);
    expect(isPlaceholderName('Cher', 'someone@x')).toBe(false);
  });

  it('derives names from emails as the database does', () => {
    expect(nameFromEmail('sara.lee@x')).toBe('Sara Lee');
    expect(nameFromEmail('JSMITH_1984@icloud.com')).toBe('Jsmith 1984');
  });
});

describe('surnameOf', () => {
  it('keeps Arabic particles with the surname', () => {
    expect(surnameOf('Fatima Al Mansoori')).toBe('Al Mansoori');
    expect(surnameOf('Mohammed bin Rashid Al Maktoum')).toBe('Al Maktoum');
    expect(surnameOf('Noor bint Saeed')).toBe('bint Saeed');
    expect(surnameOf('  Layla   Haddad ')).toBe('Haddad');
    expect(surnameOf('Cher')).toBe('Cher');
    expect(surnameOf('')).toBe('');
  });
});
