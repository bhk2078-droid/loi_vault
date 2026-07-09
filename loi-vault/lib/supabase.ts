"use client";

import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return client;
}

export function allowedDomains(): string[] {
  return (process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS || "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

export function emailDomain(email: string): string {
  return (email.split("@")[1] || "").toLowerCase();
}

export function isAllowedEmail(email: string): boolean {
  const domains = allowedDomains();
  if (domains.length === 0) return true; // no allowlist configured
  return domains.includes(emailDomain(email));
}
