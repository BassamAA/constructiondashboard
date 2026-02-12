import { Suspense, lazy, type ComponentType, type LazyExoticComponent } from "react";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import AppLayout from "./components/layout/AppLayout";
import { RequireAuth } from "./components/auth/RequireAuth";

const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const ReportsPage = lazy(() => import("./pages/ReportsPage"));
const InvoicesPage = lazy(() => import("./pages/InvoicesPage"));
const InvoicePrintPage = lazy(() => import("./pages/InvoicePrintPage"));
const CustomersPage = lazy(() => import("./pages/CustomersPage"));
const JobSitesPage = lazy(() => import("./pages/JobSitesPage"));
const ProductsPage = lazy(() => import("./pages/ProductsPage"));
const SuppliersPage = lazy(() => import("./pages/SuppliersPage"));
const InventoryPage = lazy(() => import("./pages/InventoryPage"));
const ManufacturingPage = lazy(() => import("./pages/ManufacturingPage"));
const FinancePage = lazy(() => import("./pages/FinancePage"));
const FleetPage = lazy(() => import("./pages/FleetPage"));
const ToolsPage = lazy(() => import("./pages/ToolsPage"));
const ReceiptsPage = lazy(() => import("./pages/ReceiptsPage"));
const DailyReportPage = lazy(() => import("./pages/DailyReportPage"));
const InventoryPrintPage = lazy(() => import("./pages/InventoryPrintPage"));
const TehmilTenzilPage = lazy(() => import("./pages/TehmilTenzilPage"));
const TaxPage = lazy(() => import("./pages/TaxPage"));
const ReceiptPrintPage = lazy(() => import("./pages/ReceiptPrintPage"));
const WorkerReceiptsPage = lazy(() => import("./pages/WorkerReceiptsPage"));
const WorkerReceiptPrintPage = lazy(() => import("./pages/WorkerReceiptPrintPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const DieselPage = lazy(() => import("./pages/DieselPage"));
const DebrisPage = lazy(() => import("./pages/DebrisPage"));
const PaymentsPage = lazy(() => import("./pages/PaymentsPage"));
const EmployeesPage = lazy(() => import("./pages/EmployeesPage"));
const PayrollPage = lazy(() => import("./pages/PayrollPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));
const AdminUsersPage = lazy(() => import("./pages/AdminUsersPage"));
const DebugPage = lazy(() => import("./pages/DebugPage"));

const defaultFallback = (
  <div style={{ padding: "24px", textAlign: "center" }}>Loading…</div>
);

const withSuspense = (Component: LazyExoticComponent<ComponentType<unknown>>) => (
  <Suspense fallback={defaultFallback}>
    <Component />
  </Suspense>
);

const router = createBrowserRouter([
  {
    path: "/",
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    errorElement: withSuspense(NotFoundPage),
    children: [
      { index: true, element: withSuspense(DashboardPage) },
      { path: "reports", element: withSuspense(ReportsPage) },
      { path: "daily-report", element: withSuspense(DailyReportPage) },
{ path: "invoices", element: withSuspense(InvoicesPage) },
      { path: "customers", element: withSuspense(CustomersPage) },
      { path: "job-sites", element: withSuspense(JobSitesPage) },
      { path: "products", element: withSuspense(ProductsPage) },
      { path: "suppliers", element: withSuspense(SuppliersPage) },
      { path: "inventory", element: withSuspense(InventoryPage) },
      { path: "manufacturing", element: withSuspense(ManufacturingPage) },
      { path: "finance", element: withSuspense(FinancePage) },
      { path: "fleet", element: withSuspense(FleetPage) },
      { path: "tools", element: withSuspense(ToolsPage) },
      { path: "diesel", element: withSuspense(DieselPage) },
{ path: "receipts", element: withSuspense(ReceiptsPage) },
      { path: "tehmil-tenzil", element: withSuspense(TehmilTenzilPage) },
      { path: "tax", element: withSuspense(TaxPage) },
      { path: "debris", element: withSuspense(DebrisPage) },
      { path: "payments", element: withSuspense(PaymentsPage) },
      { path: "employees", element: withSuspense(EmployeesPage) },
      { path: "payroll", element: withSuspense(PayrollPage) },
      { path: "admin/users", element: withSuspense(AdminUsersPage) },
      { path: "debug", element: withSuspense(DebugPage) },
      { path: "*", element: withSuspense(NotFoundPage) },
    ],
  },
  { path: "/login", element: withSuspense(LoginPage) },
  {
    path: "/invoices/print",
    element: (
      <RequireAuth>
        {withSuspense(InvoicePrintPage)}
      </RequireAuth>
    ),
  },
  {
    path: "/receipts/print",
    element: (
      <RequireAuth>
        {withSuspense(ReceiptPrintPage)}
      </RequireAuth>
    ),
  },
  {
    path: "/inventory/print",
    element: (
      <RequireAuth>
        {withSuspense(InventoryPrintPage)}
      </RequireAuth>
    ),
  },
  {
    path: "/worker/receipts",
    element: (
      <RequireAuth>
        {withSuspense(WorkerReceiptsPage)}
      </RequireAuth>
    ),
  },
  {
    path: "/worker/receipts/print",
    element: (
      <RequireAuth>
        {withSuspense(WorkerReceiptPrintPage)}
      </RequireAuth>
    ),
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}

export default App;
