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

export interface Me {
  owner_id: string;
  email: string;
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => apiJson<Me>("/api/auth/me"),
    staleTime: Infinity, // identitas akun tidak berubah selama sesi berjalan
  });
}

export interface Health {
  database: "ok" | "down";
}

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => apiJson<Health>("/api/health"),
    refetchInterval: 30_000,
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

export type ProviderUpdateInput = {
  config?: Record<string, unknown>;
  secret?: string;
  fallback_of?: string | null;
};

export function useUpdateProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ProviderUpdateInput }) =>
      apiJson<ProviderCred>(`/api/providers/${id}`, { method: "PUT", body: JSON.stringify(body) }),
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

export interface Device {
  id: string;
  device_id: string; // MAC
  client_id: string;
  alias: string | null;
  agent_id: string | null;
  board: string | null;
  firmware_version: string | null;
  last_seen_at: string | null;
  created_at: string;
  online: boolean;
}

export type DeviceUpdateInput = {
  alias?: string | null;
  agent_id?: string | null;
};

export function useDevices() {
  return useQuery({
    queryKey: ["devices"],
    queryFn: () => apiJson<Device[]>("/api/devices"),
    refetchInterval: 15000,
  });
}

export function useUpdateDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: DeviceUpdateInput }) =>
      apiJson<Device>(`/api/devices/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
  });
}

export function useDeleteDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/api/devices/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`API ${res.status}: ${text}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
  });
}

export interface PendingActivation {
  device_id: string; // MAC
  client_id: string;
  created_at: string;
}

export function usePendingActivations() {
  return useQuery({
    queryKey: ["devices", "pending"],
    queryFn: () => apiJson<PendingActivation[]>("/api/devices/pending"),
    refetchInterval: 5000,
  });
}

export function useClaimDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      apiJson<{ code: string; claimed: boolean }>("/api/devices/claim", {
        method: "POST",
        body: JSON.stringify({ code }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
  });
}

export interface ConversationSummary {
  id: string;
  device_id: string;
  agent_id: string | null;
  session_id: string;
  title: string | null;
  started_at: string;
  turn_count: number;
}

export interface Message {
  id: string;
  role: string;
  text: string;
  provider_used: Record<string, unknown> | null;
  latency_ms: Record<string, unknown> | null;
  audio_path: string | null;
  created_at: string;
}

export interface ConversationDetail extends ConversationSummary {
  messages: Message[];
}

export type ConversationFilters = {
  device_id?: string;
  date_from?: string;
  date_to?: string;
  q?: string;
};

export function useConversations(filters: ConversationFilters = {}) {
  const params = new URLSearchParams();
  if (filters.device_id) params.set("device_id", filters.device_id);
  if (filters.date_from) params.set("date_from", filters.date_from);
  if (filters.date_to) params.set("date_to", filters.date_to);
  if (filters.q) params.set("q", filters.q);
  const qs = params.toString();

  return useQuery({
    queryKey: ["conversations", filters],
    queryFn: () => apiJson<ConversationSummary[]>(`/api/conversations${qs ? `?${qs}` : ""}`),
  });
}

export function useConversationDetail(id: string | null) {
  return useQuery({
    queryKey: ["conversations", id],
    queryFn: () => apiJson<ConversationDetail>(`/api/conversations/${id}`),
    enabled: !!id,
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/api/conversations/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`API ${res.status}: ${text}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}
