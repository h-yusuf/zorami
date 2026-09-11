import { useEffect, useState } from "react";
import {
  useAgents,
  useCreateAgent,
  useDeleteAgent,
  useUpdateAgent,
  useDevices,
  useProviders,
  type Agent,
  type AgentCreateInput,
} from "../api/hooks";

const EMOTION_OPTIONS = [
  { value: "flat", label: "Datar" },
  { value: "medium", label: "Sedang" },
  { value: "expressive", label: "Ekspresif" },
];

const CHAT_LOG_OPTIONS = [
  { value: 0, label: "0 — Tidak disimpan" },
  { value: 1, label: "1 — Ringkasan" },
  { value: 2, label: "2 — Penuh (transkrip + audio)" },
];

type FormState = {
  name: string;
  system_prompt: string;
  llm_model: string;
  temperature: number;
  max_tokens: number;
  tts_provider: string;
  tts_voice: string;
  emotion_level: string;
  tools_enabled: string[];
  memory_enabled: boolean;
  chat_log_level: number;
};

function agentToForm(agent: Agent): FormState {
  return {
    name: agent.name,
    system_prompt: agent.system_prompt,
    llm_model: agent.llm_model,
    temperature: agent.temperature,
    max_tokens: agent.max_tokens,
    tts_provider: agent.tts_provider,
    tts_voice: agent.tts_voice,
    emotion_level: agent.emotion_level,
    tools_enabled: agent.tools_enabled,
    memory_enabled: agent.memory_enabled,
    chat_log_level: agent.chat_log_level,
  };
}

const DEFAULT_FORM: FormState = {
  name: "",
  system_prompt: "",
  llm_model: "gpt-4o-mini",
  temperature: 0.7,
  max_tokens: 160,
  tts_provider: "piper",
  tts_voice: "id_ID",
  emotion_level: "medium",
  tools_enabled: [],
  memory_enabled: false,
  chat_log_level: 1,
};

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "baru saja";
  if (min < 60) return `${min} menit lalu`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} jam lalu`;
  const day = Math.floor(hr / 24);
  return `${day} hari lalu`;
}

function Lbl({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-dim">
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[11.5px] leading-relaxed text-text-dim">{children}</p>;
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative h-[19px] w-[34px] shrink-0 rounded-full transition-colors ${
        on ? "bg-mint" : "bg-[#35322C]"
      }`}
    >
      <span
        className={`absolute top-[2px] h-[15px] w-[15px] rounded-full transition-all ${
          on ? "right-[2px] bg-text" : "left-[2px] bg-text-dim"
        }`}
      />
    </button>
  );
}

