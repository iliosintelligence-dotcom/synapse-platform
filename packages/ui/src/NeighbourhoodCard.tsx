/**
 * NeighbourhoodCard — generated from a PropertyCard. Schools, hospitals,
 * restaurants, lifestyle + safety scores. Categories chain deeper on tap.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import GlassCard from './GlassCard';
import Icon, { IconName } from './Icon';
import { color, fontFamily, radius, space, type } from './tokens';

export type NeighbourhoodCategory = {
  key: string;
  label: string;
  icon: IconName;
  summary: string;
};

export type NeighbourhoodCardProps = {
  area: string;
  lifestyleScore: number; // 0–10
  safetyScore: number; // 0–10
  categories: NeighbourhoodCategory[];
  onExploreCategory?: (key: string) => void;
};

export default function NeighbourhoodCard({
  area,
  lifestyleScore,
  safetyScore,
  categories,
  onExploreCategory,
}: NeighbourhoodCardProps) {
  return (
    <GlassCard depthLayer={2}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={type.label}>Neighbourhood</Text>
          <Text style={[type.title, { fontSize: 17 }]}>{area}</Text>
        </View>
        <Score label="Lifestyle" value={lifestyleScore} />
        <Score label="Safety" value={safetyScore} />
      </View>

      <View style={styles.cats}>
        {categories.map((c) => (
          <Pressable key={c.key} style={styles.cat} onPress={() => onExploreCategory?.(c.key)}>
            <View style={styles.catIcon}>
              <Icon name={c.icon} size="sm" color={color.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[type.title, { fontSize: 13.5 }]}>{c.label}</Text>
              <Text style={type.caption}>{c.summary}</Text>
            </View>
            <Icon name="chevron.right" size="xs" color={color.inkFaint} />
          </Pressable>
        ))}
      </View>
    </GlassCard>
  );
}

function Score({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.score}>
      <Text style={styles.scoreVal}>{value.toFixed(1)}</Text>
      <Text style={type.caption}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  score: { alignItems: 'center' },
  scoreVal: { fontFamily: fontFamily.display, fontSize: 24, letterSpacing: 0.8, color: color.accent },
  cats: { marginTop: space.lg },
  cat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderTopWidth: 1,
    borderTopColor: color.glassBorder,
  },
  catIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: color.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
