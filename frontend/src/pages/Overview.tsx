import { Server, Sparkles, MessageSquare, Gauge, AlertTriangle } from "lucide-react";
import { useOverview } from "../api/hooks";
import { StatCard } from "../components/StatCard";

export default function Overview() {
  const { data, isLoading, isError } = useOverview();

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

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          icon={Server}
          tone="mint"
          label="Device online"
          value={`${data.devices_online}/${data.devices_total}`}
        />
        <StatCard icon={Sparkles} tone="amber" label="Agents" value={data.agents_total} />
        <StatCard
          icon={MessageSquare}
          tone="amber"
          label="Percakapan aktif"
          value={data.active_conversations}
        />
        <StatCard icon={MessageSquare} tone="neutral" label="Turn hari ini" value={data.turns_today} />
        <StatCard icon={Gauge} tone="neutral" label="Latensi p50" value={`${data.p50_latency_ms} ms`} />
      </div>

      <div className="rounded-xl border border-border bg-surface px-5 py-4">
        <h2 className="text-[13px] font-semibold text-text">Providers</h2>
        {data.providers.length === 0 ? (
          <p className="mt-2 text-[12px] text-text-dim">
            Belum ada provider yang dikonfigurasi.
          </p>
        ) : (
          <div className="mt-3 flex flex-col">
            {data.providers.map((provider, idx) => (
              <div
                key={`${provider.kind}-${idx}`}
                className={`flex items-center justify-between px-1 py-2.5 ${
                  idx !== data.providers.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <span className="text-[12.5px] text-text-secondary">{provider.kind}</span>
                <span className="font-mono text-[12px] text-text">
                  {provider.provider_code}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-surface px-5 py-4">
        <h2 className="text-[13px] font-semibold text-text">Perlu perhatian</h2>
        {data.needs_attention.length === 0 ? (
          <p className="mt-2 text-[12px] text-text-dim">
            Tidak ada yang perlu diperhatikan saat ini.
          </p>
        ) : (
          <div className="mt-3 flex flex-col">
            {data.needs_attention.map((item, idx) => (
              <div
                key={`${item.type}-${item.device_id ?? idx}`}
                className={`flex items-center gap-2.5 px-1 py-2.5 text-[12.5px] text-text-secondary ${
                  idx !== data.needs_attention.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-danger/10 text-danger">
                  <AlertTriangle size={13} strokeWidth={2} />
                </span>
                {item.message}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
