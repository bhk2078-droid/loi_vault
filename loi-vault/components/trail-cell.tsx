"use client";

import { useState } from "react";
import type { AnyField, FieldKind } from "@/lib/extraction-schema";
import { cn } from "@/lib/utils";

interface Props {
  field: AnyField;
  kind: FieldKind;
  display: string;
  /** Manually painted by a teammate this round. */
  highlighted: boolean;
  /** Differs from the cell to its left — drives the hover "was X" note only. */
  moved: boolean;
  priorDisplay: string | null;
  clean: boolean;
  onSave: (text: string) => void;
  onToggleHighlight: () => void;
}

export function TrailCell({ field, kind, display, highlighted, moved, priorDisplay, clean, onSave, onToggleHighlight }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [hover, setHover] = useState(false);

  const isEmpty = display === "";
  // In the clean view we only flag what actually needs a human eye.
  const needsCheck = !isEmpty && field.confidence > 0 && field.confidence < 0.7;

  function begin() {
    setDraft(display);
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    if (draft.trim() !== display.trim()) onSave(draft.trim());
  }

  const showTooltip = hover && !editing && (!!field.source_text || (moved && priorDisplay !== null));

  return (
    <td
      className={cn(
        "group/cell relative border border-zinc-400 dark:border-zinc-600 p-0 align-middle",
        highlighted
          ? "bg-[#FFFF00] dark:bg-yellow-300"
          : "bg-[#DCE6F1] dark:bg-slate-800/70"
      )}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleHighlight();
        }}
        className={cn(
          "absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded text-[11px] transition-opacity",
          highlighted
            ? "bg-yellow-400 text-black opacity-100 hover:bg-yellow-500"
            : "bg-white/80 text-zinc-500 opacity-0 hover:bg-white hover:text-zinc-800 group-hover/cell:opacity-100"
        )}
        aria-label={highlighted ? "Remove highlight" : "Highlight this cell"}
        aria-pressed={highlighted}
        title={highlighted ? "Remove highlight" : "Highlight this cell"}
      >
        {highlighted ? "\u2715" : "\u25CF"}
      </button>
      {editing ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") setEditing(false);
          }}
          rows={3}
          className="w-full resize-y bg-white dark:bg-zinc-900 px-2 py-2 text-center text-[13px] outline outline-2 outline-accent"
        />
      ) : (
        <button
          onClick={begin}
          className="block w-full px-3 py-3 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
          title="Click to edit"
        >
          <span
            className={cn(
              "text-[13px] leading-snug",
              highlighted ? "text-black" : "text-zinc-900 dark:text-zinc-100",
              isEmpty && "text-zinc-400 dark:text-zinc-500"
            )}
          >
            {isEmpty ? "—" : display}
          </span>
          {needsCheck && (
            <span
              className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-red-500 align-middle"
              title={`Low confidence (${Math.round(field.confidence * 100)}%) — verify against the document`}
              aria-label="Low confidence, verify"
            />
          )}
        </button>
      )}

      {showTooltip && (
        <div className="pointer-events-none absolute left-1 right-1 top-full z-40 pt-1">
          <div className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-left shadow-xl">
            {moved && priorDisplay !== null && (
              <p className="mb-2 text-[12px] text-zinc-500">
                Was <span className="line-through decoration-zinc-400">{priorDisplay || "—"}</span>
                <span className="mx-1.5 text-zinc-300">→</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{display || "—"}</span>
              </p>
            )}
            {field.source_text && (
              <>
                <p className="mb-1 text-[10px] uppercase tracking-widest text-zinc-400">From the document</p>
                <p className="font-serif text-[13px] italic leading-snug text-zinc-600 dark:text-zinc-300">
                  &ldquo;{field.source_text}&rdquo;
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </td>
  );
}
