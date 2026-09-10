import { useEffect, useState } from "react";
import {
  useAgents,
  useCreateAgent,
  useDeleteAgent,
  useUpdateAgent,
  type Agent,
  type AgentCreateInput,
} from "../api/hooks";

const TOOL_OPTIONS = [
  { value: "websearch", label: "Pencarian Web" },
  { value: "device_control", label: "Kontrol Device (MCP)" },
  { value: "camera", label: "Kamera" },
];

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
  max_tokens: 256,
  tts_provider: "piper",
  tts_voice: "id_ID",
  emotion_level: "medium",
  tools_enabled: [],
  memory_enabled: false,
  chat_log_level: 1,
};

export default function Agents() {
  const { data: agents, isLoading, isError } = useAgents();
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

  async function handleDelete() {
    if (!selectedId) return;
    if (!window.confirm("Hapus agent ini? Tindakan tidak bisa dibatalkan.")) return;
    await deleteAgent.mutateAsync(selectedId);
    setSelectedId(null);
  }

  const isSaving = createAgent.isPending || updateAgent.isPending;
  const showEditor = isCreating || selected !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-text">Agents</h1>
        <button
          onClick={startCreate}
          className="rounded-md bg-amber px-3 py-1.5 text-[12px] font-semibold text-bg hover:bg-amber-light"
        >
          + Agent Baru
        </button>
      </div>

      <div className="flex gap-4">
        {/* List */}
        <div className="w-64 shrink-0 rounded-md border border-border bg-surface">
          {isLoading && <p className="p-4 text-[12px] text-text-dim">Memuat...</p>}
          {isError && <p className="p-4 text-[12px] text-danger">Gagal memuat agent.</p>}
          {agents && agents.length === 0 && (
            <p className="p-4 text-[12px] text-text-dim">Belum ada agent.</p>
          )}
          <ul className="flex flex-col">
            {agents?.map((agent) => (
              <li key={agent.id}>
                <button
                  onClick={() => selectAgent(agent.id)}
                  className={`w-full border-b border-border px-4 py-3 text-left text-[13px] ${
                    selectedId === agent.id && !isCreating
                      ? "bg-surface-alt text-text"
                      : "text-text-secondary hover:bg-surface-alt"
                  }`}
                >
                  <div className="font-medium">{agent.name}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-text-dim">
                    {agent.llm_model}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Editor */}
        <div className="flex-1 rounded-md border border-border bg-surface p-5">
          {!showEditor && (
            <p className="text-[12px] text-text-dim">
              Pilih agent di sebelah kiri, atau buat agent baru.
            </p>
          )}

          {showEditor && (
            <div className="flex flex-col gap-6">
              {/* Identitas & Persona */}
              <section className="flex flex-col gap-3">
                <h2 className="text-[13px] font-semibold text-text">Identitas & Persona</h2>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium uppercase text-text-dim">Nama</span>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className="rounded border border-border bg-bg px-3 py-2 text-[13px] text-text"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium uppercase text-text-dim">
                      System Prompt
                    </span>
                    <span className="font-mono text-[11px] text-text-dim">
                      {form.system_prompt.length} karakter
                    </span>
                  </div>
                  <textarea
                    value={form.system_prompt}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, system_prompt: e.target.value }))
                    }
                    rows={5}
                    className="rounded border border-border bg-bg px-3 py-2 text-[13px] text-text"
                  />
                </label>
              </section>

              {/* Suara */}
              <section className="flex flex-col gap-3">
                <h2 className="text-[13px] font-semibold text-text">Suara</h2>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium uppercase text-text-dim">
                      TTS Provider
                    </span>
                    <input
                      value={form.tts_provider}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, tts_provider: e.target.value }))
                      }
                      className="rounded border border-border bg-bg px-3 py-2 text-[13px] text-text"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium uppercase text-text-dim">
                      TTS Voice
                    </span>
                    <input
                      value={form.tts_voice}
                      onChange={(e) => setForm((f) => ({ ...f, tts_voice: e.target.value }))}
                      className="rounded border border-border bg-bg px-3 py-2 text-[13px] text-text"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium uppercase text-text-dim">
                      Level Emosi
                    </span>
                    <select
                      value={form.emotion_level}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, emotion_level: e.target.value }))
                      }
                      className="rounded border border-border bg-bg px-3 py-2 text-[13px] text-text"
                    >
                      {EMOTION_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </section>

              {/* Model */}
              <section className="flex flex-col gap-3">
                <h2 className="text-[13px] font-semibold text-text">Model</h2>
                <div className="grid grid-cols-3 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium uppercase text-text-dim">
                      LLM Model
                    </span>
                    <input
                      value={form.llm_model}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, llm_model: e.target.value }))
                      }
                      className="rounded border border-border bg-bg px-3 py-2 text-[13px] text-text"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium uppercase text-text-dim">
                      Temperature
                    </span>
                    <input
                      type="number"
                      step={0.1}
                      min={0}
                      max={2}
                      value={form.temperature}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, temperature: Number(e.target.value) }))
                      }
                      className="rounded border border-border bg-bg px-3 py-2 text-[13px] text-text"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium uppercase text-text-dim">
                      Max Tokens
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={form.max_tokens}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, max_tokens: Number(e.target.value) }))
                      }
                      className="rounded border border-border bg-bg px-3 py-2 text-[13px] text-text"
                    />
                  </label>
                </div>
              </section>

              {/* Tools */}
              <section className="flex flex-col gap-3">
                <h2 className="text-[13px] font-semibold text-text">Tools</h2>
                <div className="flex flex-col gap-2">
                  {TOOL_OPTIONS.map((opt) => (
                    <label key={opt.value} className="flex items-center gap-2 text-[13px] text-text-secondary">
                      <input
                        type="checkbox"
                        checked={form.tools_enabled.includes(opt.value)}
                        onChange={() => toggleTool(opt.value)}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
                <p className="text-[11px] leading-relaxed text-text-dim">
                  Catatan: tool berbahaya seperti <span className="font-mono">self.reboot</span> dan{" "}
                  <span className="font-mono">self.upgrade_firmware</span> tidak pernah diekspos ke
                  LLM, terlepas dari pengaturan di atas — bridge menyaringnya lewat allowlist.
                </p>
              </section>

              {/* Memori */}
              <section className="flex flex-col gap-3">
                <h2 className="text-[13px] font-semibold text-text">Memori Jangka Panjang</h2>
                <label className="flex items-center gap-2 text-[13px] text-text-secondary">
                  <input
                    type="checkbox"
                    checked={form.memory_enabled}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, memory_enabled: e.target.checked }))
                    }
                  />
                  Aktifkan memori jangka panjang untuk agent ini
                </label>
              </section>

              {/* Log */}
              <section className="flex flex-col gap-3">
                <h2 className="text-[13px] font-semibold text-text">Chat Log</h2>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium uppercase text-text-dim">
                    Level Penyimpanan Log
                  </span>
                  <select
                    value={form.chat_log_level}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, chat_log_level: Number(e.target.value) }))
                    }
                    className="rounded border border-border bg-bg px-3 py-2 text-[13px] text-text"
                  >
                    {CHAT_LOG_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              </section>

              <div className="flex items-center gap-3 border-t border-border pt-4">
                <button
                  onClick={handleSave}
                  disabled={isSaving || !form.name}
                  className="rounded-md bg-amber px-4 py-2 text-[12px] font-semibold text-bg hover:bg-amber-light disabled:opacity-50"
                >
                  {isCreating ? "Buat Agent" : "Simpan Perubahan"}
                </button>
                {!isCreating && (
                  <button
                    onClick={handleDelete}
                    disabled={deleteAgent.isPending}
                    className="rounded-md border border-danger px-4 py-2 text-[12px] font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
                  >
                    Hapus Agent
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
