/**
 * TaskCard — title, due date, priority indicator, assignee avatar, status
 * toggle, lead context.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import GlassCard from './GlassCard';
import Avatar from './Avatar';
import Icon from './Icon';
import { color, fontFamily, radius, space, type } from './tokens';

export type TaskCardData = {
  id: string;
  title: string;
  dueLabel: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  assigneeName: string | null;
  leadContext: string | null;
  overdue?: boolean;
};

export type TaskCardProps = {
  task: TaskCardData;
  onToggle?: () => void;
  onPress?: () => void;
};

const PRIORITY_COLOR: Record<TaskCardData['priority'], string> = {
  low: color.inkDim,
  medium: color.pending,
  high: color.warning,
  urgent: color.accent,
};

export default function TaskCard({ task, onToggle, onPress }: TaskCardProps) {
  const done = task.status === 'completed';
  return (
    <Pressable onPress={onPress}>
      <GlassCard depthLayer={1} padding={space.md}>
        <View style={styles.row}>
          <Pressable onPress={onToggle} hitSlop={8} style={[styles.check, done && styles.checkDone]}>
            {done && <Icon name="check" size="xs" color={color.surface} weight={2.4} />}
          </Pressable>

          <View style={{ flex: 1 }}>
            <Text
              style={[type.title, { fontSize: 14 }, done && styles.struck]}
              numberOfLines={2}
            >
              {task.title}
            </Text>
            {task.leadContext && (
              <Text style={type.caption} numberOfLines={1}>
                {task.leadContext}
              </Text>
            )}
            <View style={styles.meta}>
              <View style={styles.priority}>
                <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLOR[task.priority] }]} />
                <Text style={[type.caption, { textTransform: 'capitalize' }]}>{task.priority}</Text>
              </View>
              {task.dueLabel && (
                <Text style={[type.caption, task.overdue && { color: color.warning }]}>
                  {task.overdue ? 'Overdue · ' : ''}
                  {task.dueLabel}
                </Text>
              )}
            </View>
          </View>

          {task.assigneeName && <Avatar name={task.assigneeName} size="sm" />}
        </View>
      </GlassCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  check: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: color.inkFaint,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkDone: { backgroundColor: color.success, borderColor: color.success },
  struck: { textDecorationLine: 'line-through', color: color.inkMuted },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: 6 },
  priority: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  priorityDot: { width: 7, height: 7, borderRadius: 4 },
});
