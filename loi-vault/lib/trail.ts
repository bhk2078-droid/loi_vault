import {
  TRACKER_ROWS,
  SECTION_LABELS,
  SECTION_ORDER,
  type ExtractedLOI,
  type AnyField,
  type FieldKind,
  type RentPeriod,
} from "./extraction-schema";

// ---------------------------------------------------------------
// The transaction trail is a side-by-side grid:
//   rows    = deal terms
//   columns = proposals in chronological order
// Each redline dropped into a transaction appends one column. A
// "suggested counter" column can also be drafted by hand — it has no
// document behind it, so source = "manual".
// ---------------------------------------------------------------

export type Source = "upload" | "manual";

export interface TrailVersion {
  id: string;
  version_number: number;
  round_label: string | null;
  party: string | null;
  source: Source;
  document_date: string | null;
  uploaded_at: string;
  uploaded_by_email: string | null;
  file_name: string | null;
  extracted_json: ExtractedLOI;
  cell_overrides: Record<string, string> | null;
  change_summary: string | null;
}

/**
 * Highlighting has two opposite conventions and they mean different things:
 *  - "agreed": on the final column, shade every term that matches the column
 *    before it. That's a landlord's suggested counter — the shading says
 *    "we're taking this as-is."
 *  - "moved": shade every cell that differs from the column to its left.
 *    That's a diff — useful mid-negotiation.
 */
export type HighlightMode = "agreed" | "moved" | "none";

// ---- row definitions ---------------------------------------------------

export interface RowDef {
  id: string;
  label: string;
  kind: FieldKind;
  section: string;
  /** Simple rows read and write one field. */
  field?: [string, string];
  /** Composed rows render from several fields and are edited as free text. */
  compose?: (loi: ExtractedLOI) => string;
  /** Fields a composed row draws from, for confidence + provenance. */
  parts?: Array<[string, string]>;
}

function f(loi: ExtractedLOI, section: string, key: string): AnyField {
  const obj = loi as unknown as Record<string, Record<string, AnyField>>;
  return obj[section]?.[key] ?? { value: null, confidence: 0, source_text: "" };
}

const row = (id: string, section: string, key: string, kind: FieldKind, label?: string): RowDef => ({
  id,
  section,
  field: [section, key],
  kind,
  label: label ?? FIELD_LABEL(section, key),
});

function FIELD_LABEL(section: string, key: string): string {
  const found = TRACKER_ROWS.find((r) => r.section === section && r.key === key);
  return found?.label ?? key;
}

/** "Entire 5th Floor: 10,538 RSF" */
function composePremises(loi: ExtractedLOI): string {
  const floor = f(loi, "property", "floor").value as string | null;
  const rsf = f(loi, "property", "rsf").value as number | null;
  const desc = f(loi, "property", "premises_description").value as string | null;
  if (floor && rsf) return `${floor}: ${rsf.toLocaleString()} RSF`;
  if (floor) return floor;
  if (rsf) return `${rsf.toLocaleString()} RSF`;
  return desc || "";
}

/**
 * The trail view: the business points a lease negotiation actually turns on,
 * in the order a broker reads them. Everything else the extractor finds — free
 * rent, TI, assignment, security deposit, use, brokerage — lives in the
 * "All terms" view. Rows are hidden per-transaction with the ✕ on the row
 * label, not automatically, because a blank cell is itself information:
 * it says this proposal was silent on a term the other one addressed.
 */
export const TRAIL_ROWS: RowDef[] = [
  { id: "premises", label: "Premises", kind: "text", section: "property", compose: composePremises, parts: [["property", "floor"], ["property", "rsf"], ["property", "premises_description"]] },
  row("term", "term", "term_description", "text", "Term"),
  row("lcd", "term", "commencement_date", "date", "Lease Commencement Date"),
  row("rcd", "term", "rent_commencement_date", "date", "Rent Commencement Date"),
  row("base_rent", "economics", "base_rent_psf", "rent_psf", "Base Rent"),
  row("opex", "economics", "opex_base_year", "text", "Operating Escalations"),
  row("taxes", "economics", "tax_base_year", "text", "Real Estate Taxes"),
  row("electricity", "economics", "electricity", "text", "Electricity"),
  row("ll_work", "economics", "landlord_work", "textarea", "Landlord's Work"),
  row("furniture", "other", "furniture", "textarea", "Furniture"),
  row("termination", "options", "termination_option", "textarea", "Termination Option"),
  row("renewal", "options", "renewal_options", "textarea", "Renewal Option"),
  row("rofo", "options", "rofo_rofr", "textarea", "Right of First Offer"),
];

/** Every extracted field, grouped by section — the working view. */
export const DETAIL_ROWS: RowDef[] = TRACKER_ROWS.map((r) => ({
  id: `${r.section}.${r.key}`,
  label: r.label,
  kind: r.kind,
  section: r.section,
  field: [r.section, r.key] as [string, string],
}));

// ---- display formatting ------------------------------------------------

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

