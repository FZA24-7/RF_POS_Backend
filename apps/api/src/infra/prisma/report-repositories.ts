// DATABASE STATUS (Phase 6): exercised by tests/integration/phase6.pg.test.ts (same contract as the in-memory fake).
// Every query is tenant-scoped, uses exact SQL numeric (no floats) and parameterised values (no string-built SQL).
import { addDecimalStrings, roundDecimalString, subtractDecimalStrings } from '@mafk/shared';
import { Prisma, type PrismaClient } from '@mafk/database';
import type { ReportRepository } from '../../domain/ports.js';
import type {
  CashierPerformance,
  CategoryPerformance,
  DailyPoint,
  HourlyPoint,
  ProductPerformance,
  ProfitLoss,
  ReportRange,
  SalesSummary,
  StockValuation,
  StockValuationRow,
  TenderMethod,
} from '../../domain/types.js';

const METHOD_ORDER: TenderMethod[] = ['CASH', 'CARD', 'BANK_TRANSFER', 'CUSTOMER_CREDIT'];
const isZero = (s: string): boolean => /^-?0+(\.0+)?$/.test(s);
const sumOf = (xs: string[]): string => xs.reduce((a, x) => addDecimalStrings(a, x, 2), '0.00');

/** Sales in the range, tenant-scoped, VOID excluded. `s` is the alias used by every query below. */
const saleFilter = (tenantId: string, r: ReportRange): Prisma.Sql =>
  Prisma.sql`s."tenantId" = ${tenantId} AND s.status <> 'VOID' AND s."soldAt" >= ${r.start} AND s."soldAt" < ${r.end}
    ${r.storeId ? Prisma.sql`AND s."storeId" = ${r.storeId}` : Prisma.empty}`;

const local = (tz: string): Prisma.Sql =>
  Prisma.sql`(s."soldAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}`;

