/**
 * ViewingCard — a self-contained scheduling workflow inside one card.
 * Thumbnail → time slots → confirmation. No separate screen.
 */
import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, Pressable } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import GlassCard from './GlassCard';
import Icon from './Icon';
import { color, fontFamily, motion, radius, space, type } from './tokens';

export type TimeSlot = { id: string; day: string; time: string };

export type ViewingCardProps = {
  propertyTitle: string;
  propertyImage: string;
  slots: TimeSlot[];
  onConfirm?: (slot: TimeSlot) => void;
};

export default function ViewingCard({ propertyTitle, propertyImage, slots, onConfirm }: ViewingCardProps) {
  const [selected, setSelected] = useState<TimeSlot | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const confirm = () => {
    if (!selected) return;
    setConfirmed(true);
    onConfirm?.(selected);
  };

  return (
    <GlassCard depthLayer={3}>
      <View style={styles.head}>
        <Image source={{ uri: propertyImage }} style={styles.thumb} />
        <View style={{ flex: 1 }}>
          <Text style={type.label}>Schedule a viewing</Text>
          <Text style={[type.title, { fontSize: 14.5 }]} numberOfLines={2}>{propertyTitle}</Text>
        </View>
      </View>

      {!confirmed ? (
        <>
          <View style={styles.slots}>
            {slots.map((s) => {
              const on = selected?.id === s.id;
              return (
                <Pressable
                  key={s.id}
                  style={[styles.slot, on && styles.slotOn]}
                  onPress={() => setSelected(s)}
                >
                  <Text style={[styles.slotDay, on && { color: color.accent }]}>{s.day}</Text>
                  <Text style={[styles.slotTime, on && { color: color.accent }]}>{s.time}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            style={[styles.confirm, !selected && styles.confirmDisabled]}
            onPress={confirm}
            disabled={!selected}
          >
            <Icon name="calendar" size="xs" color={color.onAccent} />
            <Text style={styles.confirmText}>
              {selected ? `Confirm ${selected.day} · ${selected.time}` : 'Pick a time slot'}
            </Text>
          </Pressable>
        </>
      ) : (
        <Animated.View entering={FadeIn.duration(motion.expanded)} style={styles.done}>
          <View style={styles.doneIcon}>
            <Icon name="check" size="md" color={color.success} />
          </View>
          <Text style={[type.title, { fontSize: 14.5 }]}>Viewing confirmed</Text>
          <Text style={type.caption}>
            {selected?.day} at {selected?.time} · Added to your calendar
          </Text>
        </Animated.View>
      )}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  thumb: { width: 56, height: 56, borderRadius: radius.sm },
  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.lg },
  slot: {
    minWidth: 90,
    alignItems: 'center',
    paddingVertical: space.sm + 2,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(22,24,28,0.03)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  slotOn: { backgroundColor: color.accentSoft, borderColor: color.accentBorder },
  slotDay: { fontFamily: fontFamily.medium, fontSize: 12, color: color.inkMuted },
  slotTime: { fontFamily: fontFamily.semibold, fontSize: 13.5, color: color.ink, marginTop: 1 },
  confirm: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    backgroundColor: color.accent,
  },
  confirmDisabled: { opacity: 0.4 },
  confirmText: { fontFamily: fontFamily.semibold, fontSize: 13.5, color: color.onAccent },
  done: { alignItems: 'center', gap: space.xs, paddingVertical: space.lg, marginTop: space.sm },
  doneIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: color.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
});
