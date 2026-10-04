import AsyncStorage from '@react-native-async-storage/async-storage';

import { invoiceTotals } from '@/domain/billing';
import type { Profile } from '@/domain/types';

import type { DataSource } from '../source';
import { cmd, DEMO_DB_VERSION, newId, q, type DemoDB } from './db';
import { eq } from './engagement';
import { ops } from './operations';
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
    async signInWithProvider() {
      // Demo: Apple and Google both sign in as the sample parent.
      const d = await load();
      const found = d.profiles.find((p) => p.role === 'parent');
      if (!found) throw new Error('No demo parent account.');
      viewer = found;
      await AsyncStorage.setItem(SESSION_KEY, found.id).catch(() => undefined);
      return { status: 'signed-in' as const, profile: found };
    },
    async signOut() {
      viewer = null;
      await AsyncStorage.removeItem(SESSION_KEY).catch(() => undefined);
    },
    loginEmails: () => read((d) => d.profiles.map((p) => p.email.toLowerCase())),
    async signUp(email, _password, details) {
      const d = await load();
      const e = email.trim().toLowerCase();
      if (d.profiles.some((p) => p.email.toLowerCase() === e)) throw new Error('An account with that email already exists — sign in instead.');
      const familyId = newId('fam');
      d.families.push({
        id: familyId,
        name: details.fullName.trim().split(' ').pop() ?? details.fullName,
        parentName: details.fullName.trim(),
        email: e,
        phone: details.phone,
        status: 'prospect',
        createdAt: new Date().toISOString(),
      });
      const profile = { id: newId('u'), role: 'parent' as const, fullName: details.fullName.trim(), email: e, familyId };
      d.profiles.push(profile);
      viewer = profile;
      await save();
      await AsyncStorage.setItem(SESSION_KEY, profile.id).catch(() => undefined);
      return 'signed-in';
    },
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
    addMyChild: (child) => write((d, v) => eq.addMyChild(d, v, child)),
    setFamilyStatus: (id, status) => write((d, v) => eq.setFamilyStatus(d, v, id, status)),
    async submitEnquiry(e) {
      const d = await load();
      eq.submitEnquiry(d, viewer, e);
      await save();
    },
    listEnquiries: () => read((d, v) => eq.enquiries(d, v)),
    updateEnquiry: (id, patch) => write((d, v) => eq.updateEnquiry(d, v, id, patch)),
    listAvailability: () => read((d) => d.availability),
    setAvailability: (tutorId, blocks) => write((d, v) => eq.setAvailability(d, v, tutorId, blocks)),
    listClosures: () => read((d) => d.closures),
    saveClosure: (c) => write((d, v) => eq.saveClosure(d, v, c)),
    deleteClosure: (id) => write((d, v) => eq.deleteClosure(d, v, id)),
    listAbsences: () => read((d, v) => eq.absences(d, v)),
    saveAbsence: (a) => write((d, v) => eq.saveAbsence(d, v, a)),
    deleteAbsence: (id) => write((d, v) => eq.deleteAbsence(d, v, id)),
    openSlots: (input) => read((d) => eq.openSlots(d, input)),
    listRequests: () => read((d, v) => eq.requests(d, v)),
    requestLesson: (input) => write((d, v) => eq.requestLesson(d, v, input)),
    decideRequest: (id, approve, response) => write((d, v) => eq.decideRequest(d, v, id, approve, response)),
    withdrawRequest: (id) => write((d, v) => eq.withdrawRequest(d, v, id)),
    reassignLesson: (lessonId, tutorId) => write((d, v) => eq.reassignLesson(d, v, lessonId, tutorId)),
    listThreads: () => read((d, v) => eq.threads(d, v)),
    listMessages: (familyId) => read((d, v) => eq.messages(d, v, familyId)),
    sendMessage: (familyId, body) => write((d, v) => eq.sendMessage(d, v, familyId, body)),
    markThreadRead: (familyId) => write((d, v) => eq.markRead(d, v, familyId)),
    listAnnouncements: () => read((d, v) => eq.announcements(d, v)),
    postAnnouncement: (a) => write((d, v) => eq.postAnnouncement(d, v, a)),
    // Files aren't stored in the demo; keep the name so the flow can be tried.
    uploadFile: async (_bucket, folder, file) => `${folder}/${file.name}`,
    fileUrl: async () => null,
    listOpportunities: () => read((d, v) => ops.opportunities(d, v)),
    listBids: () => read((d, v) => ops.bids(d, v)),
    saveOpportunity: (o) => write((d, v) => ops.saveOpportunity(d, v, o)),
    placeBid: (id, pitch, availability) => write((d, v) => ops.placeBid(d, v, id, pitch, availability)),
    withdrawBid: (id) => write((d, v) => ops.withdrawBid(d, v, id)),
    awardOpportunity: (bidId) => write((d, v) => ops.awardOpportunity(d, v, bidId)),
    async submitTutorApplication(a) {
      const d = await load();
      ops.submitApplication(d, a);
      await save();
    },
    listApplications: () => read((d, v) => ops.applications(d, v)),
    updateApplication: (id, patch) => write((d, v) => ops.updateApplication(d, v, id, patch)),
    getPaymentDetails: (tutorId) => read((d, v) => ops.paymentDetails(d, v, tutorId)),
    savePaymentDetails: (details) => write((d, v) => ops.savePaymentDetails(d, v, details)),
    listTutorInvoices: () => read((d, v) => ops.tutorInvoices(d, v)),
    createTutorInvoice: (tutorId, month) => write((d, v) => ops.createTutorInvoice(d, v, tutorId, month)),
    updateTutorInvoice: (id, extras, notes) => write((d, v) => ops.updateTutorInvoice(d, v, id, extras, notes)),
    submitTutorInvoice: (id) => write((d, v) => ops.submitTutorInvoice(d, v, id)),
    reviewTutorInvoice: (id, approve, comment) => write((d, v) => ops.reviewTutorInvoice(d, v, id, approve, comment)),
    markTutorInvoicePaid: (id, reference) => write((d, v) => ops.markTutorInvoicePaid(d, v, id, reference)),
    listReportCycles: () => read((d) => d.reportCycles),
    openReportCycle: (name, startsOn, due) => write((d, v) => ops.openReportCycle(d, v, name, startsOn, due)),
    listStudentReports: () => read((d, v) => ops.reports(d, v)),
    saveReport: (id, fields) => write((d, v) => ops.saveReport(d, v, id, fields)),
    submitReport: (id) => write((d, v) => ops.submitReport(d, v, id)),
    setReportStatus: (id, status) => write((d, v) => ops.setReportStatus(d, v, id, status)),
    listExpenses: () => read((d, v) => ops.expenses(d, v)),
    saveExpense: (e) => write((d, v) => ops.saveExpense(d, v, e)),
    deleteExpense: (id) => write((d, v) => ops.deleteExpense(d, v, id)),
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
