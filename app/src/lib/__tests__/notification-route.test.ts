import { notificationRoute } from '../notification-route';

describe('notificationRoute', () => {
  it('opens app paths from the notification data', () => {
    expect(notificationRoute({ url: '/invoice/5b8c0d3e-1f2a-4b5c-9d6e-7f8a9b0c1d2e' })).toBe('/invoice/5b8c0d3e-1f2a-4b5c-9d6e-7f8a9b0c1d2e');
    expect(notificationRoute({ url: ' /manage/enquiries ' })).toBe('/manage/enquiries');
    expect(notificationRoute({ url: '/' })).toBe('/');
  });
  it('keeps simple query parameters, as the contacts and homework notices use', () => {
    expect(notificationRoute({ url: '/manage/family-edit?id=c0000000-0000-0000-0000-000000000001' })).toBe(
      '/manage/family-edit?id=c0000000-0000-0000-0000-000000000001',
    );
    expect(notificationRoute({ url: '/parent/progress?tab=homework&student=s-omar' })).toBe('/parent/progress?tab=homework&student=s-omar');
    expect(notificationRoute({ url: '/x?=1' })).toBeNull();
    expect(notificationRoute({ url: '/x?a=1&' })).toBeNull();
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
