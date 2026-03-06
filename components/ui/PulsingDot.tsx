import React, { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

interface Props {
  color: string;
  size?: number;
}

export function PulsingDot({ color, size = 8 }: Props) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.8);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.7, { duration: 700 }),
        withTiming(1, { duration: 700 })
      ),
      -1,
      false
    );
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.2, { duration: 700 }),
        withTiming(0.8, { duration: 700 })
      ),
      -1,
      false
    );
  }, []);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <View
      style={{
        width: size + 6,
        height: size + 6,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Pulsing ring */}
      <Animated.View
        style={[
          {
            position: "absolute",
            width: size + 6,
            height: size + 6,
            borderRadius: (size + 6) / 2,
            backgroundColor: color,
          },
          ringStyle,
        ]}
      />
      {/* Solid center */}
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}
