import {
  ALL_PROVIDERS,
  cachedProviders,
  isAuthorizeRefusal,
  isProviderOff,
  probeAuthorize,
  loadProviders,
  providersFromSettings,
  providerUnavailableMessage,
  resetProvidersCache,
} from '../auth-providers';

const URL_ = 'https://example.supabase.co';

describe('providersFromSettings', () => {
  it('reads the switched-on providers', () => {
    expect(providersFromSettings({ external: { email: true, google: false, apple: false } })).toEqual({ apple: false, google: false, known: true });
    expect(providersFromSettings({ external: { google: true, apple: false } })).toEqual({ apple: false, google: true, known: true });
    expect(providersFromSettings({ external: { google: true, apple: true } })).toEqual({ apple: true, google: true, known: true });
  });

  it('treats anything other than true as switched off', () => {
    expect(providersFromSettings({ external: { google: 'true' } })).toEqual({ apple: false, google: false, known: true });
  });

  it('offers both buttons when the body is unreadable', () => {
    for (const body of [null, undefined, 'oops', 42, {}, { external: null }, { external: 'x' }]) {
      expect(providersFromSettings(body)).toEqual(ALL_PROVIDERS);
    }
  });
});

describe('isProviderOff', () => {
  it('is true only when the settings are known and the provider is off', () => {
    const live = providersFromSettings({ external: { google: false, apple: true } });
    expect(isProviderOff(live, 'google')).toBe(true);
    expect(isProviderOff(live, 'apple')).toBe(false);
    expect(isProviderOff(ALL_PROVIDERS, 'google')).toBe(false);
    expect(isProviderOff(null, 'google')).toBe(false);
  });
});

describe('providerUnavailableMessage', () => {
  it('is calm and points to email', () => {
    expect(providerUnavailableMessage('google')).toBe('Google sign-in is not available yet. Please sign in with your email.');
    expect(providerUnavailableMessage('apple')).toBe('Apple sign-in is not available yet. Please sign in with your email.');
  });
});

describe('loadProviders', () => {
  beforeEach(resetProvidersCache);

  it('fetches once per session with the publishable key and caches the answer', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({ external: { google: false, apple: false } }) }));
    const a = await loadProviders(URL_ + '/', 'pk', { fetchImpl });
    const b = await loadProviders(URL_ + '/', 'pk', { fetchImpl });
    expect(a).toEqual({ apple: false, google: false, known: true });
    expect(b).toBe(a);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]).toEqual([`${URL_}/auth/v1/settings`, expect.objectContaining({ headers: { apikey: 'pk' } })]);
    expect(cachedProviders(URL_ + '/')).toEqual(a);
  });

  it('falls back to both buttons on a network error, an HTTP error or a timeout, and tries again later', async () => {
    const failing = jest.fn(async () => {
      throw new Error('offline');
    });
    expect(await loadProviders(URL_, 'pk', { fetchImpl: failing })).toEqual(ALL_PROVIDERS);
    expect(cachedProviders(URL_)).toBeUndefined();

    const http = jest.fn(async () => ({ ok: false, json: async () => ({}) }));
    expect(await loadProviders(URL_, 'pk', { fetchImpl: http })).toEqual(ALL_PROVIDERS);

    const hanging = jest.fn(() => new Promise<never>(() => undefined));
    expect(await loadProviders(URL_, 'pk', { fetchImpl: hanging, timeoutMs: 10 })).toEqual(ALL_PROVIDERS);

    const ok = jest.fn(async () => ({ ok: true, json: async () => ({ external: { google: true } }) }));
    expect(await loadProviders(URL_, 'pk', { fetchImpl: ok })).toEqual({ apple: false, google: true, known: true });
  });
});

describe('authorize fallback', () => {
  const refusal = '{"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}';

  it('recognises only Supabase\'s refusal of a switched-off provider', () => {
    expect(isAuthorizeRefusal(400, refusal)).toBe(true);
    expect(isAuthorizeRefusal(400, '{"msg":"invalid redirect"}')).toBe(false);
    expect(isAuthorizeRefusal(500, refusal)).toBe(false);
  });

  it('probes without following the redirect and never throws', async () => {
    const refused = jest.fn(async () => ({ type: 'cors', status: 400, text: async () => refusal }));
    expect(await probeAuthorize('https://x/auth/v1/authorize?provider=google', { fetchImpl: refused as never })).toBe(true);
    expect(refused).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: 'manual', credentials: 'omit' }));

    const redirect = jest.fn(async () => ({ type: 'opaqueredirect', status: 0, text: async () => '' }));
    expect(await probeAuthorize('u', { fetchImpl: redirect as never })).toBe(false);

    const offline = jest.fn(async () => {
      throw new Error('offline');
    });
    expect(await probeAuthorize('u', { fetchImpl: offline as never })).toBe(false);
  });
});
