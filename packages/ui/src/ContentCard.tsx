/**
 * ContentCard — generated-content preview with platform badge, narrative
 * angle tag, character count, edit toggle, approve + schedule actions.
 * States: draft, approved, scheduled.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput } from 'react-native';
import GlassCard from './GlassCard';
import Tag from './Tag';
import Icon from './Icon';
import { color, fontFamily, radius, space, type } from './tokens';

export type ContentCardState = 'draft' | 'approved' | 'scheduled';

export type ContentCardData = {
  id: string;
  platformLabel: string;
  narrativeAngle: string;
  text: string;
  state: ContentCardState;
};

export type ContentCardProps = {
  content: ContentCardData;
  onApprove?: () => void;
  onSchedule?: () => void;
  onEdit?: (text: string) => void;
};

export default function ContentCard({ content, onApprove, onSchedule, onEdit }: ContentCardProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(content.text);

  return (
    <GlassCard depthLayer={2}>
      <View style={styles.head}>
        <Tag label={content.platformLabel} variant="status" />
        <Tag label={content.narrativeAngle} variant="category" />
        <Text style={[type.caption, { marginLeft: 'auto' }]}>{text.length} chars</Text>
      </View>

      {editing ? (
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          multiline
          autoFocus
        />
      ) : (
        <Text style={[type.body, { fontSize: 13.5, marginTop: space.sm }]}>{text}</Text>
      )}

      <View style={styles.actions}>
        <Pressable
          style={styles.editBtn}
          onPress={() => {
            if (editing) onEdit?.(text);
            setEditing((e) => !e);
          }}
        >
          <Icon name={editing ? 'check' : 'sliders'} size="xs" color={color.ink} />
          <Text style={styles.editText}>{editing ? 'Save' : 'Edit'}</Text>
        </Pressable>

        {content.state === 'draft' && (
          <>
            <Pressable style={styles.action} onPress={onSchedule}>
              <Icon name="calendar" size="xs" color={color.ink} />
              <Text style={styles.actionText}>Schedule</Text>
            </Pressable>
            <Pressable style={[styles.action, styles.actionPrimary]} onPress={onApprove}>
              <Icon name="check.circle" size="xs" color={color.onAccent} />
              <Text style={[styles.actionText, { color: color.onAccent }]}>Approve</Text>
            </Pressable>
          </>
        )}
        {content.state !== 'draft' && (
          <View style={styles.statePill}>
            <Icon name="check.circle" size="xs" color={color.success} />
            <Text style={styles.stateText}>{content.state === 'scheduled' ? 'Scheduled' : 'Approved'}</Text>
          </View>
        )}
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  input: {
    fontFamily: fontFamily.light,
    fontSize: 13.5,
    color: color.ink,
    marginTop: space.sm,
    minHeight: 80,
    textAlignVertical: 'top',
    backgroundColor: 'rgba(22,24,28,0.03)',
    borderRadius: radius.sm,
    padding: space.sm,
  },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.md, alignItems: 'center' },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  editText: { fontFamily: fontFamily.semibold, fontSize: 12.5, color: color.ink },
  action: {
    flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 'auto',
    paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill,
    backgroundColor: 'rgba(22,24,28,0.05)',
  },
  actionPrimary: { backgroundColor: color.accent, marginLeft: 0 },
  actionText: { fontFamily: fontFamily.semibold, fontSize: 12.5, color: color.ink },
  statePill: { flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 'auto' },
  stateText: { fontFamily: fontFamily.semibold, fontSize: 12, color: color.success },
});
