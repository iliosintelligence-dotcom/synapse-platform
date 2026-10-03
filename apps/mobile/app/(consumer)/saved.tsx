/**
 * Saved — the consumer's saved listings. Same PropertyCard grammar as Browse.
 * (Supporting screen.) Swap MOCK_PROFILE.savedIds for
 * properties.listSavedProperties().
 */
import React, { useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PropertyCard, Title, Caption, Icon, color, space } from '@synapse/ui';
import { ALL_PROPERTIES, MOCK_PROFILE } from '../../src/mock';

export default function Saved() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [savedIds, setSavedIds] = useState<string[]>(MOCK_PROFILE.savedIds);
  const saved = ALL_PROPERTIES.filter((p) => savedIds.includes(p.id));

  const unsave = (id: string) => setSavedIds((s) => s.filter((x) => x !== id));

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + space.md }]}>
        <Title style={{ fontSize: 30, letterSpacing: 1 }}>Saved</Title>
        <Caption>
          {saved.length} {saved.length === 1 ? 'property' : 'properties'}
        </Caption>
      </View>

      {saved.length === 0 ? (
        <View style={styles.empty}>
          <Icon name="heart" size="xl" color={color.inkFaint} />
          <Caption style={{ marginTop: space.md, textAlign: 'center' }}>
            Nothing saved yet. Tap the heart on any listing to keep it here.
          </Caption>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + space.xxl }]}
          showsVerticalScrollIndicator={false}
        >
          {saved.map((p) => (
            <PropertyCard
              key={p.id}
              property={p}
              saved
              onSave={() => unsave(p.id)}
              onPress={() => router.push(`/property/${p.id}`)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.canvas },
  header: { paddingHorizontal: space.lg, paddingBottom: space.sm, gap: 2 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl },
  list: { paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.md },
});
