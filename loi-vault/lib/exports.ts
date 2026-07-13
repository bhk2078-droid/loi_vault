"use client";

import {
  buildTrail,
  columnHeader,
  columnTitle,
  highlightedRowsFor,
  visibleRows,
  TRAIL_ROWS,
  type TrailVersion,
} from "./trail";

// All three exports render the trail exactly as it reads on screen: terms down
// the side, one column per proposal, the landlord's suggested counter shaded
// where it accepts the tenant's position. They run in the browser via dynamic
// import so a long trail never risks a serverless function timeout.

const BLUE = "DCE6F1";
const YELLOW = "FFFF00";
const RULE = "9C9C9C";

export interface ExportBundle {
  buildingName: string;
  tenantName: string;
  versions: TrailVersion[];
  /** Rows the team removed from this transaction's trail. */
  hiddenRows?: string[];
}

const stamp = () => new Date().toISOString().slice(0, 10);
const safe = (s: string) => s.replace(/[^\w.\- ]+/g, "").trim().replace(/\s+/g, "-");

/**
 * Webpack wraps CommonJS and UMD packages, so `await import("pkg")` may hand
 * back the real module or a namespace with everything under `.default`. Which
 * one you get depends on the package's build, not on your code. Getting it
 * wrong produces a minified "c is not a function" at the call site and nothing
 * useful above it — so probe for a symbol we know exists rather than assume.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function interop<T>(mod: any, probe: string): T {
  if (mod && typeof mod[probe] !== "undefined") return mod as T;
  if (mod?.default && typeof mod.default[probe] !== "undefined") return mod.default as T;
  return (mod?.default ?? mod) as T;
}

/**
 * file-saver was one more CJS package to interop, for four lines of work we can
 * do ourselves. Object URLs must be revoked or the blob leaks for the life of
 * the tab.
 */
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function prepare(bundle: ExportBundle) {
  const trail = buildTrail(bundle.versions, TRAIL_ROWS);
  const rows = visibleRows(trail, bundle.hiddenRows || [], false);
  // Manual highlights, keyed by column then row — exactly what's painted on screen.
  const marks: Record<string, Set<string>> = {};
  for (const v of trail.versions) marks[v.id] = highlightedRowsFor(v);
  const lit = (c: { versionId: string; rowId: string }) => marks[c.versionId]?.has(c.rowId) || false;
  const anyLit = Object.values(marks).some((set) => set.size > 0);
  const legend = anyLit ? "Highlighted cells were flagged as the terms that moved this round." : "";
  return { trail, rows, lit, legend };
}

