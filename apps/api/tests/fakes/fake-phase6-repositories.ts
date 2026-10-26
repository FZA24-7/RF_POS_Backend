import { randomUUID } from 'node:crypto';
import {
  addDecimalStrings,
  compareDecimalStrings,
  localDateString,
  roundDecimalString,
  subtractDecimalStrings,
} from '@mafk/shared';
import type {
  CustomerRepository,
  EmployeeRepository,
  ExpenseRepository,
  ReportRepository,
} from '../../src/domain/ports.js';
import {
  CustomerNotFoundError,
  CustomerOverpaymentError,
  EmployeeUserConflictError,
  type CashMethod,
  type CashierPerformance,
  type CategoryPerformance,
  type CreateCustomerRecord,
  type CreateEmployeeRecord,
  type CreateExpenseRecord,
  type CustomerListFilter,
  type CustomerListResult,
  type CustomerPaymentRecord,
  type CustomerSummary,
  type CustomerWithBalance,
  type DailyPoint,
  type EmployeeListFilter,
  type EmployeeListResult,
  type EmployeeRecord,
  type ExpenseListFilter,
  type ExpenseListResult,
  type ExpenseRecord,
  type HourlyPoint,
  type Ledger,
  type LedgerEntry,
  type Outstanding,
  type ProductPerformance,
  type ProfitLoss,
  type RecordCustomerPaymentInput,
  type ReportRange,
  type SaleDetail,
  type SalesSummary,
  type StockValuation,
  type StockValuationRow,
  type TenderMethod,
  type TransactionalAudit,
  type UpdateCustomerRecord,
  type UpdateEmployeeRecord,
  type UpdateExpenseRecord,
} from '../../src/domain/types.js';
import { buildLedger, summariseOutstanding } from '../../src/services/ledger.js';
import type { FakeSaleRepository } from './fake-sale-repository.js';
import type {
  FakeAuditLogRepository,
  FakeCategoryRepository,
  FakeInventoryRepository,
  FakeProductRepository,
} from './in-memory-repositories.js';

