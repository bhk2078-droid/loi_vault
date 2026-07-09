// Prompts sent to Claude from the Netlify Functions.
// Kept in one place so tuning extraction quality never touches plumbing.

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-5";

export const EXTRACTION_SYSTEM = `You are an expert commercial real estate analyst who extracts structured deal terms from Letters of Intent and counter-proposals with extreme precision. You respond ONLY with a single valid JSON object — no preamble, no markdown fences, no commentary.`;

export function extractionPrompt(loiText: string, roundNumber: number): string {
  return `Extract deal terms from the following commercial lease LOI / proposal. This is round ${roundNumber} of the negotiation.

Return ONLY a JSON object with this exact structure. Every leaf field marked F must be an object: {"value": <extracted value or null>, "confidence": <0 to 1>, "source_text": "<the exact phrase from the document that supports this value, max 200 chars>"}.

{
  "document_meta": {
    "round_label": "<short label for this document, 2-4 words, e.g. 'Tenant LOI', 'Landlord counter', 'Tenant counter #2'>",
    "party": "<'Landlord' if this document was sent by or on behalf of the landlord/owner side, 'Tenant' if sent by the tenant or tenant's broker, otherwise 'Unknown'>",
    "document_date": "<the date ON the proposal itself, ISO yyyy-mm-dd, from the letterhead or dateline — null if undated>"
  },
  "parties": { "tenant": F, "landlord": F, "landlord_broker": F, "tenant_broker": F },
  "property": { "address": F, "floor": F, "premises_description": F, "rsf": F(number), "usf": F(number|null), "loss_factor": F(number|null) },
  "term": { "term_description": F(the term stated the way the document states it, e.g. "Five (5) Years" or "Five (5) Years from RCD"), "lease_term_months": F(number), "commencement_date": F(string — "yyyy-mm-dd" if the document states a calendar date, otherwise the condition verbatim, e.g. "Upon mutual execution and delivery of Lease documents. Target: August 1, 2026"), "rent_commencement_date": F(string — same rule, e.g. "Three (3) Months from Lease Commencement Date"), "expiration_date": F(string — "yyyy-mm-dd", or null if commencement is conditional), "early_access": F },
  "economics": { "base_rent_psf": F(number), "rent_schedule": F(array of {"period": string, "psf": number, "annual": number, "monthly": number}), "escalations": F, "free_rent_months": F(number), "ti_allowance_psf": F(number), "ti_allowance_total": F(number), "landlord_work": F, "opex_base_year": F, "tax_base_year": F, "electricity": F, "security_deposit": F },
  "options": { "termination_option": F, "renewal_options": F, "expansion_rights": F, "rofo_rofr": F, "assignment_sublet": F },
  "other": { "use_clause": F, "building_access": F, "hvac": F, "cleaning": F, "restoration": F, "furniture": F, "special_conditions": F(array of strings) },
  "commission": { "landlord_rate": F, "tenant_rep_rate": F, "notes": F }
}

Rules:
- document_meta.round_label becomes the column header in a side-by-side trail, so keep it short and describe who sent it and what it is. Brokers write these as "Tenant RFP", "LL Proposal", "Tenant Counter", "LL Counter" — use that register. Infer the sending party from the letterhead, signature block, or "we are pleased to submit / on behalf of" language.
- opex_base_year and tax_base_year are the OPEX and real-estate-tax escalation terms. Capture them the way the document states them — a base year ("2027 Calendar base year", "2026/2027 Fiscal base year") or an escalation ("3% annual increases in Base Rent") — whichever the document uses. Do not convert one into the other.
- term_description: quote the term as written, including any qualifier such as "from RCD" or "from the Rent Commencement Date". lease_term_months carries the same term as a number.
- free_rent_months: if rent commencement is N months after lease commencement, that is N months of free rent, even when both dates are conditional. "Three (3) Months from Lease Commencement Date" means free_rent_months = 3.
- Dates: use ISO yyyy-mm-dd when the document states an actual calendar date. When a date is instead expressed as a CONDITION or a RELATIVE period — "Upon mutual execution and delivery of Lease documents", "Three (3) Months from Lease Commencement Date", "Upon substantial completion of Landlord's Work" — put that condition VERBATIM in the value as a string. Never leave a date field null when the document says something about it. If the document gives both a condition and a target date, combine them: "Upon mutual execution and delivery of Lease documents. Target: August 1, 2026". These fields print directly into a side-by-side grid that brokers read, and a blank cell wrongly implies the document was silent.
- lease_term_months: convert years/months language to total months (e.g. "one year, one month" = 13).
- If escalations are "None", set escalations value to "None" with high confidence and rent_schedule to a single period covering the full term at the base rent (compute annual = rsf * psf, monthly = annual / 12).
- free_rent_months: if rent commencement is N months after lease commencement, that is N months free rent.
- ti_allowance: set to 0 ONLY where the document explicitly says there is no allowance ("no TI allowance", "as-is with no work letter"). If the document simply never mentions a tenant improvement allowance — common where the landlord instead performs defined work — leave both ti_allowance fields null and describe the work in landlord_work. A $0.00 in the grid asserts the parties agreed to zero; a blank correctly says the document is silent.
- expiration_date: commencement date + lease term, minus one day, if not stated explicitly. If the commencement date is conditional rather than a calendar date, leave expiration_date null rather than computing from a target date.
- Redlined and marked-up documents: extract the FINAL proposed state of each term — what the sender is proposing now — not the struck-through original. If a term is struck without replacement, its value is null.
- termination_option: any early-termination / break right — the window, the notice period, and the penalty or unamortized-costs payment. Null if the document grants none.
- Open items count as terms. Where a proposal ASKS a question instead of stating a position — "Please confirm how electricity is handled in the Building", "Please describe how cleaning is handled" — capture that request verbatim as the value with high confidence. It is the sender's position on that term and belongs in the grid.
- If a field is genuinely absent from the document — no statement, no question, no condition — use value null, confidence 0, source_text "".
- confidence reflects how directly the document states the value: verbatim = 0.95+, computed/inferred = 0.7-0.9, guessed = below 0.7.
- special_conditions: capture anything unusual (desk-share rights, furniture arrangements, freight rates, profit-sharing on sublease, etc.) as an array of short strings.

DOCUMENT:
---
${loiText}
---

Respond with the JSON object only.`;
}

