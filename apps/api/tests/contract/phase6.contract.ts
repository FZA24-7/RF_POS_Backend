/**
 * Phase 6 CONTRACT: customer credit & ledgers, supplier ledger, expenses, employees and the money reports.
 * One suite, run against the in-memory fakes (tests/unit/phase6.fake.test.ts) and against real PostgreSQL
 * (tests/integration/phase6.pg.test.ts). Only the PostgreSQL run is evidence of real transactional / SQL behaviour.
 *
 * Fixture (the harness provides it): product 1 sells at 100.00 tax 0, product 2 at 40.00 tax 10%, both cost 10.00;
 * branches `storeId` and `otherStoreId`; business time zone Asia/Karachi (UTC+5, no DST).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { addDaysToYmd, localDateString, startOfLocalDay } from '@mafk/shared';
import type { CreateSaleInput } from '@mafk/validation';
import type { Repositories } from '../../src/domain/ports.js';
import { DomainError } from '../../src/domain/types.js';
import { CustomerService } from '../../src/services/customer.service.js';
import { EmployeeService } from '../../src/services/employee.service.js';
import { ExpenseService } from '../../src/services/expense.service.js';
import { PurchaseService } from '../../src/services/purchase.service.js';
import { ReportService } from '../../src/services/report.service.js';
import { SaleService, type SaleActor } from '../../src/services/sale.service.js';
import { SupplierService } from '../../src/services/supplier.service.js';

export interface Phase6Harness {
  repos: Repositories;
  /** Has every permission this suite needs (customers.edit, employees.edit, reports.*, discount.apply ...). */
  actor: SaleActor;
  /** A cashier: may sell and create customers, but not edit them or see private employee data. */
  limitedActor: SaleActor;
  otherTenantActor: SaleActor;
  ids: { storeId: string; otherStoreId: string; productId: string; productId2: string };
  timeZone: string;
  faults: { failAuditWrite(actionPrefix: string): Promise<() => Promise<void>> };
  /** Moves a sale's sold-at instant (so day/hour buckets can be tested at exact boundaries). */
  setSoldAt(saleId: string, at: Date): Promise<void>;
  /** A real login user of the actor's tenant (for linking an employee). */
  newUserId(): Promise<string>;
  close(): Promise<void>;
}

const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    return (err as DomainError).code;
  }
  throw new Error('expected the promise to reject');
};
const num = (s: string): number => Number.parseFloat(s);

