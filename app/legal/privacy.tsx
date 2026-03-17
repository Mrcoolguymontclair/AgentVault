import React from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/colors";

const LAST_UPDATED = "March 14, 2026";
const APP_NAME = "AgentVault";
const CONTACT_EMAIL = "privacy@agentvault.app";

interface Section {
  title: string;
  body: string;
}

const SECTIONS: Section[] = [
  {
    title: "1. Information We Collect",
    body: `When you create an account and use ${APP_NAME}, we collect information you provide directly, including your name, email address, and profile details such as your display name and avatar.\n\nWe also collect information generated through your use of the platform, including the AI trading agents you deploy, your simulated paper-trading activity, strategy configurations, and performance metrics. Because ${APP_NAME} is a paper-trading simulation platform, no real brokerage account credentials or real financial assets are collected or stored.\n\nWe automatically collect certain technical information when you use our services, including device type, operating system, IP address, app version, and usage analytics such as screens viewed and features used.`,
  },
  {
    title: "2. How We Use Your Information",
    body: `We use the information we collect to:\n\n• Create and maintain your account\n• Provide, operate, and improve the ${APP_NAME} platform\n• Personalize your experience and display relevant content\n• Power the AI trading agent features, leaderboards, and social feed\n• Send you notifications about your agents and platform updates (if you have granted permission)\n• Respond to your support requests\n• Ensure platform security and prevent fraud\n• Comply with legal obligations\n\nWe do not sell your personal information to third parties. We do not use your data to train external AI models without your explicit consent.`,
  },
  {
    title: "3. Data Sharing and Third-Party Services",
    body: `We share information only in the following circumstances:\n\n• Service Providers: We work with trusted third-party providers to operate our platform, including Supabase (database and authentication), Groq (AI inference), and Alpaca Markets (paper market data). These providers process data only as necessary to provide their services and are bound by appropriate data protection agreements.\n\n• Leaderboard and Social Features: If you deploy a public agent, your agent's name, strategy type, and performance metrics are visible to other users on the leaderboard and social feed. You can make agents private at any time from the agent settings.\n\n• Legal Requirements: We may disclose information if required by law, subpoena, or other legal process, or if we believe in good faith that disclosure is necessary to protect our rights or the safety of users.\n\n• Business Transfers: If ${APP_NAME} is involved in a merger, acquisition, or sale of assets, your information may be transferred as part of that transaction.`,
  },
  {
    title: "4. Paper Trading Disclaimer",
    body: `${APP_NAME} is a simulated paper-trading platform. All trades executed by your AI agents are simulated and use virtual money only. No real financial transactions, real securities purchases, or real brokerage activity takes place within the app.\n\nAny Alpaca Markets API keys you optionally provide are used solely to retrieve real-time market data for simulation purposes. ${APP_NAME} does not place real orders on your behalf and does not access your real brokerage funds.`,
  },
  {
    title: "5. Data Security",
    body: `We take the security of your information seriously. We implement industry-standard technical and organizational measures to protect your data against unauthorized access, alteration, disclosure, or destruction. These measures include encrypted data transmission (TLS), encrypted storage of sensitive credentials, and strict access controls.\n\nHowever, no method of transmission over the internet or method of electronic storage is 100% secure. While we strive to protect your information, we cannot guarantee its absolute security. You are responsible for maintaining the confidentiality of your account credentials.`,
  },
  {
    title: "6. Data Retention",
    body: `We retain your personal information for as long as your account is active or as needed to provide you with our services. You may request deletion of your account and associated data at any time from the Settings screen within the app. Upon deletion, we will remove your personal information from our active databases within 30 days, subject to any legal retention obligations.\n\nAggregate, anonymized data derived from your usage may be retained indefinitely for platform analytics and improvement purposes.`,
  },
  {
    title: "7. Your Rights and Choices",
    body: `Depending on your location, you may have the following rights regarding your personal data:\n\n• Access: Request a copy of the personal data we hold about you\n• Correction: Request correction of inaccurate or incomplete data\n• Deletion: Request deletion of your account and personal data\n• Portability: Request your trade history in CSV format (available via Settings)\n• Opt-Out: Opt out of non-essential communications at any time through notification settings\n\nTo exercise any of these rights, contact us at ${CONTACT_EMAIL} or use the in-app account management features in Settings.`,
  },
  {
    title: "8. Push Notifications",
    body: `If you grant permission, we may send push notifications to your device about your agent activity, trade executions, and platform announcements. You can withdraw this permission at any time through your device's notification settings or within the ${APP_NAME} app under Settings → Notifications.`,
  },
  {
    title: "9. Children's Privacy",
    body: `${APP_NAME} is not directed to children under the age of 13. We do not knowingly collect personal information from children under 13. If you believe we have inadvertently collected such information, please contact us immediately at ${CONTACT_EMAIL} and we will take prompt steps to delete it.`,
  },
  {
    title: "10. Changes to This Policy",
    body: `We may update this Privacy Policy from time to time to reflect changes in our practices or legal requirements. When we make material changes, we will notify you through the app or by email. Your continued use of ${APP_NAME} after the effective date of any changes constitutes your acceptance of the updated policy.\n\nWe encourage you to review this policy periodically.`,
  },
  {
    title: "11. Contact Us",
    body: `If you have any questions, concerns, or requests regarding this Privacy Policy or our data practices, please contact us at:\n\n${APP_NAME} Privacy Team\n${CONTACT_EMAIL}\n\nWe will respond to your inquiry within 30 days.`,
  },
];

