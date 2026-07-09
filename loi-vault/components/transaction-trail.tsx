"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  buildTrail,
  columnDate,
  columnTitle,
  defaultHighlight,
  visibleRows,
  DETAIL_ROWS,
  TRAIL_ROWS,
  type HighlightMode,
  type TrailVersion,
} from "@/lib/trail";
import { TrailCell } from "./trail-cell";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

interface Props {
  tenantName: string;
  buildingName: string;
  versions: TrailVersion[];
  onCellSave: (versionId: string, rowId: string, text: string) => void;
  onRelabel: (versionId: string, label: string) => void;
  onRedate: (versionId: string, isoDate: string) => void;
  onDeleteColumn: (versionId: string) => void;
  onAddSuggested: () => void;
  addingSuggested?: boolean;
}

const HIGHLIGHTS: Array<{ value: HighlightMode; label: string; legend: string }> = [
  { value: "agreed", label: "Agreed terms", legend: "Highlighted = accepted from the prior proposal." },
  { value: "moved", label: "Terms that moved", legend: "Highlighted = changed from the proposal to its left." },
  { value: "none", label: "No highlight", legend: "" },
];

export function TransactionTrail({
  tenantName,
  buildingName,
  versions,
  onCellSave,
  onRelabel,
  onRedate,
  onDeleteColumn,
  onAddSuggested,
  addingSuggested,
}: Props) {
  const [view, setView] = useState<"trail" | "detail">("trail");
  const [highlight, setHighlight] = useState<HighlightMode>(() => defaultHighlight(versions));
  const [hideEmpty, setHideEmpty] = useState(true);
  const [onlyMoved, setOnlyMoved] = useState(false);
  const [editingHeader, setEditingHeader] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");

  // Adding a suggested-counter column flips the sensible default.
  useEffect(() => {
    setHighlight(defaultHighlight(versions));
  }, [versions.length, versions[versions.length - 1]?.source]); // eslint-disable-line react-hooks/exhaustive-deps

  const defs = view === "trail" ? TRAIL_ROWS : DETAIL_ROWS;
  const trail = useMemo(() => buildTrail(versions, defs), [versions, defs]);
  const rows = useMemo(() => visibleRows(trail, hideEmpty, onlyMoved), [trail, hideEmpty, onlyMoved]);
  const legend = HIGHLIGHTS.find((h) => h.value === highlight)?.legend || "";

  if (!versions.length) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-16 text-center">
        <p className="text-zinc-500">Drop in the first proposal to start the trail.</p>
      </div>
    );
  }

  const grouped = view === "detail";
  const sections = grouped
    ? trail.sections.map((s) => ({ ...s, rows: s.rows.filter((r) => rows.includes(r)) })).filter((s) => s.rows.length)
    : [{ key: "all", label: "", rows }];

  return (
    <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 px-4 py-3">
        <div className="inline-flex rounded-md border border-zinc-200 dark:border-zinc-700 p-0.5">
          {(["trail", "detail"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "rounded px-3 py-1 text-[13px] transition-colors",
                view === v ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-500 hover:text-zinc-800"
              )}
            >
              {v === "trail" ? "Trail" : "All terms"}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-4 text-[13px]">
          <label className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
            Highlight
            <select
              value={highlight}
              onChange={(e) => setHighlight(e.target.value as HighlightMode)}
              className="rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-1.5 py-0.5 text-[13px]"
            >
              {HIGHLIGHTS.map((h) => (
                <option key={h.value} value={h.value}>{h.label}</option>
              ))}
            </select>
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
            <input type="checkbox" checked={onlyMoved} onChange={(e) => setOnlyMoved(e.target.checked)} className="accent-accent" />
            Only moved
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
            <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} className="accent-accent" />
            Hide empty
          </label>
          <Button variant="secondary" size="sm" onClick={onAddSuggested} disabled={addingSuggested}>
            {addingSuggested ? "Adding…" : "+ Suggested counter"}
          </Button>
        </div>
      </header>

      <div className="overflow-x-auto p-4">
        <table className="w-full border-collapse">
          <caption className="caption-top border border-zinc-400 dark:border-zinc-600 px-4 py-3 text-center">
            <span className="block font-serif text-[17px] font-semibold underline decoration-1 underline-offset-4">
              {tenantName} — Transaction Trail
            </span>
            <span className="mt-1 block font-serif text-[15px] font-semibold underline decoration-1 underline-offset-4">
              {buildingName}
            </span>
          </caption>

          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-20 w-[190px] min-w-[190px] border border-zinc-400 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-3 py-3 text-left text-[13px] font-semibold"
              >
                Proposal
              </th>
              {trail.versions.map((v) => (
                <th
                  key={v.id}
                  scope="col"
                  className="group/col relative w-[270px] min-w-[270px] border border-zinc-400 dark:border-zinc-600 bg-[#DCE6F1] dark:bg-slate-800/70 px-3 py-2.5 text-center align-middle"
                >
                  {editingHeader === v.id ? (
                    <input
                      autoFocus
                      value={labelDraft}
                      onChange={(e) => setLabelDraft(e.target.value)}
                      onBlur={() => {
                        setEditingHeader(null);
                        if (labelDraft.trim() && labelDraft.trim() !== v.round_label) onRelabel(v.id, labelDraft.trim());
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") setEditingHeader(null);
                      }}
                      className="w-full rounded border border-accent bg-white px-1.5 py-0.5 text-center text-[13px] text-zinc-900"
                    />
                  ) : (
                    <button
                      onClick={() => {
                        setLabelDraft(columnTitle(v));
                        setEditingHeader(v.id);
                      }}
                      className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100 hover:text-accent"
                      title="Click to rename this proposal"
                    >
                      {columnTitle(v)}
                      {columnDate(v) && <span className="font-normal"> - {columnDate(v)}</span>}
                    </button>
                  )}

                  <div className="mt-1 flex items-center justify-center gap-2 text-[10px] font-normal text-zinc-500 dark:text-zinc-400">
                    <input
                      type="date"
                      value={v.document_date || ""}
                      onChange={(e) => onRedate(v.id, e.target.value)}
                      className="bg-transparent text-[10px] text-zinc-500"
                      aria-label={`Date on ${columnTitle(v)}`}
                    />
                    {v.source === "manual" && <span className="italic">draft</span>}
                  </div>

                  <button
                    onClick={() => {
                      if (confirm(`Delete the "${columnTitle(v)}" column? This can't be undone.`)) onDeleteColumn(v.id);
                    }}
                    className="absolute right-1 top-1 hidden h-5 w-5 rounded text-zinc-400 hover:bg-white/60 hover:text-red-600 group-hover/col:block"
                    aria-label={`Delete ${columnTitle(v)} column`}
                    title="Delete this column"
                  >
                    ✕
                  </button>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {sections.map((section) => (
              <Fragment key={section.key}>
                {grouped && section.label && (
                  <tr>
                    <th
                      colSpan={trail.versions.length + 1}
                      scope="colgroup"
                      className="sticky left-0 border border-zinc-400 dark:border-zinc-600 bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                    >
                      {section.label}
                    </th>
                  </tr>
                )}
                {section.rows.map((r) => (
                  <tr key={r.id}>
                    <th
                      scope="row"
                      className="sticky left-0 z-10 w-[190px] min-w-[190px] border border-zinc-400 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-3 py-3 text-left align-middle text-[13px] font-semibold text-zinc-900 dark:text-zinc-100"
                    >
                      {r.label}
                    </th>
                    {r.cells.map((c) => (
                      <TrailCell
                        key={c.versionId}
                        field={c.field}
                        kind={r.kind}
                        display={c.display}
                        highlighted={highlight === "agreed" ? c.agreed : highlight === "moved" ? c.moved : false}
                        moved={c.moved}
                        priorDisplay={c.priorDisplay}
                        clean={view === "trail"}
                        onSave={(text) => onCellSave(c.versionId, r.id, text)}
                      />
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {legend && (
        <footer className="flex items-center gap-3 border-t border-zinc-200 dark:border-zinc-800 px-4 py-2.5 text-[11px] text-zinc-400">
          <span className="inline-block h-3 w-3 border border-zinc-400 bg-[#FFFF00]" aria-hidden />
          <span>{legend}</span>
          <span className="ml-auto flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" /> low confidence — verify against the document
          </span>
        </footer>
      )}
    </section>
  );
}
