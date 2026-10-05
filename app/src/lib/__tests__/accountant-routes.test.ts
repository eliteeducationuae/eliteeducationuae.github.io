import { isAccountantRoute } from '@/lib/accountant-routes';

jest.mock('expo-router', () => ({ usePathname: () => '/' }));
jest.mock('@/data/session', () => ({ useSession: () => undefined }));

describe('isAccountantRoute', () => {
  it('allows the books', () => {
    for (const r of ['/accountant', '/accountant/invoices', '/accountant/vat', '/invoice/inv-1', '/credit-note/cn-1', '/manage/vat', '/manage/money']) {
      expect(isAccountantRoute(r)).toBe(true);
    }
  });
  it('keeps the accountant away from pupils, lessons, messages and admin tools', () => {
    for (const r of ['/admin', '/manage/families', '/students/s-omar', '/messages', '/lesson/new', '/manage/settings', '/manage/moneyx', '/accountants', '/refund']) {
      expect(isAccountantRoute(r)).toBe(false);
    }
  });
});
