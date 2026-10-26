import PDFDocument from 'pdfkit';
import type { ReceiptFormat } from '@mafk/validation';
import type {
  PaymentMethod,
  ReceiptDocument,
  SaleDetail,
  SaleReturnDetail,
} from '../domain/types.js';
import { subtractDecimalStrings } from '@mafk/shared';
import { formatUnitPrice } from './format.js';

interface Party {
  business: ReceiptDocument['business'];
  branch: ReceiptDocument['branch'];
  cashier: string | null;
}

const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  BANK_TRANSFER: 'Bank transfer',
  CUSTOMER_CREDIT: 'Customer credit',
};

/** Builds the paper-independent receipt from SAVED records only (a reprint never recomputes anything). */
export const buildSaleReceipt = (sale: SaleDetail, party: Party): ReceiptDocument => {
  const totals: ReceiptDocument['totals'] = [{ label: 'Subtotal', value: sale.subtotal }];
  if (sale.itemDiscountTotal !== '0.00')
    totals.push({ label: 'Item discounts', value: `-${sale.itemDiscountTotal}` });
  if (sale.cartDiscountAmount !== '0.00')
    totals.push({ label: 'Cart discount', value: `-${sale.cartDiscountAmount}` });
  if (sale.taxTotal !== '0.00') totals.push({ label: 'Tax', value: sale.taxTotal });
  totals.push({ label: 'TOTAL', value: sale.grandTotal, strong: true });

  const payments: ReceiptDocument['payments'] = sale.payments.map((p) => ({
    label: METHOD_LABEL[p.method],
    value: p.amount,
  }));
  if (sale.changeDue !== '0.00') payments.push({ label: 'Change', value: sale.changeDue });
  const refunded = sale.returns.reduce(
    (acc, r) => acc + BigInt(r.refundTotal.replace('.', '')),
    0n,
  );
  if (refunded > 0n) {
    const s = refunded.toString().padStart(3, '0');
    payments.push({ label: 'Refunded so far', value: `${s.slice(0, -2)}.${s.slice(-2)}` });
  }

  return {
    kind: 'SALE',
    ...party,
    title: 'SALES RECEIPT',
    number: sale.invoiceNo,
    relatedNumber: null,
    date: sale.soldAt,
    customer: sale.customerName,
    lines: sale.items.map((i) => ({
      name: i.productName,
      sku: i.sku,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      discount: i.discountAmount,
      lineTotal: i.lineTotal,
    })),
    totals,
    payments,
    footer: 'Thank you for your purchase!',
  };
};

export const buildRefundReceipt = (
  ret: SaleReturnDetail,
  sale: SaleDetail,
  party: Party,
): ReceiptDocument => ({
  kind: 'REFUND',
  ...party,
  title: 'REFUND SLIP',
  number: ret.returnNo,
  relatedNumber: sale.invoiceNo,
  date: ret.createdAt,
  customer: sale.customerName,
  lines: ret.items.map((i) => ({
    name: i.productName,
    sku: i.sku,
    quantity: i.quantity,
    unitPrice: formatUnitPrice(i.unitRefund),
    discount: '0.00',
    lineTotal: i.lineTotal,
  })),
  totals: [{ label: 'TOTAL REFUND', value: ret.refundTotal, strong: true }],
  payments: [{ label: `Refunded by ${METHOD_LABEL[ret.refundMethod]}`, value: ret.refundTotal }],
  footer: ret.reason ? `Reason: ${ret.reason}` : 'Refund processed.',
});

const trimQty = (q: string): string =>
  q.includes('.') ? q.replace(/0+$/, '').replace(/\.$/, '') : q;

export const RECEIPT_COLUMNS: Record<Exclude<ReceiptFormat, 'a4'>, number> = {
  '58mm': 32,
  '80mm': 48,
};

const pad2 = (left: string, right: string, width: number): string => {
  const room = width - right.length - 1;
  return `${left.length > room ? left.slice(0, Math.max(room, 1)) : left}${' '.repeat(Math.max(width - Math.min(left.length, room) - right.length, 1))}${right}`;
};
const center = (s: string, width: number): string =>
  s.length >= width ? s.slice(0, width) : ' '.repeat(Math.floor((width - s.length) / 2)) + s;
