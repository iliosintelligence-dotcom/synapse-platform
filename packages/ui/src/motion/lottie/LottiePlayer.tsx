/**
 * LottiePlayer — the only way Lottie animations enter the app.
 * Never import LottieView directly in a screen or feature component.
 *
 * Performance rules (see motion-system doc):
 *  - never mount more than two Lottie animations on one screen
 *  - unmount when the screen loses focus (useIsFocused)
 *  - never put a Lottie on a repeated list item
 */
import React, { useRef, forwardRef, useImperativeHandle } from 'react';
import LottieView from 'lottie-react-native';
import { StyleProp, ViewStyle } from 'react-native';
import { MotionTokens } from '../tokens';

export type LottieAnimationName =
  | 'toju-typing'
  | 'toju-thinking'
  | 'toju-success'
  | 'orb-pulse'
  | 'verified-badge'
  | 'empty-saved'
  | 'empty-leads'
  | 'empty-listings'
  | 'empty-search'
  | 'empty-chat'
  | 'proximity-ripple'
  | 'lead-arrived'
  | 'upload-success'
  | 'property-verified';

const ANIMATION_MAP: Record<LottieAnimationName, unknown> = {
  'toju-typing': require('./animations/toju-typing.json'),
  'toju-thinking': require('./animations/toju-thinking.json'),
  'toju-success': require('./animations/toju-success.json'),
  'orb-pulse': require('./animations/orb-pulse.json'),
  'verified-badge': require('./animations/verified-badge.json'),
  'empty-saved': require('./animations/empty-saved.json'),
  'empty-leads': require('./animations/empty-leads.json'),
  'empty-listings': require('./animations/empty-listings.json'),
  'empty-search': require('./animations/empty-search.json'),
  'empty-chat': require('./animations/empty-chat.json'),
  'proximity-ripple': require('./animations/proximity-ripple.json'),
  'lead-arrived': require('./animations/lead-arrived.json'),
  'upload-success': require('./animations/upload-success.json'),
  'property-verified': require('./animations/property-verified.json'),
};

export interface LottiePlayerHandle {
  play: (startFrame?: number, endFrame?: number) => void;
  pause: () => void;
  reset: () => void;
  playSegment: (start: number, end: number) => void;
}

export interface LottiePlayerProps {
  animation: LottieAnimationName;
  autoPlay?: boolean;
  loop?: boolean;
  speed?: number;
  size?: number | { width: number; height: number };
  style?: StyleProp<ViewStyle>;
  colorFilters?: { keypath: string; color: string }[];
  onAnimationFinish?: () => void;
}

export const LottiePlayer = forwardRef<LottiePlayerHandle, LottiePlayerProps>(
  ({ animation, autoPlay = true, loop = false, speed = MotionTokens.lottie.normal,
     size, style, colorFilters, onAnimationFinish }, ref) => {
    const lottieRef = useRef<LottieView>(null);

    useImperativeHandle(ref, () => ({
      play: (s?: number, e?: number) => lottieRef.current?.play(s, e),
      pause: () => lottieRef.current?.pause(),
      reset: () => lottieRef.current?.reset(),
      playSegment: (s: number, e: number) => lottieRef.current?.play(s, e),
    }));

    const sizeStyle =
      typeof size === 'number' ? { width: size, height: size } : size ?? { width: 120, height: 120 };

    return (
      <LottieView
        ref={lottieRef}
        source={ANIMATION_MAP[animation] as string}
        autoPlay={autoPlay}
        loop={loop}
        speed={speed}
        style={[sizeStyle, style]}
        colorFilters={colorFilters}
        onAnimationFinish={onAnimationFinish}
        renderMode="HARDWARE"
        resizeMode="contain"
      />
    );
  },
);
LottiePlayer.displayName = 'LottiePlayer';
