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
  { key: "payroll:manage", label: "Manage payroll" },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];
export type PermissionMap = Record<PermissionKey, boolean>;
