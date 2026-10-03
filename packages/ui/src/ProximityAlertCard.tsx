/**
 * ProximityAlertCard — Layer 3. Pulsing accent location dot, thumbnail,
 * type, price, distance in metres. One active alert at a time.
 * Tap → navigates to the PropertyCard for the listing.
 */
import React, { useEffect } from 'react';
import { View, Text, Image, StyleSheet, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import GlassCard from './GlassCard';
import { color, easing, fontFamily, radius, space, type } from './tokens';
import type { PropertyData } from './PropertyCard';

export type ProximityAlertCardProps = {
  property: PropertyData;
  propertyType: string;
  distanceMetres: number;
  onPress?: () => void;
};

function PulsingDot() {
  const pulse = useSharedValue(0);
  useEffect(() => {
    // Continuous ambient pulse — duration intentionally outside the motion
    // scale: this is presence, not a transition.
    pulse.value = withRepeat(withTiming(1, { duration: 1400, easing: easing.inOut }), -1);
  }, []);
  const ring = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 1.4 }],
    opacity: 0.45 * (1 - pulse.value),
  }));
  return (
    <View style={styles.dotWrap}>
      <Animated.View style={[styles.pulseRing, ring]} />
      <View style={styles.dot} />
    </View>
  );
}

export default function ProximityAlertCard({
  property,
  propertyType,
  distanceMetres,
  onPress,
}: ProximityAlertCardProps) {
  return (
    <Pressable onPress={onPress}>
      <GlassCard depthLayer={3} edgeGlow>
        <View style={styles.topRow}>
          <PulsingDot />
          <Text style={[type.label, { flex: 1 }]}>Verified property nearby</Text>
          <Text style={styles.distance}>{distanceMetres}m</Text>
        </View>
        <View style={styles.bodyRow}>
          <Image source={{ uri: property.image }} style={styles.thumb} />
          <View style={{ flex: 1 }}>
            <Text style={styles.price}>{property.price}</Text>
            <Text style={[type.title, { fontSize: 14 }]} numberOfLines={1}>{property.title}</Text>
            <Text style={type.caption}>{propertyType} · Trust {property.trustScore}</Text>
          </View>
        </View>
      </GlassCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.md },
  dotWrap: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  pulseRing: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: color.accent,
  },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: color.accent },
  distance: { fontFamily: fontFamily.semibold, fontSize: 13, color: color.accent },
  bodyRow: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  thumb: { width: 64, height: 64, borderRadius: radius.sm },
  price: { fontFamily: fontFamily.display, fontSize: 21, letterSpacing: 1, color: color.ink },
});
