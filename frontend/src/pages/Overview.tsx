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
          label="Device Online"
          value={`${data.devices_online}/${data.devices_total}`}
        />
        <StatCard label="Agents" value={data.agents_total} />
        <StatCard label="Percakapan Aktif" value={data.active_conversations} />
        <StatCard label="Turn Hari Ini" value={data.turns_today} />
        <StatCard label="Latensi p50" value={`${data.p50_latency_ms} ms`} />
      </div>

      <div className="rounded-md border border-border bg-surface px-4 py-4">
        <h2 className="text-[13px] font-semibold text-text">Providers</h2>
        {data.providers.length === 0 ? (
          <p className="mt-2 text-[12px] text-text-dim">
            Belum ada provider yang dikonfigurasi.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {data.providers.map((provider, idx) => (
              <li
                key={`${provider.kind}-${idx}`}
                className="flex items-center justify-between rounded border border-border bg-surface-alt px-3 py-2"
              >
                <span className="text-[12px] font-medium text-text-secondary uppercase">
                  {provider.kind}
                </span>
                <span className="font-mono text-[12px] text-text">
                  {provider.provider_code}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-md border border-border bg-surface px-4 py-4">
        <h2 className="text-[13px] font-semibold text-text">Perlu Perhatian</h2>
        {data.needs_attention.length === 0 ? (
          <p className="mt-2 text-[12px] text-text-dim">
            Tidak ada yang perlu diperhatikan saat ini.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {data.needs_attention.map((item, idx) => (
              <li
                key={`${item.type}-${item.device_id ?? idx}`}
                className="flex items-center gap-2 rounded border border-border bg-surface-alt px-3 py-2 text-[12px] text-text-secondary"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />
                {item.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
