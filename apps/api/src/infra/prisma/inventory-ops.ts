// DATABASE STATUS (Phase 5): applyMovementInTx is exercised through the real-PostgreSQL purchase and sale tests: stock
// increase (PURCHASE, SALE_RETURN), decrease (SALE), the negative-stock InsufficientStockError rollback, and 5 concurrent
// sales never overselling.
import { compareDecimalStrings, subtractDecimalStrings } from '@mafk/shared';
import type { Prisma } from '@mafk/database';
import {
  InsufficientStockError,
  type ApplyMovementInput,
  type ApplyMovementResult,
  type InventoryMovementRecord,
} from '../../domain/types.js';

const STOCK_DECREASING_TYPES = new Set(['ADJUSTMENT', 'SALE', 'TRANSFER_OUT']);

/**
 * Concurrency: the quantity change is a single atomic `SET quantity = quantity + n`
 * (via `upsert` + `increment`), NOT read-modify-write. Two concurrent purchases of
 * the same product therefore both apply, instead of the second overwriting the first
 * with a stale total. For decreasing movement types the new balance is checked after
 * the atomic update and, if negative, an error is thrown so the surrounding
 * transaction rolls the decrement back.
 */
export const applyMovementInTx = async (
  tx: Prisma.TransactionClient,
  input: ApplyMovementInput,
): Promise<ApplyMovementResult> => {
  const inventory = await tx.inventory.upsert({
    where: { storeId_productId: { storeId: input.storeId, productId: input.productId } },
    create: {
      tenantId: input.tenantId,
      storeId: input.storeId,
      productId: input.productId,
      quantity: input.quantityChange,
    },
    update: { quantity: { increment: input.quantityChange } },
  });
  const newQuantity = inventory.quantity.toString();

  if (STOCK_DECREASING_TYPES.has(input.type) && compareDecimalStrings(newQuantity, '0', 3) < 0) {
    const previous = subtractDecimalStrings(newQuantity, input.quantityChange, 3);
    throw new InsufficientStockError(
      `Cannot reduce stock below zero (current: ${previous}, change: ${input.quantityChange}).`,
    );
  }

  const movement = await tx.inventoryMovement.create({
    data: {
      tenantId: input.tenantId,
      storeId: input.storeId,
      productId: input.productId,
      type: input.type,
      quantityChange: input.quantityChange,
      balanceAfter: newQuantity,
      unitCost: input.unitCost ?? null,
      reason: input.reason ?? null,
      createdById: input.createdById,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
    },
  });

  return {
    inventory: {
      id: inventory.id,
      tenantId: inventory.tenantId,
      storeId: inventory.storeId,
      productId: inventory.productId,
      quantity: inventory.quantity.toString(),
      updatedAt: inventory.updatedAt,
    },
    movement: {
      id: movement.id,
      tenantId: movement.tenantId,
      storeId: movement.storeId,
      productId: movement.productId,
      type: movement.type as InventoryMovementRecord['type'],
      quantityChange: movement.quantityChange.toString(),
      balanceAfter: movement.balanceAfter.toString(),
      reason: movement.reason,
      createdById: movement.createdById,
      createdAt: movement.createdAt,
    },
  };
};