export default function PrivacyPolicyScreen() {
  const { colors } = useTheme();
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: colors.cardBorder,
          gap: 12,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            backgroundColor: colors.cardSecondary,
            borderWidth: 1,
            borderColor: colors.cardBorder,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800", letterSpacing: -0.4 }}>
            Privacy Policy
          </Text>
          <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 1 }}>
            Last updated {LAST_UPDATED}
          </Text>
        </View>
        <View
          style={{
            backgroundColor: Colors.accentBg,
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 8,
          }}
        >
          <Text style={{ color: Colors.accentLight, fontSize: 11, fontWeight: "700" }}>
            PLACEHOLDER
          </Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 20, gap: 24, paddingBottom: 48 }}
      >
        {/* Intro */}
        <View
          style={{
            backgroundColor: Colors.accentBg,
            borderRadius: 16,
            padding: 16,
            borderWidth: 1,
            borderColor: Colors.accent + "30",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <Ionicons name="shield-checkmark-outline" size={20} color={Colors.accentLight} />
            <Text style={{ color: Colors.accentLight, fontWeight: "700", fontSize: 15 }}>
              Your Privacy Matters
            </Text>
          </View>
          <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 20 }}>
            {APP_NAME} is committed to protecting your personal information. This policy explains what
            data we collect, how we use it, and the choices you have. This is placeholder text —
            replace with your final legal copy before submission.
          </Text>
        </View>

        {/* Sections */}
        {SECTIONS.map((section) => (
          <View key={section.title} style={{ gap: 10 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingBottom: 8,
                borderBottomWidth: 1,
                borderBottomColor: colors.cardBorder,
              }}
            >
              <View
                style={{
                  width: 3,
                  height: 16,
                  borderRadius: 2,
                  backgroundColor: Colors.accent,
                }}
              />
              <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15, flex: 1 }}>
                {section.title}
              </Text>
            </View>
            <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 22 }}>
              {section.body}
            </Text>
          </View>
        ))}

        {/* Footer */}
        <View
          style={{
            alignItems: "center",
            paddingTop: 16,
            borderTopWidth: 1,
            borderTopColor: colors.cardBorder,
            gap: 6,
          }}
        >
          <Text style={{ color: Colors.accentLight, fontWeight: "800", fontSize: 16 }}>
            {APP_NAME}
          </Text>
          <Text style={{ color: colors.textTertiary, fontSize: 12 }}>
            © 2026 {APP_NAME}. All rights reserved.
          </Text>
          <Text style={{ color: colors.textTertiary, fontSize: 12 }}>
            {CONTACT_EMAIL}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
