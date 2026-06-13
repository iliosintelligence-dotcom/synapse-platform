/**
 * PropertyComparisonCard — Layer 3. A vs B across price, commute, investment,
 * trust score, and Toju's recommendation. Any dimension can chain into a
 * deeper analysis card via onExploreDimension.
 */
import React from 'react';
import { View, Text, Image, StyleSheet, Pressable } from 'react-native';
import GlassCard from './GlassCard';
import Icon from './Icon';
import { color, fontFamily, radius, space, type } from './tokens';
import type { PropertyData } from './PropertyCard';

export type ComparisonDimension = {
  key: string;
  label: string;
  a: string;
  b: string;
  /** which side Toju favours for this dimension */
  winner?: 'a' | 'b';
};

export type PropertyComparisonCardProps = {
  propertyA: PropertyData;
  propertyB: PropertyData;
  dimensions: ComparisonDimension[];
  recommendation?: string;
  onExploreDimension?: (key: string) => void;
};

export default function PropertyComparisonCard({
  propertyA,
  propertyB,
  dimensions,
  recommendation,
  onExploreDimension,
}: PropertyComparisonCardProps) {
  return (
    <GlassCard depthLayer={3} padding={0}>
      {/* Heads */}
      <View style={styles.heads}>
        {[propertyA, propertyB].map((p, i) => (
          <View key={p.id} style={[styles.head, i === 0 && styles.headDivider]}>
            <Image source={{ uri: p.image }} style={styles.thumb} />
            <Text style={[type.title, { fontSize: 13.5 }]} numberOfLines={1}>{p.title}</Text>
            <Text style={styles.headPrice}>{p.price}</Text>
          </View>
        ))}
      </View>

      {/* Dimensions */}
      <View style={styles.dims}>
        {dimensions.map((d) => (
          <Pressable key={d.key} style={styles.dimRow} onPress={() => onExploreDimension?.(d.key)}>
            <Text style={[styles.dimVal, d.winner === 'a' && styles.dimWin]}>{d.a}</Text>
            <View style={styles.dimLabelWrap}>
              <Text style={type.caption}>{d.label}</Text>
              <Icon name="chevron.right" size={11} color={color.inkFaint} />
            </View>
            <Text style={[styles.dimVal, styles.dimRight, d.winner === 'b' && styles.dimWin]}>{d.b}</Text>
          </Pressable>
        ))}
      </View>

      {recommendation && (
        <View style={styles.reco}>
          <Icon name="sparkles" size="xs" color={color.accent} />
          <Text style={[type.body, { flex: 1, fontSize: 13.5, lineHeight: 20 }]}>{recommendation}</Text>
        </View>
      )}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  heads: { flexDirection: 'row' },
  head: { flex: 1, padding: space.lg, gap: space.xs },
  headDivider: { borderRightWidth: 1, borderRightColor: color.glassBorder },
  thumb: { width: '100%', height: 84, borderRadius: radius.sm },
  headPrice: { fontFamily: fontFamily.display, fontSize: 20, letterSpacing: 1, color: color.accent },
  dims: { borderTopWidth: 1, borderTopColor: color.glassBorder },
  dimRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: color.glassBorder,
  },
  dimVal: { flex: 1, fontFamily: fontFamily.medium, fontSize: 13, color: color.inkMuted },
  dimRight: { textAlign: 'right' },
  dimWin: { color: color.ink, fontFamily: fontFamily.semibold },
  dimLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: space.sm },
  reco: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    margin: space.lg,
    marginTop: space.md,
    backgroundColor: color.accentSoft,
    borderRadius: radius.sm,
    padding: space.md,
  },
});
