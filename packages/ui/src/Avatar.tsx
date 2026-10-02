/**
 * Avatar — consistent sizing tokens, initials fallback, optional
 * verification badge overlay.
 */
import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import Icon from './Icon';
import { color, fontFamily } from './tokens';

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZES: Record<AvatarSize, number> = { sm: 32, md: 44, lg: 56, xl: 80 };

export type AvatarProps = {
  name: string;
  imageUrl?: string | null;
  size?: AvatarSize;
  /** Gold check overlay for verified identities */
  verified?: boolean;
};

export default function Avatar({ name, imageUrl, size = 'md', verified = false }: AvatarProps) {
  const px = SIZES[size];
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <View style={{ width: px, height: px }}>
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={[styles.image, { width: px, height: px, borderRadius: px / 2 }]} />
      ) : (
        <View style={[styles.fallback, { width: px, height: px, borderRadius: px / 2 }]}>
          <Text style={[styles.initials, { fontSize: px * 0.36 }]}>{initials}</Text>
        </View>
      )}
      {verified && (
        <View style={[styles.badge, { width: px * 0.36, height: px * 0.36, borderRadius: px * 0.18 }]}>
          <Icon name="check" size={px * 0.2} color="#FFFFFF" weight={2.4} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: color.inkFaint },
  fallback: {
    backgroundColor: color.accentSoft,
    borderWidth: 1,
    borderColor: color.accentBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { fontFamily: fontFamily.semibold, color: color.accent },
  badge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: color.gold,
    borderWidth: 1.5,
    borderColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
