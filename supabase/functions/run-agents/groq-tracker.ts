/**
 * groq-tracker.ts
 *
 * Centralised Groq API management for the run-agents edge function:
 *   • Per-minute token rate limiter (14 400 tokens/min, throttle at 12 000)
 *   • Daily budget guard (450 K tokens/day, conservative mode at 400 K)
 *   • Automatic key rotation: primary → backup on 429, rotates back after 60 s
 *   • Usage logging to groq_usage table (fire-and-forget at end of call)
 *
 * Usage pattern in index.ts:
 *   1. initTracker(supabase, dailyTokensUsed)   ← once per cron invocation
 *   2. setCurrentAgent(agent.id)                ← before each agent run
 *   3. groqComplete(messages, maxTokens, type)  ← inside groq.ts helpers
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Limits ───────────────────────────────────────────────────
export const PER_MINUTE_LIMIT     = 14_400;
export const PER_MINUTE_SAFE      = 12_000; // throttle above this (83 %)
export const DAILY_BUDGET         = 450_000;
export const DAILY_CONSERVATIVE   = 400_000; // conservative mode above this (89 %)

// ── Groq config ──────────────────────────────────────────────
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL    = "llama-3.1-8b-instant";

const PRIMARY_KEY = Deno.env.get("GROQ_API_KEY")        ?? "";
const BACKUP_KEY  = Deno.env.get("GROQ_API_KEY_BACKUP") ?? "";

// Log key presence at module load so we can diagnose missing secrets immediately
console.log(`[groq] PRIMARY_KEY set=${PRIMARY_KEY.length > 0} (len=${PRIMARY_KEY.length}) BACKUP_KEY set=${BACKUP_KEY.length > 0}`);

// ── Module state (reset on each edge function invocation) ────
let _supabase: ReturnType<typeof createClient> | null = null;
let _activeKey: "primary" | "backup" = "primary";
let _backupActivatedAt: number | null = null;
let _inMemory: Array<{ ts: number; tokens: number }> = [];
let _dailyUsed   = 0;
let _conservative = false;
let _currentAgent = "system";

// ── Init / setters ───────────────────────────────────────────

/** Call once at the start of each cron invocation. */
export function initTracker(
  supabase: ReturnType<typeof createClient>,
  dailyTokensUsed: number
): void {
  _supabase          = supabase;
  _dailyUsed         = dailyTokensUsed;
  _conservative      = dailyTokensUsed >= DAILY_CONSERVATIVE;
  _activeKey         = "primary";
  _backupActivatedAt = null;
  _inMemory          = [];
  _currentAgent      = "system";

  if (_conservative) {
    console.warn(
      `[groq-tracker] Starting in conservative mode — ${dailyTokensUsed.toLocaleString()} / ${DAILY_BUDGET.toLocaleString()} tokens used today`
    );
  }
}

/** Set before running each agent so usage logs include the agent ID. */
export function setCurrentAgent(agentId: string): void {
  _currentAgent = agentId;
}

// ── Read-only state exports ───────────────────────────────────
export function isConservativeMode(): boolean { return _conservative; }
export function getActiveKeyLabel(): "primary" | "backup" { return _activeKey; }
export function getDailyUsed(): number { return _dailyUsed; }
export function getMinuteUsed(): number { return _tokensLastMinute(); }

// ── Internal helpers ─────────────────────────────────────────

function _resolveKey(): string {
  // Auto-rotate back to primary 60 s after backup activation
  if (_activeKey === "backup" && _backupActivatedAt !== null) {
    if (Date.now() - _backupActivatedAt > 60_000) {
      console.log("[groq-tracker] 60 s elapsed — rotating back to primary key");
      _activeKey         = "primary";
      _backupActivatedAt = null;
    }
  }
  const key = _activeKey === "primary" ? PRIMARY_KEY : BACKUP_KEY;
  return key || PRIMARY_KEY; // always fall back to primary if backup is empty
}

function _tokensLastMinute(): number {
  const cutoff = Date.now() - 60_000;
  _inMemory = _inMemory.filter((u) => u.ts > cutoff);
  return _inMemory.reduce((s, u) => s + u.tokens, 0);
}

