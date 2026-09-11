import { useState } from "react";
import { login } from "../api/client";

const SIGNAL_BARS = [
  { color: "var(--color-amber)", duration: "1.6s", delay: "0s" },
  { color: "var(--color-mint)", duration: "1.1s", delay: "-0.4s" },
  { color: "var(--color-amber)", duration: "1.9s", delay: "-0.9s" },
  { color: "var(--color-mint)", duration: "1.3s", delay: "-0.2s" },
  { color: "var(--color-amber)", duration: "1.5s", delay: "-1.1s" },
  { color: "var(--color-mint)", duration: "1.8s", delay: "-0.6s" },
];

function SignalBars() {
  return (
    <div className="flex h-10 items-end justify-center gap-[5px]" aria-hidden="true">
      {SIGNAL_BARS.map((bar, i) => (
        <span
          key={i}
          className="signal-bar w-[3px] origin-bottom rounded-[1px]"
          style={{
            height: "100%",
            backgroundColor: bar.color,
            animation: `signal-bar ${bar.duration} ease-in-out infinite`,
            animationDelay: bar.delay,
          }}
        />
      ))}
    </div>
  );
}

function PanelCorners() {
  const base = "absolute h-2.5 w-2.5 border-border";
  return (
    <>
      <span className={`${base} left-2 top-2 border-l border-t`} aria-hidden="true" />
      <span className={`${base} right-2 top-2 border-r border-t`} aria-hidden="true" />
      <span className={`${base} bottom-2 left-2 border-b border-l`} aria-hidden="true" />
      <span className={`${base} bottom-2 right-2 border-b border-r`} aria-hidden="true" />
    </>
  );
}

function FieldLabel({ children, htmlFor }: { children: string; htmlFor: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block font-mono text-[10px] font-semibold tracking-[0.12em] text-text-dim uppercase"
    >
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
    <div className="flex h-screen items-center justify-center bg-bg px-4 text-text">
      <div className="relative w-[340px] border border-border bg-surface p-7">
        <PanelCorners />

        <SignalBars />

        <div className="mb-7 mt-5 text-center">
          <div className="text-[16px] font-bold tracking-wide text-text">ZORA</div>
          <div className="font-mono text-[9.5px] tracking-[0.2em] text-text-dim">BRIDGE</div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-text-secondary">
            Masuk untuk mengelola agent, device, dan percakapan.
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
              className="w-full border border-border bg-surface-alt px-3 py-2 text-sm text-text outline-none focus:border-amber"
            />
          </div>

          <div className="mb-5">
            <FieldLabel htmlFor="login-password">Kata sandi</FieldLabel>
            <input
              id="login-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-border bg-surface-alt px-3 py-2 text-sm text-text outline-none focus:border-amber"
            />
          </div>

          {error && (
            <div
              role="alert"
              className="mb-5 border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 bg-amber px-3 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-amber-light disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading && (
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-bg" aria-hidden="true" />
            )}
            {loading ? "Menghubungkan..." : "Masuk"}
          </button>
        </form>
      </div>
    </div>
  );
}
