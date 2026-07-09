import { z } from "zod";

// ---------------------------------------------------------------
// Every extracted field carries { value, confidence, source_text }
// so the UI can flag low-confidence fields and show provenance.
// ---------------------------------------------------------------

const field = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({
    value: valueSchema,
    confidence: z.number().min(0).max(1).catch(0),
    source_text: z.string().catch(""),
  });

const fStr = field(z.string().nullable().catch(null));
const fNum = field(z.number().nullable().catch(null));
const fStrArr = field(z.array(z.string()).catch([]));

export const rentPeriodSchema = z.object({
  period: z.string().catch(""),
  psf: z.number().catch(0),
  annual: z.number().catch(0),
  monthly: z.number().catch(0),
});

const fRentSchedule = field(z.array(rentPeriodSchema).catch([]));

export const extractedLOISchema = z.object({
  parties: z.object({
    tenant: fStr,
    landlord: fStr,
    landlord_broker: fStr,
    tenant_broker: fStr,
  }),
  property: z.object({
    address: fStr,
    floor: fStr,
    premises_description: fStr,
    rsf: fNum,
    usf: fNum,
    loss_factor: fNum,
  }),
  term: z.object({
    term_description: fStr,
    lease_term_months: fNum,
    commencement_date: fStr, // ISO yyyy-mm-dd
    rent_commencement_date: fStr,
    expiration_date: fStr,
    early_access: fStr,
  }),
  economics: z.object({
    base_rent_psf: fNum,
    rent_schedule: fRentSchedule,
    escalations: fStr,
    free_rent_months: fNum,
    ti_allowance_psf: fNum,
    ti_allowance_total: fNum,
    landlord_work: fStr,
    opex_base_year: fStr,
    tax_base_year: fStr,
    electricity: fStr,
    security_deposit: fStr,
  }),
  options: z.object({
    termination_option: fStr,
    renewal_options: fStr,
    expansion_rights: fStr,
    rofo_rofr: fStr,
    assignment_sublet: fStr,
  }),
  other: z.object({
    use_clause: fStr,
    building_access: fStr,
    hvac: fStr,
    cleaning: fStr,
    restoration: fStr,
    furniture: fStr,
    special_conditions: fStrArr,
  }),
  commission: z.object({
    landlord_rate: fStr,
    tenant_rep_rate: fStr,
    notes: fStr,
  }),
});

export type ExtractedLOI = z.infer<typeof extractedLOISchema>;
export type RentPeriod = z.infer<typeof rentPeriodSchema>;
export type AnyField = { value: unknown; confidence: number; source_text: string };

export const EMPTY_FIELD: AnyField = { value: null, confidence: 0, source_text: "" };

/** A fully-empty LOI: every field present, null values, zero confidence. */
export function emptyLOI(): ExtractedLOI {
  const f = () => ({ ...EMPTY_FIELD, value: null });
  return extractedLOISchema.parse({
    parties: { tenant: f(), landlord: f(), landlord_broker: f(), tenant_broker: f() },
    property: { address: f(), floor: f(), premises_description: f(), rsf: f(), usf: f(), loss_factor: f() },
    term: { term_description: f(), lease_term_months: f(), commencement_date: f(), rent_commencement_date: f(), expiration_date: f(), early_access: f() },
    economics: {
      base_rent_psf: f(), rent_schedule: { value: [], confidence: 0, source_text: "" },
      escalations: f(), free_rent_months: f(), ti_allowance_psf: f(), ti_allowance_total: f(),
      landlord_work: f(), opex_base_year: f(), tax_base_year: f(), electricity: f(), security_deposit: f(),
    },
    options: { termination_option: f(), renewal_options: f(), expansion_rights: f(), rofo_rofr: f(), assignment_sublet: f() },
    other: {
      use_clause: f(), building_access: f(), hvac: f(), cleaning: f(), restoration: f(), furniture: f(),
      special_conditions: { value: [], confidence: 0, source_text: "" },
    },
    commission: { landlord_rate: f(), tenant_rep_rate: f(), notes: f() },
  });
}

/**
 * Graceful-degrade parse: whatever Claude returned, keep every field that
 * validates and backfill the rest with empty fields. Never throws.
 */
export function parseExtraction(raw: unknown): { loi: ExtractedLOI; degraded: boolean } {
  const strict = extractedLOISchema.safeParse(raw);
  if (strict.success) return { loi: strict.data, degraded: false };

  const base = emptyLOI() as Record<string, Record<string, AnyField>>;
  const input = (raw ?? {}) as Record<string, unknown>;
  let kept = 0;

  for (const section of Object.keys(base)) {
    const rawSection = input[section];
    if (!rawSection || typeof rawSection !== "object") continue;
    for (const key of Object.keys(base[section])) {
      const rawField = (rawSection as Record<string, unknown>)[key];
      if (!rawField || typeof rawField !== "object") continue;
      const rf = rawField as Partial<AnyField>;
      if ("value" in rf) {
        base[section][key] = {
          value: rf.value ?? null,
          confidence: typeof rf.confidence === "number" ? Math.max(0, Math.min(1, rf.confidence)) : 0.5,
          source_text: typeof rf.source_text === "string" ? rf.source_text : "",
        };
        kept++;
      }
    }
  }
  // Re-validate the merged object; catch() fallbacks guarantee success.
  const merged = extractedLOISchema.parse(base);
  return { loi: merged, degraded: kept === 0 ? true : true };
}