export const SUMMARY_SYSTEM = `You are a senior commercial real estate broker writing concise, landlord-ready notes on where a lease negotiation stands. Plain English, no jargon a principal wouldn't use, no fluff. You respond only with the summary text itself — no preamble.`;

export function summaryPrompt(
  current: { version_number: number; round_label: string | null; extracted_json: unknown },
  prior: { version_number: number; round_label: string | null; extracted_json: unknown } | null,
  allPriors: Array<{ version_number: number; round_label: string | null }>
): string {
  if (!prior) {
    return `Summarize the opening position of this lease negotiation in under 150 words.

OPENING DOCUMENT (v${current.version_number} — ${current.round_label || "Initial LOI"}):
${JSON.stringify(current.extracted_json)}

Write two short paragraphs of plain prose: first, the deal as proposed (tenant, premises, size, term, rent, free rent, escalations, TI or landlord's work, electricity); second, the terms most likely to be negotiated, plus anything material the document leaves open. Do not invent terms that are not in the data.`;
  }

  const history = allPriors.length
    ? `Rounds so far: ${allPriors.map((v) => `v${v.version_number} (${v.round_label || "unlabeled"})`).join(" → ")} → v${current.version_number}.`
    : "";

  return `Summarize what moved in the latest round of this lease negotiation. ${history}

PREVIOUS ROUND (v${prior.version_number} — ${prior.round_label || "prior"}):
${JSON.stringify(prior.extracted_json)}

CURRENT ROUND (v${current.version_number} — ${current.round_label || "current"}):
${JSON.stringify(current.extracted_json)}

Write under 200 words, in plain prose paragraphs — no bullets, no headers.

Cover, in order: the material terms that changed, each stated as "was X, now Y"; who conceded what; the economic effect of the round if it can be stated from the data; and one or two concrete next steps for the landlord side. If a term appears to have been dropped rather than countered, say so, and flag any term that changed without an obvious trade. Do not invent terms that are not in the data; if something material is missing, call it an open item.`;
}
