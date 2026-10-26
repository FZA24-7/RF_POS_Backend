import { Router } from 'express';
import {
  createCustomerSchema,
  createEmployeeSchema,
  createExpenseSchema,
  customerListQuerySchema,
  customerPaymentSchema,
  employeeListQuerySchema,
  expenseListQuerySchema,
  idParamSchema,
  reportExportQuerySchema,
  stockValuationQuerySchema,
  updateCustomerSchema,
  updateEmployeeSchema,
  updateExpenseSchema,
} from '@mafk/validation';
import type { AccessTokenService } from '../../security/jwt.js';
import type {
  createCustomerController,
  createEmployeeController,
  createExpenseController,
  createReportController,
} from '../controllers/business.controller.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requirePermission, requireTenant } from '../middleware/require-permission.js';

export interface BusinessControllers {
  customers: ReturnType<typeof createCustomerController>;
  expenses: ReturnType<typeof createExpenseController>;
  employees: ReturnType<typeof createEmployeeController>;
  reports: ReturnType<typeof createReportController>;
}

export const businessRoutes = (
  c: BusinessControllers,
  accessTokens: AccessTokenService,
): Router => {
  const router = Router();
  for (const prefix of ['/customers', '/expenses', '/employees', '/reports', '/analytics']) {
    router.use(prefix, requireAuth(accessTokens), requireTenant);
  }
  const id = validate(idParamSchema, 'params');

  // Customers
  router.get(
    '/customers',
    requirePermission('customers.view'),
    validate(customerListQuerySchema, 'query'),
    c.customers.list,
  );
  router.post(
    '/customers',
    requirePermission('customers.create'),
    validate(createCustomerSchema),
    c.customers.create,
  );
  router.get('/customers/:id', requirePermission('customers.view'), id, c.customers.getById);
  router.patch(
    '/customers/:id',
    requirePermission('customers.edit'),
    id,
    validate(updateCustomerSchema),
    c.customers.update,
  );
  router.get('/customers/:id/ledger', requirePermission('customers.view'), id, c.customers.ledger);
  router.post(
    '/customers/:id/payments',
    requirePermission('customers.edit'),
    id,
    validate(customerPaymentSchema),
    c.customers.recordPayment,
  );

  // Expenses
  router.get(
    '/expenses',
    requirePermission('expenses.view'),
    validate(expenseListQuerySchema, 'query'),
    c.expenses.list,
  );
  router.post(
    '/expenses',
    requirePermission('expenses.create'),
    validate(createExpenseSchema),
    c.expenses.create,
  );
  router.get('/expenses/:id', requirePermission('expenses.view'), id, c.expenses.getById);
  router.patch(
    '/expenses/:id',
    requirePermission('expenses.edit'),
    id,
    validate(updateExpenseSchema),
    c.expenses.update,
  );
  router.delete('/expenses/:id', requirePermission('expenses.delete'), id, c.expenses.remove);

  // Employees
  router.get(
    '/employees',
    requirePermission('employees.view'),
    validate(employeeListQuerySchema, 'query'),
    c.employees.list,
  );
  router.post(
    '/employees',
    requirePermission('employees.create'),
    validate(createEmployeeSchema),
    c.employees.create,
  );
  router.get('/employees/:id', requirePermission('employees.view'), id, c.employees.getById);
  router.patch(
    '/employees/:id',
    requirePermission('employees.edit'),
    id,
    validate(updateEmployeeSchema),
    c.employees.update,
  );

  // Reports (CSV additionally needs reports.export - checked in the controller)
  const range = validate(reportExportQuerySchema, 'query');
  const view = requirePermission('reports.view');
  router.get('/reports/sales-summary', view, range, c.reports.salesSummary);
  router.get('/reports/daily', view, range, c.reports.daily);
  router.get('/reports/hourly', view, range, c.reports.hourly);
  router.get('/reports/top-products', view, range, c.reports.topProducts);
  router.get('/reports/by-cashier', view, range, c.reports.byCashier);
  router.get('/reports/by-category', view, range, c.reports.byCategory);
  router.get('/reports/profit-loss', view, range, c.reports.profitLoss);
  router.get(
    '/reports/stock-valuation',
    view,
    validate(stockValuationQuerySchema, 'query'),
    c.reports.stockValuation,
  );
  router.get(
    '/reports/receivables',
    view,
    validate(stockValuationQuerySchema, 'query'),
    c.reports.receivables,
  );
  router.get(
    '/reports/payables',
    view,
    validate(stockValuationQuerySchema, 'query'),
    c.reports.payables,
  );

  // Analytics
  router.get('/analytics/overview', requirePermission('analytics.view'), range, c.reports.overview);

  return router;
};
