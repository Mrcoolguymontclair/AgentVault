import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  useWindowDimensions,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/authStore";
import { useAgentStore, type Agent } from "@/store/agentStore";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Colors } from "@/constants/colors";
import {
  STRATEGIES,
  AI_MODELS,
  TIME_HORIZONS,
  BUDGET_PRESETS,
  RISK_CONFIG,
  TIER_LIMITS,
  type StrategyId,
  type ModelId,
  type TimeHorizonId,
  type Strategy,
} from "@/constants/strategies";
import { checkAgentLimit, checkAlpacaKeyStatus } from "@/lib/services/agentService";
import { useNotificationStore } from "@/store/notificationStore";
import type { AgentMode } from "@/store/agentStore";

interface Props {
  visible: boolean;
  onClose: () => void;
  onDeployed?: (agent: Agent) => void;
}

type Step = 1 | 2 | 3 | 4;

const STEP_LABELS = ["Strategy", "Configure", "AI Model", "Deploy"];

export function DeploySheet({ visible, onClose, onDeployed }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user: authUser } = useAuthStore();
  const { agents, createAgent } = useAgentStore();
  const { sendWelcomeNotification } = useNotificationStore();

  const [step, setStep] = useState<Step>(1);
  const [selectedStrategyId, setSelectedStrategyId] = useState<StrategyId | null>(null);
  const [agentName, setAgentName] = useState("");
  const [budget, setBudget] = useState(1000);
  const [mode, setMode] = useState<AgentMode>("paper");
  const [params, setParams] = useState<Record<string, number>>({});
  const [strategyPrompt, setStrategyPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState<ModelId>("groq_llama");
  const [timeHorizon, setTimeHorizon] = useState<TimeHorizonId>("medium");
  const [isPrivate, setIsPrivate] = useState(false);
  const [aggressive, setAggressive] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);

  const plan = (authUser?.user_metadata?.plan as string) ?? "free";
  const strategy = STRATEGIES.find((s) => s.id === selectedStrategyId);

  function resetAndClose() {
    setStep(1);
    setSelectedStrategyId(null);
    setAgentName("");
    setBudget(1000);
    setMode("paper");
    setParams({});
    setStrategyPrompt("");
    setSelectedModel("groq_llama");
    setTimeHorizon("medium");
    setIsPrivate(false);
    setAggressive(false);
    setIsDeploying(false);
    setDeployError(null);
    onClose();
  }

  function selectStrategy(s: Strategy) {
    setSelectedStrategyId(s.id);
    // Pre-fill params with defaults
    const defaults: Record<string, number> = {};
    s.params.forEach((p) => { defaults[p.key] = p.default; });
    setParams(defaults);
    // Suggest a unique name (avoid reusing names of existing agents)
    const suggestion = s.nameSuggestions[Math.floor(Math.random() * s.nameSuggestions.length)];
    const existingNames = agents.map((a) => a.name);
    let finalName = suggestion;
    if (existingNames.includes(finalName)) {
      let n = 2;
      while (existingNames.includes(`${suggestion} ${n}`)) n++;
      finalName = `${suggestion} ${n}`;
    }
    setAgentName(finalName);
    setStep(2);
  }

  function adjustParam(key: string, delta: number, min: number, max: number, step_size: number) {
    setParams((prev) => {
      const current = prev[key] ?? 0;
      const next = Math.round((current + delta) / step_size) * step_size;
      return { ...prev, [key]: Math.min(max, Math.max(min, next)) };
    });
  }

  async function handleDeploy() {
    if (!authUser?.id || !selectedStrategyId || !strategy) return;

    setIsDeploying(true);
    setDeployError(null);

    try {
      // Check Alpaca keys for live mode
      if (mode === "live") {
        const keyStatus = await checkAlpacaKeyStatus(authUser.id);
        if (!keyStatus?.has_keys) {
          setIsDeploying(false);
          setDeployError(null);
          Alert.alert(
            "Connect Alpaca First",
            "Live trading requires your Alpaca API keys. Connect them in Settings.",
            [
              { text: "Cancel", style: "cancel" },
              { text: "Connect Now", onPress: () => { resetAndClose(); router.push("/alpaca-setup" as any); } },
            ]
          );
          return;
        }
      }

      const { canCreate, current, limit } = await checkAgentLimit(authUser.id, plan);
      if (!canCreate) {
        setIsDeploying(false);
        setDeployError(
          `Your ${plan} plan supports up to ${limit} active agent${limit === 1 ? "" : "s"}. You have ${current}. Upgrade to deploy more.`
        );
        return;
      }

      const config: Record<string, number | string> = {
        ...params,
        time_horizon: timeHorizon,
        ...(aggressive ? { aggressive_mode: 1 } : {}),
        ...(selectedStrategyId === "custom" && strategyPrompt.trim()
          ? { strategy_prompt: strategyPrompt.trim() }
          : {}),
      };

      const { agent, error } = await createAgent(authUser.id, {
        name: agentName.trim() || strategy.name,
        strategy: selectedStrategyId,
        description: selectedStrategyId === "custom"
          ? strategyPrompt.trim().slice(0, 200) || strategy.description
          : strategy.description,
        mode,
        config,
        budget,
        is_private: isPrivate,
        model_id: selectedModel,
      });

      setIsDeploying(false);

      if (error || !agent) {
        console.error("[DeploySheet] deploy failed:", error);
        setDeployError(error ?? "Something went wrong. Please try again.");
        return;
      }

      // Send welcome notification on very first agent deployment
      const isFirstAgent = agents.length === 0;
      if (isFirstAgent) {
        sendWelcomeNotification(authUser.id, agent.name);
      }

      onDeployed?.(agent);
      resetAndClose();
    } catch (e: any) {
      console.error("[DeploySheet] deploy threw:", e);
      setIsDeploying(false);
      setDeployError(e?.message ?? "Unexpected error. Please try again.");
    }
  }

  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isWide = Platform.OS === "web" && screenWidth >= 768;

  const tierLimit = TIER_LIMITS[plan as keyof typeof TIER_LIMITS] ?? 1;
  const atLimit = agents.filter((a) => a.status !== "stopped").length >= tierLimit;

  return (
    <Modal
      visible={visible}
      transparent
      animationType={isWide ? "fade" : "slide"}
      onRequestClose={resetAndClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <Pressable
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.6)",
            justifyContent: isWide ? "center" : "flex-end",
            alignItems: isWide ? "center" : "stretch",
          }}
          onPress={step === 1 ? resetAndClose : undefined}
        >
          <Pressable onPress={(e) => e.stopPropagation()}>
            <View
              style={{
                backgroundColor: colors.card,
                borderTopLeftRadius: 28,
                borderTopRightRadius: isWide ? 28 : 28,
                borderBottomLeftRadius: isWide ? 28 : 0,
                borderBottomRightRadius: isWide ? 28 : 0,
                borderWidth: 1,
                borderBottomWidth: isWide ? 1 : 0,
                borderColor: colors.cardBorder,
                maxHeight: isWide ? screenHeight * 0.85 : "92%",
                width: isWide ? Math.min(680, screenWidth * 0.9) : "100%",
              }}
            >
              {/* Drag Handle — only on mobile bottom sheet */}
              {!isWide && (
                <View style={{ alignItems: "center", paddingTop: 12, paddingBottom: 4 }}>
                  <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.divider }} />
                </View>
              )}

              {/* Header */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 20,
                  paddingVertical: 14,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.divider,
                  gap: 12,
                }}
              >
                {step > 1 && (
                  <Pressable
                    onPress={() => setStep((s) => (s - 1) as Step)}
                    hitSlop={12}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 10,
                      backgroundColor: colors.cardBorder,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name="chevron-back" size={18} color={colors.textSecondary} />
                  </Pressable>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700", letterSpacing: -0.3 }}>
                    Deploy Agent
                  </Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                    Step {step} of 4 — {STEP_LABELS[step - 1]}
                  </Text>
                </View>
                <Pressable
                  onPress={resetAndClose}
                  hitSlop={12}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    backgroundColor: colors.cardBorder,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="close" size={18} color={colors.textSecondary} />
                </Pressable>
              </View>

              {/* Step Progress */}
              <View style={{ flexDirection: "row", gap: 4, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 }}>
                {[1, 2, 3, 4].map((s) => (
                  <View
                    key={s}
                    style={{
                      flex: 1,
                      height: 3,
                      borderRadius: 2,
                      backgroundColor: s <= step ? Colors.accent : colors.cardBorder,
                    }}
                  />
                ))}
              </View>

              {/* Content */}
              {step === 1 && <StepStrategy colors={colors} onSelect={selectStrategy} />}
              {step === 2 && strategy && (
                <StepConfigure
                  colors={colors}
                  strategy={strategy}
                  agentName={agentName}
                  setAgentName={setAgentName}
                  budget={budget}
                  setBudget={setBudget}
                  mode={mode}
                  setMode={setMode}
                  params={params}
                  adjustParam={adjustParam}
                  strategyPrompt={strategyPrompt}
                  setStrategyPrompt={setStrategyPrompt}
                  plan={plan}
                  timeHorizon={timeHorizon}
                  setTimeHorizon={setTimeHorizon}
                  isPrivate={isPrivate}
                  setIsPrivate={setIsPrivate}
                  aggressive={aggressive}
                  setAggressive={setAggressive}
                  onNext={() => setStep(3)}
                />
              )}
              {step === 3 && (
                <StepModel
                  colors={colors}
                  plan={plan}
                  selectedModel={selectedModel}
                  setSelectedModel={setSelectedModel}
                  onNext={() => setStep(4)}
                />
              )}
              {step === 4 && strategy && (
                <StepReview
                  colors={colors}
                  strategy={strategy}
                  agentName={agentName}
                  budget={budget}
                  mode={mode}
                  params={params}
                  strategyPrompt={strategyPrompt}
                  selectedModel={selectedModel}
                  timeHorizon={timeHorizon}
                  isPrivate={isPrivate}
                  aggressive={aggressive}
                  isDeploying={isDeploying}
                  atLimit={atLimit}
                  plan={plan}
                  tierLimit={tierLimit}
                  onDeploy={handleDeploy}
                  insets={insets}
                  deployError={deployError}
                />
              )}
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function StepStrategy({ colors, onSelect }: { colors: any; onSelect: (s: Strategy) => void }) {
  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ padding: 20, gap: 12 }}
    >
      <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 4 }}>
        Choose a strategy to power your agent. You can fine-tune parameters in the next step.
      </Text>
      {STRATEGIES.map((s) => {
        const risk = RISK_CONFIG[s.risk];
        return (
          <Pressable
            key={s.id}
            onPress={() => onSelect(s)}
            style={({ pressed }) => ({
              backgroundColor: pressed ? colors.cardSecondary : colors.card,
              borderRadius: 16,
              borderWidth: 1.5,
              borderColor: colors.cardBorder,
              padding: 16,
              flexDirection: "row",
              alignItems: "center",
              gap: 14,
            })}
          >
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: 16,
                backgroundColor: colors.cardSecondary,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 26 }}>{s.icon}</Text>
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ color: colors.text, fontWeight: "700", fontSize: 16 }}>{s.name}</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 18 }}>
                {s.tagline}
              </Text>
              <View style={{ marginTop: 4 }}>
                <Badge label={risk.label} variant={s.risk === "low" ? "success" : s.risk === "medium" ? "warning" : "danger"} />
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </Pressable>
        );
      })}
      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

