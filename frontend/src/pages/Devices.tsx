import { useRef, useState } from "react";
import {
  useDevices,
  useAgents,
  useUpdateDevice,
  useDeleteDevice,
  useClaimDevice,
  usePendingActivations,
  type Device,
} from "../api/hooks";

const CODE_LENGTH = 6;

// Allowlist bridge (app/device/mcp_client.py) - sama untuk semua device, bukan
// hasil "deteksi" per device. Reboot/upgrade_firmware sengaja tidak pernah
// diekspos ke LLM walau device melaporkannya balik lewat tools/list.
const ALLOWED_TOOLS = [
  "self.get_device_status",
  "self.audio_speaker.set_volume",
  "self.screen.set_brightness",
  "self.screen.set_theme",
];
const BLOCKED_TOOLS = ["self.reboot", "self.upgrade_firmware"];

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function truncateMiddle(value: string, head = 4, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const chars = value.padEnd(CODE_LENGTH, " ").split("");

  return (
    <div
      className="relative flex gap-[7px]"
      onClick={() => inputRef.current?.focus()}
    >
      <input
        ref={inputRef}
        value={value}
        onChange={(e) =>
          onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH))
        }
        maxLength={CODE_LENGTH}
        aria-label="Kode aktivasi"
        className="absolute inset-0 h-full w-full cursor-text opacity-0"
      />
      {chars.map((ch, i) => {
        const filled = ch !== " ";
        const isNext = !filled && value.length === i;
        return (
          <div
            key={i}
            className={`flex h-12 w-10 items-center justify-center rounded-[3px] border font-mono text-[20px] font-semibold ${
              isNext
                ? "border-amber text-amber"
                : filled
                  ? "border-[#4A3A2A] text-text"
                  : "border-[#35322C] text-text"
            }`}
            style={{ background: "var(--color-bg)" }}
          >
            {filled ? ch : ""}
          </div>
        );
      })}
    </div>
  );
}

