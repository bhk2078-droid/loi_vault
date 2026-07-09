"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useRef, useState } from "react";
import { supabase, emailDomain } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = [".pdf", ".doc", ".docx"];

type Stage = "idle" | "reading" | "extracting" | "building" | "done" | "error";

const STAGE_COPY: Record<Stage, string> = {
  idle: "",
  reading: "Reading document…",
  extracting: "Extracting terms…",
  building: "Adding column to the tracker…",
  done: "Done",
  error: "",
};

interface Props {
  open: boolean;
  onClose: () => void;
  /** Always required — every transaction lives inside a building. */
  buildingId: string;
  /** Existing transaction: pass dealId + nextVersion. New one: leave undefined. */
  dealId?: string;
  nextVersion?: number;
  onComplete: (dealId: string, versionId: string, degraded: boolean) => void;
}

export function UploadDropzone({ open, onClose, buildingId, dealId, nextVersion, onComplete }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [dealName, setDealName] = useState("");
  const [suite, setSuite] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const isNewDeal = !dealId;

  const pick = useCallback((f: File | null) => {
    setError("");
    if (!f) return;
    const ext = "." + (f.name.split(".").pop() || "").toLowerCase();
    if (!ACCEPTED.includes(ext)) {
      setError("Accepted formats: PDF, DOC, DOCX.");
      return;
    }
    if (f.size > MAX_BYTES) {
      setError("File is over the 10 MB limit.");
      return;
    }
    setFile(f);
  }, []);

  async function run() {
    if (!file) return;
    setError("");
    setStage("reading");
    try {
      const sb = supabase();
      const { data: sess } = await sb.auth.getSession();
      const user = sess.session?.user;
      if (!user?.email) throw new Error("You're signed out — refresh and sign in again.");
      const domain = emailDomain(user.email);

      // 1. Create the transaction row if this is a new one
      let targetDealId = dealId;
      if (!targetDealId) {
        const { data: deal, error: dealErr } = await sb
          .from("deals")
          .insert({
            building_id: buildingId,
            name: dealName.trim() || file.name.replace(/\.[^.]+$/, ""),
            suite: suite.trim() || null,
            workspace_domain: domain,
            created_by: user.id,
          })
          .select()
          .single();
        if (dealErr) throw new Error(dealErr.message);
        targetDealId = deal.id as string;
      }

      // 2. Upload the raw file to Storage (browser -> Supabase directly,
      //    which keeps us under Netlify's function payload limit)
      const path = `${domain}/${buildingId}/${targetDealId}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
      const { error: upErr } = await sb.storage.from("loi-files").upload(path, file);
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

      // 3. Ask the function to parse + extract
      setStage("extracting");
      const res = await fetch("/.netlify/functions/extract-loi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storagePath: path,
          fileName: file.name,
          dealId: targetDealId,
          versionNumber: nextVersion || 1,
          uploaderEmail: user.email,
          uploaderId: user.id,
        }),
      });
      // The function can fail before it ever returns JSON — a crash, a timeout,
      // a missing env var — and Netlify answers with an HTML error page. Read
      // the body as text first so the real status and message reach the screen
      // instead of a "Unexpected token '<'" parse error.
      const raw = await res.text();
      let body: { error?: string; version?: { id: string; extracted_json: Record<string, any> }; degraded?: boolean };
      try {
        body = JSON.parse(raw);
      } catch {
        const snippet = raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
        throw new Error(
          res.status === 404
            ? "The extract-loi function isn't deployed. Check the Netlify deploy log for 'Packaging Functions'."
            : `Extraction failed (HTTP ${res.status}). ${snippet || "The server returned an error page."} — see Netlify → Logs → Functions → extract-loi.`
        );
      }
      if (!res.ok) throw new Error(body.error || `Extraction failed (${res.status})`);

      setStage("building");
      const x = body.version!.extracted_json;
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (x?.parties?.tenant?.value) patch.tenant = x.parties.tenant.value;
      if (x?.parties?.landlord?.value) patch.landlord = x.parties.landlord.value;
      if (isNewDeal && !suite.trim() && x?.property?.floor?.value) patch.suite = x.property.floor.value;
      await sb.from("deals").update(patch).eq("id", targetDealId);

      setStage("done");
      onComplete(targetDealId!, body.version!.id, !!body.degraded);
    } catch (e) {
      setStage("error");
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  }

  const busy = stage === "reading" || stage === "extracting" || stage === "building";
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
    >
      <div className="w-full max-w-lg rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <h2 className="font-serif text-xl font-medium text-zinc-900 dark:text-zinc-50">
            {isNewDeal ? "New transaction" : `Add round ${nextVersion}`}
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy} aria-label="Close">
            ✕
          </Button>
        </div>

        {isNewDeal ? (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="deal-name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                Tenant <span className="font-normal text-zinc-400">(optional)</span>
              </label>
              <Input id="deal-name" placeholder="Oso Security" value={dealName} onChange={(e) => setDealName(e.target.value)} disabled={busy} />
            </div>
            <div>
              <label htmlFor="suite" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                Suite / floor <span className="font-normal text-zinc-400">(optional)</span>
              </label>
              <Input id="suite" placeholder="2nd Floor" value={suite} onChange={(e) => setSuite(e.target.value)} disabled={busy} />
            </div>
          </div>
        ) : (
          <p className="mt-2 text-[13px] text-zinc-500">
            This becomes column {nextVersion} of the tracker. Terms that moved from the last round get flagged automatically.
          </p>
        )}

        <div
          className={cn(
            "mt-4 rounded-lg border-2 border-dashed p-8 text-center transition-colors cursor-pointer",
            dragOver ? "border-accent bg-accent-soft dark:bg-accent-softDark" : "border-zinc-300 dark:border-zinc-700 hover:border-zinc-400"
          )}
          onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; setDragOver(true); }}
          onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(false);
            pick(e.dataTransfer.files?.[0] || null);
          }}
          onClick={() => { if (!busy) inputRef.current?.click(); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          role="button"
          tabIndex={0}
        >
          {/* The input sits inside the drop zone, so its own click must not
              bubble back up and re-trigger inputRef.click() — that recursion
              opens and immediately closes the file dialog. */}
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED.join(",")}
            className="sr-only"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              pick(e.target.files?.[0] || null);
              e.target.value = ""; // let the same file be picked twice in a row
            }}
          />
          {file ? (
            <div>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{file.name}</p>
              <p className="mt-1 text-xs text-zinc-400">{(file.size / 1024).toFixed(0)} KB — click to swap</p>
            </div>
          ) : (
            <div>
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                {isNewDeal ? "Drop the LOI here, or click to browse" : "Drop the redline here, or click to browse"}
              </p>
              <p className="mt-1 text-xs text-zinc-400">PDF, DOC, or DOCX · up to 10 MB</p>
            </div>
          )}
        </div>

        {busy && (
          <div className="mt-4 flex items-center gap-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/60 px-4 py-3">
            <span className="h-2 w-2 rounded-full bg-accent animate-pulse" aria-hidden />
            <p className="text-sm text-zinc-600 dark:text-zinc-300" aria-live="polite">{STAGE_COPY[stage]}</p>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={run} disabled={!file || busy}>{busy ? "Working…" : "Upload & extract"}</Button>
        </div>
      </div>
    </div>
  );
}