export function describePhase6Contract(
  backendName: string,
  createHarness: () => Promise<Phase6Harness>,
): void {
  describe(`phase 6 customers, expenses, employees, reports [${backendName}]`, () => {
    let h: Phase6Harness;
    let sales: SaleService;
    let customers: CustomerService;
    let expenses: ExpenseService;
    let employees: EmployeeService;
    let reports: ReportService;
    let counter = 0;

    beforeEach(async () => {
      h = await createHarness();
      sales = new SaleService(h.repos);
      customers = new CustomerService(h.repos);
      expenses = new ExpenseService(h.repos);
      employees = new EmployeeService(h.repos);
      reports = new ReportService(h.repos);
      counter = 0;
      for (const productId of [h.ids.productId, h.ids.productId2]) {
        await h.repos.inventory.applyMovement({
          tenantId: h.actor.tenantId,
          storeId: h.ids.storeId,
          productId,
          type: 'OPENING',
          quantityChange: '100',
          createdById: h.actor.id,
        });
      }
    });
    afterAll(async () => {
      await h?.close();
    });

    const key = (): string =>
      `p6-${Date.now()}-${++counter}-${Math.random().toString(36).slice(2, 8)}`;
    const sell = (over: Partial<CreateSaleInput> = {}, actor: SaleActor = h.actor) =>
      sales.createSale(actor, {
        clientRequestId: key(),
        storeId: h.ids.storeId,
        items: [{ productId: h.ids.productId, quantity: '1' }],
        payments: [{ method: 'CASH', amount: '100.00' }],
        ...over,
      });
    const newCustomer = (over: Record<string, string | undefined> = {}) =>
      customers.create(h.actor, {
        name: `Customer ${++counter}`,
        customerType: 'RETAIL',
        openingBalance: '0',
        ...over,
      });
    const stock = async (productId: string): Promise<number> =>
      num(
        (await h.repos.inventory.findByStoreAndProduct(h.ids.storeId, productId))?.quantity ?? '0',
      );

    // ─────────────────────────────── customers & credit ───────────────────────────────
    describe('customers and sales on account', () => {
      it('creates a customer with an opening balance and lists it', async () => {
        const c = await newCustomer({
          openingBalance: '75.50',
          creditLimit: '500',
          phone: '0300-1112223',
        });
        expect(c).toMatchObject({
          openingBalance: '75.50',
          creditLimit: '500.00',
          balance: '75.50',
          isActive: true,
        });
        const list = await customers.list(h.actor.tenantId, { page: 1, pageSize: 20 });
        expect(list.total).toBe(1);
        const owing = await customers.list(h.actor.tenantId, {
          page: 1,
          pageSize: 20,
          withBalanceOnly: true,
        });
        expect(owing.items.map((x) => x.id)).toEqual([c.id]);
        const found = await customers.list(h.actor.tenantId, {
          page: 1,
          pageSize: 20,
          search: '1112',
        });
        expect(found.total).toBe(1);
      });

      it('a cashier cannot grant credit or an opening balance (needs customers.edit)', async () => {
        expect(
          await code(
            customers.create(h.limitedActor, {
              name: 'Walk In',
              customerType: 'RETAIL',
              openingBalance: '0',
              creditLimit: '100',
            }),
          ),
        ).toBe('PERMISSION_DENIED');
        expect(
          await code(
            customers.create(h.limitedActor, {
              name: 'Walk In 2',
              customerType: 'RETAIL',
              openingBalance: '10',
            }),
          ),
        ).toBe('PERMISSION_DENIED');
        const ok = await customers.create(h.limitedActor, {
          name: 'Walk In 3',
          customerType: 'RETAIL',
          openingBalance: '0',
        });
        expect(ok.balance).toBe('0.00');
      });

      it('sale on account: snapshot, paid total includes credit, balance and ledger agree', async () => {
        const c = await newCustomer({ creditLimit: '500', phone: '0300-1' });
        const { sale } = await sell({
          customerId: c.id,
          items: [
            { productId: h.ids.productId, quantity: '2' },
            { productId: h.ids.productId2, quantity: '3' },
          ],
          payments: [
            { method: 'CASH', amount: '100.00' },
            { method: 'CUSTOMER_CREDIT', amount: '232.00' },
          ],
        });
        expect(sale.grandTotal).toBe('332.00');
        expect(sale.paidTotal).toBe('332.00');
        expect(sale.changeDue).toBe('0.00');
        expect(sale).toMatchObject({
          customerId: c.id,
          customerName: c.name,
          customerPhone: '0300-1',
        });
        expect((await customers.getById(c.id, h.actor.tenantId)).balance).toBe('232.00');
        const ledger = await customers.ledger(c.id, h.actor.tenantId);
        expect(ledger.entries.map((e) => e.type)).toEqual(['OPENING', 'CREDIT_SALE']);
        expect(ledger.entries[1]).toMatchObject({
          reference: sale.invoiceNo,
          increase: '232.00',
          decrease: '0.00',
          balance: '232.00',
        });
        expect(ledger.balance).toBe('232.00');
        const bySale = await sales.list(h.actor.tenantId, {
          page: 1,
          pageSize: 20,
          customerId: c.id,
        });
        expect(bySale.total).toBe(1);
      });

      it('credit limit: none, exceeded, and cumulative; failed attempts change nothing', async () => {
        const none = await newCustomer();
        expect(
          await code(
            sell({
              customerId: none.id,
              payments: [{ method: 'CUSTOMER_CREDIT', amount: '100.00' }],
            }),
          ),
        ).toBe('CREDIT_LIMIT_EXCEEDED');

        const c = await newCustomer({ creditLimit: '250' });
        const before = await stock(h.ids.productId);
        await sell({
          customerId: c.id,
          payments: [{ method: 'CUSTOMER_CREDIT', amount: '100.00' }],
        });
        await sell({
          customerId: c.id,
          payments: [{ method: 'CUSTOMER_CREDIT', amount: '100.00' }],
        });
        expect(
          await code(
            sell({ customerId: c.id, payments: [{ method: 'CUSTOMER_CREDIT', amount: '100.00' }] }),
          ),
        ).toBe('CREDIT_LIMIT_EXCEEDED');
        // exactly at the limit is allowed (a 50.00 sale after a 50.00 item discount)
        await sell({
          customerId: c.id,
          items: [{ productId: h.ids.productId, quantity: '1', discountAmount: '50.00' }],
          payments: [{ method: 'CUSTOMER_CREDIT', amount: '50.00' }],
        });
        expect((await customers.getById(c.id, h.actor.tenantId)).balance).toBe('250.00');
        expect(await stock(h.ids.productId)).toBe(before - 3);
        expect(
          (await sales.list(h.actor.tenantId, { page: 1, pageSize: 50, customerId: c.id })).total,
        ).toBe(3);
      });

      it('credit rules: needs a customer, an active one, and not more than the unpaid part of the total', async () => {
        expect(
          await code(sell({ payments: [{ method: 'CUSTOMER_CREDIT', amount: '100.00' }] })),
        ).toBe('VALIDATION_ERROR');
        const c = await newCustomer({ creditLimit: '1000' });
        // 100 total, 30 cash + 80 credit would be 110 > 100
        expect(
          await code(
            sell({
              customerId: c.id,
              payments: [
                { method: 'CASH', amount: '30' },
                { method: 'CUSTOMER_CREDIT', amount: '80' },
              ],
            }),
          ),
        ).toBe('VALIDATION_ERROR');
        await customers.update(h.actor, c.id, { isActive: false });
        expect(
          await code(
            sell({ customerId: c.id, payments: [{ method: 'CUSTOMER_CREDIT', amount: '100' }] }),
          ),
        ).toBe('VALIDATION_ERROR');
        // an inactive customer can still be named on a fully paid cash sale
        const { sale } = await sell({ customerId: c.id });
        expect(sale.customerId).toBe(c.id);
      });

      it('concurrent credit sales cannot jointly exceed the limit (customer row is locked)', async () => {
        const c = await newCustomer({ creditLimit: '400' });
        const before = await stock(h.ids.productId);
        const results = await Promise.allSettled(
          Array.from({ length: 3 }, () =>
            sell({
              customerId: c.id,
              items: [{ productId: h.ids.productId, quantity: '2' }],
              payments: [{ method: 'CUSTOMER_CREDIT', amount: '200.00' }],
            }),
          ),
        );
        const ok = results.filter((r) => r.status === 'fulfilled');
        const bad = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
        expect(ok).toHaveLength(2);
        expect(bad).toHaveLength(1);
        expect((bad[0]!.reason as DomainError).code).toBe('CREDIT_LIMIT_EXCEEDED');
        expect((await customers.getById(c.id, h.actor.tenantId)).balance).toBe('400.00');
        expect(await stock(h.ids.productId)).toBe(before - 4);
      });

      it('payments reduce the balance, cannot exceed it, and concurrent payments cannot jointly exceed it', async () => {
        const c = await newCustomer({ openingBalance: '150' });
        const r1 = await customers.recordPayment(h.actor, c.id, {
          amount: '50.00',
          method: 'CASH',
          reference: 'RCPT-1',
        });
        expect(r1.balance).toBe('100.00');
        expect(r1.payment).toMatchObject({ amount: '50.00', method: 'CASH', reference: 'RCPT-1' });
        expect(
          await code(customers.recordPayment(h.actor, c.id, { amount: '100.01', method: 'CASH' })),
        ).toBe('PAYMENT_EXCEEDS_BALANCE');

        const results = await Promise.allSettled([
          customers.recordPayment(h.actor, c.id, { amount: '70.00', method: 'CARD' }),
          customers.recordPayment(h.actor, c.id, { amount: '70.00', method: 'BANK_TRANSFER' }),
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const bad = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!;
        expect((bad.reason as DomainError).code).toBe('PAYMENT_EXCEEDS_BALANCE');
        expect((await customers.getById(c.id, h.actor.tenantId)).balance).toBe('30.00');
        const ledger = await customers.ledger(c.id, h.actor.tenantId);
        expect(ledger.entries.filter((e) => e.type === 'CUSTOMER_PAYMENT')).toHaveLength(2);
        expect(ledger.balance).toBe('30.00');
        const out = await reports.receivables(h.actor.tenantId);
        expect(out.rows).toEqual([expect.objectContaining({ id: c.id, balance: '30.00' })]);
        expect(out.total).toBe('30.00');
      });

      it('refund to the customer account lowers the balance; needs a sale with a customer', async () => {
        const c = await newCustomer({ creditLimit: '1000' });
        const { sale } = await sell({
          customerId: c.id,
          items: [{ productId: h.ids.productId, quantity: '2' }],
          payments: [{ method: 'CUSTOMER_CREDIT', amount: '200.00' }],
        });
        const ret = await sales.refund(h.actor, sale.id, {
          refundMethod: 'CUSTOMER_CREDIT',
          items: [{ saleItemId: sale.items[0]!.id, quantity: '1' }],
        });
        expect(ret.refundTotal).toBe('100.00');
        expect((await customers.getById(c.id, h.actor.tenantId)).balance).toBe('100.00');
        const ledger = await customers.ledger(c.id, h.actor.tenantId);
        expect(ledger.entries.map((e) => e.type)).toEqual([
          'OPENING',
          'CREDIT_SALE',
          'CREDIT_REFUND',
        ]);

        const { sale: walkIn } = await sell();
        expect(
          await code(
            sales.refund(h.actor, walkIn.id, {
              refundMethod: 'CUSTOMER_CREDIT',
              items: [{ saleItemId: walkIn.items[0]!.id, quantity: '1' }],
            }),
          ),
        ).toBe('VALIDATION_ERROR');
        expect(
          num((await sales.getById(walkIn.id, h.actor.tenantId)).items[0]!.returnedQuantity),
        ).toBe(0);
      });

      it('an audit failure rolls the payment back completely', async () => {
        const c = await newCustomer({ openingBalance: '100' });
        const restore = await h.faults.failAuditWrite('CUSTOMER_PAYMENT');
        await expect(
          customers.recordPayment(h.actor, c.id, { amount: '40', method: 'CASH' }),
        ).rejects.toThrow();
        await restore();
        expect((await customers.getById(c.id, h.actor.tenantId)).balance).toBe('100.00');
        expect((await customers.ledger(c.id, h.actor.tenantId)).entries).toHaveLength(1);
        const audits = await h.repos.auditLogs.listByTenant(h.actor.tenantId, 500);
        expect(audits.filter((a) => a.action === 'CUSTOMER_PAYMENT_RECEIVED')).toHaveLength(0);
      });

      it('tenant isolation: another business cannot see, pay or sell to this customer', async () => {
        const c = await newCustomer({ creditLimit: '500', openingBalance: '20' });
        expect(await h.repos.customers.findById(c.id, h.otherTenantActor.tenantId)).toBeNull();
        expect(await code(customers.getById(c.id, h.otherTenantActor.tenantId))).toBe('NOT_FOUND');
        expect(
          await code(
            customers.recordPayment(h.otherTenantActor, c.id, { amount: '5', method: 'CASH' }),
          ),
        ).toBe('NOT_FOUND');
        expect(await code(customers.update(h.otherTenantActor, c.id, { name: 'Hijack' }))).toBe(
          'NOT_FOUND',
        );
        expect(await code(customers.ledger(c.id, h.otherTenantActor.tenantId))).toBe('NOT_FOUND');
        expect(
          (await customers.list(h.otherTenantActor.tenantId, { page: 1, pageSize: 20 })).total,
        ).toBe(0);
        expect((await reports.receivables(h.otherTenantActor.tenantId)).rows).toHaveLength(0);
      });
    });

    // ─────────────────────────────── supplier ledger ───────────────────────────────
    describe('supplier ledger', () => {
      it('opening balance + purchases - payments, with payables report', async () => {
        const suppliers = new SupplierService(h.repos);
        const purchases = new PurchaseService(h.repos);
        const supplier = await suppliers.create(h.actor, {
          name: `Sup ${counter}`,
          openingBalance: '100',
        });
        expect(supplier.openingBalance).toBe('100.00');
        const purchase = await purchases.recordPurchase(h.actor, {
          supplierId: supplier.id,
          storeId: h.ids.storeId,
          invoiceNo: 'SUP-1',
          purchaseDate: new Date('2026-01-15'),
          items: [{ productId: h.ids.productId, quantity: '10', costPrice: '50', taxRate: '0' }],
          initialPayment: { amount: '200', method: 'CASH' },
        });
        await purchases.recordPayment(h.actor, purchase.id, {
          amount: '100',
          method: 'BANK_TRANSFER',
        });
        const ledger = await suppliers.ledger(supplier.id, h.actor.tenantId);
        expect(ledger.openingBalance).toBe('100.00');
        expect(ledger.entries[0]).toMatchObject({ type: 'OPENING', balance: '100.00' });
        expect(ledger.entries[1]).toMatchObject({
          type: 'PURCHASE',
          increase: '500.00',
          balance: '600.00',
        });
        expect(ledger.entries.filter((e) => e.type === 'SUPPLIER_PAYMENT')).toHaveLength(2);
        expect(ledger.balance).toBe('300.00');
        const payables = await reports.payables(h.actor.tenantId);
        expect(payables.rows).toEqual([
          expect.objectContaining({ id: supplier.id, balance: '300.00' }),
        ]);
        expect(payables.total).toBe('300.00');
        // another business sees nothing
        expect(await code(suppliers.ledger(supplier.id, h.otherTenantActor.tenantId))).toBe(
          'NOT_FOUND',
        );
        expect((await reports.payables(h.otherTenantActor.tenantId)).rows).toHaveLength(0);
      });
    });

    // ─────────────────────────────── expenses ───────────────────────────────
    describe('expenses', () => {
      const today = (): string => localDateString(new Date(), h.timeZone);
      const exp = (over: Record<string, string> = {}) =>
        expenses.create(h.actor, {
          storeId: h.ids.storeId,
          category: 'Rent',
          amount: '50.00',
          expenseDate: today(),
          method: 'CASH',
          ...over,
        } as Parameters<ExpenseService['create']>[1]);

      it('create, read, filter, total over all pages, update and delete', async () => {
        const d0 = addDaysToYmd(today(), -10);
        const e1 = await exp({ expenseDate: d0, amount: '50.00' });
        const e2 = await exp({
          expenseDate: addDaysToYmd(d0, 1),
          amount: '20.25',
          category: 'Tea',
        });
        await exp({
          expenseDate: addDaysToYmd(d0, 2),
          amount: '30.00',
          storeId: h.ids.otherStoreId,
        });
        expect(e1.expenseDay).toBe(d0);
        const all = await expenses.list(h.actor.tenantId, { page: 1, pageSize: 2 });
        expect(all).toMatchObject({ total: 3, totalAmount: '100.25' });
        expect(all.items).toHaveLength(2);
        expect(all.items[0]!.expenseDay).toBe(addDaysToYmd(d0, 2)); // newest first
        const filtered = await expenses.list(h.actor.tenantId, {
          page: 1,
          pageSize: 20,
          from: d0,
          to: addDaysToYmd(d0, 1),
        });
        expect(filtered).toMatchObject({ total: 2, totalAmount: '70.25' });
        expect(
          (await expenses.list(h.actor.tenantId, { page: 1, pageSize: 20, category: 'Tea' }))
            .totalAmount,
        ).toBe('20.25');
        expect(
          (
            await expenses.list(h.actor.tenantId, {
              page: 1,
              pageSize: 20,
              storeId: h.ids.otherStoreId,
            })
          ).total,
        ).toBe(1);

        const up = await expenses.update(h.actor, e2.id, {
          amount: '25.00',
          description: 'Tea & milk',
        });
        expect(up).toMatchObject({ amount: '25.00', description: 'Tea & milk', category: 'Tea' });
        await expenses.delete(h.actor, e1.id);
        expect(await code(expenses.getById(e1.id, h.actor.tenantId))).toBe('NOT_FOUND');
        expect((await expenses.list(h.actor.tenantId, { page: 1, pageSize: 20 })).totalAmount).toBe(
          '55.00',
        );
        const audits = (await h.repos.auditLogs.listByTenant(h.actor.tenantId, 500)).map(
          (a) => a.action,
        );
        expect(audits).toEqual(
          expect.arrayContaining(['EXPENSE_CREATED', 'EXPENSE_UPDATED', 'EXPENSE_DELETED']),
        );
      });

      it('rejects an unknown branch; an audit failure writes nothing; other tenants are isolated', async () => {
        expect(await code(exp({ storeId: 'nope' }))).toBe('VALIDATION_ERROR');
        const restore = await h.faults.failAuditWrite('EXPENSE_');
        await expect(exp()).rejects.toThrow();
        await restore();
        expect((await expenses.list(h.actor.tenantId, { page: 1, pageSize: 20 })).total).toBe(0);

        const e = await exp();
        const failDelete = await h.faults.failAuditWrite('EXPENSE_');
        await expect(expenses.delete(h.actor, e.id)).rejects.toThrow();
        await failDelete();
        expect((await expenses.getById(e.id, h.actor.tenantId)).id).toBe(e.id);

        expect(await code(expenses.getById(e.id, h.otherTenantActor.tenantId))).toBe('NOT_FOUND');
        expect(await code(expenses.update(h.otherTenantActor, e.id, { amount: '1' }))).toBe(
          'NOT_FOUND',
        );
        expect(await code(expenses.delete(h.otherTenantActor, e.id))).toBe('NOT_FOUND');
        expect(
          (await expenses.list(h.otherTenantActor.tenantId, { page: 1, pageSize: 20 })).total,
        ).toBe(0);
      });
    });

    // ─────────────────────────────── employees ───────────────────────────────
    describe('employees', () => {
      it('creates and edits; salary and national ID are only visible with employees.edit', async () => {
        const e = await employees.create(h.actor, {
          fullName: 'Ayesha Khan',
          designation: 'Cashier',
          nationalId: '35202-1234567-1',
          hireDate: '2026-01-05',
          salary: '45000',
          storeId: h.ids.storeId,
        });
        expect(e).toMatchObject({
          status: 'ACTIVE',
          salary: '45000.00',
          nationalId: '35202-1234567-1',
          hireDate: '2026-01-05',
        });
        const seen = await employees.getById(h.limitedActor, e.id);
        expect(seen).toMatchObject({
          fullName: 'Ayesha Khan',
          salary: null,
          nationalId: null,
          hireDate: '2026-01-05',
        });
        const list = await employees.list(h.limitedActor, { page: 1, pageSize: 20 });
        expect(list.items[0]).toMatchObject({ salary: null, nationalId: null });
        const up = await employees.update(h.actor, e.id, {
          status: 'INACTIVE',
          salary: '50000.50',
          hireDate: null,
        });
        expect(up).toMatchObject({ status: 'INACTIVE', salary: '50000.50', hireDate: null });
        expect(
          (await employees.list(h.actor, { page: 1, pageSize: 20, status: 'ACTIVE' })).total,
        ).toBe(0);
        expect(
          (await employees.list(h.actor, { page: 1, pageSize: 20, search: 'ayesha' })).total,
        ).toBe(1);
      });

      it('one login per employee; invalid branch/user rejected; other tenants isolated', async () => {
        const userId = await h.newUserId();
        const e = await employees.create(h.actor, { fullName: 'Bilal Ahmed', userId });
        expect(e.userId).toBe(userId);
        expect(await code(employees.create(h.actor, { fullName: 'Bilal Twin', userId }))).toBe(
          'CONFLICT',
        );
        expect(await code(employees.create(h.actor, { fullName: 'Nobody', storeId: 'nope' }))).toBe(
          'VALIDATION_ERROR',
        );
        expect(await code(employees.create(h.actor, { fullName: 'Ghost', userId: 'nope' }))).toBe(
          'VALIDATION_ERROR',
        );
        const other = await employees.create(h.actor, { fullName: 'Chand Ali' });
        expect(await code(employees.update(h.actor, other.id, { userId }))).toBe('CONFLICT');
        expect((await employees.list(h.actor, { page: 1, pageSize: 20 })).total).toBe(2);

        expect(await code(employees.getById(h.otherTenantActor, e.id))).toBe('NOT_FOUND');
        expect(await code(employees.update(h.otherTenantActor, e.id, { fullName: 'Hijack' }))).toBe(
          'NOT_FOUND',
        );
        expect((await employees.list(h.otherTenantActor, { page: 1, pageSize: 20 })).total).toBe(0);
      });

      it('an audit failure rolls the employee back', async () => {
        const restore = await h.faults.failAuditWrite('EMPLOYEE_');
        await expect(employees.create(h.actor, { fullName: 'Rolled Back' })).rejects.toThrow();
        await restore();
        expect((await employees.list(h.actor, { page: 1, pageSize: 20 })).total).toBe(0);
      });
    });

    // ─────────────────────────────── reports ───────────────────────────────
    describe('reports', () => {
      /**
       * Day X is 30 days ago (business time). Sales are moved to exact boundaries:
       *   D  X 00:00:00 - 1s  (outside)      A  X 00:00:00 (first instant of the range)   B  X 10:15
       *   C  X+1 13:00                        E  X+2 00:00:00 (first instant AFTER the range [X .. X+1])
       */
      let X: string;
      let ids: { A: string; B: string; C: string; D: string; E: string; saleBItem: string };
      const at = (day: string, ms = 0): Date =>
        new Date(startOfLocalDay(day, h.timeZone).getTime() + ms);
      const H = 3_600_000;
      const range = () => ({ from: X, to: addDaysToYmd(X, 1), format: 'json' as const, limit: 10 });

      beforeEach(async () => {
        X = addDaysToYmd(localDateString(new Date(), h.timeZone), -30);
        const A = await sell({
          items: [
            { productId: h.ids.productId, quantity: '2' },
            { productId: h.ids.productId2, quantity: '3' },
          ],
          payments: [{ method: 'CASH', amount: '340.00' }],
        });
        const B = await sell({ payments: [{ method: 'CARD', amount: '100.00' }] });
        const C = await sell({
          items: [{ productId: h.ids.productId2, quantity: '5' }],
          discountAmount: '10.00',
          payments: [{ method: 'BANK_TRANSFER', amount: '209.00' }],
        });
        const D = await sell();
        const E = await sell();
        expect(A.sale.grandTotal).toBe('332.00');
        expect(C.sale.grandTotal).toBe('209.00');
        await h.setSoldAt(A.sale.id, at(X));
        await h.setSoldAt(B.sale.id, at(X, 10 * H + 15 * 60_000));
        await h.setSoldAt(C.sale.id, at(addDaysToYmd(X, 1), 13 * H));
        await h.setSoldAt(D.sale.id, at(X, -1000));
        await h.setSoldAt(E.sale.id, at(addDaysToYmd(X, 2)));
        ids = {
          A: A.sale.id,
          B: B.sale.id,
          C: C.sale.id,
          D: D.sale.id,
          E: E.sale.id,
          saleBItem: B.sale.items[0]!.id,
        };
      });

      it('sales summary: exact totals, inclusive start / exclusive end, payments net of change', async () => {
        const { data: s, meta } = await reports.salesSummary(h.actor.tenantId, range());
        expect(meta).toMatchObject({ from: X, timeZone: h.timeZone, storeId: null });
        expect(s).toMatchObject({
          saleCount: 3,
          grossSales: '620.00',
          itemDiscounts: '0.00',
          cartDiscounts: '10.00',
          tax: '31.00',
          netSales: '641.00',
          refundCount: 0,
          refunds: '0.00',
          netAfterRefunds: '641.00',
          averageSale: '213.67',
        });
        expect(s.paymentsByMethod).toEqual([
          { method: 'CASH', amount: '332.00' },
          { method: 'CARD', amount: '100.00' },
          { method: 'BANK_TRANSFER', amount: '209.00' },
        ]);
        expect(s.refundsByMethod).toEqual([]);
      });

      it('daily and hourly buckets follow the business time zone', async () => {
        const daily = (await reports.daily(h.actor.tenantId, range())).data;
        expect(daily).toEqual([
          { date: X, saleCount: 2, netSales: '432.00' },
          { date: addDaysToYmd(X, 1), saleCount: 1, netSales: '209.00' },
        ]);
        const hourly = (await reports.hourly(h.actor.tenantId, range())).data;
        expect(hourly).toEqual([
          { hour: 0, saleCount: 1, netSales: '332.00' },
          { hour: 10, saleCount: 1, netSales: '100.00' },
          { hour: 13, saleCount: 1, netSales: '209.00' },
        ]);
        // widening the range pulls in the boundary sales
        const wide = (
          await reports.daily(h.actor.tenantId, {
            ...range(),
            from: addDaysToYmd(X, -1),
            to: addDaysToYmd(X, 2),
          })
        ).data;
        expect(wide.map((d) => d.date)).toEqual([
          addDaysToYmd(X, -1),
          X,
          addDaysToYmd(X, 1),
          addDaysToYmd(X, 2),
        ]);
      });

      it('top products, by category and by cashier', async () => {
        const top = (await reports.topProducts(h.actor.tenantId, range())).data;
        expect(top.map((p) => [p.sku, p.quantitySold, p.quantityReturned, p.revenue])).toEqual([
          [expect.stringContaining('P2'), '8.000', '0.000', '341.00'],
          [expect.stringContaining('P1'), '3.000', '0.000', '300.00'],
        ]);
        expect(
          (await reports.topProducts(h.actor.tenantId, { ...range(), limit: 1 })).data,
        ).toHaveLength(1);
        const cat = (await reports.byCategory(h.actor.tenantId, range())).data;
        expect(cat).toEqual([
          expect.objectContaining({ quantitySold: '11.000', revenue: '641.00' }),
        ]);
        const cashier = (await reports.byCashier(h.actor.tenantId, range())).data;
        expect(cashier).toEqual([
          expect.objectContaining({ cashierId: h.actor.id, saleCount: 3, netSales: '641.00' }),
        ]);
      });

      it('profit & loss: revenue ex tax, cost of goods and expenses in range', async () => {
        const mk = (day: string, amount: string, category: string) =>
          expenses.create(h.actor, {
            storeId: h.ids.storeId,
            category,
            amount,
            expenseDate: day,
            method: 'CASH',
          });
        await mk(X, '50.00', 'Rent');
        await mk(addDaysToYmd(X, 1), '20.00', 'Rent');
        await mk(addDaysToYmd(X, 2), '30.00', 'Tea'); // outside the range
        const { data: p } = await reports.profitLoss(h.actor.tenantId, range());
        expect(p).toEqual({
          revenue: '610.00',
          costOfGoods: '110.00',
          grossProfit: '500.00',
          expenses: '70.00',
          netProfit: '430.00',
          expensesByCategory: [{ category: 'Rent', amount: '70.00' }],
        });
      });

      it('refunds: counted when processed, and removed from profit by the refunded units', async () => {
        await sales.refund(h.actor, ids.B, {
          refundMethod: 'CASH',
          items: [{ saleItemId: ids.saleBItem, quantity: '1' }],
        });
        // The refund happened today, not in the 30-days-ago range:
        expect((await reports.salesSummary(h.actor.tenantId, range())).data).toMatchObject({
          refundCount: 0,
          netSales: '641.00',
        });
        const today = localDateString(new Date(), h.timeZone);
        const now = {
          from: addDaysToYmd(today, -1),
          to: addDaysToYmd(today, 1),
          format: 'json' as const,
          limit: 10,
        };
        // today's range holds no sales (all moved), but holds the refund
        expect((await reports.salesSummary(h.actor.tenantId, now)).data).toMatchObject({
          saleCount: 0,
          refundCount: 1,
          refunds: '100.00',
          netAfterRefunds: '-100.00',
          refundsByMethod: [{ method: 'CASH', amount: '100.00' }],
        });
        const { data: p } = await reports.profitLoss(h.actor.tenantId, range());
        expect(p).toMatchObject({
          revenue: '510.00',
          costOfGoods: '100.00',
          grossProfit: '410.00',
        });
        const top = (await reports.topProducts(h.actor.tenantId, range())).data;
        expect(top.find((x) => x.sku.includes('P1'))).toMatchObject({
          quantitySold: '3.000',
          quantityReturned: '1.000',
        });
      });

      it('store filter, tenant isolation and range validation', async () => {
        expect(
          (await reports.salesSummary(h.actor.tenantId, { ...range(), storeId: h.ids.storeId }))
            .data.saleCount,
        ).toBe(3);
        expect(
          (
            await reports.salesSummary(h.actor.tenantId, {
              ...range(),
              storeId: h.ids.otherStoreId,
            })
          ).data.saleCount,
        ).toBe(0);
        expect(
          await code(reports.salesSummary(h.actor.tenantId, { ...range(), storeId: 'nope' })),
        ).toBe('VALIDATION_ERROR');
        const other = h.otherTenantActor.tenantId;
        expect((await reports.salesSummary(other, range())).data.saleCount).toBe(0);
        expect((await reports.topProducts(other, range())).data).toEqual([]);
        expect((await reports.profitLoss(other, range())).data).toMatchObject({
          revenue: '0.00',
          costOfGoods: '0.00',
          expenses: '0.00',
        });
        expect((await reports.stockValuation(other)).data.rows).toEqual([]);
      });

      it('stock valuation: quantity x cost and x selling price, per branch', async () => {
        const { data } = await reports.stockValuation(h.actor.tenantId);
        // P1 100 - 5 sold = 95, P2 100 - 8 = 92 (A 2/3, B 1, C 0/5, D 1, E 1). The harness may hold other stock too.
        const mine = data.rows.filter((r) => /^P[12]/.test(r.productName));
        expect(
          mine.map((r) => [
            r.productName,
            num(r.quantity),
            r.costPrice,
            r.costValue,
            r.retailValue,
          ]),
        ).toEqual([
          ['P1', 95, '10.0000', '950.00', '9500.00'],
          ['P2', 92, '10.0000', '920.00', '3680.00'],
        ]);
        const cents = (x: string): bigint => BigInt(x.replace('.', ''));
        expect(cents(data.totalCostValue)).toBe(
          data.rows.reduce((a, r) => a + cents(r.costValue), 0n),
        );
        expect(cents(data.totalRetailValue)).toBe(
          data.rows.reduce((a, r) => a + cents(r.retailValue), 0n),
        );
        expect(
          (await reports.stockValuation(h.actor.tenantId, h.ids.otherStoreId)).data.rows,
        ).toEqual([]);
      });

      it('analytics overview compares with the previous period and lists trend, hours, best sellers', async () => {
        const o = await reports.overview(h.actor.tenantId, range());
        expect(o.summary.netSales).toBe('641.00');
        expect(o.previous).toMatchObject({ from: addDaysToYmd(X, -2), to: addDaysToYmd(X, -1) });
        expect(o.previous.summary.netSales).toBe('100.00'); // sale D
        expect(o.netSalesChangePercent).toBe('541.0');
        expect(o.daily).toHaveLength(2);
        expect(o.hourly).toHaveLength(3);
        expect(o.topProducts[0]!.revenue).toBe('341.00');
        // previous period with no sales -> no percentage
        const none = await reports.overview(h.actor.tenantId, {
          ...range(),
          from: addDaysToYmd(X, 40),
          to: addDaysToYmd(X, 41),
        });
        expect(none.netSalesChangePercent).toBeNull();
      });

      it('CSV export of a report is well-formed and neutralises formula cells', async () => {
        await newCustomer({ name: '=SUM(1+1)', openingBalance: '10' });
        const file = await reports.csv(h.actor.tenantId, 'sales-summary', range());
        expect(file.filename).toBe(`sales-summary_${X}_${addDaysToYmd(X, 1)}.csv`);
        expect(file.content.split('\r\n')[0]).toBe('Metric,Value');
        expect(file.content).toContain('Net sales,641.00');
        const recv = await reports.csv(h.actor.tenantId, 'receivables', range());
        expect(recv.content).toContain("'=SUM(1+1),,10.00");
        expect(recv.content).not.toMatch(/^=/m);
      });
    });
  });
}