const clone = <T>(v: T): T => structuredClone(v);
const METHOD_ORDER: TenderMethod[] = ['CASH', 'CARD', 'BANK_TRANSFER', 'CUSTOMER_CREDIT'];
const cents = (s: string): bigint => BigInt(roundDecimalString(s, 2).replace('.', ''));
const fromCents = (c: bigint): string => {
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? '-' : ''}${a / 100n}.${(a % 100n).toString().padStart(2, '0')}`;
};
const milli = (q: string): bigint => {
  const [w = '0', f = ''] = q.split('.');
  return BigInt(`${w}${(f + '000').slice(0, 3)}`);
};
const fromMilli = (m: bigint): string => `${m / 1000n}.${(m % 1000n).toString().padStart(3, '0')}`;
/** round-half-up of num/den for non-negative values. */
const roundDiv = (num: bigint, den: bigint): bigint => (2n * num + den) / (2n * den);

const sum = (xs: string[]): string => fromCents(xs.reduce((a, x) => a + cents(x), 0n));

/** Customers: balance is derived from the sale repository's rows, exactly like the SQL aggregates in the Prisma adapter. */
export class FakeCustomerRepository implements CustomerRepository {
  readonly customers = new Map<string, CustomerSummary>();
  readonly payments: (CustomerPaymentRecord & { tenantId: string; createdById: string })[] = [];
  /** Test hook: runs after the payment row exists, before the audit (inside the transaction). */
  afterPaymentInsert: (() => void) | null = null;

  constructor(
    private readonly sales: FakeSaleRepository,
    private readonly audit: FakeAuditLogRepository,
  ) {
    sales.credit = {
      find: (id, tenantId) => {
        const c = this.customers.get(id);
        return c && c.tenantId === tenantId ? c : undefined;
      },
      balanceOf: (id) => this.balanceOf(id),
    };
    sales.registerSnapshotter(() => {
      const customers = new Map(this.customers);
      const payments = this.payments.length;
      return () => {
        this.customers.clear();
        customers.forEach((v, k) => this.customers.set(k, v));
        this.payments.length = payments;
      };
    });
  }

  balanceOf(customerId: string): string {
    const c = this.customers.get(customerId)!;
    let bal = c.openingBalance;
    for (const s of this.sales.sales.values()) {
      if (s.customerId !== customerId || s.tenantId !== c.tenantId) continue;
      for (const p of s.payments)
        if (p.method === 'CUSTOMER_CREDIT') bal = addDecimalStrings(bal, p.amount, 2);
      for (const r of s.returns)
        if (r.refundMethod === 'CUSTOMER_CREDIT')
          bal = subtractDecimalStrings(bal, r.refundTotal, 2);
    }
    for (const p of this.payments) {
      if (p.customerId === customerId) bal = subtractDecimalStrings(bal, p.amount, 2);
    }
    return bal;
  }

  private view(c: CustomerSummary): CustomerWithBalance {
    return { ...clone(c), balance: this.balanceOf(c.id) };
  }

  create(
    tenantId: string,
    input: CreateCustomerRecord,
    audit: TransactionalAudit,
  ): Promise<CustomerWithBalance> {
    return this.sales.transact(async () => {
      const c: CustomerSummary = {
        id: randomUUID(),
        tenantId,
        name: input.name,
        phone: input.phone ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        customerType: input.customerType,
        openingBalance: roundDecimalString(input.openingBalance, 2),
        creditLimit: input.creditLimit ? roundDecimalString(input.creditLimit, 2) : null,
        isActive: true,
        createdAt: new Date(),
      };
      this.customers.set(c.id, c);
      await this.audit.record({
        tenantId,
        userId: audit.userId,
        action: audit.action,
        entity: 'Customer',
        entityId: c.id,
        metadata: audit.metadata,
      });
      return this.view(c);
    });
  }

  async findById(id: string, tenantId: string): Promise<CustomerWithBalance | null> {
    const c = this.customers.get(id);
    return c && c.tenantId === tenantId ? this.view(c) : null;
  }

  async list(tenantId: string, f: CustomerListFilter): Promise<CustomerListResult> {
    let rows = [...this.customers.values()].filter((c) => c.tenantId === tenantId);
    if (f.isActive !== undefined) rows = rows.filter((c) => c.isActive === f.isActive);
    if (f.search) {
      const q = f.search.toLowerCase();
      rows = rows.filter(
        (c) => c.name.toLowerCase().includes(q) || (c.phone ?? '').includes(f.search!),
      );
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    let views = rows.map((c) => this.view(c));
    if (f.withBalanceOnly)
      views = views.filter((c) => compareDecimalStrings(c.balance, '0', 2) !== 0);
    const start = (f.page - 1) * f.pageSize;
    return {
      items: views.slice(start, start + f.pageSize),
      total: views.length,
      page: f.page,
      pageSize: f.pageSize,
    };
  }

  update(
    id: string,
    tenantId: string,
    patch: UpdateCustomerRecord,
    audit: TransactionalAudit,
  ): Promise<CustomerWithBalance | null> {
    return this.sales.transact(async () => {
      const c = this.customers.get(id);
      if (!c || c.tenantId !== tenantId) return null;
      const next: CustomerSummary = {
        ...c,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
        ...(patch.email !== undefined ? { email: patch.email } : {}),
        ...(patch.address !== undefined ? { address: patch.address } : {}),
        ...(patch.customerType !== undefined ? { customerType: patch.customerType } : {}),
        ...(patch.creditLimit !== undefined
          ? {
              creditLimit:
                patch.creditLimit === null ? null : roundDecimalString(patch.creditLimit, 2),
            }
          : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      };
      this.customers.set(id, next);
      await this.audit.record({
        tenantId,
        userId: audit.userId,
        action: audit.action,
        entity: 'Customer',
        entityId: id,
        metadata: audit.metadata,
      });
      return this.view(next);
    });
  }

  async ledger(id: string, tenantId: string): Promise<Ledger | null> {
    const c = this.customers.get(id);
    if (!c || c.tenantId !== tenantId) return null;
    const raw: Omit<LedgerEntry, 'balance'>[] = [];
    for (const s of this.sales.sales.values()) {
      if (s.customerId !== id || s.tenantId !== tenantId) continue;
      for (const p of s.payments)
        if (p.method === 'CUSTOMER_CREDIT')
          raw.push({
            date: s.soldAt,
            type: 'CREDIT_SALE',
            reference: s.invoiceNo,
            description: 'Sale on account',
            increase: p.amount,
            decrease: '0.00',
          });
      for (const r of s.returns)
        if (r.refundMethod === 'CUSTOMER_CREDIT')
          raw.push({
            date: r.createdAt,
            type: 'CREDIT_REFUND',
            reference: r.returnNo,
            description: `Refund to account (${s.invoiceNo})`,
            increase: '0.00',
            decrease: r.refundTotal,
          });
    }
    for (const p of this.payments)
      if (p.customerId === id)
        raw.push({
          date: p.paidAt,
          type: 'CUSTOMER_PAYMENT',
          reference: p.reference ?? p.id,
          description: p.note ?? `Payment received (${p.method.toLowerCase().replace('_', ' ')})`,
          increase: '0.00',
          decrease: p.amount,
        });
    raw.sort(
      (a, b) => a.date.getTime() - b.date.getTime() || a.reference.localeCompare(b.reference),
    );
    return buildLedger(c.openingBalance, c.createdAt, raw);
  }

  recordPayment(
    input: RecordCustomerPaymentInput,
  ): Promise<{ payment: CustomerPaymentRecord; balance: string }> {
    return this.sales.transact(async () => {
      const c = this.customers.get(input.customerId);
      if (!c || c.tenantId !== input.tenantId) throw new CustomerNotFoundError();
      const balance = this.balanceOf(c.id);
      const amount = roundDecimalString(input.amount, 2);
      if (compareDecimalStrings(amount, balance, 2) > 0) {
        throw new CustomerOverpaymentError(
          `Payment (${amount}) is more than the customer owes (${balance}).`,
        );
      }
      const payment = {
        id: randomUUID(),
        tenantId: input.tenantId,
        customerId: c.id,
        amount,
        method: input.method as CashMethod,
        reference: input.reference ?? null,
        note: input.note ?? null,
        paidAt: new Date(),
        createdById: input.createdById,
      };
      this.payments.push(payment);
      this.afterPaymentInsert?.();
      const after = subtractDecimalStrings(balance, amount, 2);
      await this.audit.record({
        tenantId: input.tenantId,
        userId: input.audit.userId,
        action: input.audit.action,
        entity: 'Customer',
        entityId: c.id,
        metadata: { ...(input.audit.metadata ?? {}), amount, balanceAfter: after },
      });
      const { tenantId: _t, createdById: _c, ...rest } = payment;
      void _t;
      void _c;
      return { payment: rest, balance: after };
    });
  }

  async outstanding(tenantId: string): Promise<Outstanding> {
    return summariseOutstanding(
      [...this.customers.values()]
        .filter((c) => c.tenantId === tenantId)
        .map((c) => ({ id: c.id, name: c.name, phone: c.phone, balance: this.balanceOf(c.id) })),
    );
  }
}

export class FakeExpenseRepository implements ExpenseRepository {
  readonly expenses = new Map<string, ExpenseRecord>();

  constructor(
    private readonly sales: FakeSaleRepository,
    private readonly audit: FakeAuditLogRepository,
  ) {
    sales.registerSnapshotter(() => {
      const snap = new Map(this.expenses);
      return () => {
        this.expenses.clear();
        snap.forEach((v, k) => this.expenses.set(k, v));
      };
    });
  }

  create(input: CreateExpenseRecord): Promise<ExpenseRecord> {
    return this.sales.transact(async () => {
      const e: ExpenseRecord = {
        id: randomUUID(),
        tenantId: input.tenantId,
        storeId: input.storeId,
        category: input.category,
        description: input.description ?? null,
        amount: roundDecimalString(input.amount, 2),
        expenseDate: input.expenseDate,
        method: input.method,
        createdById: input.createdById,
        createdAt: new Date(),
      };
      this.expenses.set(e.id, e);
      await this.audit.record({
        tenantId: input.tenantId,
        userId: input.audit.userId,
        action: input.audit.action,
        entity: 'Expense',
        entityId: e.id,
        metadata: input.audit.metadata,
      });
      return clone(e);
    });
  }

  async findById(id: string, tenantId: string): Promise<ExpenseRecord | null> {
    const e = this.expenses.get(id);
    return e && e.tenantId === tenantId ? clone(e) : null;
  }

  async list(tenantId: string, f: ExpenseListFilter): Promise<ExpenseListResult> {
    let rows = [...this.expenses.values()].filter((e) => e.tenantId === tenantId);
    if (f.storeId) rows = rows.filter((e) => e.storeId === f.storeId);
    if (f.category) rows = rows.filter((e) => e.category === f.category);
    if (f.from) rows = rows.filter((e) => e.expenseDate >= f.from!);
    if (f.to) rows = rows.filter((e) => e.expenseDate < f.to!);
    rows.sort(
      (a, b) =>
        b.expenseDate.getTime() - a.expenseDate.getTime() ||
        b.createdAt.getTime() - a.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    );
    const start = (f.page - 1) * f.pageSize;
    return {
      items: rows.slice(start, start + f.pageSize).map(clone),
      total: rows.length,
      totalAmount: sum(rows.map((r) => r.amount)),
      page: f.page,
      pageSize: f.pageSize,
    };
  }

  update(
    id: string,
    tenantId: string,
    patch: UpdateExpenseRecord,
    audit: TransactionalAudit,
  ): Promise<ExpenseRecord | null> {
    return this.sales.transact(async () => {
      const e = this.expenses.get(id);
      if (!e || e.tenantId !== tenantId) return null;
      const next: ExpenseRecord = {
        ...e,
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.amount !== undefined ? { amount: roundDecimalString(patch.amount, 2) } : {}),
        ...(patch.expenseDate !== undefined ? { expenseDate: patch.expenseDate } : {}),
        ...(patch.method !== undefined ? { method: patch.method } : {}),
      };
      this.expenses.set(id, next);
      await this.audit.record({
        tenantId,
        userId: audit.userId,
        action: audit.action,
        entity: 'Expense',
        entityId: id,
        metadata: audit.metadata,
      });
      return clone(next);
    });
  }

  delete(id: string, tenantId: string, audit: TransactionalAudit): Promise<boolean> {
    return this.sales.transact(async () => {
      const e = this.expenses.get(id);
      if (!e || e.tenantId !== tenantId) return false;
      this.expenses.delete(id);
      await this.audit.record({
        tenantId,
        userId: audit.userId,
        action: audit.action,
        entity: 'Expense',
        entityId: id,
        metadata: audit.metadata,
      });
      return true;
    });
  }
}

export class FakeEmployeeRepository implements EmployeeRepository {
  readonly employees = new Map<string, EmployeeRecord>();

  constructor(
    private readonly sales: FakeSaleRepository,
    private readonly audit: FakeAuditLogRepository,
  ) {
    sales.registerSnapshotter(() => {
      const snap = new Map(this.employees);
      return () => {
        this.employees.clear();
        snap.forEach((v, k) => this.employees.set(k, v));
      };
    });
  }

  private assertUserFree(userId: string | null | undefined, exceptId?: string): void {
    if (!userId) return;
    for (const e of this.employees.values()) {
      if (e.userId === userId && e.id !== exceptId) {
        throw new EmployeeUserConflictError('This login is already linked to another employee.');
      }
    }
  }

  create(
    tenantId: string,
    input: CreateEmployeeRecord,
    audit: TransactionalAudit,
  ): Promise<EmployeeRecord> {
    return this.sales.transact(async () => {
      this.assertUserFree(input.userId);
      const e: EmployeeRecord = {
        id: randomUUID(),
        tenantId,
        userId: input.userId ?? null,
        storeId: input.storeId ?? null,
        fullName: input.fullName,
        phone: input.phone ?? null,
        designation: input.designation ?? null,
        nationalId: input.nationalId ?? null,
        hireDate: input.hireDate ?? null,
        salary: input.salary ? roundDecimalString(input.salary, 2) : null,
        status: 'ACTIVE',
        createdAt: new Date(),
      };
      this.employees.set(e.id, e);
      await this.audit.record({
        tenantId,
        userId: audit.userId,
        action: audit.action,
        entity: 'Employee',
        entityId: e.id,
        metadata: audit.metadata,
      });
      return clone(e);
    });
  }

  async findById(id: string, tenantId: string): Promise<EmployeeRecord | null> {
    const e = this.employees.get(id);
    return e && e.tenantId === tenantId ? clone(e) : null;
  }

  async list(tenantId: string, f: EmployeeListFilter): Promise<EmployeeListResult> {
    let rows = [...this.employees.values()].filter((e) => e.tenantId === tenantId);
    if (f.status) rows = rows.filter((e) => e.status === f.status);
    if (f.storeId) rows = rows.filter((e) => e.storeId === f.storeId);
    if (f.search) {
      const q = f.search.toLowerCase();
      rows = rows.filter(
        (e) => e.fullName.toLowerCase().includes(q) || (e.phone ?? '').includes(f.search!),
      );
    }
    rows.sort((a, b) => a.fullName.localeCompare(b.fullName));
    const start = (f.page - 1) * f.pageSize;
    return {
      items: rows.slice(start, start + f.pageSize).map(clone),
      total: rows.length,
      page: f.page,
      pageSize: f.pageSize,
    };
  }

  update(
    id: string,
    tenantId: string,
    patch: UpdateEmployeeRecord,
    audit: TransactionalAudit,
  ): Promise<EmployeeRecord | null> {
    return this.sales.transact(async () => {
      const e = this.employees.get(id);
      if (!e || e.tenantId !== tenantId) return null;
      if (patch.userId !== undefined) this.assertUserFree(patch.userId, id);
      const next: EmployeeRecord = {
        ...e,
        ...(patch.fullName !== undefined ? { fullName: patch.fullName } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
        ...(patch.designation !== undefined ? { designation: patch.designation } : {}),
        ...(patch.nationalId !== undefined ? { nationalId: patch.nationalId } : {}),
        ...(patch.hireDate !== undefined ? { hireDate: patch.hireDate } : {}),
        ...(patch.salary !== undefined
          ? { salary: patch.salary === null ? null : roundDecimalString(patch.salary, 2) }
          : {}),
        ...(patch.storeId !== undefined ? { storeId: patch.storeId } : {}),
        ...(patch.userId !== undefined ? { userId: patch.userId } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
      };
      this.employees.set(id, next);
      await this.audit.record({
        tenantId,
        userId: audit.userId,
        action: audit.action,
        entity: 'Employee',
        entityId: id,
        metadata: audit.metadata,
      });
      return clone(next);
    });
  }
}

/** Mirrors the SQL in PrismaReportRepository definition-for-definition (see docs/PHASE-6.md for the rules). */
export class FakeReportRepository implements ReportRepository {
  constructor(
    private readonly sales: FakeSaleRepository,
    private readonly products: FakeProductRepository,
    private readonly categories: FakeCategoryRepository,
    private readonly inventory: FakeInventoryRepository,
    private readonly expenses: FakeExpenseRepository,
  ) {}

  private salesIn(tenantId: string, r: ReportRange): SaleDetail[] {
    return [...this.sales.sales.values()].filter(
      (s) =>
        s.tenantId === tenantId &&
        s.status !== 'VOID' &&
        s.soldAt >= r.start &&
        s.soldAt < r.end &&
        (!r.storeId || s.storeId === r.storeId),
    );
  }

  async salesSummary(tenantId: string, r: ReportRange): Promise<SalesSummary> {
    const rows = this.salesIn(tenantId, r);
    const returns = [...this.sales.sales.values()]
      .filter(
        (s) =>
          s.tenantId === tenantId && s.status !== 'VOID' && (!r.storeId || s.storeId === r.storeId),
      )
      .flatMap((s) => s.returns)
      .filter((x) => x.createdAt >= r.start && x.createdAt < r.end);
    const netSales = sum(rows.map((s) => s.grandTotal));
    const refunds = sum(returns.map((x) => x.refundTotal));
    const changeTotal = sum(rows.map((s) => s.changeDue));
    const byMethod = (m: TenderMethod): string => {
      const total = sum(
        rows.flatMap((s) => s.payments.filter((p) => p.method === m).map((p) => p.amount)),
      );
      return m === 'CASH' ? subtractDecimalStrings(total, changeTotal, 2) : total;
    };
    return {
      saleCount: rows.length,
      grossSales: sum(rows.map((s) => s.subtotal)),
      itemDiscounts: sum(rows.map((s) => s.itemDiscountTotal)),
      cartDiscounts: sum(rows.map((s) => s.cartDiscountAmount)),
      tax: sum(rows.map((s) => s.taxTotal)),
      netSales,
      refundCount: returns.length,
      refunds,
      netAfterRefunds: subtractDecimalStrings(netSales, refunds, 2),
      averageSale:
        rows.length === 0 ? '0.00' : fromCents(roundDiv(cents(netSales), BigInt(rows.length))),
      paymentsByMethod: METHOD_ORDER.map((m) => ({ method: m, amount: byMethod(m) })).filter(
        (x) => cents(x.amount) !== 0n,
      ),
      refundsByMethod: METHOD_ORDER.map((m) => ({
        method: m,
        amount: sum(returns.filter((x) => x.refundMethod === m).map((x) => x.refundTotal)),
      })).filter((x) => cents(x.amount) !== 0n),
    };
  }

  async dailySales(tenantId: string, r: ReportRange): Promise<DailyPoint[]> {
    const groups = new Map<string, SaleDetail[]>();
    for (const s of this.salesIn(tenantId, r)) {
      const d = localDateString(s.soldAt, r.timeZone);
      groups.set(d, [...(groups.get(d) ?? []), s]);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, ss]) => ({
        date,
        saleCount: ss.length,
        netSales: sum(ss.map((s) => s.grandTotal)),
      }));
  }

  async hourlySales(tenantId: string, r: ReportRange): Promise<HourlyPoint[]> {
    const groups = new Map<number, SaleDetail[]>();
    for (const s of this.salesIn(tenantId, r)) {
      const hour = Number(
        new Intl.DateTimeFormat('en-GB', {
          hour: '2-digit',
          hourCycle: 'h23',
          timeZone: r.timeZone,
        }).format(s.soldAt),
      );
      groups.set(hour, [...(groups.get(hour) ?? []), s]);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a - b)
      .map(([hour, ss]) => ({
        hour,
        saleCount: ss.length,
        netSales: sum(ss.map((s) => s.grandTotal)),
      }));
  }

  async topProducts(
    tenantId: string,
    r: ReportRange,
    limit: number,
  ): Promise<ProductPerformance[]> {
    const map = new Map<
      string,
      { name: string; sku: string; sold: bigint; ret: bigint; revenue: string[] }
    >();
    for (const s of this.salesIn(tenantId, r)) {
      for (const i of s.items) {
        const g = map.get(i.productId) ?? {
          name: i.productName,
          sku: i.sku,
          sold: 0n,
          ret: 0n,
          revenue: [],
        };
        if (i.productName < g.name) g.name = i.productName;
        if (i.sku < g.sku) g.sku = i.sku;
        g.sold += milli(i.quantity);
        g.ret += milli(i.returnedQuantity);
        g.revenue.push(i.lineTotal);
        map.set(i.productId, g);
      }
    }
    return [...map.entries()]
      .map(([productId, g]) => ({
        productId,
        productName: g.name,
        sku: g.sku,
        quantitySold: fromMilli(g.sold),
        quantityReturned: fromMilli(g.ret),
        revenue: sum(g.revenue),
      }))
      .sort(
        (a, b) =>
          Number(cents(b.revenue) - cents(a.revenue)) || a.productName.localeCompare(b.productName),
      )
      .slice(0, limit);
  }

  async salesByCashier(tenantId: string, r: ReportRange): Promise<CashierPerformance[]> {
    const map = new Map<string, SaleDetail[]>();
    for (const s of this.salesIn(tenantId, r))
      map.set(s.cashierId, [...(map.get(s.cashierId) ?? []), s]);
    return [...map.entries()]
      .map(([cashierId, ss]) => ({
        cashierId,
        saleCount: ss.length,
        netSales: sum(ss.map((s) => s.grandTotal)),
      }))
      .sort(
        (a, b) =>
          Number(cents(b.netSales) - cents(a.netSales)) || a.cashierId.localeCompare(b.cashierId),
      );
  }

  async salesByCategory(tenantId: string, r: ReportRange): Promise<CategoryPerformance[]> {
    const map = new Map<string, { qty: bigint; revenue: string[] }>();
    for (const s of this.salesIn(tenantId, r)) {
      for (const i of s.items) {
        const categoryId = this.products.products.get(i.productId)!.categoryId;
        const g = map.get(categoryId) ?? { qty: 0n, revenue: [] };
        g.qty += milli(i.quantity);
        g.revenue.push(i.lineTotal);
        map.set(categoryId, g);
      }
    }
    return [...map.entries()]
      .map(([categoryId, g]) => ({
        categoryId,
        categoryName: this.categories.categories.get(categoryId)?.name ?? categoryId,
        quantitySold: fromMilli(g.qty),
        revenue: sum(g.revenue),
      }))
      .sort(
        (a, b) =>
          Number(cents(b.revenue) - cents(a.revenue)) ||
          a.categoryName.localeCompare(b.categoryName),
      );
  }

  async profitLoss(tenantId: string, r: ReportRange): Promise<ProfitLoss> {
    let revenue = 0n;
    let cogs = 0n;
    for (const s of this.salesIn(tenantId, r)) {
      for (const i of s.items) {
        const qty = milli(i.quantity);
        const kept = qty - milli(i.returnedQuantity);
        const exTax = cents(i.lineTotal) - cents(i.taxAmount);
        revenue += roundDiv(exTax * kept, qty);
        const cost = this.sales.itemCosts.get(i.id) ?? '0';
        const [cw = '0', cf = ''] = cost.split('.');
        const cost4 = BigInt(`${cw}${(cf + '0000').slice(0, 4)}`);
        // cost (1e-4) x kept (1e-3) = 1e-7; round to 1e-2
        cogs += roundDiv(cost4 * kept, 100_000n);
      }
    }
    const inRange = [...this.expenses.expenses.values()].filter(
      (e) =>
        e.tenantId === tenantId &&
        e.expenseDate >= r.start &&
        e.expenseDate < r.end &&
        (!r.storeId || e.storeId === r.storeId),
    );
    const byCat = new Map<string, string[]>();
    for (const e of inRange) byCat.set(e.category, [...(byCat.get(e.category) ?? []), e.amount]);
    const expenses = sum(inRange.map((e) => e.amount));
    const gross = revenue - cogs;
    return {
      revenue: fromCents(revenue),
      costOfGoods: fromCents(cogs),
      grossProfit: fromCents(gross),
      expenses,
      netProfit: fromCents(gross - cents(expenses)),
      expensesByCategory: [...byCat.entries()]
        .map(([category, xs]) => ({ category, amount: sum(xs) }))
        .sort(
          (a, b) =>
            Number(cents(b.amount) - cents(a.amount)) || a.category.localeCompare(b.category),
        ),
    };
  }

  async stockValuation(tenantId: string, storeId?: string): Promise<StockValuation> {
    const rows: StockValuationRow[] = [];
    for (const inv of this.inventory.inventories.values()) {
      if (inv.tenantId !== tenantId || (storeId && inv.storeId !== storeId)) continue;
      if (milli(inv.quantity) <= 0n) continue;
      const p = this.products.products.get(inv.productId);
      if (!p) continue;
      const q = milli(inv.quantity);
      const val = (price: string): string => {
        const [w = '0', f = ''] = price.split('.');
        return fromCents(roundDiv(BigInt(`${w}${(f + '0000').slice(0, 4)}`) * q, 100_000n));
      };
      rows.push({
        storeId: inv.storeId,
        productId: p.id,
        productName: p.name,
        sku: p.sku,
        quantity: inv.quantity,
        costPrice: roundDecimalString(p.costPrice, 4),
        sellingPrice: roundDecimalString(p.sellingPrice, 4),
        costValue: val(p.costPrice),
        retailValue: val(p.sellingPrice),
      });
    }
    rows.sort(
      (a, b) => a.productName.localeCompare(b.productName) || a.storeId.localeCompare(b.storeId),
    );
    return {
      rows,
      totalCostValue: sum(rows.map((x) => x.costValue)),
      totalRetailValue: sum(rows.map((x) => x.retailValue)),
    };
  }
}
