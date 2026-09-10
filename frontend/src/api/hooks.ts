import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiJson } from "./client";

export interface OverviewProvider {
  kind: string;
  provider_code: string;
  p50_ms: number;
}

export interface OverviewAttentionItem {
  type: string;
  message: string;
  device_id?: string;
}

export interface OverviewData {
  devices_online: number;
  devices_total: number;
  turns_today: number;
  p50_latency_ms: number;
  active_conversations: number;
  agents_total: number;
  providers: OverviewProvider[];
  needs_attention: OverviewAttentionItem[];
}

export function useOverview() {
  return useQuery({
    queryKey: ["overview"],
    queryFn: () => apiJson<OverviewData>("/api/overview"),
  });
}

export interface Agent {
  id: string;
  name: string;
  system_prompt: string;
  llm_model: string;
  temperature: number;
  max_tokens: number;
  tts_provider: string;
  tts_voice: string;
  emotion_level: string;
  tools_enabled: string[];
  memory_enabled: boolean;
  chat_log_level: number;
  created_at: string;
  updated_at: string;
}

export type AgentCreateInput = {
  name: string;
  system_prompt?: string;
  llm_model?: string;
  temperature?: number;
  max_tokens?: number;
  tts_provider?: string;
  tts_voice?: string;
  emotion_level?: string;
  tools_enabled?: string[];
  memory_enabled?: boolean;
  chat_log_level?: number;
};

export type AgentUpdateInput = Partial<AgentCreateInput>;

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: () => apiJson<Agent[]>("/api/agents"),
  });
}

export function useCreateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AgentCreateInput) =>
      apiJson<Agent>("/api/agents", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function useUpdateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AgentUpdateInput }) =>
      apiJson<Agent>(`/api/agents/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function useDeleteAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/api/agents/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`API ${res.status}: ${text}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export interface ProviderCred {
  id: string;
  kind: string; // llm|stt|tts|search|vision
  provider_code: string;
  config: Record<string, unknown>;
  secret_last4: string;
  fallback_of: string | null;
  created_at: string;
}

export type ProviderCreateInput = {
  kind: string;
  provider_code: string;
  config?: Record<string, unknown>;
  secret: string;
  fallback_of?: string | null;
};

export interface ProviderTestResult {
  ok: boolean;
  message: string;
}

export function useProviders() {
  return useQuery({
    queryKey: ["providers"],
    queryFn: () => apiJson<ProviderCred[]>("/api/providers"),
  });
}

export function useCreateProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ProviderCreateInput) =>
      apiJson<ProviderCred>("/api/providers", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
    },
  });
}

export function useDeleteProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/api/providers/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`API ${res.status}: ${text}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
    },
  });
}

export function useTestProvider() {
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<ProviderTestResult>(`/api/providers/${id}/test`, { method: "POST" }),
  });
}

export function useDevices() {
  return useQuery({
    queryKey: ["devices"],
    queryFn: () => apiJson<unknown[]>("/api/devices"),
    enabled: false,
  });
}

export function useConversations() {
  return useQuery({
    queryKey: ["conversations"],
    queryFn: () => apiJson<unknown[]>("/api/conversations"),
    enabled: false,
  });
}
