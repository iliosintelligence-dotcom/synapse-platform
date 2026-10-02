/**
 * Button — filled accent, ghost, destructive. DM Sans semibold, pill radius.
 */
import React from 'react';
import { Pressable, Text, StyleSheet, ActivityIndicator, type ViewStyle, type StyleProp } from 'react-native';
import Icon, { type IconName } from './Icon';
import { color, fontFamily, radius, space } from './tokens';

export type ButtonVariant = 'filled' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

const PAD: Record<ButtonSize, { v: number; h: number; font: number }> = {
  sm: { v: space.sm, h: space.md, font: 12.5 },
  md: { v: space.sm + 3, h: space.lg, font: 14 },
  lg: { v: space.md, h: space.xl, font: 15 },
};

export default function Button({
  label,
  variant = 'filled',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  onPress,
  style,
}: ButtonProps) {
  const pad = PAD[size];
  const fg =
    variant === 'filled' ? color.onAccent : variant === 'destructive' ? color.warning : color.ink;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        { paddingVertical: pad.v, paddingHorizontal: pad.h },
        variant === 'filled' && styles.filled,
        variant === 'ghost' && styles.ghost,
        variant === 'destructive' && styles.destructive,
        pressed && variant === 'filled' && { backgroundColor: color.accentPressed },
        (disabled || loading) && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <>
          {icon && <Icon name={icon} size="xs" color={fg} />}
          <Text style={[styles.label, { fontSize: pad.font, color: fg }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: radius.pill,
  },
  filled: { backgroundColor: color.accent },
  ghost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: color.glassBorder,
  },
  destructive: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(179,84,30,0.35)',
  },
  disabled: { opacity: 0.45 },
  label: { fontFamily: fontFamily.semibold, letterSpacing: 0.1 },
});
