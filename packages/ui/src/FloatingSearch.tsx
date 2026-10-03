/**
 * FloatingSearch — not a search bar. A floating glass capsule at Layer 2:
 * search icon, rotating AI prompts, voice input. An entry into conversation.
 * Expands into the Toju chat via onActivate.
 */
import React, { useEffect, useState } from 'react';
import { Text, StyleSheet, Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import Icon from './Icon';
import { color, depth, fontFamily, motion, radius, shadow, space } from './tokens';

const DEFAULT_PROMPTS = [
  'Find a home near my office',
  'What can I afford in Lekki?',
  '3-bedroom under ₦150M',
  'Is Ibeju-Lekki a good investment?',
];

export type FloatingSearchProps = {
  prompts?: string[];
  rotateMs?: number;
  onActivate?: () => void;
  onVoice?: () => void;
};

export default function FloatingSearch({
  prompts = DEFAULT_PROMPTS,
  rotateMs = 3600,
  onActivate,
  onVoice,
}: FloatingSearchProps) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setIndex((i) => (i + 1) % prompts.length), rotateMs);
    return () => clearInterval(t);
  }, [prompts.length, rotateMs]);

  return (
    <Pressable onPress={onActivate} style={[styles.wrap, shadow[2]]}>
      <BlurView intensity={depth[2].blur} tint="light" style={styles.blur}>
        <View style={styles.inner}>
          <Icon name="search" size="sm" color={color.inkMuted} />
          <View style={styles.promptWrap}>
            <Animated.Text
              key={index}
              entering={FadeIn.duration(motion.standard)}
              exiting={FadeOut.duration(motion.micro)}
              style={styles.prompt}
              numberOfLines={1}
            >
              {prompts[index]}
            </Animated.Text>
          </View>
          <Pressable onPress={onVoice} hitSlop={8}>
            <Icon name="mic" size="sm" color={color.inkMuted} />
          </Pressable>
          <View style={styles.aiEntry}>
            <Icon name="sparkles" size="xs" color={color.onAccent} />
          </View>
        </View>
      </BlurView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.pill,
    backgroundColor: depth[2].fill,
  },
  blur: { borderRadius: radius.pill, overflow: 'hidden' },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: space.lg,
    paddingRight: space.xs + 2,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.glassBorder,
    borderTopColor: color.glassHighlight,
  },
  promptWrap: { flex: 1, height: 22, justifyContent: 'center' },
  prompt: { fontFamily: fontFamily.light, fontSize: 14, color: color.inkDim },
  aiEntry: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
