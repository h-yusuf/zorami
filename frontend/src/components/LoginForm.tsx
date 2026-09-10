import { useState } from "react";
import { login } from "../api/client";

function StatusPulse() {
  return (
    <div className="flex items-center gap-2">
      <span className="status-pulse h-1.5 w-1.5 rounded-full bg-mint" style={{ animation: "status-pulse 2s ease-in-out infinite" }} aria-hidden="true" />
      <span className="font-mono text-[10px] tracking-[0.08em] text-text-dim">
        BRIDGE ONLINE
      </span>
    </div>
  );
}

function FieldLabel({ children, htmlFor }: { children: string; htmlFor: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[12.5px] font-medium text-text-secondary">
      {children}
    </label>
  );
}

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
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 text-text">
      <div className="w-[380px] rounded-xl border border-border bg-surface p-8">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber/10">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF6A2E" strokeWidth="1.8" strokeLinecap="round">
                <rect x="4" y="7" width="16" height="12" rx="2" />
                <path d="M8 7V5m8 2V5M9 12h.01M15 12h.01M9 16h6" />
              </svg>
            </div>
            <div className="text-[15px] font-semibold tracking-tight text-text">Zora Bridge</div>
          </div>
          <StatusPulse />
        </div>

        <div className="mb-7">
          <h1 className="text-[19px] font-semibold text-text">Masuk ke dashboard</h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-text-secondary">
            Kelola agent, device, dan percakapan dari satu tempat.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="mb-4">
            <FieldLabel htmlFor="login-email">Email</FieldLabel>
            <input
              id="login-email"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface-alt px-3.5 py-2.5 text-sm text-text outline-none focus:border-amber"
            />
          </div>

          <div className="mb-6">
            <FieldLabel htmlFor="login-password">Kata sandi</FieldLabel>
            <input
              id="login-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface-alt px-3.5 py-2.5 text-sm text-text outline-none focus:border-amber"
            />
          </div>

          {error && (
            <div role="alert" className="mb-6 rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[12.5px] text-danger">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber px-3 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-amber-light disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Menghubungkan..." : "Masuk"}
          </button>
        </form>
      </div>
    </div>
  );
}
