import { notificationRoute } from '../notification-route';

describe('notificationRoute', () => {
  it('opens app paths from the notification data', () => {
    expect(notificationRoute({ url: '/invoice/5b8c0d3e-1f2a-4b5c-9d6e-7f8a9b0c1d2e' })).toBe('/invoice/5b8c0d3e-1f2a-4b5c-9d6e-7f8a9b0c1d2e');
    expect(notificationRoute({ url: ' /manage/enquiries ' })).toBe('/manage/enquiries');
    expect(notificationRoute({ url: '/' })).toBe('/');
  });
  it('ignores missing, foreign or malformed links', () => {
    expect(notificationRoute(null)).toBeNull();
    expect(notificationRoute({})).toBeNull();
    expect(notificationRoute({ url: 42 })).toBeNull();
    expect(notificationRoute({ url: 'https://example.com/x' })).toBeNull();
    expect(notificationRoute({ url: '//example.com/x' })).toBeNull();
    expect(notificationRoute({ url: 'invoice/1' })).toBeNull();
    expect(notificationRoute({ url: '/invoice/1?x=<script>' })).toBeNull();
  });
});
