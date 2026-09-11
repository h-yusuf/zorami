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
  { value: "llm", label: "LLM" },
  { value: "stt", label: "STT" },
  { value: "tts", label: "TTS" },
  { value: "search", label: "Search" },
  { value: "vision", label: "Vision" },
];

// Heuristik kosmetik FRONTEND SAJA — bukan data dari backend. Backend tidak
// pernah mengklaim provider mana yang gratis; ini cuma label bantu berdasarkan
// provider_code yang dikenal umum dipakai gratis/self-host di proyek ini.
const FREE_PROVIDER_CODES = new Set(["piper", "searxng"]);
function costBadge(providerCode: string): { label: string; className: string } {
  const isFree = FREE_PROVIDER_CODES.has(providerCode.toLowerCase());
  return isFree
    ? { label: "GRATIS", className: "bg-green-500/10 text-green-500 border-green-500/30" }
    : { label: "TOKEN SENDIRI", className: "bg-amber/10 text-amber border-amber/30" };
}

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
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>(
    {}
  );

  const grouped: Record<string, ProviderCred[]> = {};
  for (const p of providers ?? []) {
    (grouped[p.kind] ??= []).push(p);
  }
  const kindsPresent = KIND_OPTIONS.filter((k) => grouped[k.value]?.length);
  const knownKindValues = new Set(KIND_OPTIONS.map((k) => k.value));
  const otherKinds = Object.keys(grouped).filter((k) => !knownKindValues.has(k));

  function startCreate() {
    setEditingId(null);
    setForm(DEFAULT_FORM);
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
  const fallbackCandidates = (providers ?? []).filter((p) => p.kind === form.kind);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-text">Providers & Keys</h1>
        <button
          onClick={startCreate}
          className="rounded-md bg-amber px-3 py-1.5 text-[12px] font-semibold text-bg hover:bg-amber-light"
        >
          + Provider Baru
        </button>
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {kindsPresent.map((k) => (
          <ProviderKindColumn
            key={k.value}
            title={k.label}
            providers={grouped[k.value] ?? []}
            allProviders={providers ?? []}
            testResults={testResults}
            onEdit={startEdit}
            onDelete={handleDelete}
            onTest={handleTest}
            testPending={testProvider.isPending}
          />
        ))}
        {otherKinds.map((kind) => (
          <ProviderKindColumn
            key={kind}
            title={kind}
            providers={grouped[kind]}
            allProviders={providers ?? []}
            testResults={testResults}
            onEdit={startEdit}
            onDelete={handleDelete}
            onTest={handleTest}
            testPending={testProvider.isPending}
          />
        ))}
        {providers && providers.length === 0 && (
          <p className="text-[12px] text-text-dim">Belum ada provider. Tambahkan satu di atas.</p>
        )}
      </div>
    </div>
  );
}

function ProviderKindColumn({
  title,
  providers,
  allProviders,
  testResults,
  onEdit,
  onDelete,
  onTest,
  testPending,
}: {
  title: string;
  providers: ProviderCred[];
  allProviders: ProviderCred[];
  testResults: Record<string, { ok: boolean; message: string }>;
  onEdit: (p: ProviderCred) => void;
  onDelete: (id: string) => void;
  onTest: (id: string) => void;
  testPending: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <h2 className="mb-3 text-[13px] font-semibold uppercase text-text">{title}</h2>
      <div className="flex flex-col gap-3">
        {providers.map((p) => {
          const badge = costBadge(p.provider_code);
          const fallbackTarget = allProviders.find((f) => f.id === p.fallback_of);
          const result = testResults[p.id];
          return (
            <div key={p.id} className="rounded border border-border bg-bg p-3">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-text">{p.provider_code}</span>
                <span
                  className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${badge.className}`}
                >
                  {badge.label}
                </span>
              </div>
              <p className="mt-1 font-mono text-[11px] text-text-dim">
                secret ****{p.secret_last4}
              </p>
              {fallbackTarget && (
                <p className="mt-1 text-[11px] text-text-dim">
                  fallback dari: {fallbackTarget.provider_code}
                </p>
              )}
              {result && (
                <p
                  className={`mt-2 text-[11px] ${result.ok ? "text-green-500" : "text-danger"}`}
                >
                  {result.message}
                </p>
              )}
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => onTest(p.id)}
                  disabled={testPending}
                  className="rounded border border-border px-2 py-1 text-[11px] font-semibold text-text-secondary hover:bg-surface-alt disabled:opacity-50"
                >
                  Tes Koneksi
                </button>
                <button
                  onClick={() => onEdit(p)}
                  className="rounded border border-border px-2 py-1 text-[11px] font-semibold text-text-secondary hover:bg-surface-alt"
                >
                  Edit
                </button>
                <button
                  onClick={() => onDelete(p.id)}
                  className="rounded border border-danger px-2 py-1 text-[11px] font-semibold text-danger hover:bg-danger/10"
                >
                  Hapus
                </button>
              </div>
            </div>
          );
        })}
        {providers.length === 0 && (
          <p className="text-[11px] text-text-dim">Belum ada provider {title}.</p>
        )}
      </div>
    </div>
  );
}
