import { createDemoSource } from '../demo';

const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => mockStore.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      mockStore.set(k, v);
    },
    removeItem: async (k: string) => {
      mockStore.delete(k);
    },
  },
}));

beforeEach(() => mockStore.clear());

async function accountant() {
  const source = createDemoSource();
  await source.signIn('accounts@example.com', '');
  return source;
}

describe('demo accountant: own account versus the business’s records', () => {
  it('still refuses every business write', async () => {
    const source = await accountant();
    await expect(source.saveSettings({ trn: '100000000000003' })).rejects.toThrow('Accountants have read-only access.');
    await expect(source.saveExpense({ date: '2026-10-01', description: 'Paper', amount: 10, vatAmount: 0.5, category: 'Supplies' } as never)).rejects.toThrow(
      'Accountants have read-only access.',
    );
    await expect(source.recordDeletionRequest({ familyId: 'f-mansoori' })).rejects.toThrow('Accountants have read-only access.');
  });

  it('can change their own name and WhatsApp settings, as set_my_name and set_whatsapp allow', async () => {
    const source = await accountant();
    // set_my_name renames only a parent who is still signing up; for everyone else it is a no-op, not an error.
    await expect(source.setMyName!('Amira H.')).resolves.toMatchObject({ id: 'u-accountant', fullName: 'Amira Haddad' });
    await expect(source.setWhatsApp!({ optIn: true, number: '+971501234567' })).resolves.toMatchObject({
      id: 'u-accountant',
      whatsappOptIn: true,
      whatsappNumber: '+971501234567',
    });
  });

  it('can delete their own account, as the delete-account function allows', async () => {
    const source = await accountant();
    await expect(source.deleteMyAccount()).resolves.toBeDefined();
    await expect(source.restoreSession()).resolves.toBeNull();
    await expect(source.signIn('accounts@example.com', '')).rejects.toThrow('This demo account has been deleted.');
    // The deletion is recorded for the office, which sees it in the deletion log.
    const admin = createDemoSource();
    await admin.signIn('craig@eliteeducation.me', '');
    const requests = await admin.listDeletionRequests();
    expect(requests[0]).toMatchObject({ status: 'completed', role: 'accountant', reason: 'Deleted from the app' });
  });
});