export default function Agents() {
  const { data: agents, isLoading, isError } = useAgents();
  const { data: devices } = useDevices();
  const { data: providers } = useProviders();
  const createAgent = useCreateAgent();
  const updateAgent = useUpdateAgent();
  const deleteAgent = useDeleteAgent();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [isCreating, setIsCreating] = useState(false);

  const selected = agents?.find((a) => a.id === selectedId) ?? null;

  useEffect(() => {
    if (isCreating) return;
    if (selected) {
      setForm(agentToForm(selected));
    } else if (agents && agents.length > 0 && !selectedId) {
      setSelectedId(agents[0].id);
    }
  }, [selected, agents, selectedId, isCreating]);

  function startCreate() {
    setIsCreating(true);
    setSelectedId(null);
    setForm(DEFAULT_FORM);
  }

  function selectAgent(id: string) {
    setIsCreating(false);
    setSelectedId(id);
  }

  function toggleTool(value: string) {
    setForm((f) => ({
      ...f,
      tools_enabled: f.tools_enabled.includes(value)
        ? f.tools_enabled.filter((t) => t !== value)
        : [...f.tools_enabled, value],
    }));
  }

  async function handleSave() {
    const body: AgentCreateInput = { ...form };
    if (isCreating) {
      const created = await createAgent.mutateAsync(body);
      setIsCreating(false);
      setSelectedId(created.id);
    } else if (selectedId) {
      await updateAgent.mutateAsync({ id: selectedId, body });
    }
  }

  async function handleDuplicate() {
    if (!selected) return;
    const body: AgentCreateInput = { ...agentToForm(selected), name: `${selected.name} (salinan)` };
    const created = await createAgent.mutateAsync(body);
    setIsCreating(false);
    setSelectedId(created.id);
  }

  async function handleDelete() {
    if (!selectedId) return;
    if (!window.confirm("Hapus agent ini? Tindakan tidak bisa dibatalkan.")) return;
    await deleteAgent.mutateAsync(selectedId);
    setSelectedId(null);
  }

  const isSaving = createAgent.isPending || updateAgent.isPending;
  const showEditor = isCreating || selected !== null;

  const searchProvider = (providers ?? []).find((p) => p.kind === "search");
  const visionProvider = (providers ?? []).find((p) => p.kind === "vision");

  function devicesFor(agentId: string) {
    return (devices ?? []).filter((d) => d.agent_id === agentId);
  }

  return (
    <div className="flex h-full gap-4">
      {/* List */}
      <div className="flex w-[262px] shrink-0 flex-col rounded-md border border-border bg-[#1A1917]">
        <div className="flex flex-col gap-[11px] border-b border-border px-4 pb-3 pt-4">
          <div className="flex items-center justify-between">
            <div className="text-[14px] font-semibold text-text">Agents</div>
            <div className="font-mono text-[10.5px] text-text-dim">{agents?.length ?? 0}</div>
          </div>
          <button
            onClick={startCreate}
            className="flex items-center justify-center gap-[7px] rounded-[3px] bg-amber px-[11px] py-[7px] text-[12.5px] font-semibold text-bg hover:bg-amber-light"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Agent baru
          </button>
        </div>

        {isLoading && <p className="p-4 text-[12px] text-text-dim">Memuat...</p>}
        {isError && <p className="p-4 text-[12px] text-danger">Gagal memuat agent.</p>}
        {agents && agents.length === 0 && (
          <p className="p-4 text-[12px] text-text-dim">Belum ada agent.</p>
        )}

        <div className="flex flex-col overflow-y-auto">
          {agents?.map((agent) => {
            const isActive = selectedId === agent.id && !isCreating;
            const assigned = devicesFor(agent.id);
            const anyOffline = assigned.some((d) => !d.online);
            return (
              <button
                key={agent.id}
                onClick={() => selectAgent(agent.id)}
                className={`flex flex-col gap-[5px] border-b border-[#26241F] px-4 py-[13px] text-left ${
                  isActive ? "border-l-[3px] border-l-amber bg-[#221F1B]" : "border-l-[3px] border-l-transparent hover:bg-surface-alt"
                }`}
              >
                <div className={`text-[13.5px] ${isActive ? "font-semibold text-text" : "font-medium text-[#D6D1C8]"}`}>
                  {agent.name}
                </div>
                <div className="line-clamp-1 text-[11.5px] leading-relaxed text-text-dim">
                  {agent.system_prompt || "Belum ada system prompt"}
                </div>
                <div className="mt-[2px] flex flex-wrap gap-[5px]">
                  {assigned.length > 0 ? (
                    <span className="rounded-[2px] border border-[#2F4033] bg-[#1F241F] px-[5px] py-[2px] font-mono text-[9.5px] text-[#8FD6BC]">
                      {assigned.length} device
                    </span>
                  ) : (
                    <span className="rounded-[2px] border border-border bg-[#1D1C19] px-[5px] py-[2px] font-mono text-[9.5px] text-text-dim">
                      belum ada device
                    </span>
                  )}
                  {agent.memory_enabled && (
                    <span className="rounded-[2px] border border-border bg-[#221F1B] px-[5px] py-[2px] font-mono text-[9.5px] text-text-secondary">
                      memori on
                    </span>
                  )}
                  {anyOffline && (
                    <span className="rounded-[2px] border border-border bg-[#1D1C19] px-[5px] py-[2px] font-mono text-[9.5px] text-text-dim">
                      device offline
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="grow" />
        <div className="border-t border-border px-4 py-[13px]">
          <Hint>Satu device dipasangkan ke satu agent. Ganti agent tidak perlu reboot device.</Hint>
        </div>
      </div>

      {/* Editor */}
      <div className="flex flex-1 flex-col overflow-hidden rounded-md border border-border bg-surface">
        {!showEditor && (
          <p className="p-5 text-[12px] text-text-dim">
            Pilih agent di sebelah kiri, atau buat agent baru.
          </p>
        )}

        {showEditor && (
          <>
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="flex flex-col gap-[2px]">
                <div className="text-[17px] font-semibold text-text">
                  {isCreating ? "Agent baru" : selected?.name}
                </div>
                {!isCreating && selected && (
                  <div className="font-mono text-[10.5px] text-text-dim">
                    agent_{selected.id.slice(0, 8)} &middot; diubah {relativeTime(selected.updated_at)}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-[9px]">
                {!isCreating && (
                  <button
                    onClick={handleDelete}
                    disabled={deleteAgent.isPending}
                    className="text-[12px] text-text-dim hover:text-danger disabled:opacity-50"
                  >
                    Hapus
                  </button>
                )}
                {!isCreating && (
                  <button
                    onClick={handleDuplicate}
                    disabled={createAgent.isPending}
                    className="rounded-[3px] border border-[#35322C] px-[13px] py-[7px] text-[12.5px] text-text-secondary hover:bg-surface-alt disabled:opacity-50"
                  >
                    Duplikat
                  </button>
                )}
                <button
                  onClick={handleSave}
                  disabled={isSaving || !form.name}
                  className="rounded-[3px] bg-amber px-[15px] py-[7px] text-[12.5px] font-semibold text-bg hover:bg-amber-light disabled:opacity-50"
                >
                  {isCreating ? "Buat Agent" : "Simpan"}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-4 overflow-y-auto p-5">
              {/* Identitas & persona */}
              <div className="flex flex-col gap-[14px] rounded-md border border-border bg-[#1F1E1B] p-[18px]">
                <div className="text-[13.5px] font-semibold text-text">Identitas &amp; persona</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-[5px]">
                    <Lbl>Nama agent</Lbl>
                    <input
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      className="rounded-[3px] border border-[#35322C] bg-bg px-[11px] py-[9px] text-[13px] text-text"
                    />
                  </div>
                  <div className="flex flex-col gap-[5px]">
                    <Lbl>Nama panggilan (wake word)</Lbl>
                    <div className="flex items-center gap-2 rounded-[3px] border border-[#35322C] bg-bg px-[11px] py-[9px] text-[13px] text-text-secondary">
                      Zora
                      <span className="font-mono text-[11px] text-text-dim">
                        &mdash; dari firmware, read-only
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-[5px]">
                  <div className="flex items-center justify-between">
                    <Lbl>System prompt</Lbl>
                    <div className="font-mono text-[10.5px] text-text-dim">
                      {form.system_prompt.length} / 4000 karakter
                    </div>
                  </div>
                  <textarea
                    value={form.system_prompt}
                    onChange={(e) => setForm((f) => ({ ...f, system_prompt: e.target.value }))}
                    rows={4}
                    maxLength={4000}
                    className="rounded-[3px] border border-[#35322C] bg-bg px-[11px] py-[9px] text-[13px] leading-relaxed text-text"
                  />
                  <Hint>
                    Jawaban dibacakan TTS, bukan dibaca. Prompt yang minta output pendek dan tanpa
                    markdown itu bedanya antara terasa alami dan terasa robot.
                  </Hint>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* Suara */}
                <div className="flex flex-col gap-[13px] rounded-md border border-border bg-[#1F1E1B] p-[18px]">
                  <div className="text-[13.5px] font-semibold text-text">Suara</div>
                  <div className="grid grid-cols-2 gap-[10px]">
                    <div className="flex flex-col gap-[5px]">
                      <Lbl>TTS Provider</Lbl>
                      <input
                        value={form.tts_provider}
                        onChange={(e) => setForm((f) => ({ ...f, tts_provider: e.target.value }))}
                        className="rounded-[3px] border border-[#35322C] bg-bg px-[11px] py-[9px] text-[13px] text-text"
                      />
                    </div>
                    <div className="flex flex-col gap-[5px]">
                      <Lbl>TTS Voice</Lbl>
                      <input
                        value={form.tts_voice}
                        onChange={(e) => setForm((f) => ({ ...f, tts_voice: e.target.value }))}
                        className="rounded-[3px] border border-[#35322C] bg-bg px-[11px] py-[9px] text-[13px] text-text"
                      />
                    </div>
                  </div>

                  <div className="h-px bg-border" />

                  <div className="flex flex-col gap-[5px]">
                    <Lbl>Ekspresi di layar device</Lbl>
                    <Hint>
                      Bridge mengirim <span className="font-mono text-text-secondary">type: llm</span>{" "}
                      + emotion, device menampilkan wajahnya. Pilih seberapa ekspresif.
                    </Hint>
                    <div className="mt-[3px] flex gap-[6px]">
                      {EMOTION_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => setForm((f) => ({ ...f, emotion_level: opt.value }))}
                          className={`rounded-[3px] px-[10px] py-[5px] text-[11.5px] font-medium ${
                            form.emotion_level === opt.value
                              ? "bg-[#3A342A] text-amber"
                              : "border border-[#35322C] text-text-secondary hover:bg-surface-alt"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Model */}
                <div className="flex flex-col gap-[13px] rounded-md border border-border bg-[#1F1E1B] p-[18px]">
                  <div className="text-[13.5px] font-semibold text-text">Model</div>
                  <div className="flex flex-col gap-[5px]">
                    <Lbl>LLM</Lbl>
                    <input
                      value={form.llm_model}
                      onChange={(e) => setForm((f) => ({ ...f, llm_model: e.target.value }))}
                      className="rounded-[3px] border border-[#35322C] bg-bg px-[11px] py-[9px] text-[13px] text-text"
                    />
                    <Hint>Model diambil dari provider LLM milikmu di halaman Providers. Tiap agent boleh beda model.</Hint>
                  </div>
                  <div className="grid grid-cols-2 gap-[10px]">
                    <div className="flex flex-col gap-[5px]">
                      <Lbl>Temperature</Lbl>
                      <input
                        type="number"
                        step={0.1}
                        min={0}
                        max={2}
                        value={form.temperature}
                        onChange={(e) => setForm((f) => ({ ...f, temperature: Number(e.target.value) }))}
                        className="rounded-[3px] border border-[#35322C] bg-bg px-[11px] py-[9px] font-mono text-[13px] text-text"
                      />
                    </div>
                    <div className="flex flex-col gap-[5px]">
                      <Lbl>Batas token balasan</Lbl>
                      <input
                        type="number"
                        min={1}
                        value={form.max_tokens}
                        onChange={(e) => setForm((f) => ({ ...f, max_tokens: Number(e.target.value) }))}
                        className="rounded-[3px] border border-[#35322C] bg-bg px-[11px] py-[9px] font-mono text-[13px] text-text"
                      />
                    </div>
                  </div>
                  <Hint>
                    Batas token rendah itu sengaja &mdash; jawaban panjang bikin TTS lama dan device
                    terasa lambat.
                  </Hint>
                </div>
              </div>

              {/* Tools */}
              <div className="flex flex-col gap-[13px] rounded-md border border-border bg-[#1F1E1B] p-[18px]">
                <div className="flex items-center justify-between">
                  <div className="text-[13.5px] font-semibold text-text">Tools</div>
                  <div className="text-[11.5px] text-text-dim">Diekspos ke LLM sebagai function-call</div>
                </div>

                <div className="flex items-center gap-[13px] border-t border-[#26241F] py-[11px]">
                  <Toggle on={form.tools_enabled.includes("websearch")} onClick={() => toggleTool("websearch")} />
                  <div className="flex grow flex-col gap-[3px]">
                    <div className="text-[13px] font-medium text-text">Websearch</div>
                    <Hint>
                      LLM memutuskan sendiri kapan perlu cari. Provider:{" "}
                      {searchProvider ? searchProvider.provider_code : "belum dikonfigurasi"}.
                    </Hint>
                  </div>
                </div>

                <div className="flex items-center gap-[13px] border-t border-[#26241F] py-[11px]">
                  <Toggle
                    on={form.tools_enabled.includes("device_control")}
                    onClick={() => toggleTool("device_control")}
                  />
                  <div className="flex grow flex-col gap-[3px]">
                    <div className="text-[13px] font-medium text-text">Kontrol device (MCP)</div>
                    <Hint>
                      Volume, kecerahan, tema, status device &mdash; ditemukan otomatis dari device
                      lewat <span className="font-mono text-text-secondary">tools/list</span>.
                    </Hint>
                  </div>
                </div>

                <div className="flex items-center gap-[13px] border-t border-[#26241F] py-[11px]">
                  <Toggle on={form.tools_enabled.includes("camera")} onClick={() => toggleTool("camera")} />
                  <div className="flex grow flex-col gap-[3px]">
                    <div className={`text-[13px] font-medium ${form.tools_enabled.includes("camera") ? "text-text" : "text-text-secondary"}`}>
                      Kamera (jawab soal apa yang dilihat)
                    </div>
                    <Hint>
                      Device kirim foto ke bridge, bridge yang menjalankan model vision. Butuh key
                      provider vision.
                    </Hint>
                  </div>
                  <div className="font-mono text-[10.5px] text-text-dim">
                    {visionProvider ? visionProvider.provider_code : "key belum diisi"}
                  </div>
                </div>

                <div className="mt-[2px] flex gap-[11px] rounded-[3px] bg-[#201C18] p-[13px]">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--color-amber)" strokeWidth="1.8" strokeLinecap="round" className="mt-px shrink-0">
                    <rect x="4.5" y="10.5" width="15" height="9.5" rx="1.5" />
                    <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
                  </svg>
                  <Hint>
                    <span className="text-[#C9B48C]">
                      Tool berbahaya device (<span className="font-mono">self.reboot</span>,{" "}
                      <span className="font-mono">self.upgrade_firmware</span>) tidak pernah
                      diekspos ke LLM &mdash; firmware tetap mau mengeksekusinya kalau dipanggil,
                      jadi bridge yang memfilter. Hanya bisa dijalankan manual dari halaman Devices.
                    </span>
                  </Hint>
                </div>
              </div>

              {/* Memori */}
              <div className="flex flex-col gap-[13px] rounded-md border border-border bg-[#1F1E1B] p-[18px]">
                <div className="flex items-center justify-between">
                  <div className="text-[13.5px] font-semibold text-text">Memori jangka panjang</div>
                  <Toggle on={form.memory_enabled} onClick={() => setForm((f) => ({ ...f, memory_enabled: !f.memory_enabled }))} />
                </div>
                <Hint>
                  Kalau aktif, bridge boleh menyimpan fakta tentang pemilik dan ringkasan
                  percakapan lama untuk disuntik ke system prompt turn berikutnya. Penyimpanan
                  faktanya sendiri belum tersedia di dashboard ini &mdash; toggle ini baru
                  menyalakan flag di agent.
                </Hint>
              </div>

              {/* Log */}
              <div className="flex flex-col gap-[10px] rounded-md border border-border bg-[#1F1E1B] p-[18px]">
                <div className="text-[13.5px] font-semibold text-text">Chat log</div>
                <div className="flex flex-col gap-[5px]">
                  <Lbl>Level penyimpanan log</Lbl>
                  <select
                    value={form.chat_log_level}
                    onChange={(e) => setForm((f) => ({ ...f, chat_log_level: Number(e.target.value) }))}
                    className="rounded-[3px] border border-[#35322C] bg-bg px-[11px] py-[9px] text-[13px] text-text"
                  >
                    {CHAT_LOG_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