// ---------------------------------------------------------------
// Excel — the working copy the desk marks up.
// ---------------------------------------------------------------
export async function exportExcel(bundle: ExportBundle) {
  // `import("exceljs")` resolves to the Node build, which requires fs, stream
  // and zlib. Webpack compiles it happily and it explodes the moment it runs in
  // a browser. The dist bundle is self-contained; the UMD wrapper means the
  // real export may sit on .default or on the namespace itself.
  const ExcelJS = interop<typeof import("exceljs")>(await import("exceljs/dist/exceljs.min.js"), "Workbook");
  const { trail, rows, lit, legend } = prepare(bundle);

  const wb = new ExcelJS.Workbook();
  wb.creator = "LOI Vault";
  wb.created = new Date();
  const ws = wb.addWorksheet("Transaction Trail", { views: [{ state: "frozen", xSplit: 1, ySplit: 4 }] });
  const cols = trail.versions.length;

  ws.getColumn(1).width = 26;
  for (let i = 0; i < cols; i++) ws.getColumn(i + 2).width = 34;

  const border = {
    top: { style: "thin" as const, color: { argb: `FF${RULE}` } },
    left: { style: "thin" as const, color: { argb: `FF${RULE}` } },
    bottom: { style: "thin" as const, color: { argb: `FF${RULE}` } },
    right: { style: "thin" as const, color: { argb: `FF${RULE}` } },
  };
  const fill = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: `FF${argb}` } });

  // Title block, merged across the full width
  const t1 = ws.addRow([`${bundle.tenantName}  -  Transaction Trail`]);
  ws.mergeCells(t1.number, 1, t1.number, cols + 1);
  t1.getCell(1).font = { bold: true, size: 13, underline: true };
  t1.getCell(1).alignment = { horizontal: "center" };
  const t2 = ws.addRow([bundle.buildingName]);
  ws.mergeCells(t2.number, 1, t2.number, cols + 1);
  t2.getCell(1).font = { bold: true, size: 12, underline: true };
  t2.getCell(1).alignment = { horizontal: "center" };
  for (const r of [t1, t2]) for (let c = 1; c <= cols + 1; c++) r.getCell(c).border = border;
  ws.addRow([]);

  // Header row
  const header = ws.addRow(["Proposal", ...trail.versions.map(columnHeader)]);
  header.height = 28;
  header.eachCell((cell, i) => {
    cell.font = { bold: true, size: 10 };
    cell.border = border;
    cell.alignment = { horizontal: i === 1 ? "left" : "center", vertical: "middle", wrapText: true };
    if (i > 1) cell.fill = fill(BLUE);
  });

  // Body
  for (const row of rows) {
    const r = ws.addRow([row.label, ...row.cells.map((c) => c.display || "—")]);
    r.getCell(1).font = { bold: true, size: 10 };
    r.getCell(1).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    r.getCell(1).border = border;
    row.cells.forEach((c, i) => {
      const cell = r.getCell(i + 2);
      cell.font = { size: 10 };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = border;
      cell.fill = fill(lit(c) ? YELLOW : BLUE);
      if (c.field.confidence > 0 && c.field.confidence < 0.7 && c.display) {
        cell.note = `Low confidence (${Math.round(c.field.confidence * 100)}%) — verify.\n\nSource: ${c.field.source_text || "n/a"}`;
      }
    });
  }

  if (legend) {
    ws.addRow([]);
    const l = ws.addRow([legend]);
    l.getCell(1).font = { italic: true, size: 9, color: { argb: "FF808080" } };
  }

  // Negotiation log on its own sheet
  const log = wb.addWorksheet("Negotiation Log");
  log.getColumn(1).width = 26;
  log.getColumn(2).width = 110;
  log.addRow(["Proposal", "Summary"]).font = { bold: true };
  for (const v of trail.versions) {
    const r = log.addRow([columnHeader(v), v.change_summary || "Not yet summarized."]);
    r.alignment = { wrapText: true, vertical: "top" };
  }

  const buf = await wb.xlsx.writeBuffer();
  download(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${safe(bundle.tenantName)}-transaction-trail-${stamp()}.xlsx`
  );
}

// ---------------------------------------------------------------
// Word — the version that goes into an ownership email.
// ---------------------------------------------------------------
export async function exportWord(bundle: ExportBundle) {
  const docx = interop<typeof import("docx")>(await import("docx"), "Document");
  const {
    Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel,
    WidthType, AlignmentType, ShadingType, BorderStyle, UnderlineType,
  } = docx;
  const { trail, rows, lit, legend } = prepare(bundle);

  const edges = {
    top: { style: BorderStyle.SINGLE, size: 4, color: RULE },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE },
    left: { style: BorderStyle.SINGLE, size: 4, color: RULE },
    right: { style: BorderStyle.SINGLE, size: 4, color: RULE },
  };

  const cell = (text: string, o: { bold?: boolean; fill?: string; center?: boolean } = {}) =>
    new TableCell({
      borders: edges,
      shading: o.fill ? { type: ShadingType.CLEAR, color: "auto", fill: o.fill } : undefined,
      margins: { top: 80, bottom: 80, left: 90, right: 90 },
      children: [
        new Paragraph({
          alignment: o.center ? AlignmentType.CENTER : AlignmentType.LEFT,
          children: [new TextRun({ text: text || "—", bold: o.bold, size: 18 })],
        }),
      ],
    });

  const body: InstanceType<typeof TableRow>[] = [
    new TableRow({
      tableHeader: true,
      children: [
        cell("Proposal", { bold: true }),
        ...trail.versions.map((v) => cell(columnHeader(v), { bold: true, fill: BLUE, center: true })),
      ],
    }),
    ...rows.map(
      (r) =>
        new TableRow({
          children: [
            cell(r.label, { bold: true }),
            ...r.cells.map((c) => cell(c.display, { fill: lit(c) ? YELLOW : BLUE, center: true })),
          ],
        })
    ),
  ];

  const title = (text: string, size: number) =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [new TextRun({ text, bold: true, size, underline: { type: UnderlineType.SINGLE } })],
    });

  const logParas: InstanceType<typeof Paragraph>[] = [];
  for (const v of trail.versions) {
    if (!v.change_summary) continue;
    logParas.push(
      new Paragraph({ spacing: { before: 240, after: 80 }, children: [new TextRun({ text: columnHeader(v), bold: true, size: 20 })] })
    );
    for (const para of v.change_summary.split("\n").filter(Boolean)) {
      logParas.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: para, size: 20 })] }));
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: { page: { size: { orientation: docx.PageOrientation.LANDSCAPE } } },
        children: [
          title(`${bundle.tenantName}  -  Transaction Trail`, 26),
          title(bundle.buildingName, 24),
          new Paragraph({ spacing: { after: 160 }, children: [] }),
          new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: body }),
          ...(legend
            ? [new Paragraph({ spacing: { before: 160 }, children: [new TextRun({ text: legend, italics: true, color: "808080", size: 16 })] })]
            : []),
          ...(logParas.length
            ? [new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 320 }, children: [new TextRun({ text: "Negotiation log" })] }), ...logParas]
            : []),
        ],
      },
    ],
  });

  download(await Packer.toBlob(doc), `${safe(bundle.tenantName)}-transaction-trail-${stamp()}.docx`);
}

// ---------------------------------------------------------------
// PDF — the read-only version. Built-in Helvetica, no font fetching.
// ---------------------------------------------------------------
export async function exportPDF(bundle: ExportBundle) {
  const { createElement: h } = await import("react");
  const { Document, Page, Text, View, StyleSheet, pdf } = interop<typeof import("@react-pdf/renderer")>(
    await import("@react-pdf/renderer"),
    "pdf"
  );
  const { trail, rows, lit, legend } = prepare(bundle);

  const n = Math.max(1, trail.versions.length);
  const termW = "16%";
  const colW = `${84 / n}%`;

  const s = StyleSheet.create({
    page: { padding: 24, fontSize: 8, fontFamily: "Helvetica", color: "#111827" },
    title: { fontSize: 13, fontFamily: "Helvetica-Bold", textAlign: "center", textDecoration: "underline" },
    subtitle: { fontSize: 11, fontFamily: "Helvetica-Bold", textAlign: "center", textDecoration: "underline", marginBottom: 10 },
    row: { flexDirection: "row" },
    termCell: { width: termW, borderWidth: 0.5, borderColor: `#${RULE}`, padding: 5, fontFamily: "Helvetica-Bold", justifyContent: "center" },
    cell: { borderWidth: 0.5, borderColor: `#${RULE}`, padding: 5, backgroundColor: `#${BLUE}`, justifyContent: "center" },
    lit: { backgroundColor: `#${YELLOW}` },
    headText: { fontFamily: "Helvetica-Bold", textAlign: "center" },
    cellText: { textAlign: "center", lineHeight: 1.3 },
    legend: { marginTop: 8, fontSize: 7, color: "#808080" },
    logHead: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 16, marginBottom: 4 },
    logTitle: { fontFamily: "Helvetica-Bold", marginTop: 8, marginBottom: 2 },
    logPara: { marginBottom: 3, lineHeight: 1.4 },
  });

  const doc = h(
    Document,
    {},
    h(
      Page,
      { size: "LETTER", orientation: "landscape", style: s.page },
      h(Text, { style: s.title }, `${bundle.tenantName}  -  Transaction Trail`),
      h(Text, { style: s.subtitle }, bundle.buildingName),

      h(
        View,
        { style: s.row },
        h(View, { style: s.termCell }, h(Text, {}, "Proposal")),
        ...trail.versions.map((v) =>
          h(View, { key: v.id, style: [s.cell, { width: colW }] }, h(Text, { style: s.headText }, columnHeader(v)))
        )
      ),

      ...rows.map((r) =>
        h(
          View,
          { key: r.id, style: s.row, wrap: false },
          h(View, { style: s.termCell }, h(Text, {}, r.label)),
          ...r.cells.map((c) =>
            h(
              View,
              { key: c.versionId, style: [s.cell, { width: colW }, ...(lit(c) ? [s.lit] : [])] },
              h(Text, { style: s.cellText }, c.display || "—")
            )
          )
        )
      ),

      legend ? h(Text, { style: s.legend }, legend) : null,

      ...(trail.versions.some((v) => v.change_summary)
        ? [
            h(Text, { style: s.logHead }, "Negotiation log"),
            ...trail.versions
              .filter((v) => v.change_summary)
              .flatMap((v) => [
                h(Text, { key: `t${v.id}`, style: s.logTitle }, columnTitle(v)),
                ...v.change_summary!.split("\n").filter(Boolean).map((p, i) => h(Text, { key: `${v.id}-${i}`, style: s.logPara }, p)),
              ]),
          ]
        : [])
    )
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  download(await pdf(doc as any).toBlob(), `${safe(bundle.tenantName)}-transaction-trail-${stamp()}.pdf`);
}
