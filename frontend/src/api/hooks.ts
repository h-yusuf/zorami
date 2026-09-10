import { useQuery } from "@tanstack/react-query";
import { apiJson } from "./client";

export interface OverviewData {
  devices_active: number;
  devices_total: number;
  turns_today: number;
  latency_p50_ms: number;
  turns_failed: number;
  pipeline: Array<{
    stage: string;
    provider: string;
    latency_p50_ms: number;
    quota_status: string;
  }>;
  devices: Array<{
    id: string;
    name: string;
    status: string;
    wifi_strength: number;
    battery: number;
    agent_name: string | null;
  }>;
  attention: Array<{ message: string; severity: string }>;
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
