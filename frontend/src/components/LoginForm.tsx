import { useState } from "react";
import { login } from "../api/client";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login gagal");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-bg text-text">
      <form
        onSubmit={handleSubmit}
        className="w-[320px] rounded-[3px] border border-border bg-surface p-6"
      >
        <div className="mb-1 text-[15px] font-bold tracking-wide text-text">
          ZORA
        </div>
        <div className="mb-6 font-mono text-[9.5px] tracking-widest text-text-dim">
          BRIDGE
        </div>

        <label className="mb-1 block text-[11.5px] text-text-secondary">
          Email
        </label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded-[2px] border border-border bg-surface-alt px-3 py-2 text-sm text-text outline-none focus:border-amber"
        />

        <label className="mb-1 block text-[11.5px] text-text-secondary">
          Password
        </label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-4 w-full rounded-[2px] border border-border bg-surface-alt px-3 py-2 text-sm text-text outline-none focus:border-amber"
        />

        {error && (
          <div className="mb-4 rounded-[2px] border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-[2px] bg-amber px-3 py-2 text-sm font-semibold text-bg transition-colors hover:bg-amber-light disabled:opacity-60"
        >
          {loading ? "Masuk..." : "Masuk"}
        </button>
      </form>
    </div>
  );
}
