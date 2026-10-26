import {
  addDaysToYmd,
  daysBetweenInclusive,
  localDayRange,
  subtractDecimalStrings,
} from '@mafk/shared';
import type { ReportExportQuery, ReportRangeQuery } from '@mafk/validation';
import type { Repositories } from '../domain/ports.js';
import {
  DomainError,
  type CashierPerformance,
  type CategoryPerformance,
  type DailyPoint,
  type HourlyPoint,
  type Outstanding,
  type ProductPerformance,
  type ProfitLoss,
  type ReportRange,
  type SalesSummary,
  type StockValuation,
} from '../domain/types.js';
import { toReportCsv as toCsv } from './csv.js';

export type ReportKind =
  | 'sales-summary'
  | 'daily'
  | 'hourly'
  | 'top-products'
  | 'by-cashier'
  | 'by-category'
  | 'profit-loss'
  | 'stock-valuation'
  | 'receivables'
  | 'payables';

export interface ReportMeta {
  from: string;
  to: string;
  storeId: string | null;
  timeZone: string;
  currency: string;
}
export interface ReportResult<T> {
  meta: ReportMeta;
  data: T;
}
export interface CsvFile {
  filename: string;
  content: string;
}

export interface AnalyticsOverview {
  meta: ReportMeta;
  summary: SalesSummary;
  /** The immediately preceding period of the same length, for comparison. */
  previous: { from: string; to: string; summary: SalesSummary };
  /** netSales change vs the previous period, in percent with 1 decimal; null when the previous period had no sales. */
  netSalesChangePercent: string | null;
  daily: DailyPoint[];
  hourly: HourlyPoint[];
  topProducts: ProductPerformance[];
  byCategory: CategoryPerformance[];
}

export class ReportService {
  constructor(private readonly repos: Repositories) {}

  private async resolve(
    tenantId: string,
    q: { from: string; to: string; storeId?: string },
  ): Promise<{ range: ReportRange; meta: ReportMeta }> {
    const tenant = await this.repos.tenants.findDetailById(tenantId);
    if (!tenant) throw new DomainError('NOT_FOUND', 'Business not found.', 404);
    const timeZone = tenant.timezone ?? 'Asia/Karachi';
    if (q.storeId) {
      const stores = await this.repos.stores.listByTenant(tenantId);
      if (!stores.some((s) => s.id === q.storeId)) {
        throw new DomainError('VALIDATION_ERROR', 'Selected branch does not exist.', 422);
      }
    }
    const { start, end } = localDayRange(q.from, q.to, timeZone);
    return {
      range: { start, end, storeId: q.storeId, timeZone },
      meta: {
        from: q.from,
        to: q.to,
        storeId: q.storeId ?? null,
        timeZone,
        currency: tenant.currency ?? 'PKR',
      },
    };
  }

