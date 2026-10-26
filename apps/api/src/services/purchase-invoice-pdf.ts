import PDFDocument from 'pdfkit';
import type { PurchaseInvoice } from '../domain/types.js';

const fmtDate = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Renders a genuine A4 PDF from a `PurchaseInvoice` (i.e. from SAVED records).
 * Money values are already exact decimal strings and are printed verbatim -
 * no arithmetic happens here. A logo is embedded only when `logoUrl` is a
 * `data:image/(png|jpeg)` URI; remote URLs are deliberately NOT fetched
 * server-side (SSRF risk), so those are omitted from the PDF (the on-screen
 * invoice still shows them).
 */
export const renderPurchaseInvoicePdf = (inv: PurchaseInvoice): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      info: { Title: `Purchase Invoice ${inv.purchase.purchaseNo}` },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const p = inv.purchase;
    let y = 40;

    const logo = inv.business.logoUrl?.match(/^data:image\/(png|jpeg);base64,(.+)$/);
    if (logo?.[2]) {
      try {
        doc.image(Buffer.from(logo[2], 'base64'), 40, y, { fit: [90, 50] });
      } catch {
        // An unreadable logo must not block the invoice.
      }
    }

    doc.fontSize(18).font('Helvetica-Bold').text(inv.business.name, 140, y, { width: 255 });
    doc.fontSize(9).font('Helvetica');
    if (inv.business.address) doc.text(inv.business.address, 140, doc.y, { width: 255 });
    const contact = [inv.business.phone, inv.business.email].filter(Boolean).join('  |  ');
    if (contact) doc.text(contact, 140, doc.y, { width: 255 });

    doc
      .fontSize(16)
      .font('Helvetica-Bold')
      .text('PURCHASE INVOICE', 395, y, { width: 160, align: 'right' });
    doc.fontSize(9).font('Helvetica');
    doc.text(`Purchase No: ${p.purchaseNo}`, 395, doc.y, { width: 160, align: 'right' });
    doc.text(`Supplier Invoice: ${p.invoiceNo}`, 395, doc.y, { width: 160, align: 'right' });
    doc.text(`Date: ${fmtDate(p.purchaseDate)}`, 395, doc.y, { width: 160, align: 'right' });

    y = Math.max(doc.y, 100) + 14;
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('Supplier', 40, y)
      .text('Branch', 220, y)
      .text('Created By', 400, y);
    doc.font('Helvetica');
    const sup = [
      inv.supplier.name,
      inv.supplier.phone,
      inv.supplier.email,
      inv.supplier.address,
    ].filter(Boolean);
    doc.text(sup.join('\n'), 40, y + 12, { width: 170 });
    doc.text(`${inv.branch.name} (${inv.branch.code})`, 220, y + 12, { width: 170 });
    doc.text(inv.createdBy?.displayName ?? '—', 400, y + 12, { width: 150 });

    y += 12 + Math.max(sup.length * 11, 24) + 14;

    const cols = [
      { h: 'Product', x: 40, w: 130, a: 'left' as const },
      { h: 'SKU', x: 170, w: 55, a: 'left' as const },
      { h: 'Qty', x: 225, w: 35, a: 'right' as const },
      { h: 'Cost', x: 260, w: 55, a: 'right' as const },
      { h: 'Disc %', x: 315, w: 40, a: 'right' as const },
      { h: 'Disc Rs', x: 355, w: 50, a: 'right' as const },
      { h: 'Tax', x: 405, w: 50, a: 'right' as const },
      { h: 'Total', x: 455, w: 100, a: 'right' as const },
    ];
    const header = (yy: number): number => {
      doc.rect(40, yy - 3, 515, 16).fill('#e5e7eb');
      doc.fillColor('#000').font('Helvetica-Bold').fontSize(8);
      for (const c of cols) doc.text(c.h, c.x, yy, { width: c.w, align: c.a });
      doc.font('Helvetica');
      return yy + 18;
    };
    y = header(y);
    doc.fontSize(8);
    for (const it of p.items) {
      if (y > 740) {
        doc.addPage();
        y = header(40);
        doc.fontSize(8);
      }
      const name = it.barcodes.length ? `${it.productName}\n${it.barcodes[0]}` : it.productName;
      const rowH = it.barcodes.length ? 22 : 12;
      doc.text(name, cols[0]!.x, y, { width: cols[0]!.w });
      doc.text(it.sku, cols[1]!.x, y, { width: cols[1]!.w });
      doc.text(it.quantity, cols[2]!.x, y, { width: cols[2]!.w, align: 'right' });
      doc.text(it.costPrice, cols[3]!.x, y, { width: cols[3]!.w, align: 'right' });
      doc.text(it.discountPercent, cols[4]!.x, y, { width: cols[4]!.w, align: 'right' });
      doc.text(it.discountAmount, cols[5]!.x, y, { width: cols[5]!.w, align: 'right' });
      doc.text(it.taxAmount, cols[6]!.x, y, { width: cols[6]!.w, align: 'right' });
      doc.text(it.lineTotal, cols[7]!.x, y, { width: cols[7]!.w, align: 'right' });
      y += rowH + 4;
    }

    if (y > 650) {
      doc.addPage();
      y = 40;
    }
    y += 10;
    const row = (label: string, value: string, bold = false): void => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      doc.text(label, 355, y, { width: 100, align: 'right' });
      doc.text(value, 455, y, { width: 100, align: 'right' });
      y += 14;
    };
    row('Subtotal', p.subtotal);
    row(`Purchase discount (${p.discountPercent}%)`, p.discountAmount);
    row('Tax', p.taxTotal);
    row('Grand total', p.total, true);
    row('Amount paid', inv.amountPaid);
    row('Outstanding', inv.outstanding, true);
    row('Payment status', p.paymentStatus, true);

    doc.end();
  });