export class PrismaReportRepository implements ReportRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async salesSummary(tenantId: string, r: ReportRange): Promise<SalesSummary> {
    const [row] = await this.prisma.$queryRaw<
      {
        c: number;
        gross: string;
        itemd: string;
        cartd: string;
        tax: string;
        net: string;
        change: string;
      }[]
    >`SELECT COUNT(*)::int AS c,
        ROUND(COALESCE(SUM(s.subtotal),0),2)::text AS gross,
        ROUND(COALESCE(SUM(s."itemDiscountTotal"),0),2)::text AS itemd,
        ROUND(COALESCE(SUM(s."cartDiscountAmount"),0),2)::text AS cartd,
        ROUND(COALESCE(SUM(s."taxTotal"),0),2)::text AS tax,
        ROUND(COALESCE(SUM(s."grandTotal"),0),2)::text AS net,
        ROUND(COALESCE(SUM(s."changeDue"),0),2)::text AS change
      FROM sales s WHERE ${saleFilter(tenantId, r)}`;
    const pays = await this.prisma.$queryRaw<{ method: TenderMethod; amount: string }[]>`
      SELECT p.method::text AS method, ROUND(SUM(p.amount),2)::text AS amount
      FROM payments p JOIN sales s ON s.id = p."saleId" AND s."tenantId" = p."tenantId"
      WHERE ${saleFilter(tenantId, r)} GROUP BY p.method`;
    const refunds = await this.prisma.$queryRaw<
      { method: TenderMethod; amount: string; c: number }[]
    >`
      SELECT x."refundMethod"::text AS method, ROUND(SUM(x."refundTotal"),2)::text AS amount, COUNT(*)::int AS c
      FROM sale_returns x JOIN sales s ON s.id = x."saleId" AND s."tenantId" = x."tenantId"
      WHERE x."tenantId" = ${tenantId} AND s.status <> 'VOID' AND x."createdAt" >= ${r.start} AND x."createdAt" < ${r.end}
        ${r.storeId ? Prisma.sql`AND x."storeId" = ${r.storeId}` : Prisma.empty}
      GROUP BY x."refundMethod"`;
    const paid = new Map(pays.map((p) => [p.method, p.amount]));
    const refunded = new Map(refunds.map((p) => [p.method, p.amount]));
    const refundTotal = sumOf(refunds.map((x) => x.amount));
    const count = row!.c;
    const net = row!.net;
    const netCents = BigInt(net.replace('.', ''));
    const avg =
      count === 0
        ? '0.00'
        : (() => {
            const q = (2n * netCents + BigInt(count)) / (2n * BigInt(count));
            const s = q.toString().padStart(3, '0');
            return `${s.slice(0, -2)}.${s.slice(-2)}`;
          })();
    return {
      saleCount: count,
      grossSales: row!.gross,
      itemDiscounts: row!.itemd,
      cartDiscounts: row!.cartd,
      tax: row!.tax,
      netSales: net,
      refundCount: refunds.reduce((a, x) => a + x.c, 0),
      refunds: refundTotal,
      netAfterRefunds: subtractDecimalStrings(net, refundTotal, 2),
      averageSale: avg,
      paymentsByMethod: METHOD_ORDER.map((m) => {
        const total = paid.get(m) ?? '0.00';
        return {
          method: m,
          amount: m === 'CASH' ? subtractDecimalStrings(total, row!.change, 2) : total,
        };
      }).filter((x) => !isZero(x.amount)),
      refundsByMethod: METHOD_ORDER.map((m) => ({
        method: m,
        amount: refunded.get(m) ?? '0.00',
      })).filter((x) => !isZero(x.amount)),
    };
  }

  async dailySales(tenantId: string, r: ReportRange): Promise<DailyPoint[]> {
    const rows = await this.prisma.$queryRaw<{ d: string; c: number; net: string }[]>`
      SELECT to_char(${local(r.timeZone)}, 'YYYY-MM-DD') AS d, COUNT(*)::int AS c,
             ROUND(SUM(s."grandTotal"),2)::text AS net
      FROM sales s WHERE ${saleFilter(tenantId, r)} GROUP BY 1 ORDER BY 1`;
    return rows.map((x) => ({ date: x.d, saleCount: x.c, netSales: x.net }));
  }

  async hourlySales(tenantId: string, r: ReportRange): Promise<HourlyPoint[]> {
    const rows = await this.prisma.$queryRaw<{ h: number; c: number; net: string }[]>`
      SELECT EXTRACT(HOUR FROM ${local(r.timeZone)})::int AS h, COUNT(*)::int AS c,
             ROUND(SUM(s."grandTotal"),2)::text AS net
      FROM sales s WHERE ${saleFilter(tenantId, r)} GROUP BY 1 ORDER BY 1`;
    return rows.map((x) => ({ hour: x.h, saleCount: x.c, netSales: x.net }));
  }

  async topProducts(
    tenantId: string,
    r: ReportRange,
    limit: number,
  ): Promise<ProductPerformance[]> {
    const rows = await this.prisma.$queryRaw<
      { id: string; name: string; sku: string; sold: string; ret: string; rev: string }[]
    >`SELECT si."productId" AS id, MIN(si."productName") AS name, MIN(si.sku) AS sku,
             SUM(si.quantity)::numeric(18,3)::text AS sold, SUM(si."returnedQuantity")::numeric(18,3)::text AS ret,
             ROUND(SUM(si."lineTotal"),2)::text AS rev
      FROM sale_items si JOIN sales s ON s.id = si."saleId" AND s."tenantId" = si."tenantId"
      WHERE ${saleFilter(tenantId, r)}
      GROUP BY si."productId" ORDER BY SUM(si."lineTotal") DESC, MIN(si."productName") ASC LIMIT ${limit}`;
    return rows.map((x) => ({
      productId: x.id,
      productName: x.name,
      sku: x.sku,
      quantitySold: x.sold,
      quantityReturned: x.ret,
      revenue: x.rev,
    }));
  }

  async salesByCashier(tenantId: string, r: ReportRange): Promise<CashierPerformance[]> {
    const rows = await this.prisma.$queryRaw<{ id: string; c: number; net: string }[]>`
      SELECT s."cashierId" AS id, COUNT(*)::int AS c, ROUND(SUM(s."grandTotal"),2)::text AS net
      FROM sales s WHERE ${saleFilter(tenantId, r)}
      GROUP BY s."cashierId" ORDER BY SUM(s."grandTotal") DESC, s."cashierId" ASC`;
    return rows.map((x) => ({ cashierId: x.id, saleCount: x.c, netSales: x.net }));
  }

  async salesByCategory(tenantId: string, r: ReportRange): Promise<CategoryPerformance[]> {
    const rows = await this.prisma.$queryRaw<
      { id: string; name: string; qty: string; rev: string }[]
    >`
      SELECT c.id AS id, c.name AS name, SUM(si.quantity)::numeric(18,3)::text AS qty,
             ROUND(SUM(si."lineTotal"),2)::text AS rev
      FROM sale_items si
        JOIN sales s ON s.id = si."saleId" AND s."tenantId" = si."tenantId"
        JOIN products p ON p.id = si."productId" AND p."tenantId" = si."tenantId"
        JOIN categories c ON c.id = p."categoryId" AND c."tenantId" = p."tenantId"
      WHERE ${saleFilter(tenantId, r)}
      GROUP BY c.id, c.name ORDER BY SUM(si."lineTotal") DESC, c.name ASC`;
    return rows.map((x) => ({
      categoryId: x.id,
      categoryName: x.name,
      quantitySold: x.qty,
      revenue: x.rev,
    }));
  }

  async profitLoss(tenantId: string, r: ReportRange): Promise<ProfitLoss> {
    const [row] = await this.prisma.$queryRaw<{ revenue: string; cogs: string }[]>`
      SELECT ROUND(COALESCE(SUM(ROUND(((si."lineTotal" - si."taxAmount") * (si.quantity - si."returnedQuantity")) / si.quantity, 2)),0),2)::text AS revenue,
             ROUND(COALESCE(SUM(ROUND(si."unitCost" * (si.quantity - si."returnedQuantity"), 2)),0),2)::text AS cogs
      FROM sale_items si JOIN sales s ON s.id = si."saleId" AND s."tenantId" = si."tenantId"
      WHERE ${saleFilter(tenantId, r)}`;
    const exp = await this.prisma.$queryRaw<{ category: string; amount: string }[]>`
      SELECT e.category AS category, ROUND(SUM(e.amount),2)::text AS amount
      FROM expenses e
      WHERE e."tenantId" = ${tenantId} AND e."expenseDate" >= ${r.start} AND e."expenseDate" < ${r.end}
        ${r.storeId ? Prisma.sql`AND e."storeId" = ${r.storeId}` : Prisma.empty}
      GROUP BY e.category ORDER BY SUM(e.amount) DESC, e.category ASC`;
    const expenses = sumOf(exp.map((x) => x.amount));
    const gross = subtractDecimalStrings(row!.revenue, row!.cogs, 2);
    return {
      revenue: row!.revenue,
      costOfGoods: row!.cogs,
      grossProfit: gross,
      expenses,
      netProfit: subtractDecimalStrings(gross, expenses, 2),
      expensesByCategory: exp,
    };
  }

  async stockValuation(tenantId: string, storeId?: string): Promise<StockValuation> {
    const rows = await this.prisma.$queryRaw<
      {
        storeId: string;
        id: string;
        name: string;
        sku: string;
        qty: string;
        cost: string;
        sell: string;
        cv: string;
        rv: string;
      }[]
    >`SELECT i."storeId" AS "storeId", p.id AS id, p.name AS name, p.sku AS sku, i.quantity::text AS qty,
             p."costPrice"::numeric(18,4)::text AS cost, p."sellingPrice"::numeric(18,4)::text AS sell,
             ROUND(i.quantity * p."costPrice", 2)::text AS cv, ROUND(i.quantity * p."sellingPrice", 2)::text AS rv
      FROM inventory i JOIN products p ON p.id = i."productId" AND p."tenantId" = i."tenantId"
      WHERE i."tenantId" = ${tenantId} AND i.quantity > 0
        ${storeId ? Prisma.sql`AND i."storeId" = ${storeId}` : Prisma.empty}
      ORDER BY p.name ASC, i."storeId" ASC`;
    const out: StockValuationRow[] = rows.map((x) => ({
      storeId: x.storeId,
      productId: x.id,
      productName: x.name,
      sku: x.sku,
      quantity: roundDecimalString(x.qty, 3),
      costPrice: x.cost,
      sellingPrice: x.sell,
      costValue: x.cv,
      retailValue: x.rv,
    }));
    return {
      rows: out,
      totalCostValue: sumOf(out.map((x) => x.costValue)),
      totalRetailValue: sumOf(out.map((x) => x.retailValue)),
    };
  }
}
