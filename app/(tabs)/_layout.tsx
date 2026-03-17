import React from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { View, Text, Platform } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/colors";
import { useDebugStore } from "@/store/debugStore";

type IoniconName = keyof typeof Ionicons.glyphMap;

interface TabIconProps {
  name: IoniconName;
  focused: boolean;
  label: string;
  color: string;
}

function TabIcon({ name, focused, label, color }: TabIconProps) {
  const { colors, isDark } = useTheme();

  return (
    <View style={{ alignItems: "center", justifyContent: "center", gap: 3, paddingTop: 4 }}>
      <View
        style={{
          width: 44,
          height: 28,
          borderRadius: 14,
          backgroundColor: focused ? Colors.accentBg : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons
          name={focused ? (String(name).replace("-outline", "") as IoniconName) : name}
          size={22}
          color={focused ? Colors.accent : colors.textTertiary}
        />
      </View>
      <Text
        style={{
          fontSize: 10,
          fontWeight: focused ? "700" : "500",
          color: focused ? Colors.accent : colors.textTertiary,
          letterSpacing: 0.2,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export default function TabsLayout() {
  const { colors, isDark } = useTheme();
  const { devMode } = useDebugStore();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.tabBar,
          borderTopWidth: 1,
          borderTopColor: colors.tabBarBorder,
          height: Platform.OS === "ios" ? 85 : 68,
          paddingBottom: Platform.OS === "ios" ? 24 : 8,
          paddingTop: 0,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarShowLabel: false,
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: colors.textTertiary,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name="home-outline" focused={focused} label="Home" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="agents"
        options={{
          title: "Agents",
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name="hardware-chip-outline" focused={focused} label="Agents" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="leaderboard"
        options={{
          title: "Leaderboard",
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name="trophy-outline" focused={focused} label="Ranks" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="social"
        options={{
          title: "Social",
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name="people-outline" focused={focused} label="Social" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name="settings-outline" focused={focused} label="Settings" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="debug"
        options={{
          title: "Debug",
          href: devMode ? undefined : null,
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name="construct-outline" focused={focused} label="Debug" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
