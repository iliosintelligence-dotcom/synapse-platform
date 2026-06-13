/**
 * Root layout — boots services, loads fonts, resolves the session, and
 * routes by role. The splash view holds until status !== 'resolving',
 * so there is never an auth flash.
 */
import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts, BebasNeue_400Regular } from '@expo-google-fonts/bebas-neue';
import {
  DMSans_300Light,
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
} from '@expo-google-fonts/dm-sans';
import { bindAuthEvents, homeRouteFor, useSessionStore } from '@synapse/auth';
import { color } from '@synapse/ui';
import { bootApp } from '../src/lib/boot';

bootApp();

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    BebasNeue_400Regular,
    DMSans_300Light,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
  });

  const status = useSessionStore((s) => s.status);
  const user = useSessionStore((s) => s.user);
  const resolve = useSessionStore((s) => s.resolve);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    const unbind = bindAuthEvents();
    void resolve();
    return unbind;
  }, [resolve]);

  // Role-based routing: consumers → consumer tabs, agencies → agency tabs,
  // signed out → auth stack.
  useEffect(() => {
    if (status === 'resolving' || !fontsLoaded) return;
    const inAuthGroup = segments[0] === '(auth)';

    if (status === 'signed_out' && !inAuthGroup) {
      router.replace('/(auth)/landing');
    } else if (status === 'signed_in' && inAuthGroup) {
      router.replace(homeRouteFor(user));
    }
  }, [status, fontsLoaded, segments, user, router]);

  if (!fontsLoaded || status === 'resolving') {
    return (
      <View style={{ flex: 1, backgroundColor: color.canvas, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={color.accent} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.canvas } }} />
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
