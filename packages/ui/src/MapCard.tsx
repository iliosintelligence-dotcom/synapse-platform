/**
 * MapCard — maps live inside cards, never on a dedicated screen.
 * Layer 1 collapsed, Layer 3 on interaction. Pins react to Toju's
 * recommendations (highlightedPinId lights up in real time).
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import GlassCard from './GlassCard';
import Icon from './Icon';
import { color, fontFamily, motion, radius, space, type } from './tokens';

export type MapPin = {
  id: string;
  price: string;
  /** 0–1 relative position inside the map area */
  x: number;
  y: number;
};

export type MapCardProps = {
  areaLabel: string;
  pins: MapPin[];
  /** Pin Toju is currently talking about — lights up accent */
  highlightedPinId?: string;
  /** Optional commute route preview between two pins */
  routeLabel?: string;
  expanded?: boolean;
  onPinPress?: (id: string) => void;
};

export default function MapCard({
  areaLabel,
  pins,
  highlightedPinId,
  routeLabel,
  expanded: initialExpanded = false,
  onPinPress,
}: MapCardProps) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const mapHeight = expanded ? 260 : 110;

  return (
    <Pressable onPress={() => setExpanded((e) => !e)}>
      <GlassCard depthLayer={expanded ? 3 : 1} padding={0}>
        {/* Stylised map surface — light grid, no tile dependency */}
        <View style={[styles.map, { height: mapHeight }]}>
          <View style={styles.grid} pointerEvents="none">
            {Array.from({ length: 5 }).map((_, i) => (
              <View key={`h${i}`} style={[styles.gridLineH, { top: `${(i + 1) * 16}%` }]} />
            ))}
            {Array.from({ length: 7 }).map((_, i) => (
              <View key={`v${i}`} style={[styles.gridLineV, { left: `${(i + 1) * 12.5}%` }]} />
            ))}
            <View style={styles.water} />
          </View>

          {pins.map((pin) => {
            const hot = pin.id === highlightedPinId;
            return (
              <Pressable
                key={pin.id}
                style={[
                  styles.pin,
                  { left: `${pin.x * 100}%`, top: `${pin.y * 100}%` },
                  hot && styles.pinHot,
                ]}
                onPress={() => onPinPress?.(pin.id)}
              >
                <Text style={[styles.pinText, hot && { color: color.onAccent }]}>{pin.price}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.footer}>
          <Icon name="map" size="sm" color={color.accent} />
          <Text style={[type.label, { flex: 1 }]}>
            {areaLabel} · {pins.length} verified nearby
          </Text>
          {expanded && routeLabel && (
            <Animated.View entering={FadeIn.duration(motion.standard)} style={styles.route}>
              <Icon name="car" size="xs" color={color.inkMuted} />
              <Text style={type.caption}>{routeLabel}</Text>
            </Animated.View>
          )}
          <Icon name={expanded ? 'chevron.down' : 'chevron.right'} size="xs" color={color.inkDim} />
        </View>
      </GlassCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  map: {
    backgroundColor: '#F2F1ED',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    overflow: 'hidden',
  },
  grid: { ...StyleSheet.absoluteFill as object },
  gridLineH: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(22,24,28,0.04)' },
  gridLineV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(22,24,28,0.04)' },
  water: {
    position: 'absolute',
    bottom: -36,
    left: -20,
    right: -20,
    height: 70,
    borderTopLeftRadius: 120,
    backgroundColor: 'rgba(120,160,190,0.16)',
  },
  pin: {
    position: 'absolute',
    transform: [{ translateX: -28 }, { translateY: -14 }],
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1,
    borderColor: color.glassBorder,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  pinHot: { backgroundColor: color.accent, borderColor: color.accent },
  pinText: { fontFamily: fontFamily.semibold, fontSize: 11, color: color.ink },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
  },
  route: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
