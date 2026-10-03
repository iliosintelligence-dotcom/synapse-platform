/**
 * Profile — name, phone, saved count, sign out. Deliberately minimal for the
 * MVP. (Supporting screen.) Swap MOCK_PROFILE for useProfile(); wire signOut
 * to useAuth().signOut.
 */
import React from 'react';
import { View, ScrollView, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassCard, Avatar, Title, Body, Label, Caption, Button, Icon, color, space } from '@synapse/ui';
import { MOCK_PROFILE } from '../../src/mock';

export default function Profile() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xxl }]}
    >
      <View style={styles.head}>
        <Avatar name={MOCK_PROFILE.full_name} size="xl" />
        <Title style={{ fontSize: 24, marginTop: space.md }}>{MOCK_PROFILE.full_name}</Title>
        <Caption>{MOCK_PROFILE.phone}</Caption>
      </View>

      <GlassCard depthLayer={1} style={{ marginTop: space.xl }}>
        <Row icon="heart" label="Saved properties" value={String(MOCK_PROFILE.savedIds.length)} onPress={() => router.push('/(consumer)/saved')} />
        <Divider />
        <Row icon="message" label="Talk to Toju" value="Home" onPress={() => router.push('/(consumer)/home')} />
        <Divider />
        <Row icon="bell" label="Alerts" value="On" onPress={() => router.push('/(consumer)/alerts')} />
      </GlassCard>

      <GlassCard depthLayer={1} style={{ marginTop: space.md }}>
        <Label style={{ color: color.inkMuted }}>Contact</Label>
        <Body style={{ marginTop: 4 }}>{MOCK_PROFILE.phone}</Body>
      </GlassCard>

      <Button
        label="Sign out"
        variant="destructive"
        icon="xmark"
        style={{ marginTop: space.xl }}
        onPress={() => router.replace('/(auth)/landing')}
      />
    </ScrollView>
  );
}

function Row({
  icon,
  label,
  value,
  onPress,
}: {
  icon: 'heart' | 'message' | 'bell';
  label: string;
  value: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.rowIcon}>
        <Icon name={icon} size="sm" color={color.accent} />
      </View>
      <Body style={{ flex: 1, fontSize: 14.5 }}>{label}</Body>
      <Caption>{value}</Caption>
      <Icon name="chevron.right" size="xs" color={color.inkFaint} />
    </Pressable>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.canvas },
  content: { paddingHorizontal: space.lg },
  head: { alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm + 2 },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: color.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: { height: StyleSheet.hairlineWidth * 2, backgroundColor: color.glassBorder },
});
