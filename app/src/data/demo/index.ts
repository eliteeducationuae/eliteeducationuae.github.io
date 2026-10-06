import AsyncStorage from '@react-native-async-storage/async-storage';

import { isValidTrn, normaliseTrn } from '@/domain/tax';
import type { Family, Profile } from '@/domain/types';
import { surnameOf } from '@/lib/social-auth';

import type { DataSource } from '../source';
import { readOnlySource, type ViewTarget } from '../view-as';
import { auditedWrite, ensureAuditSeed, listAuditActorsDemo, listAuditEventsDemo } from './audit';
// Admissions advisory
import { adm } from './admissions';
import { cw } from './classwork';
import { cal } from './calendar';
import { listFamilyContacts, removeFamilyContact, saveFamilyContact, syncPrimaryFromFamily } from './contacts';
import { cmd, DEMO_DB_VERSION, enr, newId, q, requireAdmin, type DemoDB } from './db';
import { eq } from './engagement';
import { ho } from './handover';
import { ops } from './operations';
import { pay } from './payments';
import { createSeed } from './seed';
import { tax } from './tax';
import * as launch from './launch';
import { setWhatsAppPrefs } from './whatsapp';
import { vet } from './vetting';

const DB_KEY = 'elite.demo.db';
const SESSION_KEY = 'elite.demo.session';

/** Picked files by stored path, so an upload can be viewed again in this session. */
const demoFiles = new Map<string, string>();

/** How long a demo "View as" lasts, matching production. */
const VIEW_MINUTES = 60;

/**
 * Who a demo source acts as. The signed-in source remembers its viewer in device storage; a "View as" source is
 * fixed to the viewed person and never touches the stored sign-in.
 */
interface DemoSession {
  viewer: Profile | null;
  persist: boolean;
}

/** The database a "View as" source shares with the signed-in source, so both see the same records. */
interface DemoStore {
  load(): Promise<DemoDB>;
  save(): Promise<void>;
}

/**
 * Offline demo backend: a seeded in-memory database persisted to device storage.
 * Lets anyone try every role without a server, and is used for UI testing.
 */
