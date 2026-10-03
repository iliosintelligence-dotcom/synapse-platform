/**
 * Icon — SF Symbols-style line icons. One stroke weight, rounded geometry,
 * native Apple proportions. Drawn inline; no third-party icon set.
 */
import React from 'react';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { color, iconSize, iconStroke, IconSize } from './tokens';

export type IconName =
  | 'house' | 'building' | 'pin' | 'map' | 'heart' | 'heart.fill' | 'bookmark'
  | 'calendar' | 'message' | 'phone' | 'camera' | 'car' | 'clock' | 'sparkles'
  | 'person' | 'people' | 'briefcase' | 'chart' | 'wallet' | 'card' | 'sliders'
  | 'search' | 'shield' | 'check.circle' | 'bell' | 'radar' | 'check' | 'plus'
  | 'chevron.left' | 'chevron.right' | 'chevron.down' | 'arrow.up' | 'xmark' | 'mic';

type Props = {
  name: IconName;
  size?: IconSize | number;
  color?: string;
  /** stroke weight override; defaults to token */
  weight?: number;
  filled?: boolean;
};

/** All paths drawn on a 24x24 grid */
const PATHS: Record<IconName, React.ReactNode | ((c: string, w: number, filled?: boolean) => React.ReactNode)> = {
  house: (c, w) => (
    <Path d="M3.5 10.5 12 3.5l8.5 7M5.5 9v10a1 1 0 0 0 1 1h3.5v-5.5a2 2 0 0 1 4 0V20h3.5a1 1 0 0 0 1-1V9" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" />
  ),
  building: (c, w) => (
    <>
      <Rect x="5" y="3.5" width="10" height="17" rx="1.2" stroke={c} strokeWidth={w} fill="none" />
      <Path d="M15 9.5h3a1 1 0 0 1 1 1v10M8.5 7.5h3M8.5 11h3M8.5 14.5h3M8.5 18h3" stroke={c} strokeWidth={w} strokeLinecap="round" fill="none" />
    </>
  ),
  pin: (c, w) => (
    <>
      <Path d="M12 21s-6.5-5.6-6.5-10.4A6.5 6.5 0 0 1 12 4a6.5 6.5 0 0 1 6.5 6.6C18.5 15.4 12 21 12 21Z" stroke={c} strokeWidth={w} strokeLinejoin="round" fill="none" />
      <Circle cx="12" cy="10.5" r="2.2" stroke={c} strokeWidth={w} fill="none" />
    </>
  ),
  map: (c, w) => (
    <Path d="M9 4.5 4.4 6.2a1 1 0 0 0-.65.94V19l5.25-2 6 2 4.6-1.7a1 1 0 0 0 .65-.94V5l-5.25 2-6-2.5ZM9 4.5V17M15 7v12" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" />
  ),
  heart: (c, w) => (
    <Path d="M12 19.5s-7.5-4.6-7.5-9.7C4.5 7 6.7 5 9.2 5c1.2 0 2.2.6 2.8 1.5C12.6 5.6 13.6 5 14.8 5c2.5 0 4.7 2 4.7 4.8 0 5.1-7.5 9.7-7.5 9.7Z" stroke={c} strokeWidth={w} strokeLinejoin="round" fill="none" />
  ),
  'heart.fill': (c) => (
    <Path d="M12 19.5s-7.5-4.6-7.5-9.7C4.5 7 6.7 5 9.2 5c1.2 0 2.2.6 2.8 1.5C12.6 5.6 13.6 5 14.8 5c2.5 0 4.7 2 4.7 4.8 0 5.1-7.5 9.7-7.5 9.7Z" fill={c} />
  ),
  bookmark: (c, w) => (
    <Path d="M7 4.5h10a.8.8 0 0 1 .8.8V20l-5.8-3.4L6.2 20V5.3a.8.8 0 0 1 .8-.8Z" stroke={c} strokeWidth={w} strokeLinejoin="round" fill="none" />
  ),
  calendar: (c, w) => (
    <>
      <Rect x="4" y="5.5" width="16" height="14.5" rx="2" stroke={c} strokeWidth={w} fill="none" />
      <Path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" stroke={c} strokeWidth={w} strokeLinecap="round" fill="none" />
    </>
  ),
  message: (c, w) => (
    <Path d="M12 4.5c4.7 0 8.5 3.2 8.5 7.2s-3.8 7.2-8.5 7.2c-1 0-1.9-.13-2.8-.38L5 20l1.2-3.4c-1.7-1.3-2.7-3-2.7-4.9 0-4 3.8-7.2 8.5-7.2Z" stroke={c} strokeWidth={w} strokeLinejoin="round" fill="none" />
  ),
  phone: (c, w) => (
    <Path d="M7.2 4.5c.5 0 1 .3 1.2.8l1.1 2.5c.2.5.1 1.1-.3 1.5L8 10.5a12.4 12.4 0 0 0 5.5 5.5l1.2-1.2c.4-.4 1-.5 1.5-.3l2.5 1.1c.5.2.8.7.8 1.2v2c0 .8-.7 1.5-1.5 1.4C10.7 19.6 4.4 13.3 3.8 6c-.07-.8.6-1.5 1.4-1.5h2Z" stroke={c} strokeWidth={w} strokeLinejoin="round" fill="none" />
  ),
  camera: (c, w) => (
    <>
      <Path d="M4 8.5a1.5 1.5 0 0 1 1.5-1.5h2L9.4 5h5.2l1.9 2h2A1.5 1.5 0 0 1 20 8.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18V8.5Z" stroke={c} strokeWidth={w} strokeLinejoin="round" fill="none" />
      <Circle cx="12" cy="13" r="3.2" stroke={c} strokeWidth={w} fill="none" />
    </>
  ),
  car: (c, w) => (
    <>
      <Path d="M5 13 6.3 8.2A2 2 0 0 1 8.2 6.8h7.6a2 2 0 0 1 1.9 1.4L19 13M5 13h14M5 13a1.5 1.5 0 0 0-1.5 1.5v3h2.7M19 13a1.5 1.5 0 0 1 1.5 1.5v3h-2.7M6.2 17.5h11.6M6.2 17.5V19M17.8 17.5V19" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Circle cx="7.8" cy="15.2" r="0.5" fill={c} />
      <Circle cx="16.2" cy="15.2" r="0.5" fill={c} />
    </>
  ),
  clock: (c, w) => (
    <>
      <Circle cx="12" cy="12" r="8" stroke={c} strokeWidth={w} fill="none" />
      <Path d="M12 7.5V12l3 2" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
  sparkles: (c, w) => (
    <Path d="M12 4.5 13.6 9 18 10.5 13.6 12 12 16.5 10.4 12 6 10.5 10.4 9 12 4.5ZM18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z" stroke={c} strokeWidth={w} strokeLinejoin="round" fill="none" />
  ),
  person: (c, w) => (
    <>
      <Circle cx="12" cy="8.2" r="3.4" stroke={c} strokeWidth={w} fill="none" />
      <Path d="M5.2 19.5c.8-3.2 3.6-5 6.8-5s6 1.8 6.8 5" stroke={c} strokeWidth={w} strokeLinecap="round" fill="none" />
    </>
  ),
  people: (c, w) => (
    <>
      <Circle cx="9.2" cy="8.8" r="3" stroke={c} strokeWidth={w} fill="none" />
      <Path d="M3.5 19c.7-2.8 3-4.4 5.7-4.4s5 1.6 5.7 4.4M15.5 6.3a3 3 0 0 1 0 5.1M17.8 14.9c1.5.6 2.6 1.9 3 3.6" stroke={c} strokeWidth={w} strokeLinecap="round" fill="none" />
    </>
  ),
  briefcase: (c, w) => (
    <>
      <Rect x="4" y="7.5" width="16" height="12" rx="2" stroke={c} strokeWidth={w} fill="none" />
      <Path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M4 12.5h16" stroke={c} strokeWidth={w} strokeLinecap="round" fill="none" />
    </>
  ),
  chart: (c, w) => (
    <Path d="M4.5 19.5h15M6.5 19.5v-6M11 19.5V9M15.5 19.5v-8M20 19.5V5.5" stroke={c} strokeWidth={w} strokeLinecap="round" fill="none" />
  ),
  wallet: (c, w) => (
    <>
      <Path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h10A2.5 2.5 0 0 1 19 7.3M4 7.5V17a2.5 2.5 0 0 0 2.5 2.5h11A2.5 2.5 0 0 0 20 17v-6a2.5 2.5 0 0 0-2.5-2.5h-11A2.5 2.5 0 0 1 4 7.5Z" stroke={c} strokeWidth={w} strokeLinejoin="round" fill="none" />
      <Circle cx="16" cy="13.8" r="1.1" fill={c} />
    </>
  ),
  card: (c, w) => (
    <>
      <Rect x="3.5" y="6" width="17" height="12.5" rx="2" stroke={c} strokeWidth={w} fill="none" />
      <Path d="M3.5 10h17M7 15h4" stroke={c} strokeWidth={w} strokeLinecap="round" fill="none" />
    </>
  ),
  sliders: (c, w) => (
    <>
      <Path d="M5 8h4.5M13.5 8H19M5 16h7.5M16.5 16H19" stroke={c} strokeWidth={w} strokeLinecap="round" fill="none" />
      <Circle cx="11.5" cy="8" r="2" stroke={c} strokeWidth={w} fill="none" />
      <Circle cx="14.5" cy="16" r="2" stroke={c} strokeWidth={w} fill="none" />
    </>
  ),
  search: (c, w) => (
    <>
      <Circle cx="10.8" cy="10.8" r="6.3" stroke={c} strokeWidth={w} fill="none" />
      <Path d="m15.5 15.5 4.5 4.5" stroke={c} strokeWidth={w} strokeLinecap="round" fill="none" />
    </>
  ),
  shield: (c, w) => (
    <Path d="M12 3.8 5.5 6.2v5.2c0 4.2 2.8 7.4 6.5 8.8 3.7-1.4 6.5-4.6 6.5-8.8V6.2L12 3.8Z" stroke={c} strokeWidth={w} strokeLinejoin="round" fill="none" />
  ),
  'check.circle': (c, w) => (
    <>
      <Circle cx="12" cy="12" r="8.2" stroke={c} strokeWidth={w} fill="none" />
      <Path d="m8.4 12.2 2.4 2.4 4.8-5" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
  bell: (c, w) => (
    <Path d="M12 4a5.5 5.5 0 0 1 5.5 5.5c0 4 1.2 5.4 2 6.2H4.5c.8-.8 2-2.2 2-6.2A5.5 5.5 0 0 1 12 4ZM10 18.8a2 2 0 0 0 4 0" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" />
  ),
  radar: (c, w) => (
    <>
      <Circle cx="12" cy="12" r="2" stroke={c} strokeWidth={w} fill="none" />
      <Path d="M12 6.2a5.8 5.8 0 0 1 5.8 5.8M12 2.8A9.2 9.2 0 0 1 21.2 12" stroke={c} strokeWidth={w} strokeLinecap="round" fill="none" />
      <Path d="M8 16 4.8 19.2" stroke={c} strokeWidth={w} strokeLinecap="round" fill="none" />
    </>
  ),
  check: (c, w) => (
    <Path d="m5.5 12.5 4 4 9-9.5" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" />
  ),
  plus: (c, w) => (
    <Path d="M12 5.5v13M5.5 12h13" stroke={c} strokeWidth={w} strokeLinecap="round" fill="none" />
  ),
  'chevron.left': (c, w) => (
    <Path d="M14.5 5.5 8 12l6.5 6.5" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" />
  ),
  'chevron.right': (c, w) => (
    <Path d="M9.5 5.5 16 12l-6.5 6.5" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" />
  ),
  'chevron.down': (c, w) => (
    <Path d="M5.5 9.5 12 16l6.5-6.5" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" />
  ),
  'arrow.up': (c, w) => (
    <Path d="M12 19V5.5M6 11.5 12 5.5l6 6" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" />
  ),
  xmark: (c, w) => (
    <Path d="m6 6 12 12M18 6 6 18" stroke={c} strokeWidth={w} strokeLinecap="round" fill="none" />
  ),
  mic: (c, w) => (
    <>
      <Rect x="9.2" y="3.5" width="5.6" height="10" rx="2.8" stroke={c} strokeWidth={w} fill="none" />
      <Path d="M5.8 11.5a6.2 6.2 0 0 0 12.4 0M12 17.7v2.8" stroke={c} strokeWidth={w} strokeLinecap="round" fill="none" />
    </>
  ),
};

export default function Icon({ name, size = 'md', color: iconColor = color.ink, weight = iconStroke }: Props) {
  const px = typeof size === 'number' ? size : iconSize[size];
  const render = PATHS[name];
  return (
    <Svg width={px} height={px} viewBox="0 0 24 24">
      {typeof render === 'function' ? render(iconColor, weight) : render}
    </Svg>
  );
}
