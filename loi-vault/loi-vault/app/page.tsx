"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, isAllowedEmail } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function Landing() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "signing" | "blocked" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    supabase().auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/dashboard");
    });
  }, [router]);

  async function signIn() {
    const clean = email.trim().toLowerCase();
    if (!clean.includes("@") || !password) return;
    if (!isAllowedEmail(clean)) {
      setState("blocked");
      return;
    }
    setState("signing");
    const { error } = await supabase().auth.signInWithPassword({ email: clean, password });
    if (error) {
      // Supabase returns the same message for a bad password and an unknown
      // account, on purpose — don't leak which emails have accounts.
      setErrorMsg(
        error.message === "Invalid login credentials"
          ? "That email and password don't match an account."
          : error.message
      );
      setState("error");
    } else {
      router.replace("/dashboard");
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
            Drop in a Letter of Intent. LOI Vault pulls the deal terms, sets every
            counter side by side, and shows exactly what moved — and what you&apos;re
            agreeing to.
          </p>

          <div className="mt-10 border-t border-zinc-200 dark:border-zinc-800 pt-8">
            {state === "blocked" ? (
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
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void signIn();
                }}
              >
                <div className="space-y-1.5">
                  <label htmlFor="email" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Work email
                  </label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@yourfirm.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="username"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="password" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Password
                  </label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={state === "signing" || !email.includes("@") || !password}
                >
                  {state === "signing" ? "Signing in…" : "Sign in"}
                </Button>

                {state === "error" && (
                  <p className="text-sm text-red-600 dark:text-red-400">{errorMsg}</p>
                )}

                <p className="text-xs text-zinc-400">
                  Accounts are created by your workspace admin. No sign-up, no email required.
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
      <footer className="px-6 py-4 text-center text-xs text-zinc-400">
        Extracted terms are a starting point — verify against the executed document.
      </footer>
    </main>
  );
}
