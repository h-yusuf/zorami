import type { LucideIcon } from "lucide-react";

type Tone = "mint" | "amber" | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  mint: "bg-mint/10 text-mint",
  amber: "bg-amber/10 text-amber",
  neutral: "bg-surface-alt text-text-secondary",
};

interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  tone?: Tone;
}

export function StatCard({ label, value, hint, icon: Icon, tone = "neutral" }: StatCardProps) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-4">
      <div className="flex items-center gap-3">
        {Icon && (
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${TONE_CLASS[tone]}`}>
            <Icon size={16} strokeWidth={2} />
          </div>
        )}
        <div className="min-w-0">
          <div className="font-mono text-[22px] leading-none font-semibold text-text">
            {value}
          </div>
          <div className="mt-1 truncate text-[12px] text-text-secondary">{label}</div>
        </div>
      </div>
      {hint && <div className="mt-2.5 text-[11px] text-text-dim">{hint}</div>}
    </div>
  );
}
