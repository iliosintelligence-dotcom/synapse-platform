/**
 * CommuteCard — generated from a PropertyCard. Commute time, traffic pattern,
 * travel options, Toju observation. Compact by default, expands on tap.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import GlassCard from './GlassCard';
import Icon, { IconName } from './Icon';
import { color, fontFamily, motion, radius, space, type } from './tokens';

export type TravelOption = { mode: string; icon: IconName; time: string };

export type CommuteCardProps = {
  destination: string;
  primaryTime: string;
  trafficPattern: string;
  options?: TravelOption[];
  observation?: string;
  expanded?: boolean;
};

export default function CommuteCard({
  destination,
  primaryTime,
  trafficPattern,
  options = [],
  observation,
  expanded: initialExpanded = false,
}: CommuteCardProps) {
  const [expanded, setExpanded] = useState(initialExpanded);

  return (
    <Pressable onPress={() => setExpanded((e) => !e)}>
      <GlassCard depthLayer={2}>
        <View style={styles.row}>
          <View style={styles.iconWrap}>
            <Icon name="car" size="sm" color={color.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={type.label}>Commute to {destination}</Text>
            <Text style={styles.time}>{primaryTime}</Text>
            <Text style={type.caption}>{trafficPattern}</Text>
          </View>
          <Icon name={expanded ? 'chevron.down' : 'chevron.right'} size="sm" color={color.inkDim} />
        </View>

        {expanded && (
          <Animated.View entering={FadeIn.duration(motion.standard)} style={styles.expandWrap}>
            {options.length > 0 && (
              <View style={styles.options}>
                {options.map((o) => (
                  <View key={o.mode} style={styles.option}>
                    <Icon name={o.icon} size="sm" color={color.inkMuted} />
                    <Text style={styles.optionTime}>{o.time}</Text>
                    <Text style={type.caption}>{o.mode}</Text>
                  </View>
                ))}
              </View>
            )}
            {observation && (
              <View style={styles.observation}>
                <Icon name="sparkles" size="xs" color={color.accent} />
                <Text style={[type.body, { flex: 1, fontSize: 13, lineHeight: 19 }]}>{observation}</Text>
              </View>
            )}
          </Animated.View>
        )}
      </GlassCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    backgroundColor: color.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  time: { fontFamily: fontFamily.display, fontSize: 24, letterSpacing: 1, color: color.ink, marginVertical: 1 },
  expandWrap: { marginTop: space.lg, gap: space.md },
  options: { flexDirection: 'row', gap: space.sm },
  option: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(22,24,28,0.03)',
    borderRadius: radius.sm,
    paddingVertical: space.md,
  },
  optionTime: { fontFamily: fontFamily.semibold, fontSize: 13, color: color.ink },
  observation: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    backgroundColor: color.accentSoft,
    borderRadius: radius.sm,
    padding: space.md,
  },
});
