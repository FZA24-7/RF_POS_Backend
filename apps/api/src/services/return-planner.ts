import {
  addDecimalStrings,
  compareDecimalStrings,
  lineRefundAmount,
  SaleMathError,
  unitRefundAmount,
} from '@mafk/shared';
import {
  InvalidSaleRelationshipError,
  ReturnNotAllowedError,
  type SaleItemRecord,
  type SaleReturnDetail,
  type SaleStatus,
} from '../domain/types.js';

export interface PlannedReturnLine {
  item: SaleItemRecord;
  quantity: string;
  lineRefund: string;
  unitRefund: string;
}

export interface ReturnPlan {
  lines: PlannedReturnLine[];
  refundTotal: string;
  /** True when, after this return, every unit of every line has been returned. */
  fullyReturned: boolean;
}

/**
 * Pure refund planning shared by the Prisma repository and the in-memory fake, so both apply the same rules.
 * Run it on rows read INSIDE the write transaction: that is what makes the over-return check race-free
 * (the repository additionally guards `returnedQuantity` with an optimistic update).
 */
export const planReturn = (
  sale: { status: SaleStatus; items: SaleItemRecord[]; returns: Pick<SaleReturnDetail, 'items'>[] },
  requested: { saleItemId: string; quantity: string }[],
): ReturnPlan => {
  if (sale.status !== 'COMPLETED' && sale.status !== 'PARTIALLY_REFUNDED') {
    throw new ReturnNotAllowedError(
      `A ${sale.status.toLowerCase().replace('_', ' ')} sale cannot be refunded.`,
    );
  }
  const lines: PlannedReturnLine[] = [];
  let refundTotal = '0.00';
  for (const req of requested) {
    const item = sale.items.find((i) => i.id === req.saleItemId);
    if (!item) throw new InvalidSaleRelationshipError('Item does not belong to this sale.');
    const alreadyRefunded = sale.returns
      .flatMap((r) => r.items)
      .filter((ri) => ri.saleItemId === item.id)
      .reduce((acc, ri) => addDecimalStrings(acc, ri.lineTotal, 2), '0.00');
    let lineRefund: string;
    try {
      lineRefund = lineRefundAmount({
        lineTotal: item.lineTotal,
        quantity: item.quantity,
        returnQty: req.quantity,
        alreadyReturnedQty: item.returnedQuantity,
        alreadyRefunded,
      });
    } catch (err) {
      if (err instanceof SaleMathError) {
        throw new ReturnNotAllowedError(`${item.productName}: ${err.message}`);
      }
      throw err;
    }
    lines.push({
      item,
      quantity: req.quantity,
      lineRefund,
      unitRefund: unitRefundAmount(lineRefund, req.quantity),
    });
    refundTotal = addDecimalStrings(refundTotal, lineRefund, 2);
  }
  const fullyReturned = sale.items.every((item) => {
    const extra = lines.find((l) => l.item.id === item.id)?.quantity ?? '0';
    const returned = addDecimalStrings(item.returnedQuantity, extra, 3);
    return compareDecimalStrings(returned, item.quantity, 3) === 0;
  });
  return { lines, refundTotal, fullyReturned };
};