export default function Devices() {
  const { data: devices, isLoading, isError } = useDevices();
  const { data: agents } = useAgents();
  const { data: pending } = usePendingActivations();
  const updateDevice = useUpdateDevice();
  const deleteDevice = useDeleteDevice();
  const claimDevice = useClaimDevice();

  const [claimCode, setClaimCode] = useState("");
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimSuccess, setClaimSuccess] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reassigning, setReassigning] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const selected = (devices ?? []).find((d) => d.id === selectedId) ?? null;
  const onlineCount = (devices ?? []).filter((d) => d.online).length;

  function agentName(agentId: string | null): string {
    if (!agentId) return "Belum ada agent";
    const agent = (agents ?? []).find((a) => a.id === agentId);
    return agent ? agent.name : agentId;
  }

  async function handleClaim() {
    const code = claimCode.trim().toUpperCase();
    setClaimError(null);
    setClaimSuccess(null);
    if (code.length !== CODE_LENGTH) {
      setClaimError("Kode aktivasi harus 6 karakter.");
      return;
    }
    try {
      const result = await claimDevice.mutateAsync(code);
      setClaimSuccess(`Kode ${result.code} berhasil diklaim. Device akan muncul di tabel setelah tersambung.`);
      setClaimCode("");
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : "Gagal mengklaim kode.");
    }
  }

  async function handleAgentChange(device: Device, agentId: string) {
    await updateDevice.mutateAsync({ id: device.id, body: { agent_id: agentId || null } });
    setReassigning(false);
  }

  async function handleDelete(id: string) {
    setDeleteError(null);
    try {
      await deleteDevice.mutateAsync(id);
      setConfirmDeleteId(null);
      if (selectedId === id) setSelectedId(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Gagal menghapus device.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text">Devices</h1>
          <p className="text-[11.5px] text-text-dim">
            {(devices ?? []).length} device terdaftar &middot; {onlineCount} online
          </p>
        </div>
        <div className="rounded-[3px] border border-border px-2.5 py-[7px] font-mono text-[11px] text-text-dim">
          FIRMWARE HOST: AKTIF
        </div>
      </div>

      {isError && <p className="text-[12px] text-danger">Gagal memuat devices.</p>}

      <div className="grid grid-cols-1 gap-[18px] xl:grid-cols-[1.55fr_1fr]">
        <div className="flex flex-col gap-4">
          <div className="rounded-md border border-[#4A3A2A] bg-surface">
            <div className="flex items-center gap-[9px] border-b border-border px-[18px] py-3.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-amber)" strokeWidth="1.8" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <div className="text-[13.5px] font-semibold text-text">Pasangkan device baru</div>
            </div>
            <div className="flex flex-col gap-[14px] px-[18px] py-4">
              <p className="text-[11.5px] leading-relaxed text-text-dim">
                Nyalakan device di WiFi yang sama. Setelah tersambung, layarnya menampilkan kode
                enam karakter. Masukkan kode itu di sini &mdash; device langsung menerima alamat
                bridge dan tokennya sendiri, tanpa perlu dicolok ke komputer.
              </p>
              <div className="flex flex-wrap items-center gap-[10px]">
                <CodeInput value={claimCode} onChange={setClaimCode} />
                <button
                  onClick={handleClaim}
                  disabled={claimDevice.isPending || claimCode.length !== CODE_LENGTH}
                  className="rounded-[3px] bg-amber px-4 py-2.5 text-[12.5px] font-semibold text-bg hover:bg-amber-light disabled:opacity-50"
                >
                  Klaim device
                </button>
              </div>
              {claimError && <p className="text-[12px] text-danger">{claimError}</p>}
              {claimSuccess && <p className="text-[12px] text-[#8FD6BC]">{claimSuccess}</p>}

              {pending && pending.length > 0 && (
                <div className="flex items-center gap-2 rounded-[3px] bg-[#1D1C19] px-3 py-[9px]">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
                  <div className="font-mono text-[11px] text-[#C9B48C]">
                    {pending.length} device sedang menunggu diklaim &middot;{" "}
                    {pending.map((p) => p.device_id).join(", ")}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-md border border-border bg-surface">
            <div className="grid grid-cols-[1.4fr_1.1fr_88px_96px] border-b border-border">
              <div className="px-[14px] py-[9px] text-[10px] font-semibold uppercase tracking-widest text-text-dim">
                Device
              </div>
              <div className="px-[14px] py-[9px] text-[10px] font-semibold uppercase tracking-widest text-text-dim">
                Agent
              </div>
              <div className="px-[14px] py-[9px] text-[10px] font-semibold uppercase tracking-widest text-text-dim">
                Firmware
              </div>
              <div className="px-[14px] py-[9px] text-[10px] font-semibold uppercase tracking-widest text-text-dim">
                Status
              </div>
            </div>

            {isLoading && <p className="px-[14px] py-4 text-[12px] text-text-dim">Memuat...</p>}

            {(devices ?? []).map((d, idx, arr) => {
              const isSelected = d.id === selectedId;
              return (
                <div
                  key={d.id}
                  onClick={() => setSelectedId(d.id)}
                  className={`grid cursor-pointer grid-cols-[1.4fr_1.1fr_88px_96px] border-l-[3px] ${
                    idx !== arr.length - 1 ? "border-b border-[#26241F]" : ""
                  } ${isSelected ? "border-l-amber bg-[#221F1B]" : "border-l-transparent hover:bg-surface-alt"}`}
                >
                  <div className="flex flex-col gap-[3px] px-[14px] py-3">
                    <div className={`text-[12.5px] font-medium ${d.online ? "text-text" : "text-text-secondary"}`}>
                      {d.alias ?? "(tanpa nama)"}
                    </div>
                    <div className={`font-mono text-[10.5px] ${d.online ? "text-text-dim" : "text-[#56534D]"}`}>
                      {d.device_id}
                    </div>
                  </div>
                  <div className={`flex items-center px-[14px] py-3 text-[12.5px] ${d.online ? "text-[#D6D1C8]" : "text-[#8B857D]"}`}>
                    {agentName(d.agent_id)}
                  </div>
                  <div className={`flex items-center px-[14px] py-3 font-mono text-[11px] ${d.online ? "text-[#8FD6BC]" : "text-text-dim"}`}>
                    {d.firmware_version ?? "-"}
                  </div>
                  <div className="flex items-center gap-[7px] px-[14px] py-3">
                    <span className={`h-1.5 w-1.5 rounded-full ${d.online ? "bg-mint" : "bg-[#56534D]"}`} />
                    <span className={`text-[12.5px] ${d.online ? "text-[#8FD6BC]" : "text-text-dim"}`}>
                      {d.online ? "Online" : "Offline"}
                    </span>
                  </div>
                </div>
              );
            })}
            {devices && devices.length === 0 && (
              <p className="px-[14px] py-4 text-center text-[12px] text-text-dim">
                Belum ada device. Klaim kode aktivasi di atas.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {selected ? (
            <>
              <div className="flex flex-col gap-[13px] rounded-md border border-border bg-surface px-[18px] py-4">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-[3px]">
                    <div className="text-[14px] font-semibold text-text">
                      {selected.alias ?? selected.device_id}
                    </div>
                    <div className="font-mono text-[10.5px] text-text-dim">
                      diklaim {formatDate(selected.created_at)}
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedId(null)}
                    className="text-[12px] text-text-dim hover:text-text"
                  >
                    Tutup
                  </button>
                </div>

                <div className="h-px bg-border" />

                <div className="flex flex-col gap-[9px]">
                  <div className="flex items-center justify-between">
                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-dim">
                      Agent
                    </div>
                    <div className="text-[12.5px] font-medium text-amber">
                      {agentName(selected.agent_id)}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-dim">
                      Client-Id
                    </div>
                    <div className="font-mono text-[11px] text-text-secondary">
                      {truncateMiddle(selected.client_id)}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-dim">
                      Board
                    </div>
                    <div className="font-mono text-[11px] text-text-secondary">
                      {selected.board ?? "-"}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-dim">
                      Terakhir terlihat
                    </div>
                    <div className="font-mono text-[11px] text-text-secondary">
                      {formatDate(selected.last_seen_at)}
                    </div>
                  </div>
                </div>

                <div className="h-px bg-border" />

                <div className="flex flex-col gap-[5px]">
                  <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-dim">
                    Tool yang diizinkan ke agent
                  </div>
                  <p className="text-[11.5px] leading-relaxed text-text-dim">
                    Bridge cuma meneruskan daftar ini ke LLM, apapun yang device laporkan sendiri
                    lewat MCP.
                  </p>
                  <div className="mt-1 flex flex-wrap gap-[6px]">
                    {ALLOWED_TOOLS.map((t) => (
                      <span
                        key={t}
                        className="rounded-[2px] border border-[#2F4033] bg-[#1F241F] px-[6px] py-[3px] font-mono text-[10px] text-[#8FD6BC]"
                      >
                        {t}
                      </span>
                    ))}
                    {BLOCKED_TOOLS.map((t) => (
                      <span
                        key={t}
                        className="rounded-[2px] border border-[#4A3A2A] bg-[#201C18] px-[6px] py-[3px] font-mono text-[10px] text-[#C9B48C]"
                      >
                        {t} &mdash; diblokir
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-[11px] rounded-md border border-border bg-surface px-[18px] py-4">
                <div className="text-[13.5px] font-semibold text-text">Tindakan</div>

                <button
                  onClick={() => setReassigning((v) => !v)}
                  className="flex items-center gap-[9px] rounded-[3px] border border-[#35322C] px-[11px] py-[9px] text-left text-[12.5px] text-[#D6D1C8] hover:bg-surface-alt"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#A8A29A" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M12 3v3m0 12v3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M3 12h3m12 0h3M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1" />
                  </svg>
                  <span className="grow">Pindahkan ke agent lain</span>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6E6A63" strokeWidth="2" strokeLinecap="round">
                    <path d={reassigning ? "m6 15 6-6 6 6" : "m9 6 6 6-6 6"} />
                  </svg>
                </button>
                {reassigning && (
                  <select
                    autoFocus
                    value={selected.agent_id ?? ""}
                    onChange={(e) => handleAgentChange(selected, e.target.value)}
                    disabled={updateDevice.isPending}
                    className="rounded-[3px] border border-border bg-bg px-3 py-2 text-[13px] text-text"
                  >
                    <option value="">— Belum ada agent —</option>
                    {(agents ?? []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                )}

                <div className="flex items-center gap-[9px] rounded-[3px] border border-[#35322C] px-[11px] py-[9px] text-[12.5px] text-[#8B857D]">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#A8A29A" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M12 16v-8m0 0-3.5 3.5M12 8l3.5 3.5M4 18v1.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V18" />
                  </svg>
                  <span className="grow">Kirim firmware</span>
                  <span className="font-mono text-[10.5px] text-mint">
                    {selected.firmware_version ? `sudah ${selected.firmware_version}` : "belum diketahui"}
                  </span>
                </div>

                <div className="flex items-center gap-[9px] rounded-[3px] border border-[#35322C] px-[11px] py-[9px] text-[12.5px] text-[#8B857D]">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#A8A29A" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1M20.5 4v4.5H16" />
                  </svg>
                  <span className="grow">Reboot device</span>
                  <span className="text-[10.5px] text-text-dim">butuh sesi aktif</span>
                </div>

                {confirmDeleteId === selected.id ? (
                  <div className="rounded-[3px] border border-danger bg-danger/10 p-3">
                    <p className="mb-2 text-[12px] text-text">
                      Yakin lepas device ini dari akun? Baris device (termasuk token koneksinya)
                      akan dihapus permanen &mdash; device perlu diklaim ulang lewat kode aktivasi
                      baru untuk tersambung lagi. Riwayat percakapan tidak ikut terhapus.
                    </p>
                    {deleteError && <p className="mb-2 text-[12px] text-danger">{deleteError}</p>}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDelete(selected.id)}
                        disabled={deleteDevice.isPending}
                        className="rounded bg-danger px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-danger/80 disabled:opacity-50"
                      >
                        Ya, Lepas Device
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="rounded border border-border px-3 py-1.5 text-[11px] font-semibold text-text-secondary hover:bg-surface-alt"
                      >
                        Batal
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(selected.id)}
                    className="flex items-center gap-[9px] rounded-[3px] border border-[#4A2E28] px-[11px] py-[9px] text-[12.5px] text-danger hover:bg-danger/10"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--color-danger)" strokeWidth="1.8" strokeLinecap="round">
                      <path d="M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13" />
                    </svg>
                    <span className="grow text-left">Lepas dari akun</span>
                  </button>
                )}
                <p className="text-[11.5px] leading-relaxed text-text-dim">
                  Melepas device menghapus token dan ikatannya ke agent. Riwayat percakapan tetap
                  tersimpan.
                </p>
              </div>
            </>
          ) : (
            <div className="rounded-md border border-dashed border-[#35322C] px-[18px] py-8 text-center text-[12px] text-text-dim">
              Pilih device di tabel untuk lihat detail dan tindakan.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
