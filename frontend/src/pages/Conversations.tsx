import { useMemo, useState } from "react";
import {
  useConversations,
  useConversationDetail,
  useDeleteConversation,
  useDevices,
  type ConversationFilters,
} from "../api/hooks";

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("id-ID");
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function Conversations() {
  const [qInput, setQInput] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const filters: ConversationFilters = useMemo(
    () => ({
      q: qInput.trim() || undefined,
      device_id: deviceId || undefined,
      date_from: dateFrom ? new Date(dateFrom).toISOString() : undefined,
      date_to: dateTo ? new Date(dateTo).toISOString() : undefined,
    }),
    [qInput, deviceId, dateFrom, dateTo]
  );

  const { data: conversations, isLoading, isError } = useConversations(filters);
  const { data: devices } = useDevices();
  const { data: detail, isLoading: detailLoading } = useConversationDetail(selectedId);
  const deleteConversation = useDeleteConversation();

  function deviceLabel(id: string): string {
    const d = (devices ?? []).find((dev) => dev.id === id);
    return d ? d.alias ?? d.device_id : id;
  }

  async function handleDelete(id: string) {
    setDeleteError(null);
    try {
      await deleteConversation.mutateAsync(id);
      setConfirmDeleteId(null);
      if (selectedId === id) setSelectedId(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Gagal menghapus percakapan.");
    }
  }

  function handleExport() {
    if (!detail) return;
    downloadJson(`percakapan-${detail.id}.json`, detail);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-text">Percakapan</h1>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-4">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase text-text-dim">Cari judul</span>
          <input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="cari judul percakapan..."
            className="w-56 rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-text"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase text-text-dim">Device</span>
          <select
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            className="w-48 rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-text"
          >
            <option value="">Semua device</option>
            {(devices ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.alias ?? d.device_id}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase text-text-dim">Dari tanggal</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-text"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase text-text-dim">Sampai tanggal</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-text"
          />
        </label>
        <p className="text-[11px] text-text-dim">
          Catatan: pencarian judul, bukan isi transkrip.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[380px_1fr]">
        {/* List kiri */}
        <div className="rounded-xl border border-border bg-surface">
          {isLoading && <p className="p-4 text-[12px] text-text-dim">Memuat...</p>}
          {isError && <p className="p-4 text-[12px] text-danger">Gagal memuat percakapan.</p>}
          {conversations && conversations.length === 0 && (
            <p className="p-4 text-[12px] text-text-dim">Tidak ada percakapan yang cocok.</p>
          )}
          <ul className="divide-y divide-border">
            {(conversations ?? []).map((c) => (
              <li
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`cursor-pointer p-3 hover:bg-surface-alt ${
                  selectedId === c.id ? "bg-surface-alt" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-medium text-text">
                    {c.title ?? "(tanpa judul)"}
                  </span>
                  <span className="rounded-lg border border-border px-1.5 py-0.5 text-[10px] text-text-dim">
                    {c.turn_count} pesan
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-text-dim">{deviceLabel(c.device_id)}</p>
                <p className="text-[11px] text-text-dim">{formatDate(c.started_at)}</p>
              </li>
            ))}
          </ul>
        </div>

        {/* Detail kanan */}
        <div className="rounded-xl border border-border bg-surface p-5">
          {!selectedId && (
            <p className="text-[12px] text-text-dim">Pilih percakapan di sebelah kiri untuk melihat transkrip.</p>
          )}
          {selectedId && detailLoading && <p className="text-[12px] text-text-dim">Memuat transkrip...</p>}
          {selectedId && detail && (
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-[14px] font-semibold text-text">
                    {detail.title ?? "(tanpa judul)"}
                  </h2>
                  <p className="text-[11px] text-text-dim">
                    {deviceLabel(detail.device_id)} · {formatDate(detail.started_at)} · {detail.turn_count} pesan
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleExport}
                    className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-semibold text-text-secondary hover:bg-surface-alt"
                  >
                    Ekspor JSON
                  </button>
                  {confirmDeleteId === detail.id ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDelete(detail.id)}
                        disabled={deleteConversation.isPending}
                        className="rounded-lg bg-danger px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-danger/80 disabled:opacity-50"
                      >
                        Yakin Hapus?
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-semibold text-text-secondary hover:bg-surface-alt"
                      >
                        Batal
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(detail.id)}
                      className="rounded-lg border border-danger px-3 py-1.5 text-[11px] font-semibold text-danger hover:bg-danger/10"
                    >
                      Hapus
                    </button>
                  )}
                </div>
              </div>
              {deleteError && <p className="text-[12px] text-danger">{deleteError}</p>}

              <div className="flex flex-col gap-3">
                {detail.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`max-w-[85%] rounded-xl p-3 text-[13px] ${
                      m.role === "user"
                        ? "self-start border border-border bg-bg text-text"
                        : "self-end border border-amber/30 bg-amber/10 text-text"
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-4">
                      <span className="text-[10px] font-semibold uppercase text-text-dim">
                        {m.role === "user" ? "Pengguna" : "Asisten"}
                      </span>
                      <span className="text-[10px] text-text-dim">{formatDate(m.created_at)}</span>
                    </div>
                    <p className="whitespace-pre-wrap">{m.text}</p>
                    {(m.provider_used || m.latency_ms) && (
                      <div className="mt-2 border-t border-border/60 pt-2 text-[10px] text-text-dim">
                        {m.provider_used && (
                          <div>
                            provider: {Object.entries(m.provider_used).map(([k, v]) => `${k}=${String(v)}`).join(", ")}
                          </div>
                        )}
                        {m.latency_ms && (
                          <div>
                            latensi: {Object.entries(m.latency_ms).map(([k, v]) => `${k}=${String(v)}ms`).join(", ")}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {detail.messages.length === 0 && (
                  <p className="text-[12px] text-text-dim">Belum ada pesan di percakapan ini.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
