"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, emailDomain } from "@/lib/supabase";
import { emptyLOI } from "@/lib/extraction-schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = [".pdf", ".doc", ".docx"];
const POLL_MS = 2500;
const GIVE_UP_MS = 6 * 60 * 1000;

type Stage = "idle" | "uploading" | "extracting" | "done" | "error";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Props {
  open: boolean;
  onClose: () => void;
  /** Always required — every transaction lives inside a building. */
  buildingId: string;
  /** Existing transaction: pass dealId + nextVersion. New one: leave undefined. */
  dealId?: string;
  nextVersion?: number;
  onComplete: (dealId: string, versionId: string, warning: string | null) => void;
}

export function UploadDropzone({ open, onClose, buildingId, dealId, nextVersion, onComplete }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [dealName, setDealName] = useState("");
  const [suite, setSuite] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const isNewDeal = !dealId;
  const busy = stage === "uploading" || stage === "extracting";

  // Extraction usually lands in 20-60 seconds. Showing the clock is the
  // difference between "it's working" and "it's broken".
  useEffect(() => {
    if (stage !== "extracting") return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [stage]);

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
    setElapsed(0);
    setStage("uploading");

    const sb = supabase();
    let placeholderId = "";

    try {
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

      // 2. Upload the raw file straight to Storage — keeps us clear of
      //    Netlify's function payload limit.
      const version = nextVersion || 1;
      const path = `${domain}/${buildingId}/${targetDealId}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
      const { error: upErr } = await sb.storage.from("loi-files").upload(path, file);
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

      // 3. Claim the column now, so the work has somewhere to land.
      const { data: placeholder, error: insErr } = await sb
        .from("loi_versions")
        .insert({
          deal_id: targetDealId,
          version_number: version,
          status: "processing",
          source: "upload",
          extracted_json: emptyLOI(),
          cell_overrides: {},
          uploaded_by: user.id,
          uploaded_by_email: user.email,
          file_url: path,
          file_name: file.name,
        })
        .select()
        .single();
      if (insErr) throw new Error(`Could not create the column: ${insErr.message}`);
      placeholderId = placeholder.id as string;

      // 4. Kick off the background job. It answers 202 straight away and keeps
      //    working for up to 15 minutes — the response tells us nothing.
      setStage("extracting");
      const res = await fetch("/.netlify/functions/extract-loi-background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: placeholderId, storagePath: path, fileName: file.name, versionNumber: version }),
      });
      if (res.status !== 202 && !res.ok) {
        throw new Error(
          res.status === 404
            ? "The extraction function isn't deployed. Background functions need a paid Netlify plan."
            : `Could not start extraction (HTTP ${res.status}).`
        );
      }

      // 5. Poll the row until the function fills it in.
      const deadline = Date.now() + GIVE_UP_MS;
      let done = false;
      let warning: string | null = null;
      while (Date.now() < deadline) {
        await sleep(POLL_MS);
        const { data: row } = await sb
          .from("loi_versions")
          .select("status, error, extracted_json")
          .eq("id", placeholderId)
          .single();
        if (!row) continue;
        if (row.status === "failed") throw new Error(row.error || "Extraction failed.");
        if (row.status === "ready") {
          warning = row.error || null;
          const x = row.extracted_json as Record<string, { [k: string]: { value: unknown } }> | null;
          const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
          if (x?.parties?.tenant?.value) patch.tenant = x.parties.tenant.value;
          if (x?.parties?.landlord?.value) patch.landlord = x.parties.landlord.value;
          if (isNewDeal && !suite.trim() && x?.property?.floor?.value) patch.suite = x.property.floor.value;
          await sb.from("deals").update(patch).eq("id", targetDealId);
          done = true;
          break;
        }
      }
      if (!done) throw new Error("Extraction is taking unusually long. Reload the page in a minute — it may still finish.");

      setStage("done");
      onComplete(targetDealId!, placeholderId, warning);
    } catch (e) {
      // Don't leave a half-made column behind and burn the version number.
      if (placeholderId) {
        const { data: row } = await sb.from("loi_versions").select("status").eq("id", placeholderId).single();
        if (row?.status !== "ready") await sb.from("loi_versions").delete().eq("id", placeholderId);
      }
      setStage("error");
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  }

  if (!open) return null;

  const stageCopy =
    stage === "uploading"
      ? "Uploading document…"
      : stage === "extracting"
      ? `Reading the document and pulling terms… ${elapsed}s`
      : "";

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
            {isNewDeal ? "New transaction" : `Add proposal ${nextVersion}`}
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
            This becomes column {nextVersion} of the trail. Terms that moved from the last proposal get flagged automatically.
          </p>
        )}

        <div
          className={cn(
            "mt-4 rounded-lg border-2 border-dashed p-8 text-center transition-colors",
            busy ? "cursor-default opacity-60" : "cursor-pointer",
            dragOver ? "border-accent bg-accent-soft dark:bg-accent-softDark" : "border-zinc-300 dark:border-zinc-700 hover:border-zinc-400"
          )}
          onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; setDragOver(true); }}
          onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(false);
            if (!busy) pick(e.dataTransfer.files?.[0] || null);
          }}
          onClick={() => { if (!busy) inputRef.current?.click(); }}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !busy) {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          role="button"
          tabIndex={0}
        >
          {/* The input lives inside the drop zone, so its own click must not
              bubble up and re-trigger inputRef.click() — that recursion opens
              and immediately closes the file dialog. */}
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
                {isNewDeal ? "Drop the LOI here, or click to browse" : "Drop the proposal here, or click to browse"}
              </p>
              <p className="mt-1 text-xs text-zinc-400">PDF, DOC, or DOCX · up to 10 MB</p>
            </div>
          )}
        </div>

        {busy && (
          <div className="mt-4 rounded-lg bg-zinc-50 dark:bg-zinc-800/60 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-accent animate-pulse" aria-hidden />
              <p className="text-sm text-zinc-600 dark:text-zinc-300" aria-live="polite">{stageCopy}</p>
            </div>
            {stage === "extracting" && elapsed > 45 && (
              <p className="mt-2 text-xs text-zinc-400">
                Long documents can take a couple of minutes. This keeps running even if you close the tab.
              </p>
            )}
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