/** Wait until there is enough per-minute headroom.  Max 10 s wait. */
async function _waitForBudget(estimatedTokens: number): Promise<void> {
  const start  = Date.now();
  const maxWait = 10_000;
  while (Date.now() - start < maxWait) {
    if (_tokensLastMinute() + estimatedTokens <= PER_MINUTE_SAFE) return;
    console.log("[groq-tracker] Near per-minute limit — waiting 2 s…");
    await new Promise((r) => setTimeout(r, 2_000));
  }
  // Proceed after maxWait to avoid hanging the edge function
}

function _recordUsage(tokens: number): void {
  _inMemory.push({ ts: Date.now(), tokens });
  _dailyUsed += tokens;
  if (!_conservative && _dailyUsed >= DAILY_CONSERVATIVE) {
    console.warn(
      `[groq-tracker] Daily budget at 89 % (${_dailyUsed.toLocaleString()} tokens) — entering conservative mode`
    );
    _conservative = true;
  }
}

async function _logToDb(
  tokens: number,
  requestType: string,
  keyUsed: "primary" | "backup"
): Promise<void> {
  if (!_supabase) return;
  try {
    await _supabase.rpc("rpc_log_groq_usage", {
      p_tokens_used:  tokens,
      p_request_type: requestType,
      p_agent_id:     _currentAgent,
      p_api_key_used: keyUsed,
    });
  } catch (err) {
    // Non-fatal — never crash the agent run over a log write
    console.error("[groq-tracker] Failed to log usage:", err);
  }
}

// ── Core API ─────────────────────────────────────────────────

/**
 * Make a Groq chat-completion request with rate limiting and key rotation.
 *
 * @param messages             Chat messages array
 * @param maxTokens            Hard limit on response tokens
 * @param requestType          One of: confirm_trade | sentiment | mispricing | custom
 * @param estimatedPromptTokens Rough prompt size used for pre-call throttle check
 * @returns Parsed response content string (already JSON when response_format=json_object)
 */
export async function groqComplete(
  messages: Array<{ role: "system" | "user"; content: string }>,
  maxTokens: number,
  requestType: string,
  estimatedPromptTokens = 250
): Promise<string> {
  // In conservative mode only confirmTrade is allowed (auto-approve path handles it)
  if (_conservative && requestType !== "confirm_trade") {
    throw new Error("CONSERVATIVE_MODE");
  }

  await _waitForBudget(estimatedPromptTokens + maxTokens);

  const key      = _resolveKey();
  const keyLabel = _activeKey; // capture before any rotation inside this call

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model:           MODEL,
      messages,
      response_format: { type: "json_object" },
      max_tokens:      maxTokens,
      temperature:     0.1,
    }),
  });

  // Always read body as text first so we can log it on any outcome
  const rawBody = await res.text().catch(() => "");
  console.log(`[groq] type=${requestType} key=${keyLabel} status=${res.status} body=${rawBody.slice(0, 500)}`);

  // On 429, try the backup key once then give up
  if (res.status === 429) {
    if (BACKUP_KEY && _activeKey === "primary") {
      console.warn("[groq-tracker] Primary key rate-limited (429) — switching to backup");
      _activeKey         = "backup";
      _backupActivatedAt = Date.now();
      return groqComplete(messages, maxTokens, requestType, estimatedPromptTokens);
    }
    throw new Error(`Groq 429 rate-limited: ${rawBody.slice(0, 120)}`);
  }

  if (!res.ok) {
    throw new Error(`Groq ${res.status}: ${rawBody.slice(0, 300)}`);
  }

  let data: any;
  try {
    data = JSON.parse(rawBody);
  } catch {
    throw new Error(`Groq response not JSON: ${rawBody.slice(0, 200)}`);
  }
  const content = data.choices?.[0]?.message?.content ?? "{}";
  const tokensUsed = Number(data.usage?.total_tokens ?? (estimatedPromptTokens + maxTokens));

  _recordUsage(tokensUsed);
  await _logToDb(tokensUsed, requestType, keyLabel);

  return content;
}
