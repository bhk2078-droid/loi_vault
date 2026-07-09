import { cn } from "@/lib/utils";

const tones: Record<string, string> = {
  Draft: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  Active: "bg-accent-soft text-accent dark:bg-accent-softDark dark:text-indigo-300",
  Closed: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  neutral: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  Negotiating: "bg-accent-soft text-accent dark:bg-accent-softDark dark:text-indigo-300",
  "Out for signature": "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  Executed: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  Dead: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

export function Badge({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium tracking-wide", tones[tone] || tones.neutral, className)}>
      {children}
    </span>
  );
}
