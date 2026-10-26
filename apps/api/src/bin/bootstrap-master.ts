// DATABASE STATUS (Phase 4.2): run against PostgreSQL 16 in the sandbox ("Master Admin ... created").
//
// Creates the platform's first Master Admin, from environment variables only. There is no hardcoded/default master
// account anywhere in this codebase - if this script is never run, no Master Admin exists. The password must be
// supplied explicitly (MASTER_ADMIN_PASSWORD); the Login ID and display name default from .env.example.
import { loadExampleEnv } from '@mafk/database/load-example-env';
import { createPrismaClient } from '@mafk/database';
import {
  DEFAULT_ROLE_PERMISSIONS,
  isValidLoginIdFormat,
  normalizeLoginId,
  PERMISSION_CATALOG,
} from '@mafk/shared';
import { loadEnv } from '../config/env.js';
import { PasswordHasher } from '../security/password.js';

loadExampleEnv(); // local dev defaults from .env.example; MASTER_ADMIN_PASSWORD must be supplied explicitly

async function main(): Promise<void> {
  const env = loadEnv();
  const loginIdRaw = process.env.MASTER_ADMIN_LOGIN_ID;
  const password = process.env.MASTER_ADMIN_PASSWORD;
  const displayName = process.env.MASTER_ADMIN_NAME ?? 'Master Admin';

  if (!loginIdRaw || !password) {
    throw new Error('MASTER_ADMIN_LOGIN_ID and MASTER_ADMIN_PASSWORD must be set to bootstrap.');
  }
  if (!isValidLoginIdFormat(loginIdRaw)) {
    throw new Error('MASTER_ADMIN_LOGIN_ID has an invalid format.');
  }
  const loginId = normalizeLoginId(loginIdRaw);

  const prisma = createPrismaClient({ databaseUrl: env.DATABASE_URL });
  try {
    const existing = await prisma.user.findFirst({ where: { loginId } });
    if (existing) {
      console.log(`A user with Login ID "${loginId}" already exists. Nothing to do.`);
      return;
    }

    // Ensure the permission catalog exists (idempotent).
    for (const key of PERMISSION_CATALOG) {
      const [resource, action] = key.split('.');
      await prisma.permission.upsert({
        where: { key },
        create: { key, resource: resource ?? key, action: action ?? 'view' },
        update: {},
      });
    }

    // (tenantId, key) cannot be used as a unique lookup for platform roles: PostgreSQL treats NULLs as distinct,
    // so look the role up explicitly instead of upserting.
    const existingRole = await prisma.role.findFirst({
      where: { tenantId: null, key: 'master-admin' },
    });
    const role =
      existingRole ??
      (await prisma.role.create({
        data: {
          tenantId: null,
          key: 'master-admin',
          name: 'Master Admin',
          systemRole: 'MASTER_ADMIN',
          isSystem: true,
          permissions: {
            create: DEFAULT_ROLE_PERMISSIONS.MASTER_ADMIN.map((key) => ({
              permission: { connect: { key } },
            })),
          },
        },
      }));

    const hasher = new PasswordHasher({
      memoryCostKib: env.ARGON2_MEMORY_KIB,
      timeCost: env.ARGON2_TIME_COST,
    });
    const passwordHash = await hasher.hash(password);

    const user = await prisma.user.create({
      data: {
        tenantId: null,
        roleId: role.id,
        loginId,
        displayName,
        passwordHash,
        status: 'ACTIVE',
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: null,
        userId: user.id,
        action: 'MASTER_ADMIN_BOOTSTRAPPED',
        entity: 'User',
        entityId: user.id,
      },
    });

    console.log(`Master Admin "${loginId}" created.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
