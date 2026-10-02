/**
 * Browse — the fallback to the conversation. Verified active listings only,
 * ordered by trust score. Filter by city and listing type. Save button.
 * List-first (map is Layer 2). (Supporting screen.)
 *
 * Swap ALL_PROPERTIES for properties.listProperties({ city, listing_type }).
 */
import React, { useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PropertyCard, Title, Label, Caption, color, space, radius } from '@synapse/ui';
import { ALL_PROPERTIES } from '../../src/mock';

const CITIES = ['All', 'Lekki', 'Victoria Island', 'Ikoyi'];
const TYPES = ['All', 'Sale', 'Rent', 'Shortlet'];

export default function Browse() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [city, setCity] = useState('All');
  const [saved, setSaved] = useState<Set<string>>(new Set());

  const listings = useMemo(
    () => (city === 'All' ? ALL_PROPERTIES : ALL_PROPERTIES.filter((p) => p.location.includes(city))),
    [city],
  );

  const toggleSave = (id: string) =>
    setSaved((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + space.md }]}>
        <Title style={{ fontSize: 30, letterSpacing: 1 }}>Browse</Title>
        <Caption>{listings.length} verified listings · ordered by trust</Caption>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {CITIES.map((c) => (
            <Chip key={c} label={c} active={city === c} onPress={() => setCity(c)} />
          ))}
          <View style={styles.sep} />
          {TYPES.map((t) => (
            <Chip key={t} label={t} active={t === 'All'} onPress={() => {}} muted />
          ))}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + space.xxl }]}
        showsVerticalScrollIndicator={false}
      >
        {listings.map((p) => (
          <PropertyCard
            key={p.id}
            property={p}
            saved={saved.has(p.id)}
            onSave={() => toggleSave(p.id)}
            onPress={() => router.push(`/property/${p.id}`)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function Chip({
  label,
  active,
  muted,
  onPress,
}: {
  label: string;
  active: boolean;
  muted?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.chip, active && styles.chipActive, muted && !active && styles.chipMuted]}
      onPress={onPress}
    >
      <Label style={[{ fontSize: 12.5 }, active ? { color: color.accent } : { color: color.inkMuted }]}>
        {label}
      </Label>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.canvas },
  header: { paddingHorizontal: space.lg, paddingBottom: space.sm, gap: 2 },
  chips: { gap: space.xs, paddingVertical: space.sm, alignItems: 'center' },
  sep: { width: 1, height: 20, backgroundColor: color.glassBorder, marginHorizontal: 4 },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.glassBorder,
  },
  chipActive: { backgroundColor: color.accentSoft, borderColor: color.accentBorder },
  chipMuted: { opacity: 0.7 },
  list: { paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.md },
});
