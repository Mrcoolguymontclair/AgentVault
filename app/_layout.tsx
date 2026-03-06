import React, { useEffect, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import "../global.css";
import { useThemeStore } from "@/store/themeStore";
import { useUserStore } from "@/store/userStore";
import { useAuthStore } from "@/store/authStore";
import { useAgentStore } from "@/store/agentStore";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { OfflineBanner } from "@/components/OfflineBanner";

// Handles all auth-driven navigation after stores are loaded
function AuthRouter() {
  const { session, isLoading: authLoading, profileComplete } = useAuthStore();
  const { hasSeenOnboarding } = useUserStore();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (authLoading) return;

    const seg0 = segments[0] as string | undefined;
    if (!seg0) return;

    const inAuth = seg0 === "auth";
    const inSetup = seg0 === "profile-setup";
    const inOnboarding = seg0 === "onboarding";

    if (!session) {
      if (!inAuth) router.replace("/auth/login");
    } else if (!profileComplete) {
      if (!inSetup) router.replace("/profile-setup");
    } else if (!hasSeenOnboarding) {
      if (!inOnboarding) router.replace("/onboarding");
    } else {
      if (inAuth || inSetup || inOnboarding || seg0 === "index") {
        router.replace("/(tabs)");
      }
    }
  }, [session, authLoading, profileComplete, hasSeenOnboarding, segments]);

  return null;
}

// Starts realtime subscriptions when user is authenticated
function RealtimeManager() {
  const { session } = useAuthStore();
  const { startRealtimeSubscriptions, stopRealtimeSubscriptions, loadAgents, loadRecentTrades } =
    useAgentStore();

  useEffect(() => {
    if (!session?.user?.id) {
      stopRealtimeSubscriptions();
      return;
    }
    const userId = session.user.id;
    loadAgents(userId);
    loadRecentTrades(userId);
    startRealtimeSubscriptions(userId);

    return () => {
      stopRealtimeSubscriptions();
    };
  }, [session?.user?.id]);

  return null;
}

function AppLoader() {
  const [ready, setReady] = useState(false);
  const { loadTheme, theme } = useThemeStore();
  const { loadUser } = useUserStore();
  const { initialize: initAuth } = useAuthStore();

  useEffect(() => {
    Promise.all([loadTheme(), loadUser(), initAuth()]).then(() =>
      setReady(true)
    );
  }, []);

  if (!ready) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#0F1117",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator size="large" color="#6C5CE7" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
      <AuthRouter />
      <RealtimeManager />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: "fade",
          contentStyle: { backgroundColor: "transparent" },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen
          name="onboarding"
          options={{ animation: "fade", gestureEnabled: false }}
        />
        <Stack.Screen
          name="auth"
          options={{ animation: "fade", gestureEnabled: false }}
        />
        <Stack.Screen
          name="profile-setup"
          options={{ animation: "fade", gestureEnabled: false }}
        />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
      <OfflineBanner />
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <AppLoader />
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
