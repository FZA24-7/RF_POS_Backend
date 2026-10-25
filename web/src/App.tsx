import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './state/auth.js';
import { Shell, type NavItem } from './components/Shell.js';
import { LoginPage } from './LOGIN/index.js';
import { Spinner } from './components/ui/Spinner.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { TenantDetailPage } from './pages/TenantDetailPage.js';
import { CategoriesPage } from './pages/CategoriesPage.js';
import { SubDepartmentsPage } from './pages/SubDepartmentsPage.js';
import { BrandsPage } from './pages/BrandsPage.js';
import { ProductsPage } from './pages/ProductsPage.js';
import { InventoryPage } from './pages/InventoryPage.js';
import { BarcodeLookupPage } from './pages/BarcodeLookupPage.js';
import { SuppliersPage } from './pages/SuppliersPage.js';
import { PurchasesPage } from './pages/PurchasesPage.js';
import { PosPage } from './pages/PosPage.js';
import { SalesPage } from './pages/SalesPage.js';
import { CustomersPage } from './pages/CustomersPage.js';
import { ExpensesPage } from './pages/ExpensesPage.js';
import { EmployeesPage } from './pages/EmployeesPage.js';
import { ReportsPage } from './pages/ReportsPage.js';
import { AnalyticsPage } from './pages/AnalyticsPage.js';
import { apiRequest } from './api/client.js';

type View =
  | { name: 'dashboard' }
  | { name: 'tenant'; tenantId: string }
  | { name: 'categories' }
  | { name: 'sub-departments' }
  | { name: 'brands' }
  | { name: 'products' }
  | { name: 'inventory' }
  | { name: 'barcode' }
  | { name: 'suppliers' }
  | { name: 'purchases' }
  | { name: 'pos' }
  | { name: 'sales' }
  | { name: 'customers' }
  | { name: 'expenses' }
  | { name: 'employees' }
  | { name: 'reports' }
  | { name: 'analytics' };

const MASTER_NAV: NavItem[] = [{ key: 'dashboard', label: 'Dashboard' }];

const TENANT_NAV: NavItem[] = [
  { key: 'categories', label: 'Categories' },
  { key: 'sub-departments', label: 'Sub-Departments' },
  { key: 'brands', label: 'Brands' },
  { key: 'products', label: 'Products' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'barcode', label: 'Barcode Lookup' },
  { key: 'suppliers', label: 'Suppliers' },
  { key: 'purchases', label: 'Purchases' },
  { key: 'pos', label: 'POS' },
  { key: 'sales', label: 'Sales & Refunds' },
  { key: 'customers', label: 'Customers' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'employees', label: 'Employees' },
  { key: 'reports', label: 'Reports' },
  { key: 'analytics', label: 'Analytics' },
];

const AuthenticatedApp = () => {
  const { user } = useAuth();
  const isTenantUser = !!user?.tenantId;
  const [view, setView] = useState<View>(
    isTenantUser ? { name: 'categories' } : { name: 'dashboard' },
  );
  const [storeId, setStoreId] = useState<string | null>(null);
  // Bumped every time the Dashboard nav button is pressed, so the page remounts: it reloads stats + the client
  // list, closes an open "New Client" form and clears filters - the button never looks dead when already on it.
  const [dashboardKey, setDashboardKey] = useState(0);

  useEffect(() => {
    if (!isTenantUser) return;
    void (async () => {
      try {
        const stores = await apiRequest<{ id: string }[]>('/stores');
        setStoreId(stores[0]?.id ?? null);
      } catch {
        setStoreId(null);
      }
    })();
  }, [isTenantUser]);

  const nav = isTenantUser ? TENANT_NAV : MASTER_NAV;
  const activeNavKey = view.name === 'tenant' ? 'dashboard' : view.name;

  const navigate = (key: string) => {
    if (key === 'dashboard') {
      setDashboardKey((k) => k + 1);
      setView({ name: 'dashboard' });
    } else setView({ name: key } as View);
  };

  let content;
  switch (view.name) {
    case 'dashboard':
      content = (
        <DashboardPage
          key={dashboardKey}
          onOpenTenant={(tenantId) => setView({ name: 'tenant', tenantId })}
        />
      );
      break;
    case 'tenant':
      content = (
        <TenantDetailPage
          tenantId={view.tenantId}
          onBack={() => {
            setDashboardKey((k) => k + 1);
            setView({ name: 'dashboard' });
          }}
        />
      );
      break;
    case 'categories':
      content = <CategoriesPage />;
      break;
    case 'sub-departments':
      content = <SubDepartmentsPage />;
      break;
    case 'brands':
      content = <BrandsPage />;
      break;
    case 'products':
      content = <ProductsPage />;
      break;
    case 'inventory':
      content = storeId ? (
        <InventoryPage storeId={storeId} />
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading branch…</p>
      );
      break;
    case 'barcode':
      content = <BarcodeLookupPage />;
      break;
    case 'suppliers':
      content = <SuppliersPage />;
      break;
    case 'purchases':
      content = <PurchasesPage />;
      break;
    case 'pos':
      content = storeId ? (
        <PosPage storeId={storeId} />
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading branch…</p>
      );
      break;
    case 'sales':
      content = <SalesPage />;
      break;
    case 'customers':
      content = <CustomersPage />;
      break;
    case 'expenses':
      content = <ExpensesPage />;
      break;
    case 'employees':
      content = <EmployeesPage />;
      break;
    case 'reports':
      content = <ReportsPage />;
      break;
    case 'analytics':
      content = <AnalyticsPage />;
      break;
  }

  return (
    <Shell nav={nav} activeNavKey={activeNavKey} onNavigate={navigate}>
      {content}
    </Shell>
  );
};

const AppContent = () => {
  const { status } = useAuth();
  if (status === 'restoring') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Checking your session…" />
      </div>
    );
  }
  return status === 'authenticated' ? <AuthenticatedApp /> : <LoginPage />;
};

const App = () => (
  <AuthProvider>
    <AppContent />
  </AuthProvider>
);

export default App;
