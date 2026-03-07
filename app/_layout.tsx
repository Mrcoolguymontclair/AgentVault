import React, { useEffect, useState } from "react";
import { View, ActivityIndicator, Platform } from "react-native";
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
    const inAuth = seg0 === "auth";
    const inSetup = seg0 === "profile-setup";
    const inOnboarding = seg0 === "onboarding";
    const inTabs = seg0 === "(tabs)";
    // Deep routes (agent detail, trader profile) — don't touch these
    const inDeepRoute = seg0 === "agent" || seg0 === "trader";

    if (!session) {
      if (!inAuth) router.replace("/auth/login");
    } else if (!profileComplete) {
      if (!inSetup) router.replace("/profile-setup");
    } else if (!hasSeenOnboarding) {
      if (!inOnboarding) router.replace("/onboarding");
    } else {
      // Redirect root / index / leftover auth routes to tabs
      if (!inTabs && !inDeepRoute) {
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
          animation: Platform.OS === "web" ? "none" : "fade",
          contentStyle: { backgroundColor: "transparent" },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen
          name="onboarding"
          options={{
            animation: Platform.OS === "web" ? "none" : "fade",
            gestureEnabled: false,
          }}
        />
        <Stack.Screen
          name="auth"
          options={{
            animation: Platform.OS === "web" ? "none" : "fade",
            gestureEnabled: false,
          }}
        />
        <Stack.Screen
          name="profile-setup"
          options={{
            animation: Platform.OS === "web" ? "none" : "fade",
            gestureEnabled: false,
          }}
        />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="agent/[id]"
          options={{
            headerShown: false,
            animation: Platform.OS === "web" ? "none" : "slide_from_right",
          }}
        />
        <Stack.Screen
          name="trader/[id]"
          options={{
            headerShown: false,
            animation: Platform.OS === "web" ? "none" : "slide_from_right",
          }}
        />
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
