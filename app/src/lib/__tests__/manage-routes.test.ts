import { isManageRoute } from '@/lib/manage-routes';

jest.mock('expo-router', () => ({ usePathname: () => '/' }));
jest.mock('@/data/session', () => ({ useSession: () => undefined }));

describe('isManageRoute', () => {
  it('covers every office screen', () => {
    for (const r of ['/manage', '/manage/settings', '/manage/family/f-1', '/manage/vetting/t-1', '/manage/money', '/manage/vat']) {
      expect(isManageRoute(r)).toBe(true);
    }
  });
  it('leaves shared and role screens alone', () => {
    for (const r of ['/', '/parent', '/tutor', '/managex', '/messages/f-1', '/lesson/l-1', '/availability']) {
      expect(isManageRoute(r)).toBe(false);
    }
  });
});
