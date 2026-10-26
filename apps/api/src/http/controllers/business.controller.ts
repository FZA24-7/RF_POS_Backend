import type { Request, Response } from 'express';
import type {
  CreateCustomerInput,
  CreateEmployeeInput,
  CreateExpenseInput,
  CustomerListQuery,
  CustomerPaymentInput,
  EmployeeListQuery,
  ExpenseListQuery,
  ReportExportQuery,
  StockValuationQuery,
  UpdateCustomerInput,
  UpdateEmployeeInput,
  UpdateExpenseInput,
} from '@mafk/validation';
import { DomainError } from '../../domain/types.js';
import type { CustomerService } from '../../services/customer.service.js';
import type { EmployeeService } from '../../services/employee.service.js';
import type { ExpenseService } from '../../services/expense.service.js';
import type { ReportKind, ReportService } from '../../services/report.service.js';
import type { SaleActor } from '../../services/sale.service.js';

const actorFrom = (req: Request): SaleActor => {
  if (!req.auth?.tenantId)
    throw new DomainError('TENANT_REQUIRED', 'This action requires a tenant context.', 403);
  return { id: req.auth.userId, tenantId: req.auth.tenantId, permissions: req.auth.permissions };
};
const idOf = (req: Request): string => (req.params as { id: string }).id;

export const createCustomerController = (customers: CustomerService) => ({
  async list(req: Request, res: Response): Promise<void> {
    res
      .status(200)
      .json(
        await customers.list(actorFrom(req).tenantId, req.query as unknown as CustomerListQuery),
      );
  },
  async getById(req: Request, res: Response): Promise<void> {
    res.status(200).json(await customers.getById(idOf(req), actorFrom(req).tenantId));
  },
  async create(req: Request, res: Response): Promise<void> {
    res.status(201).json(await customers.create(actorFrom(req), req.body as CreateCustomerInput));
  },
  async update(req: Request, res: Response): Promise<void> {
    res
      .status(200)
      .json(await customers.update(actorFrom(req), idOf(req), req.body as UpdateCustomerInput));
  },
  async ledger(req: Request, res: Response): Promise<void> {
    res.status(200).json(await customers.ledger(idOf(req), actorFrom(req).tenantId));
  },
  async recordPayment(req: Request, res: Response): Promise<void> {
    res
      .status(201)
      .json(
        await customers.recordPayment(actorFrom(req), idOf(req), req.body as CustomerPaymentInput),
      );
  },
});

export const createExpenseController = (expenses: ExpenseService) => ({
  async list(req: Request, res: Response): Promise<void> {
    res
      .status(200)
      .json(await expenses.list(actorFrom(req).tenantId, req.query as unknown as ExpenseListQuery));
  },
  async getById(req: Request, res: Response): Promise<void> {
    res.status(200).json(await expenses.getById(idOf(req), actorFrom(req).tenantId));
  },
  async create(req: Request, res: Response): Promise<void> {
    res.status(201).json(await expenses.create(actorFrom(req), req.body as CreateExpenseInput));
  },
  async update(req: Request, res: Response): Promise<void> {
    res
      .status(200)
      .json(await expenses.update(actorFrom(req), idOf(req), req.body as UpdateExpenseInput));
  },
  async remove(req: Request, res: Response): Promise<void> {
    await expenses.delete(actorFrom(req), idOf(req));
    res.status(204).end();
  },
});

export const createEmployeeController = (employees: EmployeeService) => ({
  async list(req: Request, res: Response): Promise<void> {
    res
      .status(200)
      .json(await employees.list(actorFrom(req), req.query as unknown as EmployeeListQuery));
  },
  async getById(req: Request, res: Response): Promise<void> {
    res.status(200).json(await employees.getById(actorFrom(req), idOf(req)));
  },
  async create(req: Request, res: Response): Promise<void> {
    res.status(201).json(await employees.create(actorFrom(req), req.body as CreateEmployeeInput));
  },
  async update(req: Request, res: Response): Promise<void> {
    res
      .status(200)
      .json(await employees.update(actorFrom(req), idOf(req), req.body as UpdateEmployeeInput));
  },
});

export const createReportController = (reports: ReportService) => {
  const sendCsv = (res: Response, file: { filename: string; content: string }): void => {
    res
      .status(200)
      .setHeader('Content-Type', 'text/csv; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="${file.filename}"`)
      // BOM so Excel on Windows reads UTF-8 names correctly.
      .send(`\ufeff${file.content}`);
  };
  /** CSV needs `reports.export` on top of `reports.view` - checked on the server, not just hidden in the UI. */
  const wantsCsv = (req: Request, format: string): boolean => {
    if (format !== 'csv') return false;
    if (!actorFrom(req).permissions.has('reports.export')) {
      throw new DomainError('PERMISSION_DENIED', 'You are not allowed to export reports.', 403);
    }
    return true;
  };

  const rangeReport =
    (kind: ReportKind) =>
    async (req: Request, res: Response): Promise<void> => {
      const q = req.query as unknown as ReportExportQuery;
      const tenantId = actorFrom(req).tenantId;
      if (wantsCsv(req, q.format)) return sendCsv(res, await reports.csv(tenantId, kind, q));
      const out =
        kind === 'sales-summary'
          ? await reports.salesSummary(tenantId, q)
          : kind === 'daily'
            ? await reports.daily(tenantId, q)
            : kind === 'hourly'
              ? await reports.hourly(tenantId, q)
              : kind === 'top-products'
                ? await reports.topProducts(tenantId, q)
                : kind === 'by-cashier'
                  ? await reports.byCashier(tenantId, q)
                  : kind === 'by-category'
                    ? await reports.byCategory(tenantId, q)
                    : await reports.profitLoss(tenantId, q);
      res.status(200).json(out);
    };

  const balanceReport =
    (kind: 'receivables' | 'payables') =>
    async (req: Request, res: Response): Promise<void> => {
      const q = req.query as unknown as StockValuationQuery;
      const tenantId = actorFrom(req).tenantId;
      if (wantsCsv(req, q.format)) {
        return sendCsv(
          res,
          await reports.csv(tenantId, kind, {
            from: '2000-01-01',
            to: '2000-01-01',
            format: 'csv',
            limit: 10,
          }),
        );
      }
      res
        .status(200)
        .json(
          kind === 'receivables'
            ? await reports.receivables(tenantId)
            : await reports.payables(tenantId),
        );
    };

  return {
    salesSummary: rangeReport('sales-summary'),
    daily: rangeReport('daily'),
    hourly: rangeReport('hourly'),
    topProducts: rangeReport('top-products'),
    byCashier: rangeReport('by-cashier'),
    byCategory: rangeReport('by-category'),
    profitLoss: rangeReport('profit-loss'),
    receivables: balanceReport('receivables'),
    payables: balanceReport('payables'),
    async stockValuation(req: Request, res: Response): Promise<void> {
      const q = req.query as unknown as StockValuationQuery;
      const tenantId = actorFrom(req).tenantId;
      if (wantsCsv(req, q.format)) {
        return sendCsv(
          res,
          await reports.csv(tenantId, 'stock-valuation', {
            from: '2000-01-01',
            to: '2000-01-01',
            storeId: q.storeId,
            format: 'csv',
            limit: 10,
          }),
        );
      }
      res.status(200).json(await reports.stockValuation(tenantId, q.storeId));
    },
    async overview(req: Request, res: Response): Promise<void> {
      res
        .status(200)
        .json(
          await reports.overview(
            actorFrom(req).tenantId,
            req.query as unknown as ReportExportQuery,
          ),
        );
    },
  };
};
