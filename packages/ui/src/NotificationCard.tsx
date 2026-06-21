/**
 * NotificationCard — channel icon, message, timestamp, read state,
 * deep-link action. Unread carries a subtle accent rail.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import GlassCard from './GlassCard';
import Icon, { type IconName } from './Icon';
import { color, space, type } from './tokens';

export type NotificationChannelKind = 'push' | 'email' | 'sms' | 'whatsapp' | 'in_app';

export type NotificationCardData = {
  id: string;
  channel: NotificationChannelKind;
  title: string;
  body: string;
  timeLabel: string;
  read: boolean;
};

export type NotificationCardProps = {
  notification: NotificationCardData;
  onPress?: () => void;
};

const CHANNEL_ICON: Record<NotificationChannelKind, IconName> = {
  push: 'bell',
  email: 'message',
  sms: 'message',
  whatsapp: 'message',
  in_app: 'sparkles',
};

export default function NotificationCard({ notification, onPress }: NotificationCardProps) {
  return (
    <Pressable onPress={onPress}>
      <GlassCard depthLayer={notification.read ? 1 : 2} padding={space.md}>
        <View style={styles.row}>
          {!notification.read && <View style={styles.unreadRail} />}
          <View style={[styles.iconWrap, !notification.read && styles.iconWrapUnread]}>
            <Icon
              name={CHANNEL_ICON[notification.channel]}
              size="sm"
              color={notification.read ? color.inkDim : color.accent}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[type.title, { fontSize: 13.5 }]} numberOfLines={1}>
              {notification.title}
            </Text>
            <Text style={type.caption} numberOfLines={2}>
              {notification.body}
            </Text>
            <Text style={[type.caption, { color: color.inkDim, marginTop: 2 }]}>
              {notification.timeLabel}
            </Text>
          </View>
        </View>
      </GlassCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  unreadRail: {
    position: 'absolute',
    left: -space.md + 2,
    top: 2,
    bottom: 2,
    width: 3,
    borderRadius: 2,
    backgroundColor: color.accent,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(22,24,28,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapUnread: { backgroundColor: color.accentSoft },
});
