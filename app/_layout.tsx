import React, { useEffect, useRef, useState } from "react";
import { View, ActivityIndicator, Platform } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";

import "../global.css";
import { useThemeStore } from "@/store/themeStore";
import { useUserStore } from "@/store/userStore";
import { useAuthStore } from "@/store/authStore";
import { useAgentStore } from "@/store/agentStore";
import { useNotificationStore } from "@/store/notificationStore";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { OfflineBanner } from "@/components/OfflineBanner";
import { PermissionModal } from "@/components/notifications/PermissionModal";
import {
  requestNotificationPermission,
  getNotificationPermissionStatus,
  getExpoPushToken,
  savePushToken,
  scheduleDailySummary,
} from "@/lib/services/notificationService";

const PERMISSION_ASKED_KEY = "notification_permission_asked_v1";

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
    const inDeepRoute =
      seg0 === "agent" || seg0 === "trader" ||
      seg0 === "notifications" || seg0 === "subscription" ||
      seg0 === "profile-edit" || seg0 === "alpaca-setup";

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

// Manages push notification registration, permission modal, and realtime feed
function NotificationManager() {
  const { session } = useAuthStore();
  const {
    initialize,
    subscribeToRealtime,
    setHasPermission,
    showPermissionModal,
    setShowPermissionModal,
    preferences,
    reset,
  } = useNotificationStore();
  const router = useRouter();
  const unsubRef = useRef<(() => void) | null>(null);

  // Initialize when user logs in
  useEffect(() => {
    if (!session?.user?.id) {
      unsubRef.current?.();
      unsubRef.current = null;
      reset();
      return;
    }
    const userId = session.user.id;
    initialize(userId);
    const unsub = subscribeToRealtime(userId);
    unsubRef.current = unsub;

    // Check existing permission and show modal if needed
    if (Platform.OS !== "web") {
      (async () => {
        const status = await getNotificationPermissionStatus();
        if (status === "granted") {
          setHasPermission(true);
          const token = await getExpoPushToken();
          if (token) savePushToken(userId, token);
          if (preferences.daily_summary) scheduleDailySummary();
        } else {
          const asked = await AsyncStorage.getItem(PERMISSION_ASKED_KEY);
          if (!asked) {
            // Small delay so the main UI renders first
            setTimeout(() => setShowPermissionModal(true), 1500);
          }
        }
      })();
    }

    return () => {
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [session?.user?.id]);

  // Handle notification taps (navigates to agent detail)
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as Record<string, string>;
        if (data?.agent_id) {
          router.push(`/agent/${data.agent_id}` as any);
        }
      }
    );
    return () => subscription.remove();
  }, []);

  async function handleAllow() {
    setShowPermissionModal(false);
    await AsyncStorage.setItem(PERMISSION_ASKED_KEY, "1");
    const status = await requestNotificationPermission();
    if (status === "granted") {
      setHasPermission(true);
      const userId = session?.user?.id;
      if (userId) {
        const token = await getExpoPushToken();
        if (token) await savePushToken(userId, token);
      }
      scheduleDailySummary();
    }
  }

  async function handleSkip() {
    setShowPermissionModal(false);
    await AsyncStorage.setItem(PERMISSION_ASKED_KEY, "1");
  }

  return (
    <PermissionModal
      visible={showPermissionModal}
      onAllow={handleAllow}
      onSkip={handleSkip}
    />
  );
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
      <NotificationManager />
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
        <Stack.Screen
          name="notifications"
          options={{
            headerShown: false,
            animation: Platform.OS === "web" ? "none" : "slide_from_right",
          }}
        />
        <Stack.Screen
          name="subscription"
          options={{
            headerShown: false,
            animation: Platform.OS === "web" ? "none" : "slide_from_right",
          }}
        />
        <Stack.Screen
          name="profile-edit"
          options={{
            headerShown: false,
            animation: Platform.OS === "web" ? "none" : "slide_from_right",
          }}
        />
        <Stack.Screen
          name="alpaca-setup"
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
