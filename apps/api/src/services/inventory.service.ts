import type { AdjustStockInput, InventoryListQuery, OpeningStockInput } from '@mafk/validation';
import type { Repositories } from '../domain/ports.js';
import {
  DomainError,
  InsufficientStockError,
  type ApplyMovementResult,
  type InventoryListResult,
  type InventoryMovementRecord,
  type StockLevel,
} from '../domain/types.js';
import type { Actor } from './category.service.js';

export class InventoryService {
  constructor(private readonly repos: Repositories) {}

  async list(tenantId: string, query: InventoryListQuery): Promise<InventoryListResult> {
    return this.repos.inventory.list(tenantId, {
      storeId: query.storeId,
      search: query.search,
      stockStatus: query.stockStatus,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  /** Every count here is a real repository read - no fabricated alert numbers. */
  async listLowStock(tenantId: string, storeId?: string): Promise<StockLevel[]> {
    return this.repos.inventory.listLowStock(tenantId, storeId);
  }

  async listMovements(
    tenantId: string,
    productId: string,
    limit = 50,
  ): Promise<InventoryMovementRecord[]> {
    const product = await this.repos.products.findById(productId, tenantId);
    if (!product) throw new DomainError('NOT_FOUND', 'Product not found.', 404);
    return this.repos.inventory.listMovements(tenantId, productId, limit);
  }

  private async ensureBelongsToTenant(
    storeId: string,
    productId: string,
    tenantId: string,
  ): Promise<void> {
    const store = (await this.repos.stores.listByTenant(tenantId)).find((s) => s.id === storeId);
    if (!store) throw new DomainError('NOT_FOUND', 'Branch not found.', 404);
    const productExists = await this.repos.products.findById(productId, tenantId);
    if (!productExists) throw new DomainError('NOT_FOUND', 'Product not found.', 404);
  }

  /** Records the initial quantity for a product at a branch. Does not require `stock.adjust` - setup only. */
  async setOpeningStock(actor: Actor, input: OpeningStockInput): Promise<ApplyMovementResult> {
    await this.ensureBelongsToTenant(input.storeId, input.productId, actor.tenantId);
    const result = await this.repos.inventory.applyMovement({
      tenantId: actor.tenantId,
      storeId: input.storeId,
      productId: input.productId,
      type: 'OPENING',
      quantityChange: input.quantity,
      createdById: actor.id,
    });
    await this.repos.auditLogs.record({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'INVENTORY_OPENING_STOCK_SET',
      entity: 'Inventory',
      entityId: input.productId,
      metadata: { storeId: input.storeId, quantity: input.quantity },
    });
    return result;
  }

  /**
   * The ONLY path for a manual stock correction. Requires the `stock.adjust`
   * permission (enforced by the route middleware, not here - see
   * `docs/API.md`), and every call produces exactly one InventoryMovement -
   * there is no other code path that mutates an Inventory row's quantity.
   */
  async adjustStock(actor: Actor, input: AdjustStockInput): Promise<ApplyMovementResult> {
    await this.ensureBelongsToTenant(input.storeId, input.productId, actor.tenantId);

    let result: ApplyMovementResult;
    try {
      result = await this.repos.inventory.applyMovement({
        tenantId: actor.tenantId,
        storeId: input.storeId,
        productId: input.productId,
        type: 'ADJUSTMENT',
        quantityChange: input.quantityChange,
        reason: input.reason,
        createdById: actor.id,
      });
    } catch (err) {
      if (err instanceof InsufficientStockError) {
        throw new DomainError('CONFLICT', err.message, 409);
      }
      throw err;
    }

    await this.repos.auditLogs.record({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'INVENTORY_ADJUSTED',
      entity: 'Inventory',
      entityId: input.productId,
      metadata: {
        storeId: input.storeId,
        quantityChange: input.quantityChange,
        reason: input.reason,
        resultingQuantity: result.inventory.quantity,
      },
    });
    return result;
  }
}
