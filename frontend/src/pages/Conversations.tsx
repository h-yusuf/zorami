import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  useConversations,
  useConversationDetail,
  useDeleteConversation,
  useDevices,
  useAgents,
  type ConversationFilters,
  type Message,
} from "../api/hooks";

const CHAT_LOG_LABEL: Record<number, string> = {
  0: "tidak dicatat",
  1: "teks saja",
  2: "teks + audio",
};

const STAGE_LABEL: Record<string, string> = {
  stt: "stt",
  llm: "llm",
  tts: "tts",
  search: "search",
};

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("id-ID");
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
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

// Pesan ditulis _log_turn() selalu berpasangan (user lalu assistant) per turn -
// jadi grouping berurutan seperti ini aman, bukan tebakan.
function pairTurns(messages: Message[]): Array<{ user?: Message; assistant?: Message }> {
  const turns: Array<{ user?: Message; assistant?: Message }> = [];
  for (let i = 0; i < messages.length; i += 2) {
    turns.push({ user: messages[i], assistant: messages[i + 1] });
  }
  return turns;
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
  const { data: agents } = useAgents();
  const { data: detail, isLoading: detailLoading } = useConversationDetail(selectedId);
  const deleteConversation = useDeleteConversation();

  function deviceLabel(id: string): string {
    const d = (devices ?? []).find((dev) => dev.id === id);
    return d ? d.alias ?? d.device_id : id;
  }

  function agentLabel(id: string | null): string {
    if (!id) return "tanpa agent";
    return (agents ?? []).find((a) => a.id === id)?.name ?? id;
  }

  function agentChatLogLevel(id: string | null): number | null {
    if (!id) return null;
    return (agents ?? []).find((a) => a.id === id)?.chat_log_level ?? null;
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

  const detailChatLogLevel = detail ? agentChatLogLevel(detail.agent_id) : null;

  return (
    <div className="flex h-full gap-4">
      {/* List kiri */}
      <div className="flex w-[300px] shrink-0 flex-col rounded-md border border-border bg-[#1A1917]">
        <div className="flex flex-col gap-[11px] border-b border-border px-4 py-[15px]">
          <div className="flex items-center gap-[9px] rounded-[3px] border border-[#35322C] bg-bg px-[11px] py-2">
            <Search size={14} strokeWidth={2} className="text-text-dim" />
            <input
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="cari judul percakapan..."
              className="grow bg-transparent text-[12.5px] text-text outline-none placeholder:text-text-dim"
            />
          </div>
          <div className="flex flex-wrap gap-[6px]">
            <select
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              className={`rounded-[3px] border px-[10px] py-[5px] text-[11.5px] ${
                deviceId ? "border-[#4A3A2A] text-amber" : "border-[#35322C] text-text-secondary"
              } bg-transparent`}
            >
              <option value="">Semua device</option>
              {(devices ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.alias ?? d.device_id}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-[3px] border border-[#35322C] bg-transparent px-[10px] py-[5px] text-[11.5px] text-text-secondary"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-[3px] border border-[#35322C] bg-transparent px-[10px] py-[5px] text-[11.5px] text-text-secondary"
            />
          </div>
          <p className="text-[11.5px] leading-relaxed text-text-dim">
            Pencarian judul lewat Postgres &mdash; tanpa layanan pencarian tambahan. Belum
            menjangkau isi transkrip.
          </p>
        </div>

        {isLoading && <p className="p-4 text-[12px] text-text-dim">Memuat...</p>}
        {isError && <p className="p-4 text-[12px] text-danger">Gagal memuat percakapan.</p>}
        {conversations && conversations.length === 0 && (
          <p className="p-4 text-[12px] text-text-dim">Tidak ada percakapan yang cocok.</p>
        )}

        <div className="flex flex-col overflow-y-auto">
          {(conversations ?? []).map((c) => {
            const isActive = selectedId === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`flex flex-col gap-[5px] border-b border-[#26241F] px-4 py-[13px] text-left ${
                  isActive ? "border-l-[3px] border-l-amber bg-[#221F1B]" : "border-l-[3px] border-l-transparent hover:bg-surface-alt"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className={`text-[13px] ${isActive ? "font-semibold text-text" : "font-medium text-[#D6D1C8]"}`}>
                    {c.title ?? "(tanpa judul)"}
                  </div>
                  <div className="shrink-0 font-mono text-[9.5px] text-text-dim">
                    {formatTime(c.started_at)}
                  </div>
                </div>
                <div className="text-[11.5px] leading-relaxed text-text-dim">
                  {deviceLabel(c.device_id)} &middot; {agentLabel(c.agent_id)} &middot; {c.turn_count} turn
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Transcript kanan */}
      <div className="flex flex-1 flex-col overflow-hidden rounded-md border border-border bg-surface">
        {!selectedId && (
          <p className="p-5 text-[12px] text-text-dim">
            Pilih percakapan di sebelah kiri untuk melihat transkrip.
          </p>
        )}
        {selectedId && detailLoading && <p className="p-5 text-[12px] text-text-dim">Memuat transkrip...</p>}

        {selectedId && detail && (
          <>
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="flex flex-col gap-[2px]">
                <div className="text-[17px] font-semibold text-text">
                  {detail.title ?? "(tanpa judul)"}
                </div>
                <div className="font-mono text-[10.5px] text-text-dim">
                  {detail.session_id} &middot; {formatDate(detail.started_at)} &middot; {detail.turn_count} pesan
                </div>
              </div>
              <div className="flex items-center gap-[9px]">
                <button
                  onClick={handleExport}
                  className="rounded-[3px] border border-[#35322C] px-[13px] py-[7px] text-[12.5px] text-text-secondary hover:bg-surface-alt"
                >
                  Ekspor
                </button>
                {confirmDeleteId === detail.id ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleDelete(detail.id)}
                      disabled={deleteConversation.isPending}
                      className="rounded bg-danger px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-danger/80 disabled:opacity-50"
                    >
                      Yakin hapus?
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="rounded border border-border px-3 py-1.5 text-[11px] font-semibold text-text-secondary hover:bg-surface-alt"
                    >
                      Batal
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(detail.id)}
                    className="rounded-[3px] border border-[#4A2E28] px-[13px] py-[7px] text-[12.5px] text-danger hover:bg-danger/10"
                  >
                    Hapus
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-[14px] overflow-y-auto p-5">
              {deleteError && <p className="text-[12px] text-danger">{deleteError}</p>}

              {pairTurns(detail.messages).map((turn, idx) => {
                const latency = turn.assistant?.latency_ms;
                const stageEntries = latency
                  ? Object.entries(latency).filter(([k]) => k !== "total")
                  : [];
                return (
                  <div key={idx} className="flex flex-col gap-[11px] rounded-md border border-border bg-[#1F1E1B] p-4">
                    {turn.user && (
                      <div className="flex gap-[11px]">
                        <div className="w-[34px] shrink-0 pt-[2px] font-mono text-[10px] text-text-dim">
                          USER
                        </div>
                        <div className="grow text-[13.5px] leading-relaxed text-text">
                          {turn.user.text}
                        </div>
                      </div>
                    )}
                    {turn.assistant && (
                      <div className="flex gap-[11px]">
                        <div className="w-[34px] shrink-0 pt-[2px] font-mono text-[10px] text-text-dim">
                          ZORA
                        </div>
                        <div className="grow text-[13.5px] leading-relaxed text-text-secondary">
                          {turn.assistant.text}
                        </div>
                      </div>
                    )}
                    {stageEntries.length > 0 && (
                      <div className="flex flex-wrap gap-4 border-t border-[#26241F] pt-[9px]">
                        {stageEntries.map(([stage, ms]) => (
                          <div key={stage} className="font-mono text-[10px] text-[#56534D]">
                            {STAGE_LABEL[stage] ?? stage} {String(ms)}ms
                          </div>
                        ))}
                        <div className="grow" />
                        {typeof latency?.total === "number" && (
                          <div className="font-mono text-[10px] text-text-secondary">
                            total {(latency.total / 1000).toFixed(2)}s
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {detail.messages.length === 0 && (
                <p className="text-[12px] text-text-dim">Belum ada pesan di percakapan ini.</p>
              )}

              {detailChatLogLevel !== null && (
                <div className="flex items-center justify-between rounded-md border border-border bg-[#1F1E1B] px-4 py-3">
                  <div className="text-[12.5px] font-medium text-text">
                    Tingkat pencatatan agent ini
                  </div>
                  <div className="font-mono text-[11px] text-text-dim">
                    {CHAT_LOG_LABEL[detailChatLogLevel] ?? detailChatLogLevel}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
