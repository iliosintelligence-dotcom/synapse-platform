/**
 * VerificationBadge — gold pill. Institutional trust at a glance.
 * Used on agency cards and listing surfaces.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from './Icon';
import { color, fontFamily, radius, space } from './tokens';

type Props = {
  label?: 'Verified' | 'Gold Partner' | string;
};

export default function VerificationBadge({ label = 'Verified' }: Props) {
  return (
    <View style={styles.pill}>
      <Icon name="shield" size="xs" color={color.gold} />
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: color.goldSoft,
    borderWidth: 1,
    borderColor: color.goldBorder,
    paddingHorizontal: space.sm + 2,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  text: {
    fontFamily: fontFamily.semibold,
    fontSize: 11,
    color: color.gold,
    letterSpacing: 0.3,
  },
});
