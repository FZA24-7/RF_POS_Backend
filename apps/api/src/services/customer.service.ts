import { compareDecimalStrings } from '@mafk/shared';
import type {
  CreateCustomerInput,
  CustomerListQuery,
  CustomerPaymentInput,
  UpdateCustomerInput,
} from '@mafk/validation';
import type { Repositories } from '../domain/ports.js';
import {
  CustomerNotFoundError,
  CustomerOverpaymentError,
  DomainError,
  type CustomerListResult,
  type CustomerPaymentRecord,
  type CustomerWithBalance,
  type Ledger,
  type Outstanding,
} from '../domain/types.js';
import type { SaleActor } from './sale.service.js';

const isPositive = (v: string | undefined): boolean =>
  v !== undefined && compareDecimalStrings(v, '0', 2) > 0;

/** Customers, their on-account (credit) balance and payments received. Money rules live in the repository. */
export class CustomerService {
  constructor(private readonly repos: Repositories) {}

  list(tenantId: string, query: CustomerListQuery): Promise<CustomerListResult> {
    return this.repos.customers.list(tenantId, query);
  }

  async getById(id: string, tenantId: string): Promise<CustomerWithBalance> {
    const c = await this.repos.customers.findById(id, tenantId);
    if (!c) throw new DomainError('NOT_FOUND', 'Customer not found.', 404);
    return c;
  }

  async create(actor: SaleActor, input: CreateCustomerInput): Promise<CustomerWithBalance> {
    // Granting credit or carrying a balance in is a financial decision: needs customers.edit, not just create.
    if (
      (isPositive(input.creditLimit) || isPositive(input.openingBalance)) &&
      !actor.permissions.has('customers.edit')
    ) {
      throw new DomainError(
        'PERMISSION_DENIED',
        'You are not allowed to set a credit limit or opening balance.',
        403,
      );
    }
    return this.repos.customers.create(
      actor.tenantId,
      {
        name: input.name,
        phone: input.phone,
        email: input.email,
        address: input.address,
        customerType: input.customerType,
        openingBalance: input.openingBalance,
        creditLimit: input.creditLimit,
      },
      {
        userId: actor.id,
        action: 'CUSTOMER_CREATED',
        metadata: { name: input.name, creditLimit: input.creditLimit ?? null },
      },
    );
  }

  async update(
    actor: SaleActor,
    id: string,
    patch: UpdateCustomerInput,
  ): Promise<CustomerWithBalance> {
    const updated = await this.repos.customers.update(id, actor.tenantId, patch, {
      userId: actor.id,
      action: 'CUSTOMER_UPDATED',
      metadata: { fields: Object.keys(patch) },
    });
    if (!updated) throw new DomainError('NOT_FOUND', 'Customer not found.', 404);
    return updated;
  }

  async ledger(id: string, tenantId: string): Promise<Ledger & { customerId: string }> {
    const ledger = await this.repos.customers.ledger(id, tenantId);
    if (!ledger) throw new DomainError('NOT_FOUND', 'Customer not found.', 404);
    return { customerId: id, ...ledger };
  }

  async recordPayment(
    actor: SaleActor,
    id: string,
    input: CustomerPaymentInput,
  ): Promise<{ payment: CustomerPaymentRecord; balance: string }> {
    try {
      return await this.repos.customers.recordPayment({
        tenantId: actor.tenantId,
        customerId: id,
        amount: input.amount,
        method: input.method,
        reference: input.reference,
        note: input.note,
        createdById: actor.id,
        audit: {
          userId: actor.id,
          action: 'CUSTOMER_PAYMENT_RECEIVED',
          metadata: { method: input.method },
        },
      });
    } catch (err) {
      if (err instanceof CustomerNotFoundError)
        throw new DomainError('NOT_FOUND', err.message, 404);
      if (err instanceof CustomerOverpaymentError)
        throw new DomainError('PAYMENT_EXCEEDS_BALANCE', err.message, 409);
      throw err;
    }
  }

  outstanding(tenantId: string): Promise<Outstanding> {
    return this.repos.customers.outstanding(tenantId);
  }
}
