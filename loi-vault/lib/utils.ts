export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function confidenceColor(c: number): string {
  if (c > 0.9) return "bg-emerald-500";
  if (c >= 0.7) return "bg-amber-400";
  return "bg-red-500";
}

export function confidenceLabel(c: number): string {
  if (c > 0.9) return "High confidence";
  if (c >= 0.7) return "Medium confidence — worth a glance";
  return "Low confidence — verify against the LOI";
}
