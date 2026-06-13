/**
 * AgentCard — human-first. Verification badge, agency + agent, availability,
 * Toju's performance summary, and three actions: Call, WhatsApp, Schedule.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import GlassCard from './GlassCard';
import Icon from './Icon';
import VerificationBadge from './VerificationBadge';
import { color, fontFamily, radius, space, type } from './tokens';

export type AgentCardProps = {
  agencyName: string;
  agentName: string;
  verificationLabel?: string;
  available?: boolean;
  tojuSummary?: string;
  onCall?: () => void;
  onWhatsApp?: () => void;
  onSchedule?: () => void;
};

export default function AgentCard({
  agencyName,
  agentName,
  verificationLabel = 'Verified',
  available = true,
  tojuSummary,
  onCall,
  onWhatsApp,
  onSchedule,
}: AgentCardProps) {
  const initials = agentName.split(' ').map((n) => n[0]).slice(0, 2).join('');

  return (
    <GlassCard depthLayer={2}>
      <View style={styles.head}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <VerificationBadge label={verificationLabel} />
          <Text style={[type.title, { marginTop: space.xs }]}>{agencyName}</Text>
          <View style={styles.agentRow}>
            <Text style={type.label}>{agentName}</Text>
            <View style={[styles.statusDot, { backgroundColor: available ? color.success : color.inkDim }]} />
            <Text style={type.caption}>{available ? 'Available now' : 'Away'}</Text>
          </View>
        </View>
      </View>

      {tojuSummary && (
        <View style={styles.summary}>
          <Icon name="sparkles" size="xs" color={color.accent} />
          <Text style={[type.body, { flex: 1, fontSize: 13, lineHeight: 19 }]}>{tojuSummary}</Text>
        </View>
      )}

      <View style={styles.actions}>
        <Action icon="phone" label="Call" onPress={onCall} />
        <Action icon="message" label="WhatsApp" onPress={onWhatsApp} />
        <Action icon="calendar" label="Schedule" primary onPress={onSchedule} />
      </View>
    </GlassCard>
  );
}

function Action({
  icon, label, primary, onPress,
}: { icon: 'phone' | 'message' | 'calendar'; label: string; primary?: boolean; onPress?: () => void }) {
  return (
    <Pressable style={[styles.action, primary && styles.actionPrimary]} onPress={onPress}>
      <Icon name={icon} size="xs" color={primary ? color.onAccent : color.ink} />
      <Text style={[styles.actionText, primary && { color: color.onAccent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: color.accentSoft,
    borderWidth: 1,
    borderColor: color.accentBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: fontFamily.semibold, fontSize: 16, color: color.accent },
  agentRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 2 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  summary: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    backgroundColor: color.accentSoft,
    borderRadius: radius.sm,
    padding: space.md,
    marginTop: space.lg,
  },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: space.sm + 2,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(22,24,28,0.05)',
  },
  actionPrimary: { backgroundColor: color.accent },
  actionText: { fontFamily: fontFamily.semibold, fontSize: 12.5, color: color.ink },
});
