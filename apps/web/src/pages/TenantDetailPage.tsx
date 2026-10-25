import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { apiRequest, ApiError } from '../api/client.js';
import type {
  AuditLogEntry,
  LicenseSummary,
  StoreSummary,
  TenantDetail,
  TenantStatus,
  UserSummary,
} from '../api/types.js';
import { Card, CardBody, CardHeader } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Button } from '../components/ui/Button.js';
import { Spinner } from '../components/ui/Spinner.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { ErrorBanner } from '../components/ui/ErrorBanner.js';

const statusTone = (status: TenantStatus) =>
  status === 'ACTIVE' ? 'green' : status === 'SUSPENDED' ? 'amber' : 'slate';
const licenseTone = (status: LicenseSummary['status']) =>
  status === 'ACTIVE' ? 'green' : status === 'EXPIRED' ? 'red' : 'amber';

interface TenantData {
  tenant: TenantDetail;
  stores: StoreSummary[];
  users: UserSummary[];
  licenses: LicenseSummary[];
  auditLogs: AuditLogEntry[];
}

export const TenantDetailPage = ({
  tenantId,
  onBack,
}: {
  tenantId: string;
  onBack: () => void;
}) => {
  const [data, setData] = useState<TenantData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tenant, stores, users, licenses, auditLogs] = await Promise.all([
        apiRequest<TenantDetail>(`/master/tenants/${tenantId}`),
        apiRequest<StoreSummary[]>(`/master/tenants/${tenantId}/stores`),
        apiRequest<UserSummary[]>(`/master/tenants/${tenantId}/users`),
        apiRequest<LicenseSummary[]>(`/master/tenants/${tenantId}/licenses`),
        apiRequest<AuditLogEntry[]>(`/master/tenants/${tenantId}/audit-logs`),
      ]);
      setData({ tenant, stores, users, licenses, auditLogs });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load tenant.');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeStatus = async (next: TenantStatus) => {
    setStatusUpdating(true);
    try {
      await apiRequest(`/master/tenants/${tenantId}/status`, {
        method: 'PATCH',
        body: { status: next },
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update status.');
    } finally {
      setStatusUpdating(false);
    }
  };

  return (
    <div className="space-y-6">
      <Button variant="ghost" onClick={onBack}>
        <ArrowLeft size={16} /> Back to dashboard
      </Button>

      {error ? <ErrorBanner message={error} /> : null}

      {loading ? (
        <Spinner label="Loading tenant…" />
      ) : !data ? (
        <EmptyState title="Tenant not found" />
      ) : (
        <>
          <Card>
            <CardHeader className="flex items-center justify-between">
              <div>
                <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
                  {data.tenant.name}
                </h1>
                <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
                  {data.tenant.code}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={statusTone(data.tenant.status)}>{data.tenant.status}</Badge>
                {data.tenant.status === 'ACTIVE' ? (
                  <Button
                    variant="danger"
                    disabled={statusUpdating}
                    onClick={() => void changeStatus('SUSPENDED')}
                  >
                    Suspend
                  </Button>
                ) : (
                  <Button disabled={statusUpdating} onClick={() => void changeStatus('ACTIVE')}>
                    Activate
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardBody className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <p className="text-slate-500 dark:text-slate-400">Contact email</p>
                <p>{data.tenant.contactEmail ?? '—'}</p>
              </div>
              <div>
                <p className="text-slate-500 dark:text-slate-400">Contact phone</p>
                <p>{data.tenant.contactPhone ?? '—'}</p>
              </div>
              <div>
                <p className="text-slate-500 dark:text-slate-400">Created</p>
                <p>{new Date(data.tenant.createdAt).toLocaleDateString()}</p>
              </div>
              <div>
                <p className="text-slate-500 dark:text-slate-400">Branches</p>
                <p>{data.stores.length}</p>
              </div>
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">License</h2>
              </CardHeader>
              <CardBody>
                {data.licenses.length === 0 ? (
                  <EmptyState title="No license on file" />
                ) : (
                  <ul className="space-y-3">
                    {data.licenses.map((l) => (
                      <li key={l.id} className="flex items-center justify-between text-sm">
                        <div>
                          <p className="font-medium">{l.planCode}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Expires {new Date(l.expiresAt).toLocaleDateString()} · {l.maxUsers}{' '}
                            users · {l.maxStores} branches
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Modules: {l.enabledModules.join(', ') || 'none'}
                          </p>
                        </div>
                        <Badge tone={licenseTone(l.status)}>{l.status}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Users</h2>
              </CardHeader>
              <CardBody>
                {data.users.length === 0 ? (
                  <EmptyState title="No users yet" />
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {data.users.map((u) => (
                      <li key={u.id} className="flex items-center justify-between py-2 text-sm">
                        <div>
                          <p className="font-medium">{u.displayName}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {u.loginId} · {u.systemRole}
                          </p>
                        </div>
                        <Badge tone={u.status === 'ACTIVE' ? 'green' : 'slate'}>{u.status}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Audit activity
              </h2>
            </CardHeader>
            <CardBody>
              {data.auditLogs.length === 0 ? (
                <EmptyState title="No activity recorded yet" />
              ) : (
                <ul className="space-y-2 text-sm">
                  {data.auditLogs.map((entry) => (
                    <li key={entry.id} className="flex items-center justify-between">
                      <span>
                        <span className="font-medium">{entry.action}</span>{' '}
                        <span className="text-slate-500 dark:text-slate-400">
                          on {entry.entity}
                        </span>
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {new Date(entry.createdAt).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
};
