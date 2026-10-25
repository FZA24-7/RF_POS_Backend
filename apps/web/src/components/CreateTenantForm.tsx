import { useState } from 'react';
import type { FormEvent } from 'react';
import { MODULE_CATALOG } from '@mafk/shared';
import { apiRequest, ApiError } from '../api/client.js';
import type { CreateTenantPayload } from '../api/types.js';
import { Button } from './ui/Button.js';
import { Input, Label } from './ui/Input.js';
import { Card, CardBody, CardHeader } from './ui/Card.js';
import { ErrorBanner } from './ui/ErrorBanner.js';

const TENANT_CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,19}$/;
const LOGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/** Mirrors the server rules (packages/validation) so the user gets a clear message instead of a failed request. */
const validateForm = (f: {
  code: string;
  name: string;
  storeName: string;
  adminLoginId: string;
  adminName: string;
  adminPassword: string;
  planCode: string;
  expiresAt: string;
  maxUsers: number;
  maxDevices: number;
  maxStores: number;
}): string | null => {
  if (!TENANT_CODE_RE.test(f.code.trim().toUpperCase()))
    return 'Tenant code must be 2-20 characters: letters, numbers or dash (e.g. ACME).';
  if (f.name.trim().length < 2) return 'Business name must be at least 2 characters.';
  if (f.storeName.trim().length < 2) return 'Default branch name must be at least 2 characters.';
  if (!LOGIN_ID_RE.test(f.adminLoginId.trim().toLowerCase()))
    return 'Login ID must be 3-32 characters: letters, numbers, dot, dash or underscore (no spaces).';
  if (f.adminName.trim().length < 2) return 'Display name must be at least 2 characters.';
  const pw = f.adminPassword;
  if (pw.length < 10 || pw.length > 128)
    return 'Password must be 10-128 characters and include a lowercase letter, an uppercase letter and a digit.';
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw))
    return 'Password must include a lowercase letter, an uppercase letter and a digit.';
  if (f.planCode.trim().length < 2) return 'Plan code must be at least 2 characters.';
  if (!f.expiresAt || Number.isNaN(new Date(f.expiresAt).getTime()))
    return 'Please choose a valid license expiry date.';
  for (const n of [f.maxUsers, f.maxDevices, f.maxStores])
    if (!Number.isInteger(n) || n < 1) return 'Max users, devices and branches must be whole numbers of 1 or more.';
  return null;
};

export const CreateTenantForm = ({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) => {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [storeName, setStoreName] = useState('Main Branch');
  const [adminLoginId, setAdminLoginId] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminName, setAdminName] = useState('');
  const [planCode, setPlanCode] = useState('STANDARD');
  const [maxUsers, setMaxUsers] = useState(10);
  const [maxDevices, setMaxDevices] = useState(5);
  const [maxStores, setMaxStores] = useState(3);
  const [expiresAt, setExpiresAt] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const problem = validateForm({
      code,
      name,
      storeName,
      adminLoginId,
      adminName,
      adminPassword,
      planCode,
      expiresAt,
      maxUsers,
      maxDevices,
      maxStores,
    });
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    try {
      const payload: CreateTenantPayload = {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        defaultStoreName: storeName.trim(),
        masterAdmin: {
          loginId: adminLoginId.trim().toLowerCase(),
          password: adminPassword,
          displayName: adminName.trim(),
        },
        license: {
          planCode: planCode.trim(),
          expiresAt: new Date(expiresAt).toISOString(),
          maxUsers,
          maxDevices,
          maxStores,
          enabledModules: [...MODULE_CATALOG],
        },
      };
      await apiRequest('/master/tenants', { method: 'POST', body: payload });
      onCreated();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not reach the server. Check that the API is running and CLIENT_URL matches this page address.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
          New Client / Tenant
        </h2>
      </CardHeader>
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error ? <ErrorBanner message={error} /> : null}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="code">Tenant code</Label>
              <Input
                id="code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="ACME"
                required
              />
            </div>
            <div>
              <Label htmlFor="name">Business name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          </div>

          <div>
            <Label htmlFor="storeName">Default branch name</Label>
            <Input
              id="storeName"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              required
            />
          </div>

          <fieldset className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
            <legend className="px-1 text-xs font-medium text-slate-500 dark:text-slate-400">
              Client Master Admin
            </legend>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="adminLoginId">Login ID</Label>
                <Input
                  id="adminLoginId"
                  value={adminLoginId}
                  onChange={(e) => setAdminLoginId(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="adminName">Display name</Label>
                <Input
                  id="adminName"
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="mt-4">
              <Label htmlFor="adminPassword">Temporary password</Label>
              <Input
                id="adminPassword"
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                At least 10 characters, with a lowercase letter, an uppercase letter and a digit.
              </p>
            </div>
          </fieldset>

          <fieldset className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
            <legend className="px-1 text-xs font-medium text-slate-500 dark:text-slate-400">
              Initial license
            </legend>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="planCode">Plan code</Label>
                <Input
                  id="planCode"
                  value={planCode}
                  onChange={(e) => setPlanCode(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="expiresAt">Expires</Label>
                <Input
                  id="expiresAt"
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="maxUsers">Max users</Label>
                <Input
                  id="maxUsers"
                  type="number"
                  min={1}
                  value={maxUsers}
                  onChange={(e) => setMaxUsers(Number(e.target.value))}
                  required
                />
              </div>
              <div>
                <Label htmlFor="maxDevices">Max devices</Label>
                <Input
                  id="maxDevices"
                  type="number"
                  min={1}
                  value={maxDevices}
                  onChange={(e) => setMaxDevices(Number(e.target.value))}
                  required
                />
              </div>
              <div>
                <Label htmlFor="maxStores">Max branches</Label>
                <Input
                  id="maxStores"
                  type="number"
                  min={1}
                  value={maxStores}
                  onChange={(e) => setMaxStores(Number(e.target.value))}
                  required
                />
              </div>
            </div>
          </fieldset>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create client'}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
};
