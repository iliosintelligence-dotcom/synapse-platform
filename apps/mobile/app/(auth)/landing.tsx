/**
 * Welcome — first launch. VisionOS calm: image hero, one statement, two CTAs.
 * The whole consumer value proposition in a sentence. (Supporting screen.)
 */
import React from 'react';
import { View, StyleSheet, ImageBackground } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Display, Body, Label, color, space, radius } from '@synapse/ui';

export default function Welcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.screen}>
      <ImageBackground
        source={{ uri: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1100&q=80' }}
        style={styles.hero}
        imageStyle={{ resizeMode: 'cover' }}
      >
        <View style={styles.heroScrim} />
      </ImageBackground>

      <View style={[styles.body, { paddingBottom: insets.bottom + space.xl }]}>
        <Label style={{ letterSpacing: 3, color: color.accent }}>SYNAPSE</Label>
        <Display style={styles.headline}>Find where{'\n'}life works.</Display>
        <Body style={styles.sub}>
          Tell Toju what matters — budget, commute, the life you want. He advises, verifies, and
          arranges. No endless scrolling. No guesswork.
        </Body>

        <View style={styles.ctas}>
          <Button
            label="Talk to Toju — it's free"
            size="lg"
            onPress={() => router.push('/(auth)/sign-up-consumer')}
          />
          <Button
            label="List with Synapse"
            variant="ghost"
            size="lg"
            onPress={() => router.push('/(auth)/sign-up-agency')}
          />
        </View>
        <Body style={styles.signin} onPress={() => router.push('/(auth)/sign-in')}>
          Already have an account? <Body style={{ color: color.accent }}>Sign in</Body>
        </Body>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.canvas },
  hero: { height: '50%' },
  heroScrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(8,10,16,0.06)' },
  body: {
    flex: 1,
    marginTop: -radius.xl,
    backgroundColor: color.canvas,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
    justifyContent: 'flex-end',
    gap: space.md,
  },
  headline: { fontSize: 52, color: color.ink, letterSpacing: 1, lineHeight: 50 },
  sub: { fontSize: 15, lineHeight: 23, color: color.inkMuted, maxWidth: 360 },
  ctas: { gap: space.sm, marginTop: space.md },
  signin: { textAlign: 'center', marginTop: space.sm, color: color.inkMuted, fontSize: 13 },
});
