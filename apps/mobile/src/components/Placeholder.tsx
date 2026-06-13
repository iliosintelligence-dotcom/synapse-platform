/**
 * Placeholder — Layer 1 screens are navigation shells. Content lands in
 * later layers; the route architecture is complete now.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Display, Caption, color, space } from '@synapse/ui';

export default function Placeholder({ title }: { title: string }) {
  return (
    <View style={styles.screen}>
      <Display style={{ fontSize: 30, letterSpacing: 2 }}>{title.toUpperCase()}</Display>
      <Caption>Layer 1 shell — feature content ships in a later layer.</Caption>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    padding: space.xl,
  },
});
