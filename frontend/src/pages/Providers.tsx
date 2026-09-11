import { useState } from "react";
import {
  useProviders,
  useCreateProvider,
  useUpdateProvider,
  useDeleteProvider,
  useTestProvider,
  type ProviderCred,
  type ProviderCreateInput,
} from "../api/hooks";

const KIND_OPTIONS = [
  { value: "llm", label: "LLM", title: "Otak agent" },
  { value: "stt", label: "STT", title: "Suara jadi teks" },
  { value: "tts", label: "TTS", title: "Teks jadi suara" },
  { value: "search", label: "Search", title: "Cari info terkini" },
  { value: "vision", label: "Vision", title: "Lihat gambar" },
];

// Warna label kind FRONTEND SAJA — bukan data dari backend, cuma bantu mata
// membedakan kind yang biasanya berbayar (LLM/STT) dari yang biasanya gratis (TTS/Search).
const KIND_LABEL_CLASS: Record<string, string> = {
  llm: "text-amber",
  stt: "text-amber",
  tts: "text-mint",
  search: "text-mint",
  vision: "text-mint",
};

// Heuristik kosmetik FRONTEND SAJA — bukan data dari backend. Backend tidak
// pernah mengklaim provider mana yang gratis; ini cuma label bantu berdasarkan
// provider_code yang dikenal umum dipakai gratis/self-host di proyek ini.
const FREE_PROVIDER_CODES = new Set(["piper", "searxng"]);
function costBadge(providerCode: string): { label: string; className: string } {
  const isFree = FREE_PROVIDER_CODES.has(providerCode.toLowerCase());
  return isFree
    ? { label: "GRATIS", className: "border-[#2F4033] bg-[#1F241F] text-[#8FD6BC]" }
    : { label: "TOKEN SENDIRI", className: "border-[#4A3A2A] bg-[#201C18] text-[#C9B48C]" };
}

// Fakta teknis pipeline (bukan per-provider) - lihat app/device/ws.py _DOWNLINK_AUDIO_PARAMS
// dan app/device/pipeline.py _DOWNLINK_RATE. Selalu 24kHz mono/60ms apapun TTS-nya.
const DEVICE_AUDIO_FORMAT = "opus · 24000 Hz · mono · frame 60ms";

type FormState = {
  kind: string;
  provider_code: string;
  configText: string;
  secret: string;
  fallback_of: string;
};

const DEFAULT_FORM: FormState = {
  kind: "llm",
  provider_code: "",
  configText: "{}",
  secret: "",
  fallback_of: "",
};

function Lbl({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-dim">
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[5px]">
      <Lbl>{label}</Lbl>
      {children}
    </div>
  );
}

