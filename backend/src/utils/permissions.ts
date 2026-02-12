import { UserRole } from "@prisma/client";

export const PERMISSIONS = [
  { key: "receipts:view", label: "View receipts" },
  { key: "receipts:create", label: "Create receipts" },
  { key: "receipts:update", label: "Edit receipts" },
  { key: "receipts:delete", label: "Delete receipts" },
  { key: "receipts:print", label: "Print receipts" },
  { key: "invoices:view", label: "View invoices" },
  { key: "invoices:manage", label: "Manage invoices" },
  { key: "payments:manage", label: "Manage payments" },
  { key: "cash:manage", label: "Manage cash & owner draws" },
  { key: "products:view", label: "View products" },
  { key: "products:manage", label: "Manage products" },
  { key: "inventory:manage", label: "Manage inventory" },
  { key: "reports:view", label: "View reports" },
  { key: "diesel:manage", label: "Manage diesel logs" },
  { key: "debris:manage", label: "Manage debris" },
  { key: "debris:edit", label: "Edit or delete debris removals" },
  { key: "customers:view", label: "View customers & job sites" },
  { key: "customers:manage", label: "Manage customers & job sites" },
  { key: "suppliers:view", label: "View suppliers" },
  { key: "suppliers:manage", label: "Manage suppliers" },
  { key: "payroll:manage", label: "Manage payroll" }
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];
export type PermissionMap = Record<PermissionKey, boolean>;

const allFalse: PermissionMap = PERMISSIONS.reduce((acc, perm) => {
  acc[perm.key] = false;
  return acc;
}, {} as PermissionMap);

export function defaultPermissionsForRole(role: UserRole): PermissionMap {
  const base: PermissionMap = { ...allFalse };

  if (role === "ADMIN") {
    PERMISSIONS.forEach((perm) => {
      base[perm.key] = true;
    });
    return base;
  }

  if (role === "MANAGER") {
    Object.assign(base, {
      "receipts:view": true,
      "receipts:create": true,
      "receipts:print": true,
      "invoices:view": true,
      "invoices:manage": true,
      "payments:manage": true,
      "cash:manage": true,
      "products:view": true,
      "products:manage": true,
      "inventory:manage": true,
      "reports:view": true,
      "diesel:manage": true,
      "debris:manage": true,
      "debris:edit": true,
      "customers:view": true,
      "customers:manage": true,
      "suppliers:view": true,
      "suppliers:manage": true,
    });
    return base;
  }

  // Worker defaults
  Object.assign(base, {
    "receipts:view": true,
    "receipts:create": true,
    "receipts:print": true,
    "products:view": true,
    "customers:view": true,
    "suppliers:view": true,
  });
  return base;
}

export function mergePermissions(
  role: UserRole,
  overrides?: Record<string, any> | null,
): PermissionMap {
  const base = defaultPermissionsForRole(role);
  if (!overrides) return base;
  const result: PermissionMap = { ...base };
  for (const key of Object.keys(overrides)) {
    if ((result as Record<string, boolean>)[key] !== undefined) {
      result[key as PermissionKey] = Boolean(overrides[key]);
    }
  }
  return result;
}

export function hasPermission(map: PermissionMap | undefined, key: PermissionKey): boolean {
  if (!map) return false;
  return Boolean(map[key]);
}

export function sanitizePermissionInput(input?: Record<string, any> | null) {
  if (!input) return null;
  const sanitized: Partial<PermissionMap> = {};
  for (const key of Object.keys(input)) {
    if ((allFalse as Record<string, boolean>)[key] !== undefined) {
      sanitized[key as PermissionKey] = Boolean(input[key]);
    }
  }
  return Object.keys(sanitized).length > 0 ? sanitized : null;
}
