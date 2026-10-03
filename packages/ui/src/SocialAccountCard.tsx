/**
 * SocialAccountCard — platform logo glyph, connected account name, connection
 * status, last-synced time, disconnect button. Agency settings surface.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import GlassCard from './GlassCard';
import Icon, { type IconName } from './Icon';
import { color, fontFamily, radius, space, type } from './tokens';

export type SocialPlatformKind = 'instagram' | 'facebook' | 'tiktok' | 'linkedin' | 'x';

export type SocialAccountCardData = {
  platform: SocialPlatformKind;
  username: string | null;
  connected: boolean;
  lastSyncedLabel: string | null;
};

export type SocialAccountCardProps = {
  account: SocialAccountCardData;
  onConnect?: () => void;
  onDisconnect?: () => void;
};

const PLATFORM: Record<SocialPlatformKind, { label: string; icon: IconName }> = {
  instagram: { label: 'Instagram', icon: 'camera' },
  facebook: { label: 'Facebook', icon: 'people' },
  tiktok: { label: 'TikTok', icon: 'sparkles' },
  linkedin: { label: 'LinkedIn', icon: 'briefcase' },
  x: { label: 'X', icon: 'message' },
};

export default function SocialAccountCard({ account, onConnect, onDisconnect }: SocialAccountCardProps) {
  const p = PLATFORM[account.platform];
  return (
    <GlassCard depthLayer={1} padding={space.md}>
      <View style={styles.row}>
        <View style={[styles.logo, account.connected && styles.logoConnected]}>
          <Icon name={p.icon} size="sm" color={account.connected ? color.accent : color.inkDim} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[type.title, { fontSize: 14 }]}>{p.label}</Text>
          {account.connected ? (
            <Text style={type.caption}>
              {account.username ? '@' + account.username : 'Connected'}
              {account.lastSyncedLabel ? ` · synced ${account.lastSyncedLabel}` : ''}
            </Text>
          ) : (
            <Text style={type.caption}>Not connected</Text>
          )}
        </View>

        {account.connected ? (
          <Pressable style={styles.disconnect} onPress={onDisconnect}>
            <Text style={styles.disconnectText}>Disconnect</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.connect} onPress={onConnect}>
            <Text style={styles.connectText}>Connect</Text>
          </Pressable>
        )}
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  logo: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: 'rgba(22,24,28,0.04)', alignItems: 'center', justifyContent: 'center',
  },
  logoConnected: { backgroundColor: color.accentSoft },
  disconnect: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: 'rgba(22,24,28,0.05)' },
  disconnectText: { fontFamily: fontFamily.semibold, fontSize: 12.5, color: color.inkMuted },
  connect: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: color.accent },
  connectText: { fontFamily: fontFamily.semibold, fontSize: 12.5, color: color.onAccent },
});
