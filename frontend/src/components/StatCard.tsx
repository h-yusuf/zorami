interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
}

export function StatCard({ label, value, hint }: StatCardProps) {
  return (
    <div className="rounded-md border border-border bg-surface px-4 py-3.5">
      <div className="text-[11px] font-medium tracking-wide text-text-dim uppercase">
        {label}
      </div>
      <div className="mt-1.5 font-mono text-[26px] leading-none font-semibold text-text">
        {value}
      </div>
      {hint && <div className="mt-1.5 text-[11px] text-text-secondary">{hint}</div>}
    </div>
  );
}
