import type { Repositories } from '../domain/ports.js';
import { DomainError, type ProductSummary } from '../domain/types.js';

/**
 * Deliberately the ONLY place that turns a scanned/typed barcode string into
 * a product. A USB keyboard-emulation scanner just "types" the code into
 * whatever has focus and sends Enter - there is no SDK, no device object, no
 * hardware dependency anywhere in this service. POS (Phase 5) calls this
 * exact method; it never needs to know whether the code came from a scanner
 * or manual entry, so a future hardware integration (a different scanner
 * class, a camera-based scanner, etc.) only ever needs to produce a string
 * and call `lookup` - no POS logic changes.
 */
export class BarcodeService {
  constructor(private readonly repos: Repositories) {}

  async lookup(tenantId: string, code: string): Promise<ProductSummary> {
    const productId = await this.repos.barcodes.findProductIdByCode(tenantId, code);
    if (!productId) {
      throw new DomainError('NOT_FOUND', `No product found for barcode "${code}".`, 404);
    }
    const product = await this.repos.products.findById(productId, tenantId);
    if (!product) {
      // Data integrity edge case (barcode row survived a deleted product) - treat as not found rather than 500.
      throw new DomainError('NOT_FOUND', `No product found for barcode "${code}".`, 404);
    }
    if (product.status !== 'ACTIVE') {
      throw new DomainError(
        'CONFLICT',
        `Product "${product.name}" is inactive and cannot be sold.`,
        409,
      );
    }
    return product;
  }
}