  async salesSummary(tenantId: string, q: ReportRangeQuery): Promise<ReportResult<SalesSummary>> {
    const { range, meta } = await this.resolve(tenantId, q);
    return { meta, data: await this.repos.reports.salesSummary(tenantId, range) };
  }
  async daily(tenantId: string, q: ReportRangeQuery): Promise<ReportResult<DailyPoint[]>> {
    const { range, meta } = await this.resolve(tenantId, q);
    return { meta, data: await this.repos.reports.dailySales(tenantId, range) };
  }
  async hourly(tenantId: string, q: ReportRangeQuery): Promise<ReportResult<HourlyPoint[]>> {
    const { range, meta } = await this.resolve(tenantId, q);
    return { meta, data: await this.repos.reports.hourlySales(tenantId, range) };
  }
  async topProducts(
    tenantId: string,
    q: ReportExportQuery,
  ): Promise<ReportResult<ProductPerformance[]>> {
    const { range, meta } = await this.resolve(tenantId, q);
    return { meta, data: await this.repos.reports.topProducts(tenantId, range, q.limit) };
  }
  async byCashier(
    tenantId: string,
    q: ReportRangeQuery,
  ): Promise<ReportResult<(CashierPerformance & { cashierName: string | null })[]>> {
    const { range, meta } = await this.resolve(tenantId, q);
    const rows = await this.repos.reports.salesByCashier(tenantId, range);
    const data = [];
    for (const r of rows) {
      const u = await this.repos.users.findById(r.cashierId);
      data.push({ ...r, cashierName: u && u.tenantId === tenantId ? u.displayName : null });
    }
    return { meta, data };
  }
  async byCategory(
    tenantId: string,
    q: ReportRangeQuery,
  ): Promise<ReportResult<CategoryPerformance[]>> {
    const { range, meta } = await this.resolve(tenantId, q);
    return { meta, data: await this.repos.reports.salesByCategory(tenantId, range) };
  }
  async profitLoss(tenantId: string, q: ReportRangeQuery): Promise<ReportResult<ProfitLoss>> {
    const { range, meta } = await this.resolve(tenantId, q);
    return { meta, data: await this.repos.reports.profitLoss(tenantId, range) };
  }
  async stockValuation(
    tenantId: string,
    storeId?: string,
  ): Promise<{ storeId: string | null; data: StockValuation }> {
    if (storeId) {
      const stores = await this.repos.stores.listByTenant(tenantId);
      if (!stores.some((s) => s.id === storeId)) {
        throw new DomainError('VALIDATION_ERROR', 'Selected branch does not exist.', 422);
      }
    }
    return {
      storeId: storeId ?? null,
      data: await this.repos.reports.stockValuation(tenantId, storeId),
    };
  }
  receivables(tenantId: string): Promise<Outstanding> {
    return this.repos.customers.outstanding(tenantId);
  }
  payables(tenantId: string): Promise<Outstanding> {
    return this.repos.suppliers.outstanding(tenantId);
  }

  /** Sales, trend, hours, best sellers and categories for a period, with the previous period for comparison. */
  async overview(tenantId: string, q: ReportExportQuery): Promise<AnalyticsOverview> {
    const { range, meta } = await this.resolve(tenantId, q);
    const days = daysBetweenInclusive(q.from, q.to);
    const prevTo = addDaysToYmd(q.from, -1);
    const prevFrom = addDaysToYmd(q.from, -days);
    const prev = await this.resolve(tenantId, { from: prevFrom, to: prevTo, storeId: q.storeId });
    const [summary, previous, daily, hourly, topProducts, byCategory] = await Promise.all([
      this.repos.reports.salesSummary(tenantId, range),
      this.repos.reports.salesSummary(tenantId, prev.range),
      this.repos.reports.dailySales(tenantId, range),
      this.repos.reports.hourlySales(tenantId, range),
      this.repos.reports.topProducts(tenantId, range, q.limit),
      this.repos.reports.salesByCategory(tenantId, range),
    ]);
    const prevCents = BigInt(previous.netSales.replace('.', ''));
    let change: string | null = null;
    if (prevCents > 0n) {
      const diff = BigInt(
        subtractDecimalStrings(summary.netSales, previous.netSales, 2).replace('.', ''),
      );
      // percent with 1 decimal, round half away from zero: diff/prev*1000 -> tenths of a percent
      const num = diff * 1000n;
      const neg = num < 0n;
      const abs = neg ? -num : num;
      const tenths = (2n * abs + prevCents) / (2n * prevCents);
      change = `${neg && tenths !== 0n ? '-' : ''}${tenths / 10n}.${tenths % 10n}`;
    }
    return {
      meta,
      summary,
      previous: { from: prevFrom, to: prevTo, summary: previous },
      netSalesChangePercent: change,
      daily,
      hourly,
      topProducts,
      byCategory,
    };
  }

