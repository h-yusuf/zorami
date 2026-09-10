import { useState } from "react";
import {
  useDevices,
  useAgents,
  useUpdateDevice,
  useDeleteDevice,
  useClaimDevice,
  type Device,
} from "../api/hooks";

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("id-ID");
}

export default function Devices() {
  const { data: devices, isLoading, isError } = useDevices();
  const { data: agents } = useAgents();
  const updateDevice = useUpdateDevice();
  const deleteDevice = useDeleteDevice();
  const claimDevice = useClaimDevice();

  const [claimCode, setClaimCode] = useState("");
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimSuccess, setClaimSuccess] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const selected = (devices ?? []).find((d) => d.id === selectedId) ?? null;

  function agentName(agentId: string | null): string {
    if (!agentId) return "Belum ada agent";
    const agent = (agents ?? []).find((a) => a.id === agentId);
    return agent ? agent.name : agentId;
  }

  async function handleClaim() {
    const code = claimCode.trim().toUpperCase();
    setClaimError(null);
    setClaimSuccess(null);
    if (code.length !== 6) {
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
        <h1 className="text-lg font-semibold text-text">Devices & Pairing</h1>
      </div>

      <div className="rounded-md border border-border bg-surface p-5">
        <h2 className="mb-1 text-[13px] font-semibold text-text">Klaim Device Baru</h2>
        <p className="mb-3 text-[12px] text-text-dim">
          Masukkan kode 6 karakter yang tampil di layar device.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={claimCode}
            onChange={(e) => setClaimCode(e.target.value.toUpperCase())}
            maxLength={6}
            placeholder="ABC234"
            className="w-40 rounded border border-border bg-bg px-3 py-2 font-mono text-[16px] tracking-widest text-text"
          />
          <button
            onClick={handleClaim}
            disabled={claimDevice.isPending || claimCode.trim().length !== 6}
            className="rounded-md bg-amber px-4 py-2 text-[12px] font-semibold text-bg hover:bg-amber-light disabled:opacity-50"
          >
            Klaim
          </button>
        </div>
        {claimError && <p className="mt-2 text-[12px] text-danger">{claimError}</p>}
        {claimSuccess && <p className="mt-2 text-[12px] text-green-500">{claimSuccess}</p>}
      </div>

      {isLoading && <p className="text-[12px] text-text-dim">Memuat...</p>}
      {isError && <p className="text-[12px] text-danger">Gagal memuat devices.</p>}

      <div className="rounded-md border border-border bg-surface">
        <table className="w-full text-left text-[12px]">
          <thead>
            <tr className="border-b border-border text-text-dim">
              <th className="px-4 py-2 font-medium">Alias</th>
              <th className="px-4 py-2 font-medium">Device ID (MAC)</th>
              <th className="px-4 py-2 font-medium">Agent</th>
              <th className="px-4 py-2 font-medium">Firmware</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {(devices ?? []).map((d) => (
              <tr
                key={d.id}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-alt"
                onClick={() => setSelectedId(d.id)}
              >
                <td className="px-4 py-2 text-text">{d.alias ?? "(tanpa nama)"}</td>
                <td className="px-4 py-2 font-mono text-text-dim">{d.device_id}</td>
                <td className="px-4 py-2 text-text-dim">{agentName(d.agent_id)}</td>
                <td className="px-4 py-2 text-text-dim">{d.firmware_version ?? "-"}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                      d.online
                        ? "border-green-500/30 bg-green-500/10 text-green-500"
                        : "border-border bg-surface-alt text-text-dim"
                    }`}
                  >
                    {d.online ? "ONLINE" : "OFFLINE"}
                  </span>
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedId(d.id);
                    }}
                    className="rounded border border-border px-2 py-1 text-[11px] font-semibold text-text-secondary hover:bg-surface-alt"
                  >
                    Detail
                  </button>
                </td>
              </tr>
            ))}
            {devices && devices.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-4 text-center text-[12px] text-text-dim">
                  Belum ada device. Klaim kode aktivasi di atas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="rounded-md border border-border bg-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-text">
              Detail: {selected.alias ?? selected.device_id}
            </h2>
            <button
              onClick={() => setSelectedId(null)}
              className="text-[12px] text-text-dim hover:text-text"
            >
              Tutup
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 text-[12px]">
            <div>
              <span className="text-text-dim">Client ID</span>
              <p className="font-mono text-text">{selected.client_id}</p>
            </div>
            <div>
              <span className="text-text-dim">Board</span>
              <p className="text-text">{selected.board ?? "-"}</p>
            </div>
            <div>
              <span className="text-text-dim">Firmware</span>
              <p className="text-text">{selected.firmware_version ?? "-"}</p>
            </div>
            <div>
              <span className="text-text-dim">Dibuat</span>
              <p className="text-text">{formatDate(selected.created_at)}</p>
            </div>
            <div>
              <span className="text-text-dim">Terakhir Terlihat</span>
              <p className="text-text">{formatDate(selected.last_seen_at)}</p>
            </div>
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium uppercase text-text-dim">
                Pindah Agent
              </span>
              <select
                value={selected.agent_id ?? ""}
                onChange={(e) => handleAgentChange(selected, e.target.value)}
                disabled={updateDevice.isPending}
                className="w-64 rounded border border-border bg-bg px-3 py-2 text-[13px] text-text"
              >
                <option value="">— Belum ada agent —</option>
                {(agents ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <p className="mb-2 text-[11px] font-medium uppercase text-text-dim">
              Kirim Firmware / Reboot
            </p>
            <p className="text-[12px] text-text-dim">
              Belum tersedia — perlu sesi WebSocket aktif dengan device (tidak ada endpoint REST
              untuk ini).
            </p>
          </div>

          <div className="mt-4 border-t border-border pt-4">
            {confirmDeleteId === selected.id ? (
              <div className="rounded border border-danger bg-danger/10 p-3">
                <p className="mb-2 text-[12px] text-text">
                  Yakin lepas device ini dari akun? Baris device (termasuk token koneksinya) akan
                  dihapus permanen — device perlu diklaim ulang lewat kode aktivasi baru untuk
                  tersambung lagi. Jika device ini sudah punya riwayat percakapan tersimpan,
                  penghapusan akan ditolak (409) sampai riwayat itu dibersihkan dulu — data
                  percakapan tidak pernah ikut terhapus otomatis.
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
                className="rounded border border-danger px-3 py-1.5 text-[11px] font-semibold text-danger hover:bg-danger/10"
              >
                Lepas dari Akun
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
