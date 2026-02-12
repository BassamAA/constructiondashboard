import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useMemo, useState, useEffect } from "react";
import styles from "./AppLayout.module.css";
import { useAuth } from "../../context/AuthContext";
import type { PermissionKey } from "../../constants/permissions";

type RouteGroup = {
  label: string;
  routes: Array<{ path: string; label: string; icon: string; permission?: PermissionKey }>;
};

const managerRouteGroups: RouteGroup[] = [
  {
    label: "Workspace",
    routes: [
      { path: "/", label: "Dashboard", icon: "📊" },
      { path: "/invoices", label: "Invoices", icon: "🧾", permission: "invoices:view" },
      { path: "/reports", label: "Reports", icon: "📈", permission: "reports:view" },
      { path: "/daily-report", label: "Daily report", icon: "🗓️", permission: "reports:view" },
      { path: "/tax", label: "Tax", icon: "🧮", permission: "reports:view" },
      { path: "/receipts", label: "Receipts", icon: "🗒️", permission: "receipts:view" },
      { path: "/tehmil-tenzil", label: "Tehmil & Tenzil", icon: "✅", permission: "receipts:update" },
      { path: "/payments", label: "Payments", icon: "💵", permission: "payments:manage" },
      { path: "/inventory", label: "Inventory", icon: "📦", permission: "inventory:manage" },
      { path: "/manufacturing", label: "Manufacturing", icon: "🏭", permission: "inventory:manage" },
      { path: "/finance", label: "Finance", icon: "💰", permission: "reports:view" },
      { path: "/fleet", label: "Fleet", icon: "🚛", permission: "customers:manage" },
      { path: "/tools", label: "Tools", icon: "🧰", permission: "inventory:manage" },
      { path: "/diesel", label: "Diesel", icon: "⛽️", permission: "diesel:manage" },
      { path: "/debris", label: "Debris", icon: "🚚", permission: "debris:manage" },
    ],
  },
  {
    label: "Directory",
    routes: [
      { path: "/customers", label: "Customers", icon: "👥", permission: "customers:manage" },
      { path: "/suppliers", label: "Suppliers", icon: "🤝", permission: "suppliers:manage" },
      { path: "/job-sites", label: "Job Sites", icon: "📍", permission: "customers:manage" },
      { path: "/products", label: "Products", icon: "🧱", permission: "products:manage" },
      { path: "/employees", label: "Employees", icon: "🧑‍🔧", permission: "payroll:manage" },
      { path: "/payroll", label: "Payroll", icon: "🗂️", permission: "payroll:manage" },
    ],
  },
];

const workerRouteGroups: RouteGroup[] = [
  {
    label: "Worker",
    routes: [
      { path: "/receipts", label: "Create receipts", icon: "🗒️", permission: "receipts:create" },
      { path: "/worker/receipts", label: "Print receipts", icon: "🖨️", permission: "receipts:print" },
    ],
  },
];

const adminRouteGroup: RouteGroup = {
  label: "Admin",
  routes: [
    { path: "/admin/users", label: "User access", icon: "🛡️" },
    { path: "/debug", label: "Debug", icon: "🩺" },
  ],
};

export function AppLayout() {
  const { user, logout, can } = useAuth();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const isWorker = user?.role === "WORKER";
  const navGroups = useMemo<RouteGroup[]>(() => {
    const baseGroups = isWorker ? workerRouteGroups : [...managerRouteGroups];
    if (!isWorker && user?.role === "ADMIN") {
      baseGroups.push(adminRouteGroup);
    }
    return baseGroups;
  }, [isWorker, user?.role]);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  const renderNavGroups = (className?: string) => (
    <nav className={className ?? styles.navGroup}>
      {navGroups.map((group) => (
        <div key={group.label}>
          <p className={styles.navLabel}>{group.label}</p>
          <ul className={styles.navList}>
            {group.routes
              .filter((route) => !route.permission || can(route.permission))
              .map((route) => (
                <li key={route.path}>
                  <NavLink
                    to={route.path}
                    className={({ isActive }) =>
                      isActive ? `${styles.link} ${styles.active}` : styles.link
                    }
                    end={route.path === "/"}
                  >
                    <span className={styles.linkIcon}>{route.icon}</span>
                    {route.label}
                  </NavLink>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div>
          <h1 className={styles.brand}>N.A.T</h1>
          {renderNavGroups()}
        </div>
        <div className={styles.sidebarFooter}>
          <div style={{ display: "grid", gap: 4 }}>
            <p style={{ margin: 0, fontWeight: 600 }}>{user?.name ?? user?.email}</p>
            <p style={{ margin: 0, color: "var(--color-muted)", fontSize: 13 }}>
              {user?.role.toLowerCase()}
            </p>
            <button type="button" className="secondary-button" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.mobileHeader}>
          <div>
            <p className={styles.mobileBrand}>N.A.T</p>
            <p className={styles.mobileSubtitle}>مواد البناء • نقليات • حفريات</p>
          </div>
          <button
            type="button"
            className={styles.mobileMenuButton}
            onClick={() => setIsMobileMenuOpen((prev) => !prev)}
            aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}
          >
            <span />
            <span />
            <span />
          </button>
        </header>

        <main className={styles.content}>
          <Outlet />
        </main>
      </div>

      <div
        className={`${styles.mobileDrawer} ${isMobileMenuOpen ? styles.mobileDrawerOpen : ""}`}
        aria-hidden={!isMobileMenuOpen}
      >
        <div className={styles.mobileDrawerInner}>
          <div className={styles.mobileUser}>
            <div>
              <p className={styles.mobileUserName}>{user?.name ?? user?.email}</p>
              <p className={styles.mobileUserRole}>{user?.role.toLowerCase()}</p>
            </div>
            <button type="button" className="ghost-button" onClick={logout}>
              Sign out
            </button>
          </div>
          {renderNavGroups(styles.mobileNavGroup)}
        </div>
      </div>
      {isMobileMenuOpen ? (
        <button
          type="button"
          className={styles.mobileBackdrop}
          onClick={() => setIsMobileMenuOpen(false)}
          aria-label="Close menu"
        />
      ) : null}
    </div>
  );
}

export default AppLayout;