function formatSchedule(periods: RentPeriod[]): string {
  if (!periods.length) return "";
  return periods.map((p) => `${p.period}: $${p.psf.toFixed(2)}/RSF`).join(" · ");
}

export function displayValue(value: unknown, kind: FieldKind): string {
  if (value === null || value === undefined || value === "") return "";
  if (kind === "schedule") return formatSchedule(value as RentPeriod[]);
  if (kind === "list") return Array.isArray(value) ? value.join("; ") : String(value);
  if (kind === "rent_psf" && typeof value === "number") return `${usd(value)} per RSF`;
  if (kind === "months" && typeof value === "number") return `${value} ${value === 1 ? "month" : "months"}`;
  if (kind === "currency" && typeof value === "number") return usd(value);
  if (kind === "date" && typeof value === "string") {
    const d = new Date(value + "T00:00:00");
    if (!isNaN(d.getTime())) return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    return value;
  }
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}

/** What the reader sees in a cell: a hand-written override wins over extraction. */
export function cellDisplay(v: TrailVersion, def: RowDef): string {
  const override = v.cell_overrides?.[def.id];
  if (typeof override === "string") return override;
  if (def.compose) return def.compose(v.extracted_json);
  if (def.field) return displayValue(f(v.extracted_json, def.field[0], def.field[1]).value, def.kind);
  return "";
}

export function cellField(v: TrailVersion, def: RowDef): AnyField {
  if (typeof v.cell_overrides?.[def.id] === "string") {
    return { value: v.cell_overrides[def.id], confidence: 1, source_text: "Entered manually" };
  }
  if (def.field) return f(v.extracted_json, def.field[0], def.field[1]);
  if (def.parts) {
    const parts = def.parts.map(([s, k]) => f(v.extracted_json, s, k)).filter((p) => p.value !== null && p.value !== "");
    if (!parts.length) return { value: null, confidence: 0, source_text: "" };
    return {
      value: cellDisplay(v, def),
      confidence: Math.min(...parts.map((p) => p.confidence)),
      source_text: parts.find((p) => p.source_text)?.source_text || "",
    };
  }
  return { value: null, confidence: 0, source_text: "" };
}

// ---- matrix ------------------------------------------------------------

export interface TrailCell {
  versionId: string;
  rowId: string;
  display: string;
  field: AnyField;
  /** Differs from the cell one column to the left. */
  moved: boolean;
  /** Final column, and identical to the column to its left. */
  agreed: boolean;
  priorDisplay: string | null;
}

export interface TrailRow extends RowDef {
  cells: TrailCell[];
  everMoved: boolean;
  allEmpty: boolean;
}

export interface TrailSection {
  key: string;
  label: string;
  rows: TrailRow[];
}