const wrap = (s: string, width: number): string[] => {
  const out: string[] = [];
  let line = '';
  for (const word of s.split(/\s+/).filter(Boolean)) {
    if (word.length > width) {
      if (line) out.push(line);
      for (let i = 0; i < word.length; i += width) out.push(word.slice(i, i + width));
      line = '';
    } else if ((line ? line.length + 1 : 0) + word.length > width) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
};

const dt = (d: Date): string => d.toISOString().slice(0, 16).replace('T', ' ');

/** Fixed-width plain text for thermal printers (32 columns at 58mm, 48 at 80mm). */
export const renderReceiptText = (
  doc: ReceiptDocument,
  format: Exclude<ReceiptFormat, 'a4'>,
): string => {
  const w = RECEIPT_COLUMNS[format];
  const rule = '-'.repeat(w);
  const out: string[] = [];
  for (const l of wrap(doc.business.name.toUpperCase(), w)) out.push(center(l, w));
  for (const part of [doc.business.address, doc.business.phone])
    if (part) for (const l of wrap(part, w)) out.push(center(l, w));
  out.push(center(doc.branch.name, w), rule, center(doc.title, w));
  out.push(pad2('No:', doc.number, w));
  if (doc.relatedNumber) out.push(pad2('Invoice:', doc.relatedNumber, w));
  out.push(pad2('Date:', dt(doc.date), w));
  if (doc.cashier) out.push(pad2('Cashier:', doc.cashier, w));
  if (doc.customer) out.push(pad2('Customer:', doc.customer, w));
  out.push(rule);
  for (const l of doc.lines) {
    for (const nl of wrap(l.name, w)) out.push(nl);
    out.push(pad2(`  ${trimQty(l.quantity)} x ${l.unitPrice}`, l.lineTotal, w));
    if (l.discount !== '0.00') out.push(pad2('  discount', `-${l.discount}`, w));
  }
  out.push(rule);
  for (const t of doc.totals) out.push(pad2(t.label, t.value, w));
  if (doc.payments.length) out.push(rule);
  for (const p of doc.payments) out.push(pad2(p.label, p.value, w));
  out.push(rule);
  for (const l of wrap(doc.footer, w)) out.push(center(l, w));
  return `${out.join('\n')}\n`;
};

const MM = 72 / 25.4;

/**
 * Real PDF: 58mm and 80mm are continuous rolls (page height is measured first, so nothing is cut or wasted);
 * A4 is a full invoice-style page. Values are printed verbatim - no arithmetic here.
 */
export const renderReceiptPdf = (doc: ReceiptDocument, format: ReceiptFormat): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const thermal = format !== 'a4';
    const width = format === '58mm' ? 58 * MM : format === '80mm' ? 80 * MM : 595.28;
    const margin = thermal ? 6 : 40;
    const font = thermal ? 7.5 : 10;
    const inner = width - margin * 2;

    const measure = (): number => {
      // First pass on a throwaway doc to learn the content height.
      const probe = new PDFDocument({ size: [width, 5000], margin });
      probe.on('data', () => undefined);
      draw(probe);
      const h = probe.y + margin + 4;
      probe.end();
      return h;
    };

    const draw = (pdf: PDFKit.PDFDocument): void => {
      const line = (l: string, r: string, bold = false): void => {
        pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(font);
        const y = pdf.y;
        pdf.text(l, margin, y, { width: inner * 0.62, lineBreak: true });
        const endY = pdf.y;
        pdf.text(r, margin + inner * 0.62, y, { width: inner * 0.38, align: 'right' });
        pdf.y = Math.max(endY, pdf.y);
      };
      // Header facts (No / Date / Cashier ...): wide value column on thermal paper, plain "Label value" on A4.
      const meta = (l: string, r: string): void => {
        pdf.font('Helvetica').fontSize(font);
        if (thermal) {
          const y = pdf.y;
          pdf.text(l, margin, y, { width: inner * 0.3 });
          pdf.text(r, margin + inner * 0.3, y, { width: inner * 0.7, align: 'right' });
        } else {
          pdf.text(`${l}  ${r}`, margin, pdf.y, { width: inner });
        }
      };
      const rule = (): void => {
        pdf.moveDown(0.3);
        pdf
          .moveTo(margin, pdf.y)
          .lineTo(width - margin, pdf.y)
          .lineWidth(0.5)
          .stroke();
        pdf.moveDown(0.3);
      };
      pdf.y = margin;
      pdf
        .font('Helvetica-Bold')
        .fontSize(thermal ? 10 : 18)
        .text(doc.business.name, margin, pdf.y, {
          width: inner,
          align: thermal ? 'center' : 'left',
        });
      pdf.font('Helvetica').fontSize(font);
      for (const part of [
        doc.business.legalName,
        doc.business.address,
        doc.business.phone,
        doc.business.email,
      ]) {
        if (part)
          pdf.text(part, margin, pdf.y, { width: inner, align: thermal ? 'center' : 'left' });
      }
      pdf.text(doc.branch.name, margin, pdf.y, {
        width: inner,
        align: thermal ? 'center' : 'left',
      });
      rule();
      pdf
        .font('Helvetica-Bold')
        .fontSize(thermal ? 9 : 14)
        .text(doc.title, margin, pdf.y, { width: inner, align: thermal ? 'center' : 'left' });
      pdf.font('Helvetica').fontSize(font);
      meta('No:', doc.number);
      if (doc.relatedNumber) meta('Invoice:', doc.relatedNumber);
      meta('Date:', dt(doc.date));
      if (doc.cashier) meta('Cashier:', doc.cashier);
      if (doc.customer) meta('Customer:', doc.customer);
      rule();
      if (thermal) {
        for (const l of doc.lines) {
          pdf.font('Helvetica').fontSize(font).text(l.name, margin, pdf.y, { width: inner });
          line(`  ${trimQty(l.quantity)} x ${l.unitPrice}`, l.lineTotal);
          if (l.discount !== '0.00') line('  discount', `-${l.discount}`);
        }
      } else {
        const cols = [
          { x: margin, w: inner * 0.42, t: 'Item' },
          { x: margin + inner * 0.42, w: inner * 0.1, t: 'Qty', r: true },
          { x: margin + inner * 0.52, w: inner * 0.16, t: 'Unit price', r: true },
          { x: margin + inner * 0.68, w: inner * 0.14, t: 'Discount', r: true },
          { x: margin + inner * 0.82, w: inner * 0.18, t: 'Total', r: true },
        ];
        pdf.font('Helvetica-Bold');
        const hy = pdf.y;
        for (const c of cols) pdf.text(c.t, c.x, hy, { width: c.w, align: c.r ? 'right' : 'left' });
        pdf.y = hy + font + 6;
        pdf.font('Helvetica');
        for (const l of doc.lines) {
          const y = pdf.y;
          pdf.text(`${l.name} (${l.sku})`, cols[0]!.x, y, { width: cols[0]!.w });
          const endY = pdf.y;
          const vals = [trimQty(l.quantity), l.unitPrice, l.discount, l.lineTotal];
          vals.forEach((v, i) =>
            pdf.text(v, cols[i + 1]!.x, y, { width: cols[i + 1]!.w, align: 'right' }),
          );
          pdf.y = Math.max(endY, y + font + 4) + 2;
        }
      }
      rule();
      for (const t of doc.totals) line(t.label, t.value, t.strong);
      if (doc.payments.length) rule();
      for (const p of doc.payments) line(p.label, p.value);
      rule();
      pdf
        .font('Helvetica')
        .fontSize(font)
        .text(doc.footer, margin, pdf.y, { width: inner, align: 'center' });
    };

    try {
      const pdf = new PDFDocument({
        size: thermal ? [width, Math.max(measure(), 120)] : 'A4',
        margin,
        info: { Title: `${doc.title} ${doc.number}` },
      });
      const chunks: Buffer[] = [];
      pdf.on('data', (c: Buffer) => chunks.push(c));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);
      draw(pdf);
      pdf.end();
    } catch (err) {
      reject(err);
    }
  });

/** Net amount the customer still has after refunds (display helper for the receipt screen). */
export const netAfterRefunds = (sale: SaleDetail): string =>
  sale.returns.reduce((acc, r) => subtractDecimalStrings(acc, r.refundTotal, 2), sale.grandTotal);
