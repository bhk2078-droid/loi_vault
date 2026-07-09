"use client";

import { useState } from "react";
import type { TrailVersion } from "@/lib/trail";
import { columnTitle } from "@/lib/trail";
import { Button } from "./ui/button";
import { fmtDate } from "@/lib/utils";

interface Props {
  versions: TrailVersion[]; // chronological
  changeCounts: Record<string, number>;
  onSave: (versionId: string, text: string) => void;
}

export function NegotiationLog({ versions, changeCounts, onSave }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  async function generate(versionId: string) {
    setBusy(versionId);
    setError("");
    try {
      const res = await fetch("/.netlify/functions/summarize-round", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Failed (${res.status})`);
      onSave(versionId, body.summary as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate the summary.");
    } finally {
      setBusy(null);
    }
  }

  if (!versions.length) return null;

  return (
    <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      <header className="border-b border-zinc-200 dark:border-zinc-800 px-4 py-3">
        <h2 className="font-serif text-lg font-medium">Negotiation log</h2>
        <p className="text-[12px] text-zinc-400">One entry per proposal, newest last. Written for ownership.</p>
      </header>

      {error && <p className="px-4 pt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <ol className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {versions.map((v, i) => (
          <li key={v.id} className="px-4 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium">
                <span className="font-mono text-zinc-400 mr-2">v{v.version_number}</span>
                {columnTitle(v)}
                <span className="ml-2 font-normal text-zinc-400">{fmtDate(v.uploaded_at)}</span>
                {i > 0 && (
                  <span className="ml-2 font-normal text-amber-600 dark:text-amber-500">
                    {changeCounts[v.id] || 0} terms moved
                  </span>
                )}
              </h3>
              <div className="flex gap-2">
                {v.change_summary && editing !== v.id && (
                  <Button variant="ghost" size="sm" onClick={() => { setDraft(v.change_summary || ""); setEditing(v.id); }}>
                    Edit
                  </Button>
                )}
                <Button variant="secondary" size="sm" onClick={() => generate(v.id)} disabled={busy === v.id}>
                  {busy === v.id ? "Writing…" : v.change_summary ? "Regenerate" : "Summarize round"}
                </Button>
              </div>
            </div>

            {editing === v.id ? (
              <div className="mt-2">
                <textarea
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={7}
                  className="w-full rounded border border-accent bg-white dark:bg-zinc-900 p-3 text-[14px] leading-relaxed focus:outline-none"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                  <Button size="sm" onClick={() => { onSave(v.id, draft); setEditing(null); }}>Save</Button>
                </div>
              </div>
            ) : v.change_summary ? (
              <div className="mt-2 space-y-2 text-[14px] leading-relaxed text-zinc-700 dark:text-zinc-300">
                {v.change_summary.split("\n").filter(Boolean).map((para, idx) => (
                  <p key={idx}>{para}</p>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-[13px] text-zinc-400">
                {i === 0 ? "Summarize the opening position." : "Summarize what moved in this round."}
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
