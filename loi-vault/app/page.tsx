"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, isAllowedEmail } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function Landing() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "blocked" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    supabase().auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/dashboard");
    });
  }, [router]);

  async function sendLink() {
    const clean = email.trim().toLowerCase();
    if (!clean.includes("@")) return;
    if (!isAllowedEmail(clean)) {
      setState("blocked");
      return;
    }
    setState("sending");
    const { error } = await supabase().auth.signInWithOtp({
      email: clean,
      options: { emailRedirectTo: `${window.location.origin}/dashboard` },
    });
    if (error) {
      setErrorMsg(error.message);
      setState("error");
    } else {
      setState("sent");
    }
  }

  return (
    <main className="min-h-screen flex flex-col">
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-md">
          <p className="text-xs font-medium tracking-[0.2em] uppercase text-zinc-400 mb-6">
            Deal intelligence for leasing teams
          </p>
          <h1 className="font-serif text-4xl md:text-5xl font-medium leading-[1.1] text-zinc-900 dark:text-zinc-50">
            Every counter,
            <br />
            on the record.
          </h1>
          <p className="mt-5 text-[15px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            Upload a Letter of Intent. LOI Vault extracts the deal terms, runs the
            commission math with the formula in plain sight, and tracks every version
            across the negotiation.
          </p>

          <div className="mt-10 border-t border-zinc-200 dark:border-zinc-800 pt-8">
            {state === "sent" ? (
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Check your email</p>
                <p className="mt-1 text-sm text-zinc-500">
                  A sign-in link is on its way to <span className="font-medium">{email}</span>.
                  Open it on this device to continue.
                </p>
              </div>
            ) : state === "blocked" ? (
              <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-5">
                <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                  That email domain isn&apos;t on this workspace&apos;s allowlist.
                </p>
                <p className="mt-1 text-sm text-amber-800/80 dark:text-amber-300/80">
                  Contact your admin to be added, or{" "}
                  <button className="underline" onClick={() => setState("idle")}>
                    try a different email
                  </button>
                  .
                </p>
              </div>
            ) : (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendLink();
                }}
              >
                <label htmlFor="email" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Work email
                </label>
                <div className="flex gap-2">
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@yourfirm.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                  <Button type="submit" disabled={state === "sending" || !email.includes("@")}>
                    {state === "sending" ? "Sending…" : "Send link"}
                  </Button>
                </div>
                {state === "error" && (
                  <p className="text-sm text-red-600 dark:text-red-400">
                    Couldn&apos;t send the link: {errorMsg}
                  </p>
                )}
                <p className="text-xs text-zinc-400">
                  No password. We email you a one-time sign-in link.
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
      <footer className="px-6 py-4 text-center text-xs text-zinc-400">
        Commission figures are estimates — verify against your firm&apos;s specific commission schedule.
      </footer>
    </main>
  );
}
