/**
 * FloatingAIOrb — subtle persistent AI presence at Layer 3. Gentle breath
 * pulse signals Toju is available. Restrained, not theatrical.
 * Expands into an AIConversationCard via onPress.
 */
import React, { useEffect } from 'react';
import { StyleSheet, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Icon from './Icon';
import { color, easing, shadow } from './tokens';

export type FloatingAIOrbProps = {
  size?: number;
  onPress?: () => void;
};

export default function FloatingAIOrb({ size = 52, onPress }: FloatingAIOrbProps) {
  const breath = useSharedValue(0);

  useEffect(() => {
    // Slow ambient breathing — presence, not a transition
    breath.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2200, easing: easing.inOut }),
        withTiming(0, { duration: 2200, easing: easing.inOut }),
      ),
      -1,
    );
  }, []);

  const orbStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + breath.value * 0.04 }],
  }));
  const haloStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + breath.value * 0.22 }],
    opacity: 0.18 * (1 - breath.value * 0.6),
  }));

  return (
    <Pressable onPress={onPress} style={styles.wrap} hitSlop={8}>
      <Animated.View
        style={[
          styles.halo,
          { width: size, height: size, borderRadius: size / 2 },
          haloStyle,
        ]}
      />
      <Animated.View
        style={[
          styles.orb,
          shadow[2],
          { width: size, height: size, borderRadius: size / 2 },
          orbStyle,
        ]}
      >
        <Icon name="sparkles" size={size * 0.4} color={color.onAccent} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  halo: {
    position: 'absolute',
    backgroundColor: color.accent,
  },
  orb: {
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
