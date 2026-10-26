import { useCallback, useEffect, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { apiRequest, ApiError } from '../api/client.js';
import type { PlatformStats, TenantListResult, TenantStatus } from '../api/types.js';
import { Card, CardBody } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Button } from '../components/ui/Button.js';
import { Input } from '../components/ui/Input.js';
import { Spinner } from '../components/ui/Spinner.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { ErrorBanner } from '../components/ui/ErrorBanner.js';
import { CreateTenantForm } from '../components/CreateTenantForm.js';

const statusTone = (status: TenantStatus) =>
  status === 'ACTIVE' ? 'green' : status === 'SUSPENDED' ? 'amber' : 'slate';

const StatCard = ({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) => (
  <Card>
    <CardBody>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-white">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p> : null}
    </CardBody>
  </Card>
);

export const DashboardPage = ({ onOpenTenant }: { onOpenTenant: (tenantId: string) => void }) => {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [tenants, setTenants] = useState<TenantListResult | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<TenantStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams();
      if (search) query.set('search', search);
      if (status) query.set('status', status);
      const [statsRes, tenantsRes] = await Promise.all([
        apiRequest<PlatformStats>('/master/stats'),
        apiRequest<TenantListResult>(`/master/tenants?${query.toString()}`),
      ]);
      setStats(statsRes);
      setTenants(tenantsRes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load dashboard data.');
    } finally {
      setLoading(false);
    }
  }, [search, status]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Dashboard</h1>
        <Button onClick={() => setShowCreate((v) => !v)}>
          <Plus size={16} /> New Client
        </Button>
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      {showCreate ? (
        <CreateTenantForm
          onCancel={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            void load();
          }}
        />
      ) : null}

      {loading && !stats ? (
        <Spinner label="Loading dashboard…" />
      ) : stats ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            label="Tenants"
            value={stats.tenants.total}
            hint={`${stats.tenants.active} active`}
          />
          <StatCard
            label="Licenses"
            value={stats.licenses.total}
            hint={`${stats.licenses.expiringSoon} expiring soon`}
          />
          <StatCard label="Expired licenses" value={stats.licenses.expired} />
          <StatCard
            label="System"
            value={stats.databaseReachable ? 'Healthy' : 'Degraded'}
            hint={`${stats.users.total} users total`}
          />
        </div>
      ) : null}

      <Card>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search
                className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400"
                size={16}
              />
              <Input
                placeholder="Search by name or code…"
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              className="focus-ring rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              value={status}
              onChange={(e) => setStatus(e.target.value as TenantStatus | '')}
            >
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </div>

          {loading ? (
            <Spinner label="Loading clients…" />
          ) : !tenants || tenants.items.length === 0 ? (
            <EmptyState
              title="No clients yet"
              description="Create your first client to get started."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <th className="py-2 pr-4">Code</th>
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.items.map((t) => (
                    <tr
                      key={t.id}
                      className="cursor-pointer border-b border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                      onClick={() => onOpenTenant(t.id)}
                    >
                      <td className="py-2.5 pr-4 font-mono text-xs">{t.code}</td>
                      <td className="py-2.5 pr-4">{t.name}</td>
                      <td className="py-2.5 pr-4">
                        <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                      </td>
                      <td className="py-2.5 pr-4 text-slate-500 dark:text-slate-400">
                        {new Date(t.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
};
