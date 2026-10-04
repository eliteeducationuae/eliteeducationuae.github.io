import {
  appleDisplayName,
  friendlySocialError,
  redirectErrorNotice,
  isAppleRelayEmail,
  NATIVE_AUTH_PATH,
  parseAuthCallback,
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
      'Sign in with Google is not available yet. Please use your email address and password, or contact us.',
    );
    expect(friendlySocialError('apple', 'Unsupported provider: provider is not enabled')).toBe(
      'Sign in with Apple is not available yet. Please use your email address and password, or contact us.',
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

  it('gives a neutral message when the provider is unknown', () => {
    expect(redirectErrorNotice(null, 'Something went wrong')).toBe(
      'We could not complete your sign-in. Please try again, or use your email address and password.',
    );
  });
});
