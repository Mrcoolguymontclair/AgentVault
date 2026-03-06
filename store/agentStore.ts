import { create } from "zustand";
import {
  fetchUserAgents,
  fetchRecentTrades,
  updateAgentStatus,
  subscribeToTrades,
  subscribeToAgents,
  type DbAgent,
  type DbTrade,
} from "@/lib/services/agentService";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type AgentStatus = "active" | "paused" | "stopped" | "backtesting";
export type AgentMode = "paper" | "live";

export interface Agent {
  id: string;
  name: string;
  strategy: string;
  status: AgentStatus;
  pnl: number;
  pnlPct: number;
  trades: number;
  winRate: number;
  createdAt: string;
  mode: AgentMode;
  description: string;
  maxDrawdown: number;
  sharpeRatio: number;
}

export interface Trade {
  id: string;
  agentId: string;
  agentName: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  pnl: number;
  executedAt: string;
}

function dbAgentToAgent(a: DbAgent): Agent {
  return {
    id: a.id,
    name: a.name,
    strategy: a.strategy,
    status: a.status,
    pnl: Number(a.pnl),
    pnlPct: Number(a.pnl_pct),
    trades: a.trades_count,
    winRate: Number(a.win_rate),
    createdAt: new Date(a.created_at).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    mode: a.mode,
    description: a.description,
    maxDrawdown: Number(a.max_drawdown),
    sharpeRatio: Number(a.sharpe_ratio),
  };
}

function dbTradeToTrade(t: DbTrade): Trade {
  return {
    id: t.id,
    agentId: t.agent_id,
    agentName: t.agents?.name ?? "Unknown Agent",
    symbol: t.symbol,
    side: t.side,
    quantity: Number(t.quantity),
    price: Number(t.price),
    pnl: Number(t.pnl),
    executedAt: t.executed_at,
  };
}

interface AgentStore {
  agents: Agent[];
  recentTrades: Trade[];
  isLoading: boolean;
  selectedAgent: Agent | null;

  loadAgents: (userId: string) => Promise<void>;
  loadRecentTrades: (userId: string) => Promise<void>;
  setAgents: (agents: Agent[]) => void;
  selectAgent: (agent: Agent | null) => void;
  toggleAgent: (id: string) => Promise<void>;
  setLoading: (loading: boolean) => void;
  addTrade: (trade: Trade) => void;
  startRealtimeSubscriptions: (userId: string) => void;
  stopRealtimeSubscriptions: () => void;

  _tradeChannel: RealtimeChannel | null;
  _agentChannel: RealtimeChannel | null;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: [],
  recentTrades: [],
  isLoading: false,
  selectedAgent: null,
  _tradeChannel: null,
  _agentChannel: null,

  setAgents: (agents) => set({ agents }),
  selectAgent: (agent) => set({ selectedAgent: agent }),
  setLoading: (loading) => set({ isLoading: loading }),

  addTrade: (trade) =>
    set((state) => ({
      recentTrades: [trade, ...state.recentTrades].slice(0, 50),
    })),

  loadAgents: async (userId) => {
    set({ isLoading: true });
    const { data, error } = await fetchUserAgents(userId);
    if (data && !error) {
      set({ agents: data.map(dbAgentToAgent) });
    }
    set({ isLoading: false });
  },

  loadRecentTrades: async (userId) => {
    const { data } = await fetchRecentTrades(userId);
    if (data) {
      set({ recentTrades: data.map(dbTradeToTrade) });
    }
  },

  toggleAgent: async (id) => {
    const agents = get().agents;
    const agent = agents.find((a) => a.id === id);
    if (!agent) return;
    const newStatus: AgentStatus = agent.status === "active" ? "paused" : "active";

    // Optimistic update
    set({
      agents: agents.map((a) =>
        a.id === id ? { ...a, status: newStatus } : a
      ),
    });

    const { error } = await updateAgentStatus(id, newStatus);
    if (error) {
      // Revert on error
      set({
        agents: agents.map((a) =>
          a.id === id ? { ...a, status: agent.status } : a
        ),
      });
    }
  },

  startRealtimeSubscriptions: (userId) => {
    const tradeChannel = subscribeToTrades(userId, (dbTrade) => {
      get().addTrade(dbTradeToTrade(dbTrade));
    });

    const agentChannel = subscribeToAgents(userId, (dbAgent) => {
      set((state) => ({
        agents: state.agents.map((a) =>
          a.id === dbAgent.id ? dbAgentToAgent(dbAgent) : a
        ),
      }));
    });

    set({ _tradeChannel: tradeChannel, _agentChannel: agentChannel });
  },

  stopRealtimeSubscriptions: () => {
    const { _tradeChannel, _agentChannel } = get();
    _tradeChannel?.unsubscribe();
    _agentChannel?.unsubscribe();
    set({ _tradeChannel: null, _agentChannel: null });
  },
}));