const EXAMPLE_PROMPTS = [
  {
    label: "Buy the Dip",
    prompt:
      "Buy any stock that drops 5% or more in a single day. Sell when it recovers 3% from my buy price. Never invest more than $200 per trade.",
  },
  {
    label: "Momentum Chaser",
    prompt:
      "Buy stocks showing strong upward momentum — price above their 20-day average with RSI above 60. Sell if price drops below the 20-day average.",
  },
  {
    label: "Oversold Bounce",
    prompt:
      "Focus on large-cap tech stocks. Buy only when RSI drops below 35, indicating oversold conditions. Take profits at a 5% gain or cut losses at 3% down.",
  },
];

function StepConfigure({
  colors,
  strategy,
  agentName,
  setAgentName,
  budget,
  setBudget,
  mode,
  setMode,
  params,
  adjustParam,
  strategyPrompt,
  setStrategyPrompt,
  plan,
  timeHorizon,
  setTimeHorizon,
  isPrivate,
  setIsPrivate,
  aggressive,
  setAggressive,
  onNext,
}: {
  colors: any;
  strategy: Strategy;
  agentName: string;
  setAgentName: (v: string) => void;
  budget: number;
  setBudget: (v: number) => void;
  mode: AgentMode;
  setMode: (v: AgentMode) => void;
  params: Record<string, number>;
  adjustParam: (key: string, delta: number, min: number, max: number, step: number) => void;
  strategyPrompt: string;
  setStrategyPrompt: (v: string) => void;
  plan: string;
  timeHorizon: TimeHorizonId;
  setTimeHorizon: (v: TimeHorizonId) => void;
  isPrivate: boolean;
  setIsPrivate: (v: boolean) => void;
  aggressive: boolean;
  setAggressive: (v: boolean) => void;
  onNext: () => void;
}) {
  const canGoLive = plan !== "free";
  const canPrivate = plan !== "free";
  const risk = RISK_CONFIG[strategy.risk];

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ padding: 20, gap: 20 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Strategy Info */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          padding: 14,
          backgroundColor: colors.cardSecondary,
          borderRadius: 14,
        }}
      >
        <Text style={{ fontSize: 28 }}>{strategy.icon}</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15 }}>{strategy.name}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>{risk.label}</Text>
        </View>
      </View>

      {/* Agent Name */}
      <View style={{ gap: 8 }}>
        <Text style={{ color: colors.text, fontWeight: "600", fontSize: 14 }}>Agent Name</Text>
        <TextInput
          value={agentName}
          onChangeText={setAgentName}
          placeholder="Enter a name..."
          placeholderTextColor={colors.textTertiary}
          style={{
            color: colors.text,
            backgroundColor: colors.cardSecondary,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.cardBorder,
            paddingHorizontal: 14,
            paddingVertical: 12,
            fontSize: 15,
            fontWeight: "500",
          }}
          maxLength={32}
        />
        {/* Name Suggestions */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: -2 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {strategy.nameSuggestions.map((name) => (
              <Pressable
                key={name}
                onPress={() => setAgentName(name)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 100,
                  backgroundColor: agentName === name ? Colors.accentBg : colors.cardSecondary,
                  borderWidth: 1,
                  borderColor: agentName === name ? Colors.accent : colors.cardBorder,
                }}
              >
                <Text
                  style={{
                    color: agentName === name ? Colors.accentLight : colors.textSecondary,
                    fontSize: 12,
                    fontWeight: "600",
                  }}
                >
                  {name}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </View>

      {/* Budget */}
      <View style={{ gap: 8 }}>
        <Text style={{ color: colors.text, fontWeight: "600", fontSize: 14 }}>Starting Budget</Text>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {BUDGET_PRESETS.map((b) => (
            <Pressable
              key={b}
              onPress={() => setBudget(b)}
              style={{
                paddingHorizontal: 16,
                paddingVertical: 10,
                borderRadius: 12,
                backgroundColor: budget === b ? Colors.accentBg : colors.cardSecondary,
                borderWidth: 1.5,
                borderColor: budget === b ? Colors.accent : colors.cardBorder,
              }}
            >
              <Text
                style={{
                  color: budget === b ? Colors.accentLight : colors.textSecondary,
                  fontWeight: "700",
                  fontSize: 14,
                }}
              >
                ${b >= 1000 ? `${b / 1000}K` : b}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Mode Toggle */}
      <View style={{ gap: 8 }}>
        <Text style={{ color: colors.text, fontWeight: "600", fontSize: 14 }}>Trading Mode</Text>
        <View style={{ flexDirection: "row", gap: 10 }}>
          {(["paper", "live"] as AgentMode[]).map((m) => {
            const locked = m === "live" && !canGoLive;
            const selected = mode === m;
            return (
              <Pressable
                key={m}
                onPress={() => {
                  if (locked) {
                    Alert.alert("Pro Required", "Live trading is available on Pro and Elite plans.");
                    return;
                  }
                  setMode(m);
                }}
                style={{
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  padding: 14,
                  borderRadius: 14,
                  backgroundColor: selected ? (m === "live" ? Colors.dangerBg : Colors.accentBg) : colors.cardSecondary,
                  borderWidth: 1.5,
                  borderColor: selected ? (m === "live" ? Colors.danger : Colors.accent) : colors.cardBorder,
                  opacity: locked ? 0.5 : 1,
                }}
              >
                <Ionicons
                  name={locked ? "lock-closed" : m === "live" ? "flash" : "flask"}
                  size={16}
                  color={selected ? (m === "live" ? Colors.danger : Colors.accentLight) : colors.textSecondary}
                />
                <Text
                  style={{
                    color: selected ? (m === "live" ? Colors.danger : Colors.accentLight) : colors.textSecondary,
                    fontWeight: "700",
                    fontSize: 14,
                    textTransform: "capitalize",
                  }}
                >
                  {m} {locked ? "(Pro)" : ""}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Time Horizon */}
      <View style={{ gap: 10 }}>
        <Text style={{ color: colors.text, fontWeight: "600", fontSize: 14 }}>Time Horizon</Text>
        {TIME_HORIZONS.map((h) => {
          const selected = timeHorizon === h.id;
          const isBestFor = h.bestFor.includes(strategy.id as StrategyId);
          return (
            <Pressable
              key={h.id}
              onPress={() => setTimeHorizon(h.id)}
              style={{
                borderRadius: 14,
                borderWidth: 1.5,
                borderColor: selected ? Colors.accent : colors.cardBorder,
                backgroundColor: selected ? Colors.accentBg : colors.cardSecondary,
                padding: 14,
                gap: 6,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Text style={{ fontSize: 22 }}>{h.icon}</Text>
                  <View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={{ color: selected ? Colors.accentLight : colors.text, fontWeight: "700", fontSize: 15 }}>
                        {h.name}
                      </Text>
                      <Text style={{ color: selected ? Colors.accentLight : colors.textSecondary, fontSize: 12, fontWeight: "600" }}>
                        {h.subtitle}
                      </Text>
                      {isBestFor && (
                        <View style={{ backgroundColor: Colors.accentBg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                          <Text style={{ color: Colors.accentLight, fontSize: 10, fontWeight: "700" }}>RECOMMENDED</Text>
                        </View>
                      )}
                    </View>
                    <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 2 }}>
                      {h.targets} · {h.stopLoss}
                    </Text>
                  </View>
                </View>
                {selected && (
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: Colors.accent, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="checkmark" size={12} color="#fff" />
                  </View>
                )}
              </View>
              <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, paddingLeft: 32 }}>
                {h.description}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Strategy Params OR Custom Prompt */}
      {strategy.id === "custom" ? (
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: colors.text, fontWeight: "600", fontSize: 14 }}>Your Trading Instructions</Text>
            <View style={{ backgroundColor: Colors.accentBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
              <Text style={{ color: Colors.accentLight, fontSize: 10, fontWeight: "700" }}>AI POWERED</Text>
            </View>
          </View>
          <TextInput
            value={strategyPrompt}
            onChangeText={setStrategyPrompt}
            placeholder={
              "Describe your trading strategy...\n\nExample: Buy AAPL when the price drops more than 3% in a single day. Sell when it recovers 2% from my buy price. Never invest more than $200 per trade."
            }
            placeholderTextColor={colors.textTertiary}
            multiline
            numberOfLines={6}
            style={{
              color: colors.text,
              backgroundColor: colors.cardSecondary,
              borderRadius: 14,
              borderWidth: 1.5,
              borderColor: strategyPrompt.trim() ? Colors.accent : colors.cardBorder,
              paddingHorizontal: 14,
              paddingVertical: 12,
              fontSize: 14,
              lineHeight: 20,
              minHeight: 140,
              textAlignVertical: "top",
            }}
            maxLength={1000}
          />
          <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
            <Text style={{ color: colors.textTertiary, fontSize: 11 }}>
              {strategyPrompt.length}/1000
            </Text>
          </View>

          {/* Example prompts */}
          <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: "600" }}>
            Quick examples — tap to use:
          </Text>
          {EXAMPLE_PROMPTS.map((ex) => (
            <Pressable
              key={ex.label}
              onPress={() => setStrategyPrompt(ex.prompt)}
              style={{
                backgroundColor: strategyPrompt === ex.prompt ? Colors.accentBg : colors.cardSecondary,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: strategyPrompt === ex.prompt ? Colors.accent : colors.cardBorder,
                padding: 12,
                gap: 4,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons
                  name="bulb-outline"
                  size={14}
                  color={strategyPrompt === ex.prompt ? Colors.accentLight : colors.textSecondary}
                />
                <Text
                  style={{
                    color: strategyPrompt === ex.prompt ? Colors.accentLight : colors.text,
                    fontWeight: "700",
                    fontSize: 13,
                  }}
                >
                  {ex.label}
                </Text>
              </View>
              <Text
                style={{
                  color: strategyPrompt === ex.prompt ? Colors.accentLight : colors.textSecondary,
                  fontSize: 12,
                  lineHeight: 17,
                  opacity: 0.85,
                }}
                numberOfLines={2}
              >
                {ex.prompt}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          <Text style={{ color: colors.text, fontWeight: "600", fontSize: 14 }}>Strategy Parameters</Text>
          {strategy.params.map((p) => {
            const val = params[p.key] ?? p.default;
            return (
              <View
                key={p.key}
                style={{
                  backgroundColor: colors.cardSecondary,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: colors.cardBorder,
                  padding: 14,
                  gap: 8,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: "600", fontSize: 14 }}>{p.label}</Text>
                    <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 2 }}>{p.hint}</Text>
                  </View>
                  <Text style={{ color: Colors.accent, fontWeight: "800", fontSize: 18 }}>
                    {p.unit.startsWith("$") ? `$${val}` : `${val}${p.unit}`}
                  </Text>
                </View>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <Pressable
                    onPress={() => adjustParam(p.key, -p.step, p.min, p.max, p.step)}
                    hitSlop={8}
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      backgroundColor: colors.card,
                      borderWidth: 1,
                      borderColor: colors.cardBorder,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name="remove" size={20} color={val <= p.min ? colors.textTertiary : colors.text} />
                  </Pressable>
                  <View style={{ flex: 1, height: 4, backgroundColor: colors.cardBorder, borderRadius: 2 }}>
                    <View
                      style={{
                        width: `${((val - p.min) / (p.max - p.min)) * 100}%`,
                        height: 4,
                        borderRadius: 2,
                        backgroundColor: Colors.accent,
                      }}
                    />
                  </View>
                  <Pressable
                    onPress={() => adjustParam(p.key, p.step, p.min, p.max, p.step)}
                    hitSlop={8}
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      backgroundColor: colors.card,
                      borderWidth: 1,
                      borderColor: colors.cardBorder,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name="add" size={20} color={val >= p.max ? colors.textTertiary : colors.text} />
                  </Pressable>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: colors.textTertiary, fontSize: 11 }}>
                    Min: {p.unit.startsWith("$") ? `$${p.min}` : `${p.min}${p.unit}`}
                  </Text>
                  <Text style={{ color: colors.textTertiary, fontSize: 11 }}>
                    Max: {p.unit.startsWith("$") ? `$${p.max}` : `${p.max}${p.unit}`}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Private Toggle */}
      <Pressable
        onPress={() => {
          if (!canPrivate) {
            Alert.alert("Pro Required", "Private agents are available on Pro and Elite plans.");
            return;
          }
          setIsPrivate(!isPrivate);
        }}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
          padding: 14,
          backgroundColor: colors.cardSecondary,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: isPrivate ? Colors.accent : colors.cardBorder,
          opacity: canPrivate ? 1 : 0.6,
        }}
      >
        <Ionicons
          name={isPrivate ? "eye-off" : "eye"}
          size={20}
          color={isPrivate ? Colors.accentLight : colors.textSecondary}
        />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: "600", fontSize: 14 }}>
            Private Agent {!canPrivate && "(Pro)"}
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
            {isPrivate ? "Hidden from leaderboard & social feed" : "Visible on leaderboard & social feed"}
          </Text>
        </View>
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 8,
            backgroundColor: isPrivate ? Colors.accent : colors.card,
            borderWidth: 1.5,
            borderColor: isPrivate ? Colors.accent : colors.cardBorder,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {isPrivate && <Ionicons name="checkmark" size={14} color="#fff" />}
        </View>
      </Pressable>

      {/* Aggressive Mode Toggle */}
      <Pressable
        onPress={() => setAggressive(!aggressive)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
          padding: 14,
          backgroundColor: colors.cardSecondary,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: aggressive ? Colors.warning : colors.cardBorder,
        }}
      >
        <Ionicons
          name="flash"
          size={20}
          color={aggressive ? Colors.warning : colors.textSecondary}
        />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: "600", fontSize: 14 }}>
            Aggressive Mode
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
            {aggressive
              ? "Looser signals — trades more often with lower confidence bar"
              : "Default sensitivity — balanced signal quality"}
          </Text>
        </View>
        <View
          style={{
            width: 24, height: 24, borderRadius: 8,
            backgroundColor: aggressive ? Colors.warning : colors.card,
            borderWidth: 1.5,
            borderColor: aggressive ? Colors.warning : colors.cardBorder,
            alignItems: "center", justifyContent: "center",
          }}
        >
          {aggressive && <Ionicons name="checkmark" size={14} color="#fff" />}
        </View>
      </Pressable>

      {/* Next Button */}
      <Button
        variant="primary"
        size="lg"
        onPress={onNext}
        disabled={
          !agentName.trim() ||
          (strategy.id === "custom" && strategyPrompt.trim().length < 20)
        }
      >
        Continue to AI Model
      </Button>
      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

function StepModel({
  colors,
  plan,
  selectedModel,
  setSelectedModel,
  onNext,
}: {
  colors: any;
  plan: string;
  selectedModel: ModelId;
  setSelectedModel: (m: ModelId) => void;
  onNext: () => void;
}) {
  const planRank = { free: 0, pro: 1, elite: 2 };
  const userRank = planRank[plan as keyof typeof planRank] ?? 0;

  function modelLocked(requiredPlan: string): boolean {
    const required = planRank[requiredPlan as keyof typeof planRank] ?? 0;
    return userRank < required;
  }

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ padding: 20, gap: 14 }}
    >
      <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 4 }}>
        Choose the AI model that powers your agent's decisions. Smarter models yield better trades at higher tiers.
      </Text>

      {AI_MODELS.map((model) => {
        const locked = modelLocked(model.requiredPlan);
        const selected = selectedModel === model.id;

        return (
          <Pressable
            key={model.id}
            onPress={() => {
              if (locked) {
                Alert.alert(
                  `${model.badge} Required`,
                  `${model.name} is available on the ${model.badge} plan. Upgrade to unlock it.`
                );
                return;
              }
              setSelectedModel(model.id);
            }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 14,
              padding: 16,
              borderRadius: 16,
              backgroundColor: selected ? Colors.accentBg : colors.cardSecondary,
              borderWidth: 1.5,
              borderColor: selected ? Colors.accent : colors.cardBorder,
              opacity: locked ? 0.55 : 1,
            }}
          >
            <Text style={{ fontSize: 28 }}>{model.icon}</Text>
            <View style={{ flex: 1, gap: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15 }}>{model.name}</Text>
                <Badge
                  label={model.badge}
                  variant={model.badge === "Free" ? "success" : model.badge === "Pro" ? "accent" : "warning"}
                />
                {locked && (
                  <Ionicons name="lock-closed" size={13} color={colors.textTertiary} />
                )}
              </View>
              <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{model.description}</Text>
              <Text style={{ color: colors.textTertiary, fontSize: 12 }}>{model.provider}</Text>
            </View>
            {selected && (
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  backgroundColor: Colors.accent,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="checkmark" size={14} color="#fff" />
              </View>
            )}
          </Pressable>
        );
      })}

      <Button variant="primary" size="lg" onPress={onNext} style={{ marginTop: 6 }}>
        Review & Deploy
      </Button>
      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

function StepReview({
  colors,
  strategy,
  agentName,
  budget,
  mode,
  params,
  strategyPrompt,
  selectedModel,
  timeHorizon,
  isPrivate,
  aggressive,
  isDeploying,
  atLimit,
  plan,
  tierLimit,
  onDeploy,
  insets,
  deployError,
}: {
  colors: any;
  strategy: Strategy;
  agentName: string;
  budget: number;
  mode: AgentMode;
  params: Record<string, number>;
  strategyPrompt: string;
  selectedModel: ModelId;
  timeHorizon: TimeHorizonId;
  isPrivate: boolean;
  aggressive: boolean;
  isDeploying: boolean;
  atLimit: boolean;
  plan: string;
  tierLimit: number;
  onDeploy: () => void;
  insets: { bottom: number };
  deployError: string | null;
}) {
  const model = AI_MODELS.find((m) => m.id === selectedModel)!;
  const risk = RISK_CONFIG[strategy.risk];
  const horizon = TIME_HORIZONS.find((h) => h.id === timeHorizon)!;

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ padding: 20, gap: 16 }}
    >
      {atLimit && (
        <Pressable
          onPress={() => router.push("/subscription" as any)}
          style={{
            backgroundColor: Colors.dangerBg,
            borderRadius: 14,
            padding: 14,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            borderWidth: 1,
            borderColor: Colors.danger,
          }}
        >
          <Ionicons name="warning-outline" size={18} color={Colors.danger} />
          <Text style={{ color: Colors.danger, fontSize: 13, fontWeight: "600", flex: 1 }}>
            Agent limit reached ({tierLimit}/{tierLimit}). Tap to view upgrade options.
          </Text>
          <Ionicons name="chevron-forward" size={14} color={Colors.danger} />
        </Pressable>
      )}

      {deployError && (
        <View
          style={{
            backgroundColor: Colors.dangerBg,
            borderRadius: 14,
            padding: 14,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Ionicons name="alert-circle-outline" size={18} color={Colors.danger} />
          <Text style={{ color: Colors.danger, fontSize: 13, fontWeight: "600", flex: 1 }}>
            {deployError}
          </Text>
        </View>
      )}

      {/* Agent Identity */}
      <View
        style={{
          backgroundColor: Colors.accentBg,
          borderRadius: 18,
          padding: 18,
          alignItems: "center",
          gap: 8,
        }}
      >
        <Text style={{ fontSize: 40 }}>{strategy.icon}</Text>
        <Text style={{ color: Colors.accentLight, fontSize: 20, fontWeight: "800" }}>{agentName}</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Badge label={strategy.name} variant="accent" />
          <Badge label={risk.label} variant={strategy.risk === "low" ? "success" : strategy.risk === "medium" ? "warning" : "danger"} />
        </View>
      </View>

      {/* Summary rows */}
      {[
        { label: "Budget", value: `$${budget.toLocaleString()}`, icon: "wallet-outline" },
        {
          label: "Mode",
          value: mode === "live" ? "Live Trading" : "Paper Trading",
          icon: mode === "live" ? "flash-outline" : "flask-outline",
        },
        { label: "AI Model", value: `${model.icon} ${model.name}`, icon: "hardware-chip-outline" },
        { label: "Time Horizon", value: `${horizon.icon} ${horizon.name} (${horizon.subtitle})`, icon: "time-outline" },
        { label: "Visibility", value: isPrivate ? "Private" : "Public", icon: isPrivate ? "eye-off-outline" : "eye-outline" },
        { label: "Aggressive Mode", value: aggressive ? "On — looser signals" : "Off — default", icon: "flash-outline" },
        { label: "Initial Status", value: "Active — auto-trading enabled", icon: "flash-outline" },
      ].map((row) => (
        <View
          key={row.label}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingVertical: 14,
            borderBottomWidth: 1,
            borderBottomColor: colors.divider,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Ionicons name={row.icon as any} size={16} color={colors.textSecondary} />
            <Text style={{ color: colors.textSecondary, fontSize: 14 }}>{row.label}</Text>
          </View>
          <Text style={{ color: colors.text, fontWeight: "600", fontSize: 14 }}>{row.value}</Text>
        </View>
      ))}

      {/* Params Summary or Custom Instructions */}
      {strategy.id === "custom" ? (
        <View
          style={{
            backgroundColor: Colors.accentBg,
            borderRadius: 14,
            padding: 14,
            gap: 8,
            borderWidth: 1,
            borderColor: Colors.accent + "40",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="create-outline" size={14} color={Colors.accentLight} />
            <Text style={{ color: Colors.accentLight, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Strategy Instructions
            </Text>
          </View>
          <Text style={{ color: Colors.accentLight, fontSize: 13, lineHeight: 19, opacity: 0.9 }}>
            {strategyPrompt}
          </Text>
        </View>
      ) : strategy.params.length > 0 ? (
        <View
          style={{
            backgroundColor: colors.cardSecondary,
            borderRadius: 14,
            padding: 14,
            gap: 10,
          }}
        >
          <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 }}>
            Parameters
          </Text>
          {strategy.params.map((p) => {
            const val = params[p.key] ?? p.default;
            return (
              <View key={p.key} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{p.label}</Text>
                <Text style={{ color: colors.text, fontSize: 13, fontWeight: "600" }}>
                  {p.unit.startsWith("$") ? `$${val}` : `${val}${p.unit}`}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}

      <Text style={{ color: colors.textTertiary, fontSize: 12, textAlign: "center", lineHeight: 18 }}>
        Your agent will start trading automatically during market hours (Mon–Fri, 9:30 AM–4 PM ET). You can pause it anytime.
      </Text>

      <Button
        variant="primary"
        size="lg"
        onPress={onDeploy}
        loading={isDeploying}
        disabled={atLimit}
      >
        Deploy Agent
      </Button>
      <View style={{ height: insets.bottom + 8 }} />
    </ScrollView>
  );
}
