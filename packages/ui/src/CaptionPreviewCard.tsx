/**
 * CaptionPreviewCard — platform-specific preview showing the post as it will
 * appear. Aspect ratio matches the platform; caption below with char count.
 * Used in the Post It approval flow.
 */
import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import GlassCard from './GlassCard';
import Icon from './Icon';
import { color, fontFamily, space, type } from './tokens';

export type CaptionPlatform = 'instagram' | 'facebook' | 'tiktok' | 'linkedin' | 'x';

export type CaptionPreviewCardProps = {
  platform: CaptionPlatform;
  agencyName: string;
  propertyImage: string | null;
  caption: string;
};

// portrait for reel/tiktok, square for ig feed, landscape otherwise
const ASPECT: Record<CaptionPlatform, number> = {
  instagram: 1,
  tiktok: 9 / 16,
  facebook: 1.91,
  linkedin: 1.91,
  x: 1.91,
};

export default function CaptionPreviewCard({
  platform,
  agencyName,
  propertyImage,
  caption,
}: CaptionPreviewCardProps) {
  return (
    <GlassCard depthLayer={2} padding={0}>
      <View style={styles.bar}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{agencyName.slice(0, 1).toUpperCase()}</Text>
        </View>
        <Text style={[type.label, { fontSize: 12.5, color: color.ink }]}>{agencyName}</Text>
        <Text style={[type.caption, { marginLeft: 'auto', textTransform: 'capitalize' }]}>{platform}</Text>
      </View>

      <View style={[styles.media, { aspectRatio: ASPECT[platform] }]}>
        {propertyImage ? (
          <Image source={{ uri: propertyImage }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <Icon name="camera" size="lg" color={color.inkDim} />
        )}
      </View>

      <View style={styles.captionWrap}>
        <Text style={[type.body, { fontSize: 13 }]} numberOfLines={4}>
          {caption}
        </Text>
        <Text style={[type.caption, { marginTop: 4 }]}>{caption.length} characters</Text>
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md },
  avatar: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: color.accentSoft, borderWidth: 1, borderColor: color.accentBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontFamily: fontFamily.semibold, fontSize: 12, color: color.accent },
  media: {
    width: '100%',
    backgroundColor: 'rgba(22,24,28,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    maxHeight: 420,
  },
  captionWrap: { padding: space.md, borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: color.glassBorder },
});
