import React from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/colors";

const LAST_UPDATED = "March 14, 2026";
const APP_NAME = "AgentVault";
const CONTACT_EMAIL = "legal@agentvault.app";

interface Section {
  title: string;
  body: string;
  warning?: boolean;
}

const SECTIONS: Section[] = [
  {
    title: "1. Acceptance of Terms",
    body: `By downloading, installing, or using ${APP_NAME} ("the App", "the Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not use the App.\n\nThese Terms constitute a legally binding agreement between you and ${APP_NAME} ("we", "us", "our"). We reserve the right to update these Terms at any time. Continued use of the Service after changes are posted constitutes acceptance of the revised Terms.`,
  },
  {
    title: "2. Description of Service",
    body: `${APP_NAME} is a simulated paper-trading platform that allows users to deploy AI-powered trading agents, track simulated portfolio performance, and compete on a community leaderboard. The Service is provided for educational and entertainment purposes only.\n\nFeatures include:\n• AI agent deployment with configurable trading strategies\n• Simulated paper trading using real-time market data\n• Portfolio performance tracking and analytics\n• Social features including leaderboards, agent sharing, and comments\n• Push notifications for agent activity`,
  },
  {
    title: "3. Paper Trading — No Real Money",
    body: `IMPORTANT: ${APP_NAME} is strictly a paper-trading simulation. All trades, balances, and performance figures shown within the App are simulated and use virtual currency only.\n\n• No real money is invested, transferred, or placed at risk through the App\n• No real securities, stocks, ETFs, or other financial instruments are purchased or sold\n• Simulated portfolio returns do not represent actual investment results\n• Past simulated performance does not predict or guarantee future real-world results\n\nIf you optionally connect an Alpaca Markets API key, it is used solely to retrieve real-time market data for simulation. ${APP_NAME} will not place real orders or access real funds on your behalf.`,
    warning: true,
  },
  {
    title: "4. Not Financial Advice",
    body: `Nothing in ${APP_NAME} constitutes financial, investment, legal, or tax advice. The AI agents, trading signals, strategy recommendations, and performance metrics provided by the App are for informational and simulation purposes only.\n\nYou should not make real investment decisions based on information or results from ${APP_NAME}. Always consult a qualified financial advisor before making real investment decisions. We are not registered as an investment advisor, broker-dealer, or financial planner with any regulatory authority.`,
    warning: true,
  },
  {
    title: "5. User Accounts",
    body: `You must create an account to use ${APP_NAME}. You are responsible for:\n\n• Providing accurate and complete registration information\n• Maintaining the confidentiality of your account credentials\n• All activity that occurs under your account\n• Notifying us immediately of any unauthorized account access\n\nYou must be at least 13 years of age to create an account. Users under 18 should have parental or guardian consent. We reserve the right to suspend or terminate accounts that violate these Terms.`,
  },
  {
    title: "6. Acceptable Use",
    body: `You agree not to:\n\n• Use the Service for any unlawful purpose or in violation of any applicable laws\n• Attempt to reverse engineer, decompile, or extract source code from the App\n• Manipulate leaderboard rankings or social features through fraudulent means\n• Harass, abuse, or harm other users through social features\n• Upload or transmit malicious code, spam, or disruptive content\n• Attempt to gain unauthorized access to our systems or other users' accounts\n• Use automated tools to scrape, crawl, or extract data from the Service\n• Impersonate another person or entity\n\nViolation of these rules may result in immediate account termination without notice.`,
  },
  {
    title: "7. AI-Generated Trading Signals",
    body: `${APP_NAME} uses artificial intelligence models, including large language models from Groq and Anthropic, to generate trading signals and decisions for your AI agents. You acknowledge that:\n\n• AI-generated signals are experimental and may be incorrect, incomplete, or inconsistent\n• AI models can produce unexpected or erroneous outputs ("hallucinations")\n• The accuracy of AI trading signals is not guaranteed\n• You assume full responsibility for the agents you deploy and their configurations\n• We make no warranty that AI agents will generate profitable simulated results`,
  },
  {
    title: "8. Intellectual Property",
    body: `All content, features, and functionality of ${APP_NAME} — including but not limited to software, design, text, graphics, logos, and AI models — are the exclusive property of ${APP_NAME} and its licensors and are protected by applicable intellectual property laws.\n\nYou retain ownership of any content you create within the App, such as agent names and configurations. By making agents public, you grant ${APP_NAME} a non-exclusive, royalty-free license to display your agent's name and performance data to other users for the purpose of leaderboard and social features.`,
  },
  {
    title: "9. Limitation of Liability",
    body: `TO THE MAXIMUM EXTENT PERMITTED BY LAW, ${APP_NAME.toUpperCase()} AND ITS AFFILIATES, OFFICERS, EMPLOYEES, AGENTS, AND LICENSORS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM OR RELATED TO YOUR USE OF THE SERVICE.\n\nIN NO EVENT SHALL OUR TOTAL LIABILITY TO YOU EXCEED THE AMOUNT YOU PAID (IF ANY) TO USE THE SERVICE IN THE TWELVE MONTHS PRECEDING THE CLAIM.\n\nSome jurisdictions do not allow limitation of liability for certain damages. In such jurisdictions, our liability is limited to the greatest extent permitted by law.`,
  },
  {
    title: "10. Disclaimer of Warranties",
    body: `THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED. WE DISCLAIM ALL WARRANTIES, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.\n\nWe do not warrant that the Service will be uninterrupted, error-free, or free of viruses or other harmful components. We do not warrant the accuracy, completeness, or reliability of any content, data, or AI-generated output within the App.`,
  },
  {
    title: "11. Indemnification",
    body: `You agree to indemnify, defend, and hold harmless ${APP_NAME} and its affiliates, officers, directors, employees, and agents from and against any claims, liabilities, damages, losses, costs, and expenses (including reasonable legal fees) arising out of or relating to:\n\n• Your use of the Service\n• Your violation of these Terms\n• Your violation of any third-party rights\n• Any content you submit or share through the App`,
  },
  {
    title: "12. Termination",
    body: `We reserve the right to suspend or terminate your access to the Service at any time, with or without notice, for any reason, including violation of these Terms.\n\nYou may terminate your account at any time from the Settings screen within the App. Upon termination, your right to use the Service ceases immediately. Provisions of these Terms that by their nature should survive termination will survive, including ownership, warranty disclaimers, indemnity, and limitations of liability.`,
  },
  {
    title: "13. Governing Law",
    body: `These Terms shall be governed by and construed in accordance with the laws of the State of Delaware, United States, without regard to conflict of law principles. Any disputes arising from these Terms or your use of the Service shall be resolved through binding arbitration in accordance with the rules of the American Arbitration Association, except that either party may seek injunctive relief in a court of competent jurisdiction.\n\nIf any provision of these Terms is found to be unenforceable, the remaining provisions will remain in full force and effect.`,
  },
  {
    title: "14. Changes to Terms",
    body: `We reserve the right to modify these Terms at any time. When we make material changes, we will provide notice through the App or via email. The revised Terms will be effective as of the date posted.\n\nYour continued use of ${APP_NAME} after changes are posted constitutes your acceptance of the new Terms. If you do not agree to the updated Terms, you must stop using the Service and delete your account.`,
  },
  {
    title: "15. Contact Us",
    body: `If you have any questions about these Terms of Service, please contact us at:\n\n${APP_NAME} Legal Team\n${CONTACT_EMAIL}\n\nWe will respond to your inquiry within 30 days.`,
  },
];

export default function TermsOfServiceScreen() {
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
            Terms of Service
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
            <Ionicons name="document-text-outline" size={20} color={Colors.accentLight} />
            <Text style={{ color: Colors.accentLight, fontWeight: "700", fontSize: 15 }}>
              Please Read Carefully
            </Text>
          </View>
          <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 20 }}>
            These Terms govern your use of {APP_NAME}. By using the app you agree to these Terms.
            This is placeholder text — replace with your final legal copy reviewed by a qualified
            attorney before App Store submission.
          </Text>
        </View>

        {/* Sections */}
        {SECTIONS.map((section) => (
          <View key={section.title} style={{ gap: 10 }}>
            {section.warning && (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  backgroundColor: "rgba(255,149,0,0.10)",
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: Colors.warning + "40",
                  alignSelf: "flex-start",
                }}
              >
                <Ionicons name="alert-circle-outline" size={14} color={Colors.warning} />
                <Text style={{ color: Colors.warning, fontSize: 11, fontWeight: "700" }}>
                  IMPORTANT
                </Text>
              </View>
            )}
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
                  backgroundColor: section.warning ? Colors.warning : Colors.accent,
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
