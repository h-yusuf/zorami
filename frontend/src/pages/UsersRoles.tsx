const PERMISSION_ROWS: Array<{ label: string; owner: boolean; operator: boolean; viewer: boolean }> = [
  { label: "Kelola agent", owner: true, operator: true, viewer: false },
  { label: "Kelola provider & key", owner: true, operator: false, viewer: false },
  { label: "Klaim & kelola device", owner: true, operator: true, viewer: false },
  { label: "Lihat live monitor", owner: true, operator: true, viewer: true },
  { label: "Baca transkrip", owner: true, operator: true, viewer: true },
  { label: "Putar rekaman audio", owner: true, operator: false, viewer: false },
  { label: "Kelola user & peran", owner: true, operator: false, viewer: false },
  { label: "Ekspor & hapus percakapan", owner: true, operator: true, viewer: false },
];

function PermissionMark({ granted }: { granted: boolean }) {
  return (
    <span className={granted ? "text-mint" : "text-danger"}>
      {granted ? "Ya" : "Tidak"}
    </span>
  );
}

export default function UsersRoles() {
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold text-text">Users & Roles</h1>
        <span className="rounded-full border border-amber/40 bg-amber/10 px-3 py-1 text-xs font-medium text-amber-light">
          Fase 3 — dirancang, belum aktif
        </span>
      </div>

      <p className="mb-6 max-w-2xl text-sm text-text-secondary">
        Saat ini sistem berjalan dengan satu pemilik tunggal. Manajemen multi-user akan diaktifkan di Fase 3.
      </p>

      <div className="opacity-60">
        <h2 className="mb-2 text-sm font-semibold text-text">Matriks Izin (Preview)</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-120 border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-alt text-left text-text-secondary">
                <th className="px-4 py-2 font-medium">Kemampuan</th>
                <th className="px-4 py-2 font-medium">Owner</th>
                <th className="px-4 py-2 font-medium">Operator</th>
                <th className="px-4 py-2 font-medium">Viewer</th>
              </tr>
            </thead>
            <tbody>
              {PERMISSION_ROWS.map((row) => (
                <tr key={row.label} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-2 text-text">{row.label}</td>
                  <td className="px-4 py-2">
                    <PermissionMark granted={row.owner} />
                  </td>
                  <td className="px-4 py-2">
                    <PermissionMark granted={row.operator} />
                  </td>
                  <td className="px-4 py-2">
                    <PermissionMark granted={row.viewer} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 max-w-2xl text-xs text-text-dim">
        Izin &quot;baca transkrip&quot; dipisah dari &quot;putar rekaman audio&quot; — Operator mendapat baca
        transkrip tanpa putar audio.
      </p>
    </div>
  );
}
