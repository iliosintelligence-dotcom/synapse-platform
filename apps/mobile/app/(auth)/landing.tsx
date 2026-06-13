import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Display, Body, Button, color, space } from '@synapse/ui';

export default function Landing() {
  const router = useRouter();
  return (
    <View style={styles.screen}>
      <View style={styles.hero}>
        <Display style={{ fontSize: 44, letterSpacing: 3 }}>SYNAPSE</Display>
        <Body style={{ textAlign: 'center', maxWidth: 300 }}>
          The infrastructure layer for Nigerian real estate. Verified properties. Guided decisions.
        </Body>
      </View>
      <View style={styles.actions}>
        <Button label="Find a home" size="lg" onPress={() => router.push('/(auth)/sign-up-consumer')} />
        <Button
          label="List with Synapse"
          variant="ghost"
          size="lg"
          onPress={() => router.push('/(auth)/sign-up-agency')}
        />
        <Button label="Sign in" variant="ghost" size="md" onPress={() => router.push('/(auth)/sign-in')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.canvas, padding: space.xl, justifyContent: 'space-between' },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
  actions: { gap: space.sm, paddingBottom: space.xl },
});
