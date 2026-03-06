import React, { useEffect, useRef } from "react";
import { View, Text, Animated } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function OfflineBanner() {
  const [isOffline, setIsOffline] = React.useState(false);
  const slideAnim = useRef(new Animated.Value(-60)).current;
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const offline = !state.isConnected;
      setIsOffline(offline);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: isOffline ? 0 : -60,
      useNativeDriver: true,
      damping: 18,
      stiffness: 300,
    }).start();
  }, [isOffline]);

  return (
    <Animated.View
      style={{
        position: "absolute",
        top: insets.top,
        left: 0,
        right: 0,
        zIndex: 9999,
        transform: [{ translateY: slideAnim }],
        backgroundColor: "#FF6B6B",
        paddingHorizontal: 16,
        paddingVertical: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        shadowColor: "#FF6B6B",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 10,
      }}
      pointerEvents="none"
    >
      <Ionicons name="wifi-outline" size={16} color="#FFFFFF" />
      <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 13, flex: 1 }}>
        No internet connection — showing cached data
      </Text>
    </Animated.View>
  );
}
