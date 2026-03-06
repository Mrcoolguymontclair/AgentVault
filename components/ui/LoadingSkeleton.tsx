import React, { useEffect, useRef } from "react";
import { View, Animated, ViewStyle } from "react-native";
import { useTheme } from "@/hooks/useTheme";

interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function Skeleton({ width = "100%", height = 16, borderRadius = 8, style }: SkeletonProps) {
  const { colors } = useTheme();
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(shimmer, {
          toValue: 0,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  const opacity = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 0.85],
  });

  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height,
          borderRadius,
          backgroundColor: colors.skeleton,
          opacity,
        },
        style,
      ]}
    />
  );
}

export function CardSkeleton() {
  const { colors } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        gap: 12,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Skeleton width={44} height={44} borderRadius={12} />
        <View style={{ flex: 1, gap: 8 }}>
          <Skeleton width="60%" height={14} />
          <Skeleton width="40%" height={11} />
        </View>
        <Skeleton width={64} height={24} borderRadius={100} />
      </View>
      <View style={{ gap: 8 }}>
        <Skeleton height={12} />
        <Skeleton width="80%" height={12} />
      </View>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Skeleton width="30%" height={32} borderRadius={8} />
        <Skeleton width="30%" height={32} borderRadius={8} />
        <Skeleton width="30%" height={32} borderRadius={8} />
      </View>
    </View>
  );
}

export function PortfolioSkeleton() {
  const { colors } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 16,
        padding: 20,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        gap: 16,
      }}
    >
      <Skeleton width="50%" height={13} />
      <Skeleton width="70%" height={36} borderRadius={8} />
      <Skeleton width="40%" height={18} borderRadius={8} />
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Skeleton width="48%" height={60} borderRadius={12} />
        <Skeleton width="48%" height={60} borderRadius={12} />
      </View>
    </View>
  );
}
