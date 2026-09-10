import { useMonitorSocket, type MonitorStatus } from "../hooks/useMonitorSocket";

const STATUS_LABEL: Record<MonitorStatus, string> = {
  connecting: "Menyambungkan...",
  connected: "Tersambung",
  disconnected: "Terputus — mencoba lagi...",
  error: "Error (token tidak ada / ditolak)",
};

const STATUS_CLASS: Record<MonitorStatus, string> = {
  connecting: "border-amber/30 bg-amber/10 text-amber",
  connected: "border-green-500/30 bg-green-500/10 text-green-500",
  disconnected: "border-danger/30 bg-danger/10 text-danger",
  error: "border-danger/30 bg-danger/10 text-danger",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("id-ID", { hour12: false });
}

export default function LiveMonitor() {
  const { status, events } = useMonitorSocket();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-text">Live Monitor</h1>
        <span
          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${STATUS_CLASS[status]}`}
        >
          {STATUS_LABEL[status]}
        </span>
      </div>

      <div className="rounded-xl border border-amber/30 bg-amber/10 p-4 text-[12px] text-text">
        <p className="font-semibold text-amber">Keterbatasan saat ini</p>
        <p className="mt-1 text-text-dim">
          Live monitor sudah terhubung ke server lewat WebSocket dan akan menampilkan event apa
          adanya begitu masuk. Tapi voice loop (rekam → STT → LLM → TTS) belum memancarkan event
          detail (<code>turn.started</code>, <code>turn.stage</code>, <code>turn.completed</code>,
          dst) ke event bus — bagian itu menyusul di fase pengembangan berikutnya. Yang sudah bisa
          benar-benar muncul di sini saat ini hanyalah panggilan MCP ke device (
          <code>device.mcp_call</code>), dan hanya kalau payload-nya membawa <code>owner_id</code>
          yang cocok dengan akun Anda. Log di bawah menampilkan event mentah persis seperti yang
          diterima dari server — tidak ada data dummy atau simulasi.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface">
        <div className="border-b border-border px-4 py-2 text-[11px] font-medium uppercase text-text-dim">
          Log Event Mentah ({events.length})
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {events.length === 0 && (
            <p className="px-4 py-6 text-center text-[12px] text-text-dim">
              Belum ada event masuk. Log akan terisi begitu ada event yang dipancarkan ke bus
              untuk akun Anda.
            </p>
          )}
          {events.map((ev) => (
            <div
              key={ev.id}
              className="border-b border-border px-4 py-2 last:border-0 font-mono text-[11px]"
            >
              <div className="flex items-center gap-2 text-text-dim">
                <span>{formatTime(ev.receivedAt)}</span>
                <span className="rounded-md bg-surface-alt px-1.5 py-0.5 text-text">{ev.topic}</span>
              </div>
              <pre className="mt-1 whitespace-pre-wrap break-all text-text-dim">
                {JSON.stringify(ev.payload, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
