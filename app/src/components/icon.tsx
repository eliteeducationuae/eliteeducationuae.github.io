import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

type SymbolName = ComponentProps<typeof SymbolView>['name'];

/** One icon set for the whole app: SF Symbols on iOS, Material Symbols on Android and web. */
const ICONS = {
  home: { ios: 'house.fill', android: 'home', web: 'home' },
  calendar: { ios: 'calendar', android: 'calendar_month', web: 'calendar_month' },
  people: { ios: 'person.2.fill', android: 'group', web: 'group' },
  person: { ios: 'person.crop.circle.fill', android: 'account_circle', web: 'account_circle' },
  card: { ios: 'creditcard.fill', android: 'credit_card', web: 'credit_card' },
  more: { ios: 'ellipsis.circle.fill', android: 'more_horiz', web: 'more_horiz' },
  check: { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' },
  circle: { ios: 'circle', android: 'radio_button_unchecked', web: 'radio_button_unchecked' },
  clock: { ios: 'clock.fill', android: 'schedule', web: 'schedule' },
  chart: { ios: 'chart.bar.fill', android: 'bar_chart', web: 'bar_chart' },
  book: { ios: 'book.fill', android: 'menu_book', web: 'menu_book' },
  plus: { ios: 'plus', android: 'add', web: 'add' },
  chevron: { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
  back: { ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' },
  forward: { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
  close: { ios: 'xmark', android: 'close', web: 'close' },
  video: { ios: 'video.fill', android: 'videocam', web: 'videocam' },
  pin: { ios: 'mappin.and.ellipse', android: 'location_on', web: 'location_on' },
  alert: { ios: 'exclamationmark.triangle.fill', android: 'warning', web: 'warning' },
  settings: { ios: 'gearshape.fill', android: 'settings', web: 'settings' },
  logout: { ios: 'rectangle.portrait.and.arrow.right', android: 'logout', web: 'logout' },
  money: { ios: 'banknote.fill', android: 'payments', web: 'payments' },
  school: { ios: 'graduationcap.fill', android: 'school', web: 'school' },
  doc: { ios: 'doc.text.fill', android: 'description', web: 'description' },
  share: { ios: 'square.and.arrow.up', android: 'share', web: 'share' },
  trend: { ios: 'chart.line.uptrend.xyaxis', android: 'trending_up', web: 'trending_up' },
  sparkle: { ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' },
  tag: { ios: 'tag.fill', android: 'sell', web: 'sell' },
  repeat: { ios: 'repeat', android: 'repeat', web: 'repeat' },
  chat: { ios: 'bubble.left.and.bubble.right.fill', android: 'forum', web: 'forum' },
  megaphone: { ios: 'megaphone.fill', android: 'campaign', web: 'campaign' },
  inbox: { ios: 'tray.full.fill', android: 'inbox', web: 'inbox' },
  sun: { ios: 'sun.max.fill', android: 'beach_access', web: 'beach_access' },
  phone: { ios: 'phone.fill', android: 'call', web: 'call' },
  mail: { ios: 'envelope.fill', android: 'mail', web: 'mail' },
  drag: { ios: 'arrow.up.and.down', android: 'drag_indicator', web: 'drag_indicator' },
  search: { ios: 'magnifyingglass', android: 'search', web: 'search' },
  attach: { ios: 'paperclip', android: 'attach_file', web: 'attach_file' },
  photo: { ios: 'photo', android: 'image', web: 'image' },
  camera: { ios: 'camera.fill', android: 'photo_camera', web: 'photo_camera' },
  link: { ios: 'link', android: 'link', web: 'link' },
  folder: { ios: 'folder.fill', android: 'folder', web: 'folder' },
  eye: { ios: 'eye', android: 'visibility', web: 'visibility' },
  info: { ios: 'info.circle', android: 'info', web: 'info' },
} satisfies Record<string, SymbolName>;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 20,
  color,
  style,
}: {
  name: IconName;
  size?: number;
  color: string;
  style?: StyleProp<ViewStyle>;
}) {
  return <SymbolView name={ICONS[name]} size={size} tintColor={color} style={style} />;
}
