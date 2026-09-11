import { Plus, AlertTriangle, Clock } from "lucide-react";
import { useOverview, useDevices, useAgents } from "../api/hooks";

const KIND_LABEL: Record<string, string> = {
  llm: "LLM",
  stt: "STT",
  tts: "TTS",
  search: "Search",
  vision: "Vision",
};

// Sama seperti heuristik di halaman Providers - kosmetik frontend saja, bukan
// klaim dari backend soal provider mana yang gratis.
const FREE_PROVIDER_CODES = new Set(["piper", "searxng"]);

function formatLastSeen(value: string | null): string {
  if (!value) return "belum pernah";
  return new Date(value).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

export default function Overview() {
  const { data, isLoading, isError } = useOverview();
  const { data: devices } = useDevices();
  const { data: agents } = useAgents();

  if (isLoading) {
    return <p className="text-sm text-text-dim">Memuat ringkasan...</p>;
  }
  if (isError) {
    return (
      <p className="text-sm text-danger">
        Gagal memuat data overview. Coba muat ulang halaman.
      </p>
    );
  }
  if (!data) {
    return <p className="text-sm text-text-dim">Tidak ada data.</p>;
  }

  const attentionCount = data.needs_attention.length;

  function agentName(agentId: string | null): string {
    if (!agentId) return "belum ada agent";
    return (agents ?? []).find((a) => a.id === agentId)?.name ?? agentId;
  }

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex items-center justify-between">
        {attentionCount === 0 ? (
          <div className="flex items-center gap-[7px] rounded-[3px] border border-[#2F4033] bg-[#1F241F] px-[11px] py-[6px]">
            <span className="h-1.5 w-1.5 rounded-full bg-mint" />
            <span className="text-[12px] font-medium text-[#8FD6BC]">Semua pipeline normal</span>
          </div>
        ) : (
          <div className="flex items-center gap-[7px] rounded-[3px] border border-[#4A3A2A] bg-[#201C18] px-[11px] py-[6px]">
            <span className="h-1.5 w-1.5 rounded-full bg-amber" />
            <span className="text-[12px] font-medium text-amber">
              {attentionCount} hal perlu perhatian
            </span>
          </div>
        )}
        <div className="rounded-[3px] border border-border px-2.5 py-[7px] font-mono text-[11px] text-text-dim">
          HARI INI
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        <div className="flex flex-col gap-[7px] rounded-md border border-border bg-surface px-4 py-[14px]">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-dim">
            Device aktif
          </div>
          <div className="flex items-baseline gap-[6px]">
            <div className="font-mono text-[27px] font-semibold leading-none text-text">
              {data.devices_online}
            </div>
            <div className="font-mono text-[13px] text-text-dim">/ {data.devices_total}</div>
          </div>
          <div className="text-[11px] text-text-dim">
            {data.devices_total - data.devices_online > 0
              ? `${data.devices_total - data.devices_online} offline`
              : "semua online"}
          </div>
        </div>

        <div className="flex flex-col gap-[7px] rounded-md border border-border bg-surface px-4 py-[14px]">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-dim">
            Turn hari ini
          </div>
          <div className="font-mono text-[27px] font-semibold leading-none text-text">
            {data.turns_today}
          </div>
          <div className="text-[11px] text-text-dim">
            {data.active_conversations} percakapan aktif
          </div>
        </div>

        <div className="flex flex-col gap-[7px] rounded-md border border-border bg-surface px-4 py-[14px]">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-dim">
            Respons p50
          </div>
          <div className="flex items-baseline gap-[4px]">
            <div className="font-mono text-[27px] font-semibold leading-none text-text">
              {data.p50_latency_ms > 0 ? (data.p50_latency_ms / 1000).toFixed(2) : "-"}
            </div>
            {data.p50_latency_ms > 0 && (
              <div className="font-mono text-[13px] text-text-dim">s</div>
            )}
          </div>
          <div className="text-[11px] text-text-dim">
            {data.p50_latency_ms > 0 ? "mulut-ke-telinga" : "belum ada turn tercatat"}
          </div>
        </div>

        <div className="flex flex-col gap-[7px] rounded-md border border-border bg-surface px-4 py-[14px]">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-dim">
            Agents
          </div>
          <div className="font-mono text-[27px] font-semibold leading-none text-text">
            {data.agents_total}
          </div>
          <div className="text-[11px] text-text-dim">{data.providers.length} provider aktif</div>
        </div>
      </div>

      {/* Pipeline strip */}
      <div className="rounded-md border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="text-[13px] font-semibold text-text">Pipeline adapter</div>
          <div className="text-[11.5px] text-text-dim">
            Provider aktif per tahap &mdash; diambil dari key milik akun ini
          </div>
        </div>
        {data.providers.length === 0 ? (
          <p className="px-4 py-4 text-[12px] text-text-dim">
            Belum ada provider dikonfigurasi. Atur di halaman Providers &amp; Keys.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {data.providers.map((p, idx) => {
              const isFree = FREE_PROVIDER_CODES.has(p.provider_code.toLowerCase());
              return (
                <div
                  key={`${p.kind}-${idx}`}
                  className={`flex flex-col gap-[6px] px-4 py-[14px] ${
                    idx !== data.providers.length - 1 ? "sm:border-r sm:border-border" : ""
                  }`}
                >
                  <div className="flex items-center gap-[7px]">
                    <span className="h-1.5 w-1.5 rounded-full bg-mint" />
                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-dim">
                      {KIND_LABEL[p.kind] ?? p.kind}
                    </div>
                  </div>
                  <div className="text-[13px] font-medium text-text">{p.provider_code}</div>
                  <div className="font-mono text-[11px] text-text-dim">
                    {p.p50_ms > 0 ? `p50 ${p.p50_ms}ms` : "belum ada data"} &middot;{" "}
                    {isFree ? "nol biaya" : "token sendiri"}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Two col: devices + attention */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.35fr_1fr]">
        <div className="flex flex-col rounded-md border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="text-[13px] font-semibold text-text">Device</div>
            <a
              href="/devices"
              className="flex items-center gap-[6px] text-[11.5px] font-medium text-amber hover:text-amber-light"
            >
              <Plus size={13} strokeWidth={2} />
              Pasangkan device
            </a>
          </div>
          {(devices ?? []).length === 0 && (
            <p className="px-4 py-4 text-[12px] text-text-dim">Belum ada device terdaftar.</p>
          )}
          {(devices ?? []).map((d, idx, arr) => (
            <div
              key={d.id}
              className={`flex items-center gap-[14px] px-4 py-[13px] ${
                idx !== arr.length - 1 ? "border-b border-[#26241F]" : ""
              }`}
            >
              <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${d.online ? "bg-mint" : "bg-[#56534D]"}`} />
              <div className="flex grow flex-col gap-[3px]">
                <div className={`text-[13.5px] font-medium ${d.online ? "text-text" : "text-text-secondary"}`}>
                  {d.alias ?? d.device_id}
                </div>
                <div className={`font-mono text-[10.5px] ${d.online ? "text-text-dim" : "text-[#56534D]"}`}>
                  {d.device_id} &middot; agent: {agentName(d.agent_id)}
                </div>
              </div>
              <div className="flex flex-col items-end gap-[3px]">
                <div className={`text-[11.5px] font-medium ${d.online ? "text-[#8FD6BC]" : "text-text-dim"}`}>
                  {d.online ? "Online" : "Offline"}
                </div>
                <div className="font-mono text-[10.5px] text-text-dim">
                  {d.online ? "terhubung" : `terakhir ${formatLastSeen(d.last_seen_at)}`}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col rounded-md border border-border bg-surface">
          <div className="border-b border-border px-4 py-3 text-[13px] font-semibold text-text">
            Perlu perhatian
          </div>
          {data.needs_attention.length === 0 ? (
            <p className="px-4 py-4 text-[12px] text-text-dim">
              Tidak ada yang perlu diperhatikan saat ini.
            </p>
          ) : (
            data.needs_attention.map((item, idx) => (
              <div
                key={`${item.type}-${item.device_id ?? idx}`}
                className={`flex gap-[11px] px-4 py-[13px] ${
                  idx !== data.needs_attention.length - 1 ? "border-b border-[#26241F]" : ""
                }`}
              >
                {item.type === "device_offline" ? (
                  <Clock size={16} strokeWidth={1.8} className="mt-px shrink-0 text-text-secondary" />
                ) : (
                  <AlertTriangle size={16} strokeWidth={1.8} className="mt-px shrink-0 text-amber" />
                )}
                <div className="text-[12.5px] leading-relaxed text-text-secondary">
                  {item.message}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
