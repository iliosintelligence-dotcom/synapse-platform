/**
 * PropertyImageViewer — edge-to-edge immersive viewer. Swipe between images,
 * glass photo counter ("1 / 8"), floating controls, chrome hides on tap.
 */
import React, { useState } from 'react';
import { View, Image, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import Icon, { IconName } from './Icon';
import { color, fontFamily, motion, radius, space } from './tokens';

export type ViewerControl = { icon: IconName; label: string; onPress?: () => void };

export type PropertyImageViewerProps = {
  images: string[];
  height?: number;
  controls?: ViewerControl[];
  onClose?: () => void;
};

export default function PropertyImageViewer({
  images,
  height = 440,
  controls = [],
  onClose,
}: PropertyImageViewerProps) {
  const [index, setIndex] = useState(0);
  const [chromeVisible, setChromeVisible] = useState(true);
  // Measure the real container — never assume window width
  const [width, setWidth] = useState(0);

  return (
    <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        >
          {images.map((src, i) => (
            <Pressable key={i} onPress={() => setChromeVisible((v) => !v)}>
              <Image source={{ uri: src }} style={{ width, height }} />
            </Pressable>
          ))}
        </ScrollView>
      )}

      {chromeVisible && (
        <Animated.View
          entering={FadeIn.duration(motion.standard)}
          exiting={FadeOut.duration(motion.micro)}
          style={StyleSheet.absoluteFill}
          pointerEvents="box-none"
        >
          {onClose && (
            <Pressable style={styles.close} onPress={onClose}>
              <BlurView intensity={40} tint="light" style={styles.closeBlur}>
                <Icon name="xmark" size="sm" color={color.ink} />
              </BlurView>
            </Pressable>
          )}

          {/* Glass photo counter */}
          <View style={styles.counter}>
            <BlurView intensity={40} tint="dark" style={styles.counterBlur}>
              <Text style={styles.counterText}>{index + 1} / {images.length}</Text>
            </BlurView>
          </View>

          {/* Floating glass controls */}
          {controls.length > 0 && (
            <View style={styles.controls}>
              <BlurView intensity={45} tint="light" style={styles.controlsBlur}>
                <View style={styles.controlsRow}>
                  {controls.map((c) => (
                    <Pressable key={c.label} style={styles.control} onPress={c.onPress}>
                      <Icon name={c.icon} size="sm" color={color.ink} />
                      <Text style={styles.controlLabel}>{c.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </BlurView>
            </View>
          )}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  close: { position: 'absolute', top: space.lg, left: space.lg },
  closeBlur: {
    width: 38,
    height: 38,
    borderRadius: 19,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  counter: { position: 'absolute', top: space.lg, right: space.lg },
  counterBlur: {
    borderRadius: radius.pill,
    overflow: 'hidden',
    paddingHorizontal: space.md,
    paddingVertical: 6,
    backgroundColor: 'rgba(22,24,28,0.35)',
  },
  counterText: { fontFamily: fontFamily.medium, fontSize: 12, color: '#FFFFFF' },
  controls: {
    position: 'absolute',
    bottom: space.lg,
    left: space.lg,
    right: space.lg,
  },
  controlsBlur: {
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  controlsRow: {
    flexDirection: 'row',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.glassBorder,
  },
  control: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    paddingVertical: space.sm + 2,
  },
  controlLabel: { fontFamily: fontFamily.medium, fontSize: 10.5, color: color.inkMuted },
});
