import { useMonitorSocket, type MonitorStatus } from "../hooks/useMonitorSocket";

const STATUS_LABEL: Record<MonitorStatus, string> = {
  connecting: "Menyambungkan...",
  connected: "Live",
  disconnected: "Terputus — mencoba lagi...",
  error: "Error (token tidak ada / ditolak)",
};

const STATUS_DOT: Record<MonitorStatus, string> = {
  connecting: "bg-amber",
  connected: "bg-mint",
  disconnected: "bg-danger",
  error: "bg-danger",
};

const STATUS_CLASS: Record<MonitorStatus, string> = {
  connecting: "border-[#4A3A2A] bg-[#201C18] text-amber",
  connected: "border-[#2F4033] bg-[#1F241F] text-[#8FD6BC]",
  disconnected: "border-danger/30 bg-danger/10 text-danger",
  error: "border-danger/30 bg-danger/10 text-danger",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("id-ID", { hour12: false });
}

function summarize(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const entries = Object.entries(payload as Record<string, unknown>);
    return entries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ");
  }
  return JSON.stringify(payload);
}

export default function LiveMonitor() {
  const { status, events } = useMonitorSocket();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="rounded-[3px] border border-border px-2.5 py-[7px] font-mono text-[11px] text-text-secondary">
          SEMUA DEVICE
        </div>
        <div
          className={`flex items-center gap-[7px] rounded-[3px] border px-[11px] py-[6px] ${STATUS_CLASS[status]}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
          <span className="text-[12px] font-medium">{STATUS_LABEL[status]}</span>
        </div>
      </div>

      <div className="rounded-md border border-[#4A3A2A] bg-[#201C18] p-4 text-[12px] text-text">
        <p className="font-semibold text-amber">Keterbatasan saat ini</p>
        <p className="mt-1 leading-relaxed text-[#C9B48C]">
          Voice loop (rekam &rarr; STT &rarr; LLM &rarr; TTS) belum memancarkan event turn detail
          (<code className="font-mono">turn.started</code>, <code className="font-mono">turn.stage</code>,{" "}
          <code className="font-mono">turn.completed</code>, dst) ke event bus, jadi kartu per-turn
          seperti di rancangan tampilan belum bisa ditampilkan di sini. Yang sungguhan mengalir saat
          ini hanya panggilan MCP ke device (<code className="font-mono">device.mcp_call</code>), dan
          hanya kalau payload-nya membawa <code className="font-mono">owner_id</code> yang cocok
          dengan akun Anda. Log di bawah tidak berisi data dummy atau simulasi.
        </p>
      </div>

      <div className="rounded-md border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="text-[13.5px] font-semibold text-text">Pesan protokol</div>
          <div className="font-mono text-[10px] text-text-dim">{events.length} EVENT</div>
        </div>
        <div className="flex max-h-[60vh] flex-col overflow-y-auto px-4 py-2">
          {events.length === 0 && (
            <p className="py-6 text-center text-[12px] text-text-dim">
              Belum ada event masuk. Log akan terisi begitu ada event yang dipancarkan ke bus
              untuk akun Anda.
            </p>
          )}
          {events.map((ev) => (
            <div key={ev.id} className="flex gap-[10px] border-b border-[#26241F] py-[7px] last:border-0">
              <div className="w-[58px] shrink-0 font-mono text-[10.5px] text-[#56534D]">
                {formatTime(ev.receivedAt)}
              </div>
              <div className="shrink-0 rounded-[2px] bg-surface-alt px-[6px] py-[1px] font-mono text-[10px] text-amber">
                {ev.topic}
              </div>
              <div className="min-w-0 grow break-all font-mono text-[10.5px] text-text-secondary">
                {summarize(ev.payload)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
