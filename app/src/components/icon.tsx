import { SymbolView, type SymbolWeight } from 'expo-symbols';
import light from 'expo-symbols/androidWeights/light';
import medium from 'expo-symbols/androidWeights/medium';
import regular from 'expo-symbols/androidWeights/regular';
import semiBold from 'expo-symbols/androidWeights/semiBold';
import type { ComponentProps } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

type SymbolName = ComponentProps<typeof SymbolView>['name'];

/**
 * One icon set for the whole app: SF Symbols on iOS, Material Symbols (Outlined) on Android and web.
 * The first group keeps the original app's names; the second adds every Material Symbol the 2026 redesign
 * prototypes use, under its Material name (so `receipt_long` in a prototype is `receipt_long` here).
 */
const ICONS = {
  // ---- Original names (kept for existing screens) ----
  home: { ios: 'house', android: 'home', web: 'home' },
  calendar: { ios: 'calendar', android: 'calendar_month', web: 'calendar_month' },
  people: { ios: 'person.2', android: 'group', web: 'group' },
  person: { ios: 'person', android: 'person', web: 'person' },
  card: { ios: 'creditcard', android: 'credit_card', web: 'credit_card' },
  more: { ios: 'ellipsis.circle', android: 'more_horiz', web: 'more_horiz' },
  check: { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' },
  circle: { ios: 'circle', android: 'radio_button_unchecked', web: 'radio_button_unchecked' },
  clock: { ios: 'clock', android: 'schedule', web: 'schedule' },
  chart: { ios: 'chart.bar', android: 'bar_chart', web: 'bar_chart' },
  book: { ios: 'book', android: 'menu_book', web: 'menu_book' },
  plus: { ios: 'plus', android: 'add', web: 'add' },
  chevron: { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
  back: { ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' },
  forward: { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
  close: { ios: 'xmark', android: 'close', web: 'close' },
  video: { ios: 'video', android: 'videocam', web: 'videocam' },
  pin: { ios: 'mappin.and.ellipse', android: 'location_on', web: 'location_on' },
  alert: { ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' },
  settings: { ios: 'gearshape', android: 'settings', web: 'settings' },
  logout: { ios: 'rectangle.portrait.and.arrow.right', android: 'logout', web: 'logout' },
  money: { ios: 'banknote', android: 'payments', web: 'payments' },
  school: { ios: 'graduationcap', android: 'school', web: 'school' },
  doc: { ios: 'doc.text', android: 'description', web: 'description' },
  share: { ios: 'square.and.arrow.up', android: 'share', web: 'share' },
  trend: { ios: 'chart.line.uptrend.xyaxis', android: 'trending_up', web: 'trending_up' },
  sparkle: { ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' },
  tag: { ios: 'tag', android: 'sell', web: 'sell' },
  repeat: { ios: 'repeat', android: 'repeat', web: 'repeat' },
  chat: { ios: 'bubble.left.and.bubble.right', android: 'forum', web: 'forum' },
  megaphone: { ios: 'megaphone', android: 'campaign', web: 'campaign' },
  inbox: { ios: 'tray.full', android: 'inbox', web: 'inbox' },
  sun: { ios: 'sun.max', android: 'beach_access', web: 'beach_access' },
  phone: { ios: 'phone', android: 'call', web: 'call' },
  mail: { ios: 'envelope', android: 'mail', web: 'mail' },
  drag: { ios: 'arrow.up.and.down', android: 'drag_indicator', web: 'drag_indicator' },
  search: { ios: 'magnifyingglass', android: 'search', web: 'search' },
  attach: { ios: 'paperclip', android: 'attach_file', web: 'attach_file' },
  photo: { ios: 'photo', android: 'image', web: 'image' },
  camera: { ios: 'camera', android: 'photo_camera', web: 'photo_camera' },
  link: { ios: 'link', android: 'link', web: 'link' },
  folder: { ios: 'folder', android: 'folder', web: 'folder' },
  eye: { ios: 'eye', android: 'visibility', web: 'visibility' },
  info: { ios: 'info.circle', android: 'info', web: 'info' },

  // ---- Redesign (Material Symbols names from the prototypes) ----
  account_balance: { ios: 'building.columns', android: 'account_balance', web: 'account_balance' },
  account_balance_wallet: { ios: 'wallet.pass', android: 'account_balance_wallet', web: 'account_balance_wallet' },
  add: { ios: 'plus', android: 'add', web: 'add' },
  apartment: { ios: 'building.2', android: 'apartment', web: 'apartment' },
  apps: { ios: 'square.grid.2x2', android: 'apps', web: 'apps' },
  arrow_back: { ios: 'arrow.left', android: 'arrow_back', web: 'arrow_back' },
  arrow_forward: { ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' },
  arrow_upward: { ios: 'arrow.up', android: 'arrow_upward', web: 'arrow_upward' },
  assignment: { ios: 'list.clipboard', android: 'assignment', web: 'assignment' },
  assignment_return: { ios: 'arrow.uturn.backward.square', android: 'assignment_return', web: 'assignment_return' },
  attach_file: { ios: 'paperclip', android: 'attach_file', web: 'attach_file' },
  auto_awesome: { ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' },
  autorenew: { ios: 'arrow.triangle.2.circlepath', android: 'autorenew', web: 'autorenew' },
  badge: { ios: 'person.text.rectangle', android: 'badge', web: 'badge' },
  bar_chart: { ios: 'chart.bar', android: 'bar_chart', web: 'bar_chart' },
  beach_access: { ios: 'beach.umbrella', android: 'beach_access', web: 'beach_access' },
  block: { ios: 'nosign', android: 'block', web: 'block' },
  book_outline: { ios: 'book.closed', android: 'book', web: 'book' },
  calendar_month: { ios: 'calendar', android: 'calendar_month', web: 'calendar_month' },
  call: { ios: 'phone', android: 'call', web: 'call' },
  campaign: { ios: 'megaphone', android: 'campaign', web: 'campaign' },
  chat_bubble: { ios: 'bubble.left', android: 'chat', web: 'chat' },
  checkmark: { ios: 'checkmark', android: 'check', web: 'check' },
  check_circle: { ios: 'checkmark.circle', android: 'check_circle', web: 'check_circle' },
  chevron_right: { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
  contact_mail: { ios: 'person.crop.rectangle', android: 'contact_mail', web: 'contact_mail' },
  credit_card: { ios: 'creditcard', android: 'credit_card', web: 'credit_card' },
  currency_exchange: { ios: 'arrow.left.arrow.right.circle', android: 'currency_exchange', web: 'currency_exchange' },
  dashboard: { ios: 'rectangle.3.group', android: 'dashboard', web: 'dashboard' },
  delete: { ios: 'trash', android: 'delete', web: 'delete' },
  description: { ios: 'doc.text', android: 'description', web: 'description' },
  download: { ios: 'arrow.down.to.line', android: 'download', web: 'download' },
  edit: { ios: 'pencil', android: 'edit', web: 'edit' },
  edit_note: { ios: 'square.and.pencil', android: 'edit_note', web: 'edit_note' },
  event: { ios: 'calendar.circle', android: 'event', web: 'event' },
  event_available: { ios: 'calendar.badge.checkmark', android: 'event_available', web: 'event_available' },
  event_busy: { ios: 'calendar.badge.exclamationmark', android: 'event_busy', web: 'event_busy' },
  event_repeat: { ios: 'calendar.badge.clock', android: 'event_repeat', web: 'event_repeat' },
  expand_less: { ios: 'chevron.up', android: 'expand_less', web: 'expand_less' },
  expand_more: { ios: 'chevron.down', android: 'expand_more', web: 'expand_more' },
  family_restroom: { ios: 'figure.2.and.child.holdinghands', android: 'family_restroom', web: 'family_restroom' },
  favorite: { ios: 'heart', android: 'favorite', web: 'favorite' },
  flag: { ios: 'flag', android: 'flag', web: 'flag' },
  folder_zip: { ios: 'doc.zipper', android: 'folder_zip', web: 'folder_zip' },
  forum: { ios: 'bubble.left.and.bubble.right', android: 'forum', web: 'forum' },
  gavel: { ios: 'hammer', android: 'gavel', web: 'gavel' },
  group: { ios: 'person.2', android: 'group', web: 'group' },
  group_add: { ios: 'person.badge.plus', android: 'group_add', web: 'group_add' },
  groups: { ios: 'person.3', android: 'groups', web: 'groups' },
  handshake: { ios: 'hands.sparkles', android: 'handshake', web: 'handshake' },
  help: { ios: 'questionmark.circle', android: 'help', web: 'help' },
  history: { ios: 'clock.arrow.circlepath', android: 'history', web: 'history' },
  hourglass_top: { ios: 'hourglass', android: 'hourglass_top', web: 'hourglass_top' },
  import_contacts: { ios: 'book', android: 'import_contacts', web: 'import_contacts' },
  insights: { ios: 'chart.xyaxis.line', android: 'insights', web: 'insights' },
  inventory_2: { ios: 'archivebox', android: 'inventory_2', web: 'inventory_2' },
  key: { ios: 'key', android: 'key', web: 'key' },
  library_books: { ios: 'books.vertical', android: 'library_books', web: 'library_books' },
  location_on: { ios: 'mappin.and.ellipse', android: 'location_on', web: 'location_on' },
  lock: { ios: 'lock', android: 'lock', web: 'lock' },
  login: { ios: 'arrow.right.circle', android: 'login', web: 'login' },
  map: { ios: 'map', android: 'map', web: 'map' },
  mark_email_read: { ios: 'envelope.open', android: 'mark_email_read', web: 'mark_email_read' },
  menu_book: { ios: 'book', android: 'menu_book', web: 'menu_book' },
  monitor_heart: { ios: 'waveform.path.ecg', android: 'monitor_heart', web: 'monitor_heart' },
  monitoring: { ios: 'chart.line.uptrend.xyaxis', android: 'monitoring', web: 'monitoring' },
  notes: { ios: 'note.text', android: 'notes', web: 'notes' },
  notifications: { ios: 'bell', android: 'notifications', web: 'notifications' },
  number: { ios: 'number', android: 'tag', web: 'tag' },
  paid: { ios: 'banknote', android: 'paid', web: 'paid' },
  payments: { ios: 'banknote', android: 'payments', web: 'payments' },
  pending: { ios: 'ellipsis.circle', android: 'pending', web: 'pending' },
  person_add: { ios: 'person.badge.plus', android: 'person_add', web: 'person_add' },
  person_remove: { ios: 'person.badge.minus', android: 'person_remove', web: 'person_remove' },
  phone_iphone: { ios: 'iphone', android: 'phone_iphone', web: 'phone_iphone' },
  picture_as_pdf: { ios: 'doc.richtext', android: 'picture_as_pdf', web: 'picture_as_pdf' },
  quiz: { ios: 'questionmark.square', android: 'quiz', web: 'quiz' },
  radio_button_checked: { ios: 'smallcircle.filled.circle', android: 'radio_button_checked', web: 'radio_button_checked' },
  radio_button_unchecked: { ios: 'circle', android: 'radio_button_unchecked', web: 'radio_button_unchecked' },
  receipt: { ios: 'doc.plaintext', android: 'receipt', web: 'receipt' },
  receipt_long: { ios: 'list.bullet.rectangle.portrait', android: 'receipt_long', web: 'receipt_long' },
  redeem: { ios: 'gift', android: 'redeem', web: 'redeem' },
  refresh: { ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' },
  report: { ios: 'exclamationmark.octagon', android: 'report', web: 'report' },
  save: { ios: 'square.and.arrow.down', android: 'save', web: 'save' },
  schedule: { ios: 'clock', android: 'schedule', web: 'schedule' },
  sell: { ios: 'tag', android: 'sell', web: 'sell' },
  send: { ios: 'paperplane', android: 'send', web: 'send' },
  swap_horiz: { ios: 'arrow.left.arrow.right', android: 'swap_horiz', web: 'swap_horiz' },
  target: { ios: 'target', android: 'target', web: 'target' },
  task_alt: { ios: 'checkmark.circle', android: 'task_alt', web: 'task_alt' },
  travel_explore: { ios: 'globe', android: 'travel_explore', web: 'travel_explore' },
  trending_up: { ios: 'chart.line.uptrend.xyaxis', android: 'trending_up', web: 'trending_up' },
  undo: { ios: 'arrow.uturn.backward', android: 'undo', web: 'undo' },
  upload: { ios: 'square.and.arrow.up', android: 'upload', web: 'upload' },
  verified_user: { ios: 'checkmark.shield', android: 'verified_user', web: 'verified_user' },
  videocam: { ios: 'video', android: 'videocam', web: 'videocam' },
  visibility: { ios: 'eye', android: 'visibility', web: 'visibility' },
  wb_sunny: { ios: 'sun.max', android: 'wb_sunny', web: 'wb_sunny' },
} satisfies Record<string, SymbolName>;

export type IconName = keyof typeof ICONS;

/** Every icon name, for the kit page. */
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

/** Icon stroke weight: 300 (light) by default, 500 for the active tab; 400 and 600 when a design asks. */
export type IconWeight = 300 | 400 | 500 | 600;

const WEIGHTS: Record<IconWeight, { ios: SymbolWeight; android: { name: string; font: number } }> = {
  300: { ios: 'light', android: light },
  400: { ios: 'regular', android: regular },
  500: { ios: 'medium', android: medium },
  600: { ios: 'semibold', android: semiBold },
};

export function Icon({
  name,
  size = 20,
  color,
  weight = 300,
  style,
}: {
  name: IconName;
  size?: number;
  color: string;
  /** Stroke weight (Material Symbols weight on Android and web, SF Symbol weight on iOS). */
  weight?: IconWeight;
  style?: StyleProp<ViewStyle>;
}) {
  // Keyed by weight: expo-symbols loads the weight's font once per mounted view, so a weight change remounts it.
  return <SymbolView key={weight} name={ICONS[name]} size={size} tintColor={color} weight={WEIGHTS[weight]} style={style} accessible={false} />;
}
