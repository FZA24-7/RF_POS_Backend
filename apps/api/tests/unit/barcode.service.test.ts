import { describe, expect, it } from 'vitest';
import { BarcodeService } from '../../src/services/barcode.service.js';
import { buildScenario } from '../fakes/scenario.js';

describe('BarcodeService.lookup', () => {
  it('finds the correct product for a known barcode', async () => {
    const scenario = await buildScenario();
    const svc = new BarcodeService(scenario.repos);
    const product = await svc.lookup(scenario.tenantA.id, scenario.catalog.productBarcode);
    expect(product.id).toBe(scenario.catalog.productId);
  });

  it('returns NOT_FOUND for an unknown barcode, safely', async () => {
    const scenario = await buildScenario();
    const svc = new BarcodeService(scenario.repos);
    await expect(svc.lookup(scenario.tenantA.id, '0000000000000')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('rejects lookup for an inactive product', async () => {
    const scenario = await buildScenario();
    await scenario.repos.products.updateStatus(
      scenario.catalog.productId,
      scenario.tenantA.id,
      'INACTIVE',
    );
    const svc = new BarcodeService(scenario.repos);
    await expect(
      svc.lookup(scenario.tenantA.id, scenario.catalog.productBarcode),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('never crosses tenant boundaries - Tenant B cannot look up Tenant A barcode', async () => {
    const scenario = await buildScenario();
    const svc = new BarcodeService(scenario.repos);
    await expect(
      svc.lookup(scenario.tenantB.id, scenario.catalog.productBarcode),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
