import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/authStore";
import { Colors } from "@/constants/colors";
import {
  fetchComments,
  postComment,
  deleteComment,
  type Comment,
} from "@/lib/services/socialService";

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

interface Props {
  agentId: string;
}

export function CommentSection({ agentId }: Props) {
  const { colors } = useTheme();
  const { user: authUser } = useAuthStore();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const load = useCallback(async () => {
    const { data } = await fetchComments(agentId, 50);
    setComments(data);
    setLoading(false);
  }, [agentId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSend() {
    if (!authUser?.id || !text.trim() || sending) return;
    setSending(true);
    const optimistic: Comment = {
      id: `opt-${Date.now()}`,
      user_id: authUser.id,
      agent_id: agentId,
      content: text.trim(),
      likes: 0,
      created_at: new Date().toISOString(),
      profiles: null,
    };
    setComments((prev) => [...prev, optimistic]);
    setText("");

    const { data, error } = await postComment(authUser.id, agentId, optimistic.content);
    if (error || !data) {
      setComments((prev) => prev.filter((c) => c.id !== optimistic.id));
      Alert.alert("Error", "Failed to post comment.");
    } else {
      setComments((prev) =>
        prev.map((c) => (c.id === optimistic.id ? data : c))
      );
    }
    setSending(false);
  }

  async function handleDelete(comment: Comment) {
    if (comment.user_id !== authUser?.id) return;
    Alert.alert("Delete Comment", "Remove this comment?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setComments((prev) => prev.filter((c) => c.id !== comment.id));
          await deleteComment(comment.id);
        },
      },
    ]);
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <Text style={{ color: colors.text, fontSize: 17, fontWeight: "700" }}>
          Comments {comments.length > 0 ? `(${comments.length})` : ""}
        </Text>
        <Pressable onPress={() => inputRef.current?.focus()} hitSlop={12}>
          <Ionicons name="chatbubble-outline" size={20} color={colors.textSecondary} />
        </Pressable>
      </View>

      {/* Comment List */}
      {loading ? (
        <View style={{ paddingVertical: 20, alignItems: "center" }}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : comments.length === 0 ? (
        <View
          style={{
            paddingVertical: 24,
            alignItems: "center",
            gap: 8,
          }}
        >
          <Ionicons name="chatbubbles-outline" size={32} color={colors.textTertiary} />
          <Text style={{ color: colors.textTertiary, fontSize: 14 }}>
            No comments yet. Be first!
          </Text>
        </View>
      ) : (
        <View style={{ gap: 1, marginBottom: 12 }}>
          {comments.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              colors={colors}
              isOwn={comment.user_id === authUser?.id}
              onDelete={() => handleDelete(comment)}
            />
          ))}
        </View>
      )}

      {/* Input Row */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          backgroundColor: colors.card,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: colors.cardBorder,
          paddingHorizontal: 14,
          paddingVertical: 10,
        }}
      >
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          placeholder="Add a comment…"
          placeholderTextColor={colors.textTertiary}
          style={{
            flex: 1,
            color: colors.text,
            fontSize: 14,
            maxHeight: 80,
          }}
          multiline
          returnKeyType="default"
          onSubmitEditing={handleSend}
        />
        <Pressable
          onPress={handleSend}
          disabled={!text.trim() || sending}
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            backgroundColor:
              text.trim() && !sending ? Colors.accent : colors.cardSecondary,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons
              name="send"
              size={15}
              color={text.trim() ? "#fff" : colors.textTertiary}
            />
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function CommentRow({
  comment,
  colors,
  isOwn,
  onDelete,
}: {
  comment: Comment;
  colors: any;
  isOwn: boolean;
  onDelete: () => void;
}) {
  const displayName = comment.profiles?.display_name ?? "Trader";
  const avatar = comment.profiles?.avatar ?? "🚀";

  return (
    <View
      style={{
        flexDirection: "row",
        gap: 10,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
        alignItems: "flex-start",
      }}
    >
      {/* Avatar */}
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          backgroundColor: colors.cardSecondary,
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Text style={{ fontSize: 18 }}>{avatar}</Text>
      </View>

      {/* Content */}
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ color: colors.text, fontWeight: "700", fontSize: 13 }}>
            {displayName}
          </Text>
          <Text style={{ color: colors.textTertiary, fontSize: 11 }}>
            {timeAgo(comment.created_at)}
          </Text>
        </View>
        <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20 }}>
          {comment.content}
        </Text>
      </View>

      {/* Delete (own only) */}
      {isOwn && (
        <Pressable onPress={onDelete} hitSlop={10} style={{ paddingTop: 2 }}>
          <Ionicons name="close-circle-outline" size={16} color={colors.textTertiary} />
        </Pressable>
      )}
    </View>
  );
}