function FieldBox({
  children,
  mono,
  dim,
}: {
  children: React.ReactNode;
  mono?: boolean;
  dim?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between rounded-[3px] border border-[#35322C] bg-bg px-[11px] py-[9px] text-[13px] ${
        mono ? "font-mono text-[12px]" : ""
      } ${dim ? "text-text-secondary" : "text-text"}`}
    >
      {children}
    </div>
  );
}

export default function Providers() {
  const { data: providers, isLoading, isError } = useProviders();
  const createProvider = useCreateProvider();
  const updateProvider = useUpdateProvider();
  const deleteProvider = useDeleteProvider();
  const testProvider = useTestProvider();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [configError, setConfigError] = useState<string | null>(null);
  const [selectedByKind, setSelectedByKind] = useState<Record<string, string>>({});
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>(
    {}
  );

  const all = providers ?? [];
  const knownKindValues = new Set(KIND_OPTIONS.map((k) => k.value));
  const otherKindValues = Array.from(new Set(all.map((p) => p.kind))).filter(
    (k) => !knownKindValues.has(k)
  );
  const kindsToRender = [
    ...KIND_OPTIONS,
    ...otherKindValues.map((k) => ({ value: k, label: k, title: k })),
  ];

  function startCreate(presetKind?: string) {
    setEditingId(null);
    setForm({ ...DEFAULT_FORM, kind: presetKind ?? DEFAULT_FORM.kind });
    setConfigError(null);
    setShowForm(true);
  }

  function startEdit(p: ProviderCred) {
    setEditingId(p.id);
    setForm({
      kind: p.kind,
      provider_code: p.provider_code,
      configText: JSON.stringify(p.config ?? {}, null, 2),
      secret: "",
      fallback_of: p.fallback_of ?? "",
    });
    setConfigError(null);
    setShowForm(true);
  }

  function cancelCreate() {
    setShowForm(false);
    setEditingId(null);
    setForm(DEFAULT_FORM);
    setConfigError(null);
  }

  async function handleSave() {
    let config: Record<string, unknown> = {};
    try {
      config = form.configText.trim() ? JSON.parse(form.configText) : {};
    } catch {
      setConfigError("Config harus JSON valid, contoh: {\"base_url\": \"...\"}");
      return;
    }
    setConfigError(null);

    if (editingId) {
      await updateProvider.mutateAsync({
        id: editingId,
        body: {
          config,
          ...(form.secret ? { secret: form.secret } : {}),
          fallback_of: form.fallback_of || null,
        },
      });
    } else {
      const body: ProviderCreateInput = {
        kind: form.kind,
        provider_code: form.provider_code,
        config,
        secret: form.secret,
        fallback_of: form.fallback_of || null,
      };
      await createProvider.mutateAsync(body);
    }
    setShowForm(false);
    setEditingId(null);
    setForm(DEFAULT_FORM);
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Hapus provider ini? Tindakan tidak bisa dibatalkan.")) return;
    await deleteProvider.mutateAsync(id);
    setTestResults((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function handleTest(id: string) {
    const result = await testProvider.mutateAsync(id);
    setTestResults((prev) => ({ ...prev, [id]: result }));
  }

  // Provider lain dengan kind yang sama (untuk pilihan fallback), exclude diri sendiri saat create.
  const fallbackCandidates = all.filter((p) => p.kind === form.kind);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text">Providers &amp; Keys</h1>
          <p className="text-[11.5px] text-text-dim">
            Key milikmu sendiri, dipakai hanya oleh agent di akun ini
          </p>
        </div>
        <div className="flex items-center gap-2">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-mint)"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <rect x="4.5" y="10.5" width="15" height="9.5" rx="1.5" />
            <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
          </svg>
          <div className="text-[11.5px] text-[#8FD6BC]">
            Terenkripsi saat disimpan &middot; tidak pernah ditampilkan lagi
          </div>
        </div>
      </div>

      {isLoading && <p className="text-[12px] text-text-dim">Memuat...</p>}
      {isError && <p className="text-[12px] text-danger">Gagal memuat providers.</p>}

      {showForm && (
        <div className="rounded-md border border-border bg-surface p-5">
          <h2 className="mb-3 text-[13px] font-semibold text-text">
            {editingId ? "Edit Provider" : "Tambah Provider"}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium uppercase text-text-dim">Kind</span>
              <select
                value={form.kind}
                disabled={!!editingId}
                onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value, fallback_of: "" }))}
                className="rounded border border-border bg-bg px-3 py-2 text-[13px] text-text disabled:opacity-60"
              >
                {KIND_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium uppercase text-text-dim">
                Provider Code
              </span>
              <input
                value={form.provider_code}
                disabled={!!editingId}
                onChange={(e) => setForm((f) => ({ ...f, provider_code: e.target.value }))}
                placeholder="omnirouter, groq, piper, searxng..."
                className="rounded border border-border bg-bg px-3 py-2 text-[13px] text-text disabled:opacity-60"
              />
            </label>
            <label className="col-span-2 flex flex-col gap-1">
              <span className="text-[11px] font-medium uppercase text-text-dim">
                Config (JSON)
              </span>
              <textarea
                value={form.configText}
                onChange={(e) => setForm((f) => ({ ...f, configText: e.target.value }))}
                rows={4}
                className="rounded border border-border bg-bg px-3 py-2 font-mono text-[12px] text-text"
              />
              {configError && <span className="text-[11px] text-danger">{configError}</span>}
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium uppercase text-text-dim">
                Secret / API Key {editingId && "(kosongkan buat pertahankan yang lama)"}
              </span>
              <input
                type="password"
                value={form.secret}
                placeholder={editingId ? "••••••••" : ""}
                onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))}
                className="rounded border border-border bg-bg px-3 py-2 text-[13px] text-text"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium uppercase text-text-dim">
                Fallback Dari (opsional)
              </span>
              <select
                value={form.fallback_of}
                onChange={(e) => setForm((f) => ({ ...f, fallback_of: e.target.value }))}
                className="rounded border border-border bg-bg px-3 py-2 text-[13px] text-text"
              >
                <option value="">— Tidak ada —</option>
                {fallbackCandidates
                  .filter((p) => p.id !== editingId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.provider_code} ({p.secret_last4})
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={
                createProvider.isPending ||
                updateProvider.isPending ||
                !form.provider_code ||
                (!editingId && !form.secret)
              }
              className="rounded-md bg-amber px-4 py-2 text-[12px] font-semibold text-bg hover:bg-amber-light disabled:opacity-50"
            >
              {editingId ? "Simpan Perubahan" : "Simpan Provider"}
            </button>
            <button
              onClick={cancelCreate}
              className="rounded-md border border-border px-4 py-2 text-[12px] font-semibold text-text-secondary hover:bg-surface-alt"
            >
              Batal
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {kindsToRender.map((k) => {
          const kindProviders = all.filter((p) => p.kind === k.value);
          const primaries = kindProviders.filter((p) => !p.fallback_of);
          return (
            <KindCard
              key={k.value}
              kindValue={k.value}
              kindLabel={k.label}
              title={k.title}
              primaries={primaries}
              allProviders={all}
              selectedId={selectedByKind[k.value]}
              onSelect={(id) => setSelectedByKind((s) => ({ ...s, [k.value]: id }))}
              onCreate={() => startCreate(k.value)}
              onEdit={startEdit}
              onDelete={handleDelete}
              onTest={handleTest}
              testPending={testProvider.isPending}
              testResults={testResults}
            />
          );
        })}
      </div>

      <div className="flex items-start gap-3 rounded-md border border-border bg-surface p-4">
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-mint)"
          strokeWidth="1.8"
          strokeLinecap="round"
          className="mt-px shrink-0"
        >
          <path d="M12 3 4 6v6c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V6z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
        <div className="flex flex-col gap-1">
          <div className="text-[13px] font-semibold text-text">Bagaimana key kamu disimpan</div>
          <div className="text-[11.5px] leading-relaxed text-text-dim">
            Dienkripsi sebelum masuk database, dengan kunci utama yang tersimpan di luar database.
            Setelah disimpan, key tidak pernah dikirim balik ke browser &mdash; yang kamu lihat di
            atas hanya empat karakter terakhir. Tidak ada key yang dibagi antar akun, dan biaya
            pemakaian sepenuhnya ada di akun provider milikmu.
          </div>
        </div>
      </div>
    </div>
  );
}

function KindCard({
  kindValue,
  kindLabel,
  title,
  primaries,
  allProviders,
  selectedId,
  onSelect,
  onCreate,
  onEdit,
  onDelete,
  onTest,
  testPending,
  testResults,
}: {
  kindValue: string;
  kindLabel: string;
  title: string;
  primaries: ProviderCred[];
  allProviders: ProviderCred[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onEdit: (p: ProviderCred) => void;
  onDelete: (id: string) => void;
  onTest: (id: string) => void;
  testPending: boolean;
  testResults: Record<string, { ok: boolean; message: string }>;
}) {
  if (primaries.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-[#35322C] p-4">
        <div className="flex items-center gap-2">
          <div className={`text-[10.5px] font-semibold uppercase tracking-[0.1em] ${KIND_LABEL_CLASS[kindValue] ?? "text-text-dim"}`}>
            {kindLabel}
          </div>
          <div className="text-[13.5px] font-semibold text-text">{title}</div>
        </div>
        <p className="text-[11.5px] text-text-dim">Belum ada provider {kindLabel} yang dikonfigurasi.</p>
        <button
          onClick={onCreate}
          className="rounded border border-border px-2.5 py-1.5 text-[11px] font-semibold text-text-secondary hover:bg-surface-alt"
        >
          + Tambah provider {kindLabel}
        </button>
      </div>
    );
  }

  const active = primaries.find((p) => p.id === selectedId) ?? primaries[0];
  const fallback = allProviders.find((o) => o.fallback_of === active.id);
  const badge = costBadge(active.provider_code);
  const result = testResults[active.id];
  const config = active.config ?? {};
  const { base_url, timeout, ...restConfig } = config as Record<string, unknown>;
  const restEntries = Object.entries(restConfig);

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-[9px]">
          <div className={`text-[10.5px] font-semibold uppercase tracking-[0.1em] ${KIND_LABEL_CLASS[kindValue] ?? "text-text-dim"}`}>
            {kindLabel}
          </div>
          <div className="text-[13.5px] font-semibold text-text">{title}</div>
        </div>
        <span className={`rounded-[2px] border px-1.5 py-0.5 text-[9.5px] font-semibold tracking-[0.06em] ${badge.className}`}>
          {badge.label}
        </span>
      </div>

      <Field label="Provider aktif">
        <div className="relative">
          <select
            value={active.id}
            onChange={(e) => {
              if (e.target.value === "__new__") {
                onCreate();
              } else {
                onSelect(e.target.value);
              }
            }}
            className="w-full appearance-none rounded-[3px] border border-[#35322C] bg-bg px-[11px] py-[9px] text-[13px] text-text"
          >
            {primaries.map((p) => (
              <option key={p.id} value={p.id}>
                {p.provider_code} ({p.secret_last4})
              </option>
            ))}
            <option value="__new__">+ Tambah provider baru</option>
          </select>
        </div>
      </Field>

      {(base_url !== undefined || timeout !== undefined) && (
        <div className="grid grid-cols-[1.5fr_1fr] gap-[10px]">
          {base_url !== undefined && (
            <Field label="Base URL">
              <FieldBox mono>{String(base_url)}</FieldBox>
            </Field>
          )}
          {timeout !== undefined && (
            <Field label="Timeout">
              <FieldBox mono>{String(timeout)}</FieldBox>
            </Field>
          )}
        </div>
      )}

      {restEntries.map(([key, value]) => (
        <Field key={key} label={key.replace(/_/g, " ")}>
          <FieldBox mono>{typeof value === "string" ? value : JSON.stringify(value)}</FieldBox>
        </Field>
      ))}

      <Field label="API key">
        <FieldBox mono dim>
          <span>****{active.secret_last4}</span>
          <button
            onClick={() => onEdit(active)}
            className="text-[11px] font-medium text-amber hover:text-amber-light"
          >
            Ganti
          </button>
        </FieldBox>
      </Field>

      {fallback && (
        <Field label="Fallback kalau gagal">
          <button onClick={() => onEdit(fallback)} className="w-full text-left">
            <FieldBox>
              <span className="flex items-center gap-2">
                {fallback.provider_code}
                <span className={`rounded-[2px] border px-1.5 py-0.5 text-[9px] font-semibold ${costBadge(fallback.provider_code).className}`}>
                  {costBadge(fallback.provider_code).label}
                </span>
              </span>
            </FieldBox>
          </button>
        </Field>
      )}

      {kindValue === "tts" && (
        <Field label="Format keluar ke device">
          <FieldBox mono dim>
            {DEVICE_AUDIO_FORMAT}
          </FieldBox>
          <p className="text-[11.5px] leading-relaxed text-text-dim">
            Device melakukan resample sendiri, jadi 24 kHz aman dan kualitasnya lebih baik dari 16
            kHz. Nilai ini dikirim di balasan handshake.
          </p>
        </Field>
      )}

      <div className="flex items-center gap-[10px] pt-[3px]">
        <button
          onClick={() => onTest(active.id)}
          disabled={testPending}
          className="rounded-[3px] border border-[#35322C] px-3 py-[7px] text-[12px] font-medium text-[#D6D1C8] hover:bg-surface-alt disabled:opacity-50"
        >
          Tes koneksi
        </button>
        <button
          onClick={() => onEdit(active)}
          className="rounded-[3px] border border-[#35322C] px-3 py-[7px] text-[12px] font-medium text-[#D6D1C8] hover:bg-surface-alt"
        >
          Edit
        </button>
        {result && (
          <div className="flex items-center gap-[6px]">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke={result.ok ? "var(--color-mint)" : "var(--color-danger)"}
              strokeWidth="2.2"
              strokeLinecap="round"
            >
              {result.ok ? <path d="M20 6 9 17l-5-5" /> : <path d="M18 6 6 18M6 6l12 12" />}
            </svg>
            <div className={`font-mono text-[11px] ${result.ok ? "text-[#8FD6BC]" : "text-danger"}`}>
              {result.message}
            </div>
          </div>
        )}
        <div className="grow" />
        <button
          onClick={() => onDelete(active.id)}
          className="text-[11px] font-medium text-text-dim hover:text-danger"
        >
          Hapus
        </button>
      </div>
    </div>
  );
}
