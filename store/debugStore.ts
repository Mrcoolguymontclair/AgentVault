import { create } from "zustand";

interface DebugStore {
  devMode: boolean;
  setDevMode: (v: boolean) => void;
  lastEdgeFunctionAt: string | null;
  lastEdgeFunctionOk: boolean | null;
  setLastEdgeFunction: (at: string, ok: boolean) => void;
}

export const useDebugStore = create<DebugStore>((set) => ({
  devMode: false,
  setDevMode: (v) => set({ devMode: v }),
  lastEdgeFunctionAt: null,
  lastEdgeFunctionOk: null,
  setLastEdgeFunction: (at, ok) => set({ lastEdgeFunctionAt: at, lastEdgeFunctionOk: ok }),
}));
