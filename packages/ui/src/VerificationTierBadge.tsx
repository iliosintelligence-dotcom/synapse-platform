/**
 * VerificationTierBadge — five variants matching the five verification tiers.
 * Visual weight escalates with tier; Synapse Certified is the most prominent.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from './Icon';
import { color, fontFamily, radius, space } from './tokens';

export type TierKind =
  | 'unverified'
  | 'basic_verified'
  | 'business_verified'
  | 'enhanced_verified'
  | 'synapse_certified';

export type VerificationTierBadgeProps = {
  tier: TierKind;
  size?: 'sm' | 'md';
};

const TIERS: Record<TierKind, { label: string; bg: string; border: string; fg: string; certified?: boolean }> = {
  unverified: { label: 'Unverified', bg: 'rgba(22,24,28,0.05)', border: color.glassBorder, fg: color.inkDim },
  basic_verified: { label: 'Verified', bg: color.successSoft, border: color.successBorder, fg: color.success },
  business_verified: { label: 'Business Verified', bg: color.successSoft, border: color.successBorder, fg: color.success },
  enhanced_verified: { label: 'Enhanced Verified', bg: color.accentSoft, border: color.accentBorder, fg: color.accent },
  synapse_certified: { label: 'Synapse Certified', bg: color.goldSoft, border: color.goldBorder, fg: color.gold, certified: true },
};

export default function VerificationTierBadge({ tier, size = 'md' }: VerificationTierBadgeProps) {
  const t = TIERS[tier];
  const sm = size === 'sm';
  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: t.bg, borderColor: t.border },
        t.certified && styles.certified,
        sm && styles.pillSm,
      ]}
    >
      <Icon name={t.certified ? 'sparkles' : 'shield'} size={sm ? 'xs' : 'sm'} color={t.fg} />
      <Text style={[styles.text, { color: t.fg }, sm && styles.textSm]}>{t.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: space.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  pillSm: { paddingHorizontal: space.sm, paddingVertical: 4, gap: 4 },
  certified: { shadowColor: color.gold, shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 0 } },
  text: { fontFamily: fontFamily.semibold, fontSize: 12.5, letterSpacing: 0.2 },
  textSm: { fontSize: 11 },
});
