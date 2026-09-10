import { useQuery } from "@tanstack/react-query";
import { apiJson } from "./client";

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

// Stub hooks — halaman lengkapnya dikerjakan di Task 18-24.
export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: () => apiJson<unknown[]>("/api/agents"),
    enabled: false,
  });
}

export function useProviders() {
  return useQuery({
    queryKey: ["providers"],
    queryFn: () => apiJson<unknown[]>("/api/providers"),
    enabled: false,
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