  /** CSV for any report (the controller checks `reports.export`). */
  async csv(tenantId: string, kind: ReportKind, q: ReportExportQuery): Promise<CsvFile> {
    const range = `${q.from}_${q.to}`;
    switch (kind) {
      case 'sales-summary': {
        const { data: s } = await this.salesSummary(tenantId, q);
        const rows: (string | number)[][] = [
          ['Metric', 'Value'],
          ['Sales count', s.saleCount],
          ['Gross sales', s.grossSales],
          ['Item discounts', s.itemDiscounts],
          ['Cart discounts', s.cartDiscounts],
          ['Tax', s.tax],
          ['Net sales', s.netSales],
          ['Refund count', s.refundCount],
          ['Refunds', s.refunds],
          ['Net after refunds', s.netAfterRefunds],
          ['Average sale', s.averageSale],
          ...s.paymentsByMethod.map((p): (string | number)[] => [
            `Payments - ${p.method}`,
            p.amount,
          ]),
          ...s.refundsByMethod.map((p): (string | number)[] => [`Refunds - ${p.method}`, p.amount]),
        ];
        return { filename: `sales-summary_${range}.csv`, content: toCsv(rows) };
      }
      case 'daily': {
        const { data } = await this.daily(tenantId, q);
        return {
          filename: `daily-sales_${range}.csv`,
          content: toCsv([
            ['Date', 'Sales', 'Net sales'],
            ...data.map((d) => [d.date, d.saleCount, d.netSales]),
          ]),
        };
      }
      case 'hourly': {
        const { data } = await this.hourly(tenantId, q);
        return {
          filename: `hourly-sales_${range}.csv`,
          content: toCsv([
            ['Hour', 'Sales', 'Net sales'],
            ...data.map((d) => [d.hour, d.saleCount, d.netSales]),
          ]),
        };
      }
      case 'top-products': {
        const { data } = await this.topProducts(tenantId, q);
        return {
          filename: `top-products_${range}.csv`,
          content: toCsv([
            ['Product', 'SKU', 'Qty sold', 'Qty returned', 'Revenue'],
            ...data.map((d) => [
              d.productName,
              d.sku,
              d.quantitySold,
              d.quantityReturned,
              d.revenue,
            ]),
          ]),
        };
      }
      case 'by-cashier': {
        const { data } = await this.byCashier(tenantId, q);
        return {
          filename: `sales-by-cashier_${range}.csv`,
          content: toCsv([
            ['Cashier', 'Sales', 'Net sales'],
            ...data.map((d) => [d.cashierName ?? d.cashierId, d.saleCount, d.netSales]),
          ]),
        };
      }
      case 'by-category': {
        const { data } = await this.byCategory(tenantId, q);
        return {
          filename: `sales-by-category_${range}.csv`,
          content: toCsv([
            ['Category', 'Qty sold', 'Revenue'],
            ...data.map((d) => [d.categoryName, d.quantitySold, d.revenue]),
          ]),
        };
      }
      case 'profit-loss': {
        const { data: p } = await this.profitLoss(tenantId, q);
        return {
          filename: `profit-loss_${range}.csv`,
          content: toCsv([
            ['Line', 'Amount'],
            ['Revenue (ex tax, net of returns)', p.revenue],
            ['Cost of goods', p.costOfGoods],
            ['Gross profit', p.grossProfit],
            ...p.expensesByCategory.map((e): string[] => [`Expense - ${e.category}`, e.amount]),
            ['Total expenses', p.expenses],
            ['Net profit', p.netProfit],
          ]),
        };
      }
      case 'stock-valuation': {
        const { data } = await this.stockValuation(tenantId, q.storeId);
        return {
          filename: 'stock-valuation.csv',
          content: toCsv([
            ['Product', 'SKU', 'Qty', 'Cost price', 'Selling price', 'Cost value', 'Retail value'],
            ...data.rows.map((r) => [
              r.productName,
              r.sku,
              r.quantity,
              r.costPrice,
              r.sellingPrice,
              r.costValue,
              r.retailValue,
            ]),
            ['Total', '', '', '', '', data.totalCostValue, data.totalRetailValue],
          ]),
        };
      }
      case 'receivables':
      case 'payables': {
        const data =
          kind === 'receivables' ? await this.receivables(tenantId) : await this.payables(tenantId);
        return {
          filename: `${kind}.csv`,
          content: toCsv([
            [kind === 'receivables' ? 'Customer' : 'Supplier', 'Phone', 'Balance'],
            ...data.rows.map((r) => [r.name, r.phone, r.balance]),
            ['Total', '', data.total],
          ]),
        };
      }
    }
  }
}
