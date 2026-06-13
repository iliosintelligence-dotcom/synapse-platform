/**
 * BottomSheet — VisionOS-inspired glass sheet. Three sizes: collapsed,
 * half, expanded. Spring transitions, drag handle, physically believable.
 */
import React, { useEffect } from 'react';
import { View, StyleSheet, Pressable, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { BlurView } from 'expo-blur';
import { color, depth, motion, radius, shadow, space, spring } from './tokens';

const SCREEN_H = Dimensions.get('window').height;

export type SheetSize = 'collapsed' | 'half' | 'expanded';

const SIZE_HEIGHTS: Record<SheetSize, number> = {
  collapsed: SCREEN_H * 0.22,
  half: SCREEN_H * 0.5,
  expanded: SCREEN_H * 0.88,
};

export type BottomSheetProps = {
  visible: boolean;
  size?: SheetSize;
  onClose: () => void;
  onSizeChange?: (size: SheetSize) => void;
  children?: React.ReactNode;
};

export default function BottomSheet({
  visible,
  size = 'half',
  onClose,
  onSizeChange,
  children,
}: BottomSheetProps) {
  const height = useSharedValue(SIZE_HEIGHTS[size]);
  const translateY = useSharedValue(SCREEN_H);
  const scrim = useSharedValue(0);
  const dragStart = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      translateY.value = withSpring(0, spring.expanded);
      scrim.value = withTiming(1, { duration: motion.standard });
    } else {
      translateY.value = withTiming(SCREEN_H, { duration: motion.expanded });
      scrim.value = withTiming(0, { duration: motion.standard });
    }
  }, [visible]);

  useEffect(() => {
    height.value = withSpring(SIZE_HEIGHTS[size], spring.expanded);
  }, [size]);

  const snapTo = (h: number) => {
    'worklet';
    const sizes: SheetSize[] = ['collapsed', 'half', 'expanded'];
    let best: SheetSize = 'half';
    let bestDist = Infinity;
    for (const s of sizes) {
      const d = Math.abs(SIZE_HEIGHTS[s] - h);
      if (d < bestDist) { bestDist = d; best = s; }
    }
    if (h < SIZE_HEIGHTS.collapsed * 0.6) {
      runOnJS(onClose)();
    } else {
      height.value = withSpring(SIZE_HEIGHTS[best], spring.expanded);
      if (onSizeChange) runOnJS(onSizeChange)(best);
    }
  };

  const drag = Gesture.Pan()
    .onStart(() => { dragStart.value = height.value; })
    .onUpdate((e) => {
      height.value = Math.min(SIZE_HEIGHTS.expanded, dragStart.value - e.translationY);
    })
    .onEnd(() => { snapTo(height.value); });

  const sheetStyle = useAnimatedStyle(() => ({
    height: height.value,
    transform: [{ translateY: translateY.value }],
  }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View style={[styles.scrim, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      <Animated.View style={[styles.sheet, shadow[3], sheetStyle]}>
        <BlurView intensity={depth[3].blur} tint="light" style={styles.blur}>
          <View style={styles.inner}>
            <GestureDetector gesture={drag}>
              <View style={styles.handleZone}>
                <View style={styles.handle} />
              </View>
            </GestureDetector>
            <View style={styles.content}>{children}</View>
          </View>
        </BlurView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill as object, backgroundColor: color.scrim },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: depth[3].fill,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  blur: {
    flex: 1,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    overflow: 'hidden',
  },
  inner: {
    flex: 1,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: color.glassBorder,
    borderTopColor: color.glassHighlight,
  },
  handleZone: { paddingTop: space.sm, paddingBottom: space.md, alignItems: 'center' },
  handle: {
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: color.inkFaint,
  },
  content: { flex: 1, paddingHorizontal: space.xl, paddingBottom: space.xl },
});