export interface Trail {
  versions: TrailVersion[];
  rows: TrailRow[];
  sections: TrailSection[];
  movedCounts: Record<string, number>;
  agreedCounts: Record<string, number>;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ");

export function buildTrail(versions: TrailVersion[], defs: RowDef[] = TRAIL_ROWS): Trail {
  const ordered = [...versions].sort((a, b) => a.version_number - b.version_number);
  const last = ordered.length - 1;
  const movedCounts: Record<string, number> = {};
  const agreedCounts: Record<string, number> = {};
  for (const v of ordered) {
    movedCounts[v.id] = 0;
    agreedCounts[v.id] = 0;
  }

  const rows: TrailRow[] = defs.map((def) => {
    const cells: TrailCell[] = ordered.map((v, i) => {
      const display = cellDisplay(v, def);
      const priorDisplay = i > 0 ? cellDisplay(ordered[i - 1], def) : null;
      const moved = i > 0 && norm(display) !== norm(priorDisplay || "") && !(display === "" && !priorDisplay);
      const agreed = i === last && i > 0 && display !== "" && norm(display) === norm(priorDisplay || "");
      if (moved) movedCounts[v.id] += 1;
      if (agreed) agreedCounts[v.id] += 1;
      return { versionId: v.id, rowId: def.id, display, field: cellField(v, def), moved, agreed, priorDisplay };
    });
    return { ...def, cells, everMoved: cells.some((c) => c.moved), allEmpty: cells.every((c) => c.display === "") };
  });

  const sections: TrailSection[] = SECTION_ORDER.map((key) => ({
    key,
    label: SECTION_LABELS[key] || key,
    rows: rows.filter((r) => r.section === key),
  })).filter((s) => s.rows.length > 0);

  return { versions: ordered, rows, sections, movedCounts, agreedCounts };
}

export function visibleRows(trail: Trail, hiddenRowIds: string[], onlyMoved: boolean): TrailRow[] {
  const hidden = new Set(hiddenRowIds);
  return trail.rows.filter((r) => {
    if (hidden.has(r.id)) return false;
    if (onlyMoved && !r.everMoved) return false;
    return true;
  });
}

// ---- column headers ----------------------------------------------------

/** "Tenant RFP" */
export function columnTitle(v: TrailVersion): string {
  return v.round_label?.trim() || (v.version_number === 1 ? "Initial LOI" : `Counter ${v.version_number - 1}`);
}

/** "6/17/26" — the date on the proposal, not the day it was uploaded. */
export function columnDate(v: TrailVersion): string {
  if (v.source === "manual" && !v.document_date) return "";
  const iso = v.document_date;
  const d = iso ? new Date(iso + "T00:00:00") : new Date(v.uploaded_at);
  if (isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

/** "Tenant RFP - 6/17/26" */
export function columnHeader(v: TrailVersion): string {
  const date = columnDate(v);
  return date ? `${columnTitle(v)} - ${date}` : columnTitle(v);
}

/**
 * A suggested-counter column is where "agreed" shading earns its keep;
 * mid-negotiation, a plain diff is more useful.
 */
export function defaultHighlight(versions: TrailVersion[]): HighlightMode {
  if (versions.length < 2) return "none";
  return versions[versions.length - 1].source === "manual" ? "agreed" : "moved";
}

// ---- editing -----------------------------------------------------------

/**
 * Cells are edited as free text, because that's how a broker reads and writes
 * this grid. Where the text maps cleanly back onto a structured field we write
 * the field, so the underlying data stays true. Where it doesn't — composed
 * rows like Premises, rent schedules, prose dates — we store the text as an
 * override and let it win over extraction. Nothing is silently mangled.
 */
export function applyCellEdit(
  version: TrailVersion,
  def: RowDef,
  text: string
): { extracted_json: ExtractedLOI; cell_overrides: Record<string, string> } {
  const loi = structuredClone(version.extracted_json) as unknown as Record<string, Record<string, AnyField>>;
  const overrides: Record<string, string> = { ...(version.cell_overrides || {}) };
  const t = text.trim();

  const setField = (value: unknown) => {
    const [s, k] = def.field!;
    loi[s][k] = { ...loi[s][k], value, confidence: 1, source_text: "Edited manually" };
    delete overrides[def.id];
  };

  if (!def.field || def.kind === "schedule") {
    // Composed or unstructured — store the text the reader sees.
    if (t === "") delete overrides[def.id];
    else overrides[def.id] = t;
    return { extracted_json: loi as unknown as ExtractedLOI, cell_overrides: overrides };
  }

  if (t === "") {
    setField(def.kind === "list" ? [] : null);
    return { extracted_json: loi as unknown as ExtractedLOI, cell_overrides: overrides };
  }

  if (def.kind === "number" || def.kind === "currency" || def.kind === "rent_psf" || def.kind === "months") {
    const n = Number(t.replace(/[^0-9.\-]/g, ""));
    if (isFinite(n) && /\d/.test(t)) setField(n);
    else overrides[def.id] = t; // "TBD", "market rate" — keep the words
    return { extracted_json: loi as unknown as ExtractedLOI, cell_overrides: overrides };
  }

  if (def.kind === "date") {
    const d = new Date(t);
    if (!isNaN(d.getTime()) && /\d{4}/.test(t)) setField(d.toISOString().slice(0, 10));
    else overrides[def.id] = t; // "Upon completion of Landlord's Work"
    return { extracted_json: loi as unknown as ExtractedLOI, cell_overrides: overrides };
  }

  if (def.kind === "list") {
    setField(t.split(";").map((x) => x.trim()).filter(Boolean));
    return { extracted_json: loi as unknown as ExtractedLOI, cell_overrides: overrides };
  }

  setField(t);
  return { extracted_json: loi as unknown as ExtractedLOI, cell_overrides: overrides };
}

/** A drafted counter starts as a copy of the last proposal on the table. */
export function seedSuggestedCounter(latest: TrailVersion | undefined): {
  extracted_json: ExtractedLOI | null;
  cell_overrides: Record<string, string>;
} {
  if (!latest) return { extracted_json: null, cell_overrides: {} };
  return {
    extracted_json: structuredClone(latest.extracted_json),
    cell_overrides: { ...(latest.cell_overrides || {}) },
  };
}

// ---- manual highlighting -----------------------------------------------

/**
 * Highlights are a per-round working layer: a broker paints the cells that
 * moved this round to prep an ownership conversation, and a fresh redline
 * comes in clean. They live on the version (the column), keyed by row id, so
 * dropping in the next proposal never inherits the last one's marks.
 */
export function highlightedRowsFor(version: TrailVersion | undefined): Set<string> {
  const raw = version?.cell_overrides?.["__highlights"];
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

/** Toggle one cell's highlight, returning the new overrides object to persist. */
export function toggleHighlight(
  version: TrailVersion,
  rowId: string
): Record<string, string> {
  const set = highlightedRowsFor(version);
  if (set.has(rowId)) set.delete(rowId);
  else set.add(rowId);
  const overrides = { ...(version.cell_overrides || {}) };
  if (set.size) overrides["__highlights"] = JSON.stringify(Array.from(set));
  else delete overrides["__highlights"];
  return overrides;
}
