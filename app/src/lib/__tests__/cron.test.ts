import { isAuthorisedCronCall } from '../../../supabase/functions/_shared/cron';

describe('isAuthorisedCronCall', () => {
  it('keeps existing schedules working until CRON_SECRET is set', () => {
    expect(isAuthorisedCronCall(null, undefined)).toBe(true);
    expect(isAuthorisedCronCall('anything', '')).toBe(true);
  });

  it('requires the matching header once CRON_SECRET is set', () => {
    const secret = 'a3f1c9e07b5d42e8a3f1c9e07b5d42e8';
    expect(isAuthorisedCronCall(secret, secret)).toBe(true);
    expect(isAuthorisedCronCall(null, secret)).toBe(false);
    expect(isAuthorisedCronCall('', secret)).toBe(false);
    expect(isAuthorisedCronCall(secret.slice(0, -1), secret)).toBe(false);
    expect(isAuthorisedCronCall(`${secret}x`, secret)).toBe(false);
    expect(isAuthorisedCronCall('b3f1c9e07b5d42e8a3f1c9e07b5d42e8', secret)).toBe(false);
  });
});