// ---- Field labels for UI + diff + exports ----
export const SECTION_LABELS: Record<string, string> = {
  parties: "Parties",
  property: "Property",
  term: "Term",
  economics: "Economics",
  options: "Options",
  other: "Other",
  commission: "Brokerage",
};

export const FIELD_LABELS: Record<string, string> = {
  "parties.tenant": "Tenant",
  "parties.landlord": "Landlord",
  "parties.landlord_broker": "Landlord Broker",
  "parties.tenant_broker": "Tenant Broker",
  "property.address": "Address",
  "property.floor": "Floor",
  "property.premises_description": "Premises",
  "property.rsf": "RSF",
  "property.usf": "USF",
  "property.loss_factor": "Loss Factor",
  "term.term_description": "Term",
  "term.lease_term_months": "Lease Term (months)",
  "term.commencement_date": "Lease Commencement Date",
  "term.rent_commencement_date": "Rent Commencement Date",
  "term.expiration_date": "Expiration Date",
  "term.early_access": "Early Access",
  "economics.base_rent_psf": "Base Rent",
  "economics.rent_schedule": "Rent Schedule",
  "economics.escalations": "Rent Escalations",
  "economics.free_rent_months": "Free Rent",
  "economics.ti_allowance_psf": "TI Allowance ($/RSF)",
  "economics.ti_allowance_total": "TI Allowance (total)",
  "economics.landlord_work": "Landlord's Work",
  "economics.opex_base_year": "Operating Escalations",
  "economics.tax_base_year": "Real Estate Taxes",
  "economics.electricity": "Electricity",
  "economics.security_deposit": "Security Deposit",
  "options.termination_option": "Termination Option",
  "options.renewal_options": "Renewal Option",
  "options.expansion_rights": "Expansion Rights",
  "options.rofo_rofr": "Right of First Offer",
  "options.assignment_sublet": "Assignment / Sublet",
  "other.use_clause": "Use",
  "other.building_access": "Building Access",
  "other.hvac": "HVAC",
  "other.cleaning": "Cleaning",
  "other.restoration": "Restoration",
  "other.furniture": "Furniture",
  "other.special_conditions": "Special Conditions",
  "commission.landlord_rate": "Landlord Rate",
  "commission.tenant_rep_rate": "Tenant Rep Rate",
  "commission.notes": "Commission Notes",
};

/** Flatten an ExtractedLOI to "section.key" -> field, for diffs and exports. */
export function flattenLOI(loi: ExtractedLOI): Record<string, AnyField> {
  const out: Record<string, AnyField> = {};
  const obj = loi as unknown as Record<string, Record<string, AnyField>>;
  for (const section of Object.keys(obj)) {
    for (const key of Object.keys(obj[section])) {
      out[`${section}.${key}`] = obj[section][key];
    }
  }
  return out;
}

// ---------------------------------------------------------------
// Ordered row definition for the transaction tracker grid and for
// every export. One source of truth so the Excel/Word/PDF output
// always matches what's on screen.
// ---------------------------------------------------------------

export type FieldKind = "text" | "number" | "currency" | "rent_psf" | "months" | "date" | "textarea" | "list" | "schedule";

export interface TrackerRow {
  section: string;
  key: string;
  label: string;
  kind: FieldKind;
}

const ROW_DEFS: Record<string, Array<[string, FieldKind]>> = {
  parties: [
    ["tenant", "text"],
    ["landlord", "text"],
    ["landlord_broker", "text"],
    ["tenant_broker", "text"],
  ],
  property: [
    ["address", "text"],
    ["floor", "text"],
    ["premises_description", "textarea"],
    ["rsf", "number"],
    ["usf", "number"],
    ["loss_factor", "number"],
  ],
  term: [
    ["term_description", "text"],
    ["lease_term_months", "number"],
    ["commencement_date", "date"],
    ["rent_commencement_date", "date"],
    ["expiration_date", "date"],
    ["early_access", "textarea"],
  ],
  economics: [
    ["base_rent_psf", "rent_psf"],
    ["rent_schedule", "schedule"],
    ["escalations", "text"],
    ["free_rent_months", "months"],
    ["ti_allowance_psf", "currency"],
    ["ti_allowance_total", "currency"],
    ["landlord_work", "textarea"],
    ["opex_base_year", "text"],
    ["tax_base_year", "text"],
    ["electricity", "text"],
    ["security_deposit", "textarea"],
  ],
  options: [
    ["termination_option", "textarea"],
    ["renewal_options", "textarea"],
    ["expansion_rights", "textarea"],
    ["rofo_rofr", "textarea"],
    ["assignment_sublet", "textarea"],
  ],
  other: [
    ["use_clause", "textarea"],
    ["building_access", "text"],
    ["hvac", "textarea"],
    ["cleaning", "text"],
    ["restoration", "textarea"],
    ["furniture", "textarea"],
    ["special_conditions", "list"],
  ],
  commission: [
    ["landlord_rate", "text"],
    ["tenant_rep_rate", "text"],
    ["notes", "textarea"],
  ],
};

export const SECTION_ORDER = Object.keys(ROW_DEFS);

export const TRACKER_ROWS: TrackerRow[] = SECTION_ORDER.flatMap((section) =>
  ROW_DEFS[section].map(([key, kind]) => ({
    section,
    key,
    label: FIELD_LABELS[`${section}.${key}`] || key,
    kind,
  }))
);
