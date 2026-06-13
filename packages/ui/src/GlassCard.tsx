/**
 * GlassCard — the foundation. Every other card extends this.
 * A frosted glass surface at a declared depth layer: translucency,
 * internal top highlight, soft refraction border, optional edge glow.
 */
import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { BlurView } from 'expo-blur';
import { color, depth, DepthLayer, radius, shadow, ShadowLevel, space } from './tokens';

export type GlassCardProps = {
  children?: React.ReactNode;
  /** Which of the five depth layers this surface lives on. Default 1. */
  depthLayer?: DepthLayer;
  /** Override the layer's default blur intensity */
  blur?: number;
  /** Padding inside the card. Defaults to space.lg; pass 0 for media cards. */
  padding?: number;
  /** Corner radius. Defaults to radius.lg. */
  borderRadius?: number;
  /** Shadow level 1–3. Defaults to the level matching the depth layer. */
  shadowLevel?: ShadowLevel;
  /** Bright top-edge highlight — light entering the glass. Default true. */
  edgeHighlight?: boolean;
  /** Soft outer glow on the border — used by AI surfaces. Default false. */
  edgeGlow?: boolean;
  style?: StyleProp<ViewStyle>;
};

export default function GlassCard({
  children,
  depthLayer = 1,
  blur,
  padding = space.lg,
  borderRadius = radius.lg,
  shadowLevel,
  edgeHighlight = true,
  edgeGlow = false,
  style,
}: GlassCardProps) {
  const spec = depth[depthLayer];
  const level: ShadowLevel = shadowLevel ?? (Math.min(Math.max(depthLayer, 1), 3) as ShadowLevel);

  return (
    <View
      style={[
        styles.wrap,
        { borderRadius, zIndex: spec.z },
        shadow[level],
        edgeGlow && styles.glow,
        style,
      ]}
    >
      <BlurView intensity={blur ?? spec.blur} tint="light" style={[styles.blur, { borderRadius }]}>
        <View
          style={[
            styles.inner,
            {
              borderRadius,
              padding,
              backgroundColor: spec.fill,
              borderTopColor: edgeHighlight ? color.glassHighlight : color.glassBorder,
            },
          ]}
        >
          {children}
        </View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: color.glassFill, // Android fallback under elevation
  },
  glow: {
    shadowColor: color.accent,
    shadowOpacity: 0.14,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
  },
  blur: { overflow: 'hidden' },
  inner: {
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: color.glassBorder,
  },
});
