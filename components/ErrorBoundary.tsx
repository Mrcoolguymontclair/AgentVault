import React, { Component, ReactNode } from "react";
import { View, Text, Pressable, SafeAreaView } from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface State {
  hasError: boolean;
  error: Error | null;
}

interface Props {
  children: ReactNode;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error.message, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView
          style={{
            flex: 1,
            backgroundColor: "#0F1117",
            alignItems: "center",
            justifyContent: "center",
            padding: 32,
          }}
        >
          <View
            style={{
              width: 80,
              height: 80,
              borderRadius: 24,
              backgroundColor: "rgba(255,107,107,0.12)",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 20,
            }}
          >
            <Ionicons name="warning-outline" size={40} color="#FF6B6B" />
          </View>

          <Text
            style={{
              color: "#FFFFFF",
              fontSize: 22,
              fontWeight: "700",
              textAlign: "center",
              letterSpacing: -0.5,
              marginBottom: 10,
            }}
          >
            Something Went Wrong
          </Text>

          <Text
            style={{
              color: "#8B8FA8",
              fontSize: 15,
              textAlign: "center",
              lineHeight: 22,
              marginBottom: 32,
            }}
          >
            An unexpected error occurred. Your portfolio data is safe. Please
            try again.
          </Text>

          <Pressable
            onPress={() => this.setState({ hasError: false, error: null })}
            style={{
              backgroundColor: "#0B5C36",
              paddingHorizontal: 32,
              paddingVertical: 14,
              borderRadius: 12,
              width: "100%",
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 16 }}>
              Try Again
            </Text>
          </Pressable>

          {__DEV__ && this.state.error && (
            <Text
              style={{
                color: "#FF6B6B",
                fontSize: 11,
                marginTop: 24,
                fontFamily: "monospace",
                textAlign: "center",
              }}
            >
              {this.state.error.message}
            </Text>
          )}
        </SafeAreaView>
      );
    }

    return this.props.children;
  }
}