export function createDemoSource(session: DemoSession = { viewer: null, persist: true }, shared?: DemoStore): DataSource {
  let db: DemoDB | null = null;
  let viewer: Profile | null = session.viewer;

  async function load(): Promise<DemoDB> {
    if (shared) return shared.load();
    if (db) return db;
    try {
      const raw = await AsyncStorage.getItem(DB_KEY);
      const parsed = raw ? (JSON.parse(raw) as DemoDB) : null;
      db = parsed && parsed.version === DEMO_DB_VERSION ? parsed : createSeed();
    } catch {
      db = createSeed();
    }
    ensureAuditSeed(db);
    return db;
  }

  async function save() {
    if (shared) return shared.save();
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

  const commit = async <T>(fn: (db: DemoDB, viewer: Profile) => T, business: boolean): Promise<T> => {
    const d = await load();
    const v = me();
    // Tax: accountants have read-only access to the business's records.
    if (business) tax.requireWriter(v);
    // Record what the write changed, as the database's audit triggers do.
    const result = auditedWrite(d, v, () => fn(d, v));
    await save();
    return structuredClone(result);
  };
  /** A write to the business's records: refused for accountants. */
  const write = <T>(fn: (db: DemoDB, viewer: Profile) => T) => commit(fn, true);
  /**
   * A change to the caller's own login (name, WhatsApp settings, deleting the account). Production's set_my_name,
   * set_whatsapp and delete-account allow every role these, accountants included; each command keeps its own checks.
   */
  const writeOwn = <T>(fn: (db: DemoDB, viewer: Profile) => T) => commit(fn, false);

  return {
    kind: 'demo',

    async restoreSession() {
      const d = await load();
      if (!session.persist) {
        // A "View as" source: the viewed person, as the database has them now. It never reads the stored sign-in.
        const id = viewer?.id;
        viewer = d.profiles.find((p) => p.id === id) ?? null;
        return viewer;
      }
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
      if (!found) {
        // Launch readiness: a sample account deleted from the Account screen comes back with Reset demo data.
        const deleted = createSeed().profiles.some((p) => p.email.toLowerCase() === email.trim().toLowerCase());
        throw new Error(
          deleted
            ? 'This demo account has been deleted. Sign in with another role and choose Reset demo data on the Account screen to restore it.'
            : 'No demo account with that email.',
        );
      }
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
    async setMyName(fullName) {
      const updated = await writeOwn((d, v) => eq.setMyName(d, v, fullName));
      viewer = updated;
      return updated;
    },
    async setWhatsApp(prefs) {
      const updated = await writeOwn((d, v) => setWhatsAppPrefs(d, v, prefs));
      viewer = updated;
      return updated;
    },
    async signOut() {
      viewer = null;
      await AsyncStorage.removeItem(SESSION_KEY).catch(() => undefined);
    },
    loginEmails: () => read((d) => d.profiles.map((p) => p.email.toLowerCase())),
    listViewTargets: () =>
      read((d, v) => {
        requireAdmin(v);
        // Only parents, students and tutors can be viewed (an accountant cannot), as begin_view_as requires.
        return d.profiles
          .filter((p) => p.role === 'parent' || p.role === 'student' || p.role === 'tutor')
          .map(
            (p): ViewTarget => ({
              profileId: p.id,
              role: p.role as ViewTarget['role'],
              fullName: p.fullName,
              email: p.email,
              familyId: p.familyId,
              studentId: p.studentId,
              tutorId: p.tutorId,
            }),
          )
          .sort((a, b) => a.fullName.localeCompare(b.fullName));
      }),
    async startViewAs(profileId) {
      const d = await load();
      const admin = me();
      requireAdmin(admin);
      const target = d.profiles.find((p) => p.id === profileId);
      if (!target) throw new Error('That account could not be found.');
      if (target.role === 'admin') throw new Error('You cannot view as another admin.');
      if (target.id === admin.id) throw new Error('You cannot view as yourself.');
      // As begin_view_as: only a parent, student or tutor can be viewed (not an accountant).
      if (target.role !== 'parent' && target.role !== 'student' && target.role !== 'tutor') throw new Error('This person cannot be viewed.');
      // The view shares this source's in-memory database and never writes the stored sign-in.
      const view = createDemoSource({ viewer: target, persist: false }, { load, save });
      const profile = await view.restoreSession();
      if (!profile) throw new Error('That account could not be found.');
      return {
        viewId: newId('view'),
        profile: structuredClone(profile),
        expiresAt: new Date(Date.now() + VIEW_MINUTES * 60_000).toISOString(),
        source: readOnlySource(view),
        end: async () => undefined,
      };
    },
    async signUp(email, _password, details) {
      const d = await load();
      const e = email.trim().toLowerCase();
      if (d.profiles.some((p) => p.email.toLowerCase() === e)) throw new Error('An account with that email already exists — sign in instead.');
      const familyId = newId('fam');
      const family: Family = {
        id: familyId,
        name: surnameOf(details.fullName),
        parentName: details.fullName.trim(),
        email: e,
        phone: details.phone,
        status: 'prospect',
        createdAt: new Date().toISOString(),
      };
      d.families.push(family);
      syncPrimaryFromFamily(d, family);
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
      ensureAuditSeed(db);
      await save();
    },

    // Tax: demo databases saved before the tax settings existed get their defaults.
    getSettings: () => read((d) => ({ ...d.settings, vatQuarterStartMonth: d.settings.vatQuarterStartMonth ?? 1, nextCreditNoteNumber: d.settings.nextCreditNoteNumber ?? 1 })),
    listTutors: () => read((d) => d.tutors),
    listFamilies: () => read((d, v) => pay.stripBilling(q.families(d, v), v)),
    listStudents: () => read((d, v) => q.students(d, v)),
    // services RLS: the family price reaches only admins, parents and the accountant (others read the catalogue).
    listServices: () =>
      read((d, v) => (['admin', 'parent', 'accountant'].includes(v.role) ? d.services : d.services.map((s) => ({ ...s, rate: 0 })))),
    listLessons: ({ from, to }) => read((d, v) => q.lessons(d, v, from, to)),
    getLesson: (id) => read((d, v) => q.lessons(d, v, '0000', '9999').find((l) => l.id === id) ?? null),
    listNotes: (filter) => read((d, v) => q.notes(d, v, filter)),
    listHomework: (filter) => read((d, v) => q.homework(d, v, filter?.studentId, filter?.lessonId)),
    listRatings: (filter) => read((d, v) => q.ratings(d, v, filter?.studentId)),
    listPackages: (filter) => read((d, v) => q.packages(d, v, filter?.familyId)),
    listCharges: (filter) => read((d, v) => q.charges(d, v, filter?.familyId)),
    listInvoices: (filter) => read((d, v) => q.invoices(d, v, filter?.familyId)),
    getInvoice: (id) => read((d, v) => q.invoices(d, v).find((i) => i.id === id) ?? null),

    saveSettings: (patch) => write((d, v) => cmd.saveSettings(d, v, patch)),
    saveTutor: (t) => write((d, v) => cmd.saveTutor(d, v, t)),
    saveFamily: (f) =>
      write((d, v) => {
        // Card and autopay live in family_billing in production; editing a family's details never changes them.
        const existing = f.id ? d.families.find((x) => x.id === f.id) : undefined;
        const { autopay: _autopay, savedCard: _card, trn, billingAddress, billingName, ...details } = f;
        // Tax: billing name, TRN and billing address (family_billing) change only when given; a blank clears them.
        const taxDetails = {
          trn: trn === undefined ? existing?.trn : normaliseTrn(trn) || undefined,
          billingAddress: billingAddress === undefined ? existing?.billingAddress : billingAddress.trim() || undefined,
          billingName: billingName === undefined ? existing?.billingName : billingName.trim() || undefined,
        };
        if (taxDetails.trn && !isValidTrn(taxDetails.trn)) throw new Error('A Tax Registration Number has 15 digits. Please check it, or leave it blank.');
        return cmd.saveFamily(d, v, existing ? { ...details, ...taxDetails, autopay: existing.autopay, savedCard: existing.savedCard } : { ...details, ...taxDetails });
      }),
    saveStudent: (s) => write((d, v) => cmd.saveStudent(d, v, s)),
    saveService: (s) => write((d, v) => cmd.saveService(d, v, s)),

    listEnrolments: (filter) => read((d, v) => enr.enrolments(d, v, filter?.studentId)),
    saveEnrolment: (e) =>
      write((d, v) => {
        // Session plans and handover packs: a new tutor for the subject gets a handover. Copied, as saving edits in place.
        const found = e.id ? d.enrolments.find((x) => x.id === e.id) : undefined;
        const before = found ? { ...found } : undefined;
        const saved = enr.saveEnrolment(d, v, e);
        ho.afterEnrolmentSaved(d, before, saved);
        return saved;
      }),
    setEnrolmentRates: (input) => write((d, v) => enr.setEnrolmentRates(d, v, input)),
    listTopicLists: () => read((d) => enr.topicLists(d)),
    listTopics: (filter) => read((d) => enr.topics(d, filter?.listId)),
    addTopic: (input) => write((d, v) => enr.addTopic(d, v, input)),

    createLessons: (lessons) => write((d, v) => cmd.createLessons(d, v, lessons)),
    rescheduleLesson: (id, start, end) => write((d, v) => cmd.rescheduleLesson(d, v, id, start, end)),
    cancelLesson: (id, reason, waive) => write((d, v) => cmd.cancelLesson(d, v, id, reason, waive)),
    completeLesson: (input) => write((d, v) => cmd.completeLesson(d, v, cw.checkLessonHomework(input))),
    setHomeworkDone: (id, done) => write((d, v) => cmd.setHomeworkDone(d, v, id, done)),

    getHomework: (id) => read((d, v) => cw.getHomework(d, v, id)),
    saveHomework: (input) => write((d, v) => cw.saveHomework(d, v, input)),
    listSubmissions: (filter) => read((d, v) => cw.submissions(d, v, filter)),
    submitHomework: (input) => write((d, v) => cw.submitHomework(d, v, input)),
    giveFeedback: (id, feedback, mark) => write((d, v) => cw.giveFeedback(d, v, id, feedback, mark)),
    listResources: (filter) => read((d, v) => cw.resources(d, v, filter)),
    saveResource: (input) => write((d, v) => cw.saveResource(d, v, input)),
    async deleteResource(id) {
      const path = await write((d, v) => cw.deleteResource(d, v, id));
      if (path) demoFiles.delete(path);
    },
    shareResource: (resourceId, studentId) => write((d, v) => cw.shareResource(d, v, resourceId, studentId)),
    unshareResource: (resourceId, studentId) => write((d, v) => cw.unshareResource(d, v, resourceId, studentId)),

    sellPackage: (pkg) =>
      write((d, v) => {
        const invoice = cmd.sellPackage(d, v, pkg);
        pay.autopayIfDue(d, invoice);
        return invoice;
      }),
    invoiceUnbilled: (familyId) => write((d, v) => pay.autopayIfDue(d, cmd.invoiceUnbilled(d, v, familyId))),
    setInvoiceStatus: (id, status) =>
      write((d, v) => {
        cmd.setInvoiceStatus(d, v, id, status);
        if (status === 'sent') pay.autopayIfDue(d, d.invoices.find((i) => i.id === id));
      }),
    recordPayment: (id, amount, method, ref) => write((d, v) => cmd.recordPayment(d, v, id, amount, method, ref)),
    addMyChild: async (child) => {
      await write((d, v) => eq.addMyChild(d, v, child));
    },
    setFamilyStatus: (id, status) => write((d, v) => eq.setFamilyStatus(d, v, id, status)),
    async submitEnquiry(e) {
      const d = await load();
      eq.submitEnquiry(d, viewer, e);
      await save();
    },
    listFamilyContacts: (familyId) => read((d, v) => listFamilyContacts(d, v, familyId)),
    saveFamilyContact: (familyId, contact) => write((d, v) => saveFamilyContact(d, v, familyId, contact)),
    removeFamilyContact: (id) => write((d, v) => removeFamilyContact(d, v, id)),
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
    reassignLesson: (lessonId, tutorId) =>
      write((d, v) => {
        // Session plans and handover packs: the new tutor gets a cover handover.
        const oldTutorId = d.lessons.find((l) => l.id === lessonId)?.tutorId;
        eq.reassignLesson(d, v, lessonId, tutorId);
        const lesson = d.lessons.find((l) => l.id === lessonId);
        if (lesson) ho.afterLessonReassigned(d, lesson, oldTutorId);
      }),
    listThreads: () => read((d, v) => eq.threads(d, v)),
    listMessages: (familyId) => read((d, v) => eq.messages(d, v, familyId)),
    sendMessage: (familyId, body) => write((d, v) => eq.sendMessage(d, v, familyId, body)),
    markThreadRead: (familyId) => write((d, v) => eq.markRead(d, v, familyId)),
    listAnnouncements: () => read((d, v) => eq.announcements(d, v)),
    postAnnouncement: (a) => write((d, v) => eq.postAnnouncement(d, v, a)),
    // Files aren't stored in the demo; keep the name so the flow can be tried. A file picked in this
    // session can be opened again from its local uri; seeded files have no content.
    uploadFile: async (_bucket, folder, file) => {
      const path = `${folder}/${newId('f')}-${file.name}`;
      demoFiles.set(path, file.uri);
      return path;
    },
    fileUrl: async (_bucket, path) => demoFiles.get(path) ?? null,
    removeFile: async (_bucket, path) => {
      demoFiles.delete(path);
    },
    listOpportunities: () => read((d, v) => ops.opportunities(d, v)),
    listBids: () => read((d, v) => ops.bids(d, v)),
    saveOpportunity: (o) => write((d, v) => ops.saveOpportunity(d, v, o)),
    placeBid: (id, pitch, availability) => write((d, v) => ops.placeBid(d, v, id, pitch, availability)),
    withdrawBid: (id) => write((d, v) => ops.withdrawBid(d, v, id)),
    awardOpportunity: (bidId) =>
      write((d, v) => {
        const previousTutorId = ho.tutorBeforeAward(d, bidId);
        ops.awardOpportunity(d, v, bidId);
        // Session plans and handover packs: the winning tutor gets a handover when the role is for a known student.
        const opportunityId = d.bids.find((b) => b.id === bidId)?.opportunityId;
        if (opportunityId) ho.afterAward(d, opportunityId, new Date(), previousTutorId);
      }),
    async submitTutorApplication(a) {
      const d = await load();
      ops.submitApplication(d, a);
      await save();
    },
    listApplications: () => read((d, v) => ops.applications(d, v)),
    updateApplication: (id, patch) => write((d, v) => ops.updateApplication(d, v, id, patch)),
    setSpamStatus: (kind, id, spam) => write((d, v) => eq.setSpamStatus(d, v, kind, id, spam)),
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
    startCardPayment: (invoiceId) =>
      // No real card processing in the demo: simulate a successful Stripe payment.
      write((d, v) => {
        const invoice = q.invoices(d, v).find((i) => i.id === invoiceId);
        // Only the family (or an admin) pays; accountants and others can read invoices but never pay them.
        if (!invoice || !(v.role === 'admin' || (v.role === 'parent' && v.familyId === invoice.familyId))) throw new Error('Invoice not found');
        return pay.payInvoiceByCard(d, invoice);
      }),

    // Google Calendar
    listBusyBlocks: (filter) => read((d, v) => cal.busyBlocks(d, v, filter)),
    getCalendarConnection: () => read((d, v) => cal.connection(d, v)),
    async connectGoogleCalendar() {
      await write((d, v) => cal.connect(d, v));
      return 'connected' as const;
    },
    disconnectGoogleCalendar: () => write((d, v) => cal.disconnect(d, v)),

    // Card payments: saved cards, autopay and top-ups (no openBillingPortal: there is no Stripe in the demo)
    listPackageOffers: () => read((d, v) => pay.offers(d, v)),
    savePackageOffer: (offer) => write((d, v) => pay.saveOffer(d, v, offer)),
    deletePackageOffer: (id) => write((d, v) => pay.deleteOffer(d, v, id)),
    setAutopay: (familyId, enabled) => write((d, v) => pay.setAutopay(d, v, familyId, enabled)),
    buyPackageOffer: (offerId) => write((d, v) => pay.buyOffer(d, v, offerId)),
    chargeSavedCard: (invoiceId) => write((d, v) => pay.chargeSavedCard(d, v, invoiceId)),

    // Audit trail (admins only)
    listAuditEvents: (filter, page) => read((d, v) => listAuditEventsDemo(d, v, filter, page)),
    listAuditActors: () => read((d, v) => listAuditActorsDemo(d, v)),

    // Tax: credit notes, refunds and accountant access
    listCreditNotes: (filter) => read((d, v) => tax.creditNotes(d, v, filter)),
    getCreditNote: (id) => read((d, v) => tax.creditNote(d, v, id)),
    issueCreditNote: (input) => write((d, v) => tax.issueCreditNote(d, v, input)),
    listRefunds: (filter) => read((d, v) => tax.refunds(d, v, filter)),
    refundPayment: (input) => write((d, v) => tax.refundPayment(d, v, input)),
    listAccountants: () => read((d, v) => tax.accountants(d, v)),
    inviteAccountant: (email, fullName) => write((d, v) => tax.inviteAccountant(d, v, email, fullName)),
    removeAccountant: (email) => write((d, v) => tax.removeAccountant(d, v, email)),
    // Admissions advisory
    listAdmissionsCases: (filter) => read((d, v) => adm.cases(d, v, filter)),
    getAdmissionsCase: (id) => read((d, v) => adm.getCase(d, v, id)),
    saveAdmissionsCase: (input) => write((d, v) => adm.saveCase(d, v, input)),
    listAdmissionsTargets: (filter) => read((d, v) => adm.targets(d, v, filter)),
    saveAdmissionsTarget: (input) => write((d, v) => adm.saveTarget(d, v, input)),
    deleteAdmissionsTarget: (id) => write((d, v) => adm.deleteTarget(d, v, id)),
    listAdmissionsKeyDates: (filter) => read((d, v) => adm.dates(d, v, filter)),
    saveAdmissionsKeyDate: (input) => write((d, v) => adm.saveKeyDate(d, v, input)),
    deleteAdmissionsKeyDate: (id) => write((d, v) => adm.deleteKeyDate(d, v, id)),
    listAdmissionsTasks: (filter) => read((d, v) => adm.tasks(d, v, filter)),
    saveAdmissionsTask: (input) => write((d, v) => adm.saveTask(d, v, input)),
    setAdmissionsTaskDone: (id, done) => write((d, v) => adm.setTaskDone(d, v, id, done)),
    deleteAdmissionsTask: (id) => write((d, v) => adm.deleteTask(d, v, id)),
    listAdmissionsDocuments: (filter) => read((d, v) => adm.documents(d, v, filter)),
    addAdmissionsDocument: (input) => write((d, v) => adm.addDocument(d, v, input)),
    async deleteAdmissionsDocument(id) {
      const path = await write((d, v) => adm.deleteDocument(d, v, id));
      if (path) demoFiles.delete(path);
    },
    listAdvisoryUpdates: (filter) => read((d, v) => adm.updates(d, v, filter)),
    saveAdvisoryUpdate: (input) => write((d, v) => adm.saveUpdate(d, v, input)),
    setAdvisoryUpdateStatus: (id, status) => write((d, v) => adm.setUpdateStatus(d, v, id, status)),
    deleteAdvisoryUpdate: (id) => write((d, v) => adm.deleteUpdate(d, v, id)),
    listAdmissionsEvents: (filter) => read((d, v) => adm.events(d, v, filter)),
    addAdmissionsMilestone: (caseId, title, detail) => write((d, v) => adm.addMilestone(d, v, caseId, title, detail)),
    billAdmissionsFee: (input) =>
      write((d, v) => {
        const invoice = adm.billFee(d, v, input);
        return pay.autopayIfDue(d, invoice) ?? invoice;
      }),
    // Tutor vetting and onboarding
    listTutorDocuments: (filter) => read((d, v) => vet.documents(d, v, filter)),
    submitTutorDocument: (input) => write((d, v) => vet.submitDocument(d, v, input)),
    reviewTutorDocument: (id, decision) => write((d, v) => vet.reviewDocument(d, v, id, decision)),
    async deleteTutorDocument(id) {
      const path = await write((d, v) => vet.deleteDocument(d, v, id));
      demoFiles.delete(path);
    },
    listTutorCompliance: () => read((d, v) => vet.compliance(d, v)),
    listVettingOverrides: (filter) => read((d, v) => vet.overrides(d, v, filter)),
    grantVettingOverride: async (tutorId, reason, days) => {
      await write((d, v) => vet.grantOverride(d, v, tutorId, reason, days));
    },
    revokeVettingOverride: (id) => write((d, v) => vet.revokeOverride(d, v, id)),
    getVettingEnforced: () => read((d) => vet.enforced(d)),
    setVettingEnforced: (on) => write((d, v) => vet.setEnforced(d, v, on)),
    listHandbookVersions: () => read((d, v) => vet.handbookVersions(d, v)),
    publishHandbook: (title, body) => write((d, v) => vet.publishHandbook(d, v, title, body)),
    listHandbookAcknowledgements: (filter) => read((d, v) => vet.handbookAcks(d, v, filter)),
    acknowledgeHandbook: (version) => write((d, v) => vet.acknowledgeHandbook(d, v, version)),

    // Launch readiness: error reporting, system health, data export and account deletion
    async logAppError(e) {
      try {
        const d = await load();
        launch.logAppError(d, viewer, e);
        await save();
        return true;
      } catch {
        return false;
      }
    },
    getSystemHealth: () => read((d, v) => launch.systemHealth(d, v)),
    listAppErrors: (limit) => read((d, v) => launch.appErrors(d, v, limit)),
    listFunctionErrors: (limit) => read((d, v) => launch.functionErrors(d, v, limit)),
    exportMyData: () => read((d, v) => launch.exportMyData(d, v)),
    async deleteMyAccount() {
      const summary = await writeOwn((d, v) => launch.deleteMyAccount(d, v));
      // The login no longer exists: forget the demo session, as production signs out locally.
      viewer = null;
      await AsyncStorage.removeItem(SESSION_KEY).catch(() => undefined);
      return summary;
    },
    listDeletionRequests: () => read((d, v) => launch.deletionRequests(d, v)),
    recordDeletionRequest: (target) => write((d, v) => launch.recordDeletionRequest(d, v, target)),
    cancelDeletionRequest: (id) => write((d, v) => launch.cancelDeletionRequest(d, v, id)),
    processDeletionRequest: (id) => write((d, v) => launch.processDeletionRequest(d, v, id)),

    // Session plans and handover packs
    getLessonPlan: (lessonId) => read((d, v) => ho.plan(d, v, lessonId)),
    listLessonPlans: (range) => read((d, v) => ho.plans(d, v, range)),
    saveLessonPlan: (input) => write((d, v) => ho.savePlan(d, v, input)),
    deleteLessonPlan: (lessonId) => write((d, v) => ho.deletePlan(d, v, lessonId)),
    listHandovers: (filter) => read((d, v) => ho.handovers(d, v, filter)),
    getHandoverSources: (id) => read((d, v) => ho.sources(d, v, id)),
    saveHandoverNote: (id, note) => write((d, v) => ho.saveNote(d, v, id, note)),
    markHandoverViewed: (id) => write((d, v) => ho.markViewed(d, v, id)),
  };
}
