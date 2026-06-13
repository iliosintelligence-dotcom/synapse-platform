/**
 * Tag — small pill. Variants: verified, pending, status, category.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon, { type IconName } from './Icon';
import { color, fontFamily, radius, space } from './tokens';

export type TagVariant = 'verified' | 'pending' | 'status' | 'category';

export type TagProps = {
  label: string;
  variant?: TagVariant;
  icon?: IconName;
};

const VARIANT_STYLES: Record<TagVariant, { bg: string; border: string; fg: string; icon?: IconName }> = {
  verified: { bg: color.successSoft, border: color.successBorder, fg: color.success, icon: 'check' },
  pending: { bg: color.pendingSoft, border: color.pendingBorder, fg: color.pending, icon: 'clock' },
  status: { bg: color.accentSoft, border: color.accentBorder, fg: color.accent },
  category: { bg: 'rgba(22,24,28,0.05)', border: color.glassBorder, fg: color.inkMuted },
};

export default function Tag({ label, variant = 'category', icon }: TagProps) {
  const v = VARIANT_STYLES[variant];
  const iconName = icon ?? v.icon;

  return (
    <View style={[styles.pill, { backgroundColor: v.bg, borderColor: v.border }]}>
      {iconName && <Icon name={iconName} size="xs" color={v.fg} />}
      <Text style={[styles.text, { color: v.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  text: { fontFamily: fontFamily.medium, fontSize: 11 },
});
