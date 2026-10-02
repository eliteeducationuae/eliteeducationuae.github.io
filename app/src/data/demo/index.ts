import AsyncStorage from '@react-native-async-storage/async-storage';

import { invoiceTotals } from '@/domain/billing';
import type { Profile } from '@/domain/types';

import type { DataSource } from '../source';
import { cmd, DEMO_DB_VERSION, q, type DemoDB } from './db';
import { createSeed } from './seed';

const DB_KEY = 'elite.demo.db';
const SESSION_KEY = 'elite.demo.session';

/**
 * Offline demo backend: a seeded in-memory database persisted to device storage.
 * Lets anyone try every role without a server, and is used for UI testing.
 */
export function createDemoSource(): DataSource {
  let db: DemoDB | null = null;
  let viewer: Profile | null = null;

  async function load(): Promise<DemoDB> {
    if (db) return db;
    try {
      const raw = await AsyncStorage.getItem(DB_KEY);
      const parsed = raw ? (JSON.parse(raw) as DemoDB) : null;
      db = parsed && parsed.version === DEMO_DB_VERSION ? parsed : createSeed();
    } catch {
      db = createSeed();
    }
    return db;
  }

  async function save() {
    if (!db) return;
    try {
      await AsyncStorage.setItem(DB_KEY, JSON.stringify(db));
    } catch {
      // Storage can be unavailable (private browsing); the demo still works in memory.
    }
  }

  function me(): Profile {
    if (!viewer) throw new Error('Not signed in');
    return viewer;
  }

  const read = async <T>(fn: (db: DemoDB, viewer: Profile) => T): Promise<T> => {
    const d = await load();
    // Return copies so screens can't mutate the store by accident.
    return structuredClone(fn(d, me()));
  };

  const write = async <T>(fn: (db: DemoDB, viewer: Profile) => T): Promise<T> => {
    const d = await load();
    const result = fn(d, me());
    await save();
    return structuredClone(result);
  };

  return {
    kind: 'demo',

    async restoreSession() {
      const d = await load();
      try {
        const id = await AsyncStorage.getItem(SESSION_KEY);
        viewer = d.profiles.find((p) => p.id === id) ?? null;
      } catch {
        viewer = null;
      }
      return viewer;
    },
    async signIn(email) {
      const d = await load();
      const found = d.profiles.find((p) => p.email.toLowerCase() === email.trim().toLowerCase());
      if (!found) throw new Error('No demo account with that email.');
      viewer = found;
      await AsyncStorage.setItem(SESSION_KEY, found.id).catch(() => undefined);
      return found;
    },
    async signOut() {
      viewer = null;
      await AsyncStorage.removeItem(SESSION_KEY).catch(() => undefined);
    },
    loginEmails: () => read((d) => d.profiles.map((p) => p.email.toLowerCase())),
    demoAccounts() {
      return createSeed().profiles;
    },
    async resetDemo() {
      db = createSeed();
      await save();
    },

    getSettings: () => read((d) => d.settings),
    listTutors: () => read((d) => d.tutors),
    listFamilies: () => read((d, v) => q.families(d, v)),
    listStudents: () => read((d, v) => q.students(d, v)),
    listServices: () => read((d) => d.services),
    listLessons: ({ from, to }) => read((d, v) => q.lessons(d, v, from, to)),
    getLesson: (id) => read((d, v) => q.lessons(d, v, '0000', '9999').find((l) => l.id === id) ?? null),
    listNotes: (filter) => read((d, v) => q.notes(d, v, filter)),
    listHomework: (filter) => read((d, v) => q.homework(d, v, filter?.studentId)),
    listRatings: (filter) => read((d, v) => q.ratings(d, v, filter?.studentId)),
    listPackages: (filter) => read((d, v) => q.packages(d, v, filter?.familyId)),
    listCharges: (filter) => read((d, v) => q.charges(d, v, filter?.familyId)),
    listInvoices: (filter) => read((d, v) => q.invoices(d, v, filter?.familyId)),
    getInvoice: (id) => read((d, v) => q.invoices(d, v).find((i) => i.id === id) ?? null),

    saveSettings: (patch) => write((d, v) => cmd.saveSettings(d, v, patch)),
    saveTutor: (t) => write((d, v) => cmd.saveTutor(d, v, t)),
    saveFamily: (f) => write((d, v) => cmd.saveFamily(d, v, f)),
    saveStudent: (s) => write((d, v) => cmd.saveStudent(d, v, s)),
    saveService: (s) => write((d, v) => cmd.saveService(d, v, s)),

    createLessons: (lessons) => write((d, v) => cmd.createLessons(d, v, lessons)),
    rescheduleLesson: (id, start, end) => write((d, v) => cmd.rescheduleLesson(d, v, id, start, end)),
    cancelLesson: (id, reason, waive) => write((d, v) => cmd.cancelLesson(d, v, id, reason, waive)),
    completeLesson: (input) => write((d, v) => cmd.completeLesson(d, v, input)),
    setHomeworkDone: (id, done) => write((d, v) => cmd.setHomeworkDone(d, v, id, done)),

    sellPackage: (pkg) => write((d, v) => cmd.sellPackage(d, v, pkg)),
    invoiceUnbilled: (familyId) => write((d, v) => cmd.invoiceUnbilled(d, v, familyId)),
    setInvoiceStatus: (id, status) => write((d, v) => cmd.setInvoiceStatus(d, v, id, status)),
    recordPayment: (id, amount, method, ref) => write((d, v) => cmd.recordPayment(d, v, id, amount, method, ref)),
    async startCardPayment(invoiceId) {
      // No real card processing in the demo: simulate a successful Stripe payment.
      await write((d, v) => {
        const invoice = q.invoices(d, v).find((i) => i.id === invoiceId);
        if (!invoice) throw new Error('Invoice not found');
        cmd.recordPayment(d, v, invoiceId, invoiceTotals(invoice).balance, 'card', 'Demo card payment');
      });
      return { paid: true };
    },
  };
}
