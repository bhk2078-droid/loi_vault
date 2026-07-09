"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase, emailDomain } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtDate } from "@/lib/utils";

interface BuildingRow {
  id: string;
  name: string;
  address: string | null;
  updated_at: string;
  dealCount: number;
  activeCount: number;
  lastActivity: string | null;
}

export default function Dashboard() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [buildings, setBuildings] = useState<BuildingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = supabase();
    const { data: sess } = await sb.auth.getSession();
    if (!sess.session?.user?.email) {
      router.replace("/");
      return;
    }
    setEmail(sess.session.user.email);

    const { data: bs } = await sb.from("buildings").select("id, name, address, updated_at").order("name");
    const { data: ds } = await sb.from("deals").select("id, building_id, status, updated_at");

    const rows: BuildingRow[] = (bs || []).map((b) => {
      const mine = (ds || []).filter((d) => d.building_id === b.id);
      const last = mine.map((d) => d.updated_at as string).sort().pop() || null;
      return {
        ...b,
        dealCount: mine.length,
        activeCount: mine.filter((d) => d.status === "Negotiating" || d.status === "Out for signature").length,
        lastActivity: last,
      } as BuildingRow;
    });
    setBuildings(rows);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createBuilding() {
    if (!newName.trim() || !email) return;
    setError("");
    const sb = supabase();
    const { data: sess } = await sb.auth.getSession();
    const { data, error: err } = await sb
      .from("buildings")
      .insert({
        name: newName.trim(),
        address: newAddress.trim() || null,
        workspace_domain: emailDomain(email),
        created_by: sess.session?.user.id,
      })
      .select()
      .single();
    if (err) {
      setError(err.message);
      return;
    }
    router.push(`/building/${data.id}`);
  }

  /** Cascades to every transaction and proposal in the building. */
  async function deleteBuilding(b: BuildingRow) {
    const warn = b.dealCount
      ? `Delete "${b.name}" and all ${b.dealCount} transaction(s) inside it? This can't be undone.`
      : `Delete "${b.name}"?`;
    if (!confirm(warn)) return;
    setDeleting(b.id);
    const { error: err } = await supabase().from("buildings").delete().eq("id", b.id);
    setDeleting(null);
    if (err) {
      setError(err.message);
      return;
    }
    setBuildings((bs) => bs.filter((x) => x.id !== b.id));
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return buildings;
    return buildings.filter((b) => `${b.name} ${b.address || ""}`.toLowerCase().includes(q));
  }, [buildings, query]);

  return (
    <main className="min-h-screen">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
          <h1 className="font-serif text-lg font-medium">LOI Vault</h1>
          <div className="flex items-center gap-4">
            {email && <span className="text-[13px] text-zinc-400 hidden sm:inline">{email}</span>}
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await supabase().auth.signOut();
                router.replace("/");
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <h2 className="font-serif text-3xl font-medium">Buildings</h2>
            <p className="text-[14px] text-zinc-500 mt-1">
              Every transaction in the building, every round of every transaction.
            </p>
          </div>
          <Button onClick={() => setAdding((a) => !a)}>{adding ? "Cancel" : "+ New building"}</Button>
        </div>

        {adding && (
          <div className="mb-6 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[200px]">
              <label htmlFor="bname" className="block text-[13px] text-zinc-500 mb-1">Building name</label>
              <Input id="bname" placeholder="72 Madison Avenue" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label htmlFor="baddr" className="block text-[13px] text-zinc-500 mb-1">Address <span className="text-zinc-400">(optional)</span></label>
              <Input id="baddr" placeholder="72 Madison Ave, New York, NY" value={newAddress} onChange={(e) => setNewAddress(e.target.value)} />
            </div>
            <Button onClick={createBuilding} disabled={!newName.trim()}>Create</Button>
            {error && <p className="w-full text-sm text-red-600">{error}</p>}
          </div>
        )}

        <Input
          placeholder="Search buildings…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="mb-6 max-w-sm"
          aria-label="Search buildings"
        />

        {loading ? (
          <p className="text-zinc-400 text-sm py-16 text-center">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-16 text-center">
            <p className="text-zinc-500">
              {buildings.length === 0 ? "No buildings yet. Add the first one." : "Nothing matches that search."}
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((b) => (
              <Link
                key={b.id}
                href={`/building/${b.id}`}
                className="group relative rounded-lg border border-zinc-200 dark:border-zinc-800 p-5 hover:border-accent hover:shadow-sm transition-all"
              >
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void deleteBuilding(b);
                  }}
                  disabled={deleting === b.id}
                  className="absolute right-2 top-2 hidden rounded px-1.5 text-zinc-300 hover:bg-zinc-100 hover:text-red-600 group-hover:block dark:hover:bg-zinc-800"
                  aria-label={`Delete ${b.name}`}
                  title="Delete this building"
                >
                  {deleting === b.id ? "…" : "✕"}
                </button>
                <h3 className="font-serif text-[17px] font-medium group-hover:text-accent transition-colors">{b.name}</h3>
                {b.address && <p className="text-[13px] text-zinc-400 mt-0.5 truncate">{b.address}</p>}
                <div className="mt-4 flex items-baseline justify-between text-[13px]">
                  <span className="text-zinc-600 dark:text-zinc-300">
                    {b.dealCount} {b.dealCount === 1 ? "transaction" : "transactions"}
                    {b.activeCount > 0 && <span className="text-accent"> · {b.activeCount} live</span>}
                  </span>
                  {b.lastActivity && <span className="text-zinc-400">{fmtDate(b.lastActivity)}</span>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
