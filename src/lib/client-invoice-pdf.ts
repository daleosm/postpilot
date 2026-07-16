type InvoicePdfInput = {
  issuer: { name: string; address: string | null; email: string | null; taxName: string; taxNumber: string | null; paymentInstructions: string | null };
  client: { name: string; address: string | null; email: string | null };
  invoice: { number: string; invoiceDate: string; dueDate: string; currency: string; subtotal: number; taxEnabled: boolean; taxRate: number; taxAmount: number; total: number; showTitle: string | null; episodeLabel: string | null };
  items: Array<{ description: string; reference: string | null; quantity: number; unitAmount: number; amount: number }>;
};
type PdfRow = { description: string; quantity: string; unitAmount: string; amount: string };

const encoder = new TextEncoder();

/**
 * Small dependency-free PDF writer for immutable invoice downloads. It uses
 * the PDF base fonts so the server can safely return a document without media
 * upload, remote rendering, or a native binary dependency.
 */
export function createClientInvoicePdf(input: InvoicePdfInput) {
  const rows = input.items.flatMap((item) => {
    const description = item.reference ? `${item.description} (${item.reference})` : item.description;
    const lines = wrap(description, 64);
    return lines.map((line, index) => ({ description: line, quantity: index === 0 ? formatQuantity(item.quantity) : "", unitAmount: index === 0 ? money(item.unitAmount, input.invoice.currency) : "", amount: index === 0 ? money(item.amount, input.invoice.currency) : "" }));
  });
  const pages: PdfRow[][] = [];
  const firstCapacity = 19;
  // Keep the last page comfortably clear of the statutory totals and payment
  // block. A consistent capacity is preferable to risking an overlap on a
  // long invoice.
  const laterCapacity = 19;
  for (let start = 0; start < rows.length || (start === 0 && !rows.length);) {
    const capacity = pages.length ? laterCapacity : firstCapacity;
    pages.push(rows.slice(start, start + capacity));
    start += capacity;
    if (!rows.length) break;
  }

  const pageCount = pages.length;
  const fontRegularObject = 3;
  const fontBoldObject = 4;
  const firstPageObject = 5;
  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  const kids = pages.map((_, index) => `${firstPageObject + index * 2} 0 R`).join(" ");
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;
  objects[fontRegularObject] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[fontBoldObject] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

  pages.forEach((pageRows, index) => {
    const pageObject = firstPageObject + index * 2;
    const streamObject = pageObject + 1;
    const stream = pageContent(input, pageRows, index, pageCount);
    objects[pageObject] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontRegularObject} 0 R /F2 ${fontBoldObject} 0 R >> >> /Contents ${streamObject} 0 R >>`;
    objects[streamObject] = `<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`;
  });

  let output = "%PDF-1.4\n% PostPilot invoice\n";
  const offsets: number[] = [0];
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = encoder.encode(output).length;
    output += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = encoder.encode(output).length;
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < objects.length; index += 1) output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return encoder.encode(output);
}

function pageContent(input: InvoicePdfInput, rows: PdfRow[], pageIndex: number, pageCount: number) {
  const draw: string[] = ["q"];
  const text = (x: number, y: number, value: string, size = 10, bold = false, color = "0.14 0.17 0.16") => draw.push(`${color} rg BT /${bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${escapePdf(value)}) Tj ET`);
  const line = (x1: number, y1: number, x2: number, y2: number, color = "0.84 0.86 0.84") => draw.push(`${color} RG 0.6 w ${x1} ${y1} m ${x2} ${y2} l S`);

  if (pageIndex === 0) {
    text(48, 790, input.issuer.name, 18, true, "0.13 0.2 0.18");
    text(420, 790, "INVOICE", 20, true, "0.13 0.2 0.18");
    labelLines(text, 48, 768, input.issuer.address, input.issuer.email, input.invoice.taxEnabled && input.issuer.taxNumber ? `${input.issuer.taxName}: ${input.issuer.taxNumber}` : null);
    text(356, 764, `Invoice no.  ${input.invoice.number}`, 9, true);
    text(356, 748, `Issue date   ${displayDate(input.invoice.invoiceDate)}`, 9);
    text(356, 732, `Due date     ${displayDate(input.invoice.dueDate)}`, 9);
    text(356, 716, `Currency     ${input.invoice.currency}`, 9);
    line(48, 695, 547, 695, "0.48 0.61 0.56");
    text(48, 674, "BILL TO", 8, true, "0.29 0.43 0.38");
    text(48, 658, input.client.name, 11, true);
    labelLines(text, 48, 643, input.client.address, input.client.email);
    const project = [input.invoice.showTitle, input.invoice.episodeLabel].filter(Boolean).join(" - ");
    if (project) { text(356, 674, "PROJECT", 8, true, "0.29 0.43 0.38"); text(356, 658, project, 10, true); }
  } else {
    text(48, 790, input.issuer.name, 13, true, "0.13 0.2 0.18");
    text(401, 790, `Invoice ${input.invoice.number} - continued`, 10, true);
  }

  const tableTop = pageIndex === 0 ? 588 : 750;
  draw.push("0.94 0.96 0.94 rg 48 " + (tableTop - 17) + " 499 19 re f");
  text(56, tableTop - 11, "DESCRIPTION", 8, true, "0.26 0.31 0.29");
  text(359, tableTop - 11, "QTY", 8, true, "0.26 0.31 0.29");
  text(411, tableTop - 11, "UNIT PRICE", 8, true, "0.26 0.31 0.29");
  text(501, tableTop - 11, "AMOUNT", 8, true, "0.26 0.31 0.29");
  let y = tableTop - 39;
  for (const row of rows) {
    text(56, y, row.description, 9);
    if (row.quantity) text(359, y, row.quantity, 9);
    if (row.unitAmount) text(411, y, row.unitAmount, 9);
    if (row.amount) text(501, y, row.amount, 9);
    line(48, y - 10, 547, y - 10, "0.9 0.91 0.89");
    y -= 22;
  }
  if (!rows.length) { text(56, y, "No invoice lines", 9); y -= 22; }

  if (pageIndex === pageCount - 1) {
    const totalsY = Math.min(y - 18, 180);
    const taxOffset = input.invoice.taxEnabled ? 68 : 50;
    line(338, totalsY + taxOffset, 547, totalsY + taxOffset, "0.48 0.61 0.56");
    text(376, totalsY + (input.invoice.taxEnabled ? 48 : 30), "Subtotal", 9); text(501, totalsY + (input.invoice.taxEnabled ? 48 : 30), money(input.invoice.subtotal, input.invoice.currency), 9);
    if (input.invoice.taxEnabled) { text(376, totalsY + 30, `${input.issuer.taxName} (${input.invoice.taxRate.toFixed(3).replace(/\.000$/, "")}%)`, 9); text(501, totalsY + 30, money(input.invoice.taxAmount, input.invoice.currency), 9); }
    line(338, totalsY + 17, 547, totalsY + 17, "0.48 0.61 0.56");
    text(376, totalsY, "TOTAL DUE", 11, true, "0.13 0.2 0.18"); text(486, totalsY, money(input.invoice.total, input.invoice.currency), 11, true, "0.13 0.2 0.18");
    text(48, 94, `Payment is due by ${displayDate(input.invoice.dueDate)}.`, 9, true);
    if (input.issuer.paymentInstructions) wrap(input.issuer.paymentInstructions, 90).slice(0, 3).forEach((value, index) => text(48, 78 - index * 12, value, 8));
  }
  text(48, 34, `PostPilot client invoice - page ${pageIndex + 1} of ${pageCount}`, 8, false, "0.45 0.49 0.47");
  draw.push("Q");
  return draw.join("\n");
}

function labelLines(text: (x: number, y: number, value: string, size?: number, bold?: boolean) => void, x: number, y: number, ...values: Array<string | null>) {
  values.filter((value): value is string => Boolean(value?.trim())).flatMap((value) => wrap(value, 46)).forEach((value, index) => text(x, y - index * 12, value, 8));
}
function money(value: number, currency: string) { return `${currency} ${value.toFixed(2)}`; }
function formatQuantity(value: number) { return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, ""); }
function displayDate(value: string) { const [year, month, day] = value.split("-"); return year && month && day ? `${day}/${month}/${year}` : value; }
function wrap(value: string, length: number) { const words = sanitize(value).split(/\s+/); const lines: string[] = []; let current = ""; for (const word of words) { const next = current ? `${current} ${word}` : word; if (next.length > length && current) { lines.push(current); current = word; } else current = next; } if (current) lines.push(current); return lines.length ? lines : [""]; }
function sanitize(value: string) { return value.normalize("NFKD").replace(/[^\x20-\x7E]/g, " "); }
function escapePdf(value: string) { return sanitize(value).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)"); }
