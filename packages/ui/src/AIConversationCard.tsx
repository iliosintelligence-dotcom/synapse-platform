/**
 * AIConversationCard — not chat bubbles, not WhatsApp. Conversational cards:
 * user intent on top (Label, muted) → Toju's response in glass (Body) →
 * generated action buttons → suggested next steps. Every response actionable.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import GlassCard from './GlassCard';
import Icon, { IconName } from './Icon';
import { TojuAvatar } from './AIInsightCard';
import { color, fontFamily, radius, space, type } from './tokens';

export type ConversationAction = {
  label: string;
  icon?: IconName;
  primary?: boolean;
  onPress?: () => void;
};

export type AIConversationCardProps = {
  /** What the user asked — shown muted above the response */
  userIntent: string;
  /** Toju's response text */
  response: string;
  /** Generated action buttons */
  actions?: ConversationAction[];
  /** Suggested next steps — quiet text chips */
  suggestions?: string[];
  onSuggestion?: (s: string) => void;
};

export default function AIConversationCard({
  userIntent,
  response,
  actions = [],
  suggestions = [],
  onSuggestion,
}: AIConversationCardProps) {
  return (
    <View style={styles.wrap}>
      <Text style={[type.label, styles.intent]}>{userIntent}</Text>

      <GlassCard depthLayer={2} edgeGlow>
        <View style={styles.responseRow}>
          <TojuAvatar size={32} />
          <Text style={[type.body, { flex: 1 }]}>{response}</Text>
        </View>

        {actions.length > 0 && (
          <View style={styles.actions}>
            {actions.map((a) => (
              <Pressable
                key={a.label}
                style={[styles.action, a.primary && styles.actionPrimary]}
                onPress={a.onPress}
              >
                {a.icon && <Icon name={a.icon} size="xs" color={a.primary ? color.onAccent : color.ink} />}
                <Text style={[styles.actionText, a.primary && { color: color.onAccent }]}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </GlassCard>

      {suggestions.length > 0 && (
        <View style={styles.suggestions}>
          {suggestions.map((s) => (
            <Pressable key={s} style={styles.suggestion} onPress={() => onSuggestion?.(s)}>
              <Text style={styles.suggestionText}>{s}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  intent: { paddingHorizontal: space.xs },
  responseRow: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.lg },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(22,24,28,0.05)',
  },
  actionPrimary: { backgroundColor: color.accent },
  actionText: { fontFamily: fontFamily.semibold, fontSize: 12.5, color: color.ink },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, paddingHorizontal: space.xs },
  suggestion: {
    paddingHorizontal: space.sm + 2,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.glassBorder,
  },
  suggestionText: { fontFamily: fontFamily.light, fontSize: 12, color: color.inkMuted },
});
