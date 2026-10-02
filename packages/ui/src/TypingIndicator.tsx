/**
 * TypingIndicator — three dots in a Layer-1 GlassCard while Toju processes.
 * Spring-driven via Reanimated. Replaced by an AIConversationCard on response.
 */
import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withDelay,
  withSpring,
} from 'react-native-reanimated';
import GlassCard from './GlassCard';
import { color, space, spring } from './tokens';

function Dot({ delay }: { delay: number }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withDelay(
      delay,
      withRepeat(
        withSequence(withSpring(1, spring.micro), withSpring(0, spring.standard)),
        -1,
      ),
    );
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: 0.3 + v.value * 0.7,
    transform: [{ translateY: v.value * -3 }, { scale: 0.85 + v.value * 0.15 }],
  }));
  return <Animated.View style={[styles.dot, style]} />;
}

export default function TypingIndicator() {
  return (
    <GlassCard depthLayer={1} padding={0} style={styles.card}>
      <View style={styles.row}>
        <Dot delay={0} />
        <Dot delay={140} />
        <Dot delay={280} />
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: { alignSelf: 'flex-start' },
  row: {
    flexDirection: 'row',
    gap: space.xs,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color.accent },
});
