import React, { useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Dimensions,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUserStore } from "@/store/userStore";
import { Colors } from "@/constants/colors";

const { width } = Dimensions.get("window");

const SLIDES = [
  {
    id: "1",
    icon: "hardware-chip-outline" as const,
    iconColor: Colors.accentLight,
    iconBg: Colors.accentBg,
    badge: "AI-Powered",
    title: "Autonomous\nTrading Agents",
    description:
      "Deploy intelligent trading bots powered by Groq LLM and Alpaca Markets. Each agent runs your strategy 24/7 without you lifting a finger.",
    features: [
      { icon: "flash-outline" as const, text: "Sub-second execution" },
      { icon: "analytics-outline" as const, text: "LLM-driven decisions" },
      { icon: "shield-checkmark-outline" as const, text: "Risk-managed automatically" },
    ],
    gradient: ["#0B5C36", "#084428"],
  },
  {
    id: "2",
    icon: "flask-outline" as const,
    iconColor: Colors.success,
    iconBg: Colors.successBg,
    badge: "Risk-Free Learning",
    title: "Paper vs\nLive Trading",
    description:
      "Start in paper mode — trade with virtual money, zero risk. Prove your strategy works, then go live with real capital when you're confident.",
    features: [
      { icon: "school-outline" as const, text: "Paper mode for practice" },
      { icon: "trending-up-outline" as const, text: "Real market data always" },
      { icon: "rocket-outline" as const, text: "One tap to go live" },
    ],
    gradient: ["#00D68F", "#00B87A"],
  },
  {
    id: "3",
    icon: "trophy-outline" as const,
    iconColor: Colors.gold,
    iconBg: "rgba(255,212,59,0.12)",
    badge: "Compete & Earn",
    title: "Join the\nAgentVault League",
    description:
      "Compete on the leaderboard, follow top traders, share your agents, and climb the ranks. The best strategies rise to the top.",
    features: [
      { icon: "people-outline" as const, text: "Global leaderboard" },
      { icon: "share-social-outline" as const, text: "Share agent strategies" },
      { icon: "star-outline" as const, text: "Earn reputation & badges" },
    ],
    gradient: ["#FFD43B", "#FFA94D"],
  },
];

function Dot({ index, activeIndex }: { index: number; activeIndex: number }) {
  const isActive = index === activeIndex;
  return (
    <View
      style={{
        width: isActive ? 24 : 7,
        height: 7,
        borderRadius: 4,
        backgroundColor: isActive ? Colors.accent : "rgba(139,143,168,0.4)",
        marginHorizontal: 3,
      }}
    />
  );
}

export default function Onboarding() {
  const [activeIndex, setActiveIndex] = useState(0);
  const flatRef = useRef<FlatList>(null);
  const insets = useSafeAreaInsets();
  const { completeOnboarding } = useUserStore();

  const isLast = activeIndex === SLIDES.length - 1;

  function handleNext() {
    if (isLast) {
      handleGetStarted();
    } else {
      const next = activeIndex + 1;
      setActiveIndex(next);
      flatRef.current?.scrollToOffset({ offset: next * width, animated: true });
    }
  }

  async function handleGetStarted() {
    await completeOnboarding();
    router.replace("/(tabs)");
  }

  function handleSkip() {
    handleGetStarted();
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#0F1117" }}>
      <FlatList
        ref={flatRef}
        data={SLIDES}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / width);
          setActiveIndex(idx);
        }}
        renderItem={({ item }) => (
          <View style={{ width, flex: 1 }}>
            <SlideContent slide={item} insetTop={insets.top} />
          </View>
        )}
      />

      {/* Bottom Controls */}
      <View
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          paddingHorizontal: 24,
          paddingBottom: insets.bottom + 20,
          paddingTop: 20,
          gap: 20,
        }}
      >
        {/* Dots */}
        <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center" }}>
          {SLIDES.map((_, i) => (
            <Dot key={i} index={i} activeIndex={activeIndex} />
          ))}
        </View>

        {/* Buttons */}
        <View style={{ gap: 12 }}>
          <Pressable
            onPress={handleNext}
            style={{
              backgroundColor: Colors.accent,
              borderRadius: 16,
              paddingVertical: 18,
              alignItems: "center",
              flexDirection: "row",
              justifyContent: "center",
              gap: 8,
              shadowColor: Colors.accent,
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.4,
              shadowRadius: 16,
              elevation: 8,
            }}
          >
            <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 17, letterSpacing: 0.3 }}>
              {isLast ? "Get Started" : "Continue"}
            </Text>
            <Ionicons
              name={isLast ? "rocket-outline" : "arrow-forward"}
              size={20}
              color="#FFFFFF"
            />
          </Pressable>

          {!isLast && (
            <Pressable onPress={handleSkip} style={{ alignItems: "center", padding: 8 }}>
              <Text style={{ color: "#8B8FA8", fontWeight: "600", fontSize: 15 }}>
                Skip for now
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

function SlideContent({ slide, insetTop }: { slide: (typeof SLIDES)[0]; insetTop: number }) {
  return (
    <View
      style={{
        flex: 1,
        paddingHorizontal: 24,
        paddingTop: insetTop + 60,
        paddingBottom: 200,
        gap: 32,
      }}
    >
      {/* Badge */}
      <View style={{ alignItems: "flex-start" }}>
        <View
          style={{
            backgroundColor: "rgba(11,92,54,0.12)",
            paddingHorizontal: 14,
            paddingVertical: 6,
            borderRadius: 100,
          }}
        >
          <Text style={{ color: Colors.accentLight, fontWeight: "700", fontSize: 12, letterSpacing: 1, textTransform: "uppercase" }}>
            {slide.badge}
          </Text>
        </View>
      </View>

      {/* Icon */}
      <View
        style={{
          width: 96,
          height: 96,
          borderRadius: 28,
          backgroundColor: slide.iconBg,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: `${slide.iconColor}30`,
        }}
      >
        <Ionicons name={slide.icon} size={48} color={slide.iconColor} />
      </View>

      {/* Title */}
      <Text
        style={{
          color: "#FFFFFF",
          fontSize: 38,
          fontWeight: "800",
          letterSpacing: -1,
          lineHeight: 44,
        }}
      >
        {slide.title}
      </Text>

      {/* Description */}
      <Text
        style={{
          color: "#8B8FA8",
          fontSize: 16,
          lineHeight: 26,
          fontWeight: "400",
        }}
      >
        {slide.description}
      </Text>

      {/* Features */}
      <View style={{ gap: 14 }}>
        {slide.features.map((feature, i) => (
          <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                backgroundColor: slide.iconBg,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name={feature.icon} size={18} color={slide.iconColor} />
            </View>
            <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "500" }}>
              {feature.text}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
