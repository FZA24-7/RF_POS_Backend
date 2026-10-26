import type { Prisma } from '@mafk/database';
import type { TransactionalAudit } from '../../domain/types.js';

/** Audit metadata as a Prisma JSON object (extra keys win over the caller's). */
export const auditMeta = (
  audit: TransactionalAudit,
  extra: Record<string, unknown> = {},
): Prisma.InputJsonObject =>
  JSON.parse(JSON.stringify({ ...(audit.metadata ?? {}), ...extra })) as Prisma.InputJsonObject;
