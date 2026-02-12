import type { PermissionMap } from "./constants/permissions";

export type UserRole = "ADMIN" | "MANAGER" | "WORKER";

export interface AuthUser {
  id: number;
  email: string;
  name?: string | null;
  role: UserRole;
  permissions: PermissionMap;
}

export interface BasicUserSummary {
  id: number;
  name?: string | null;
  email: string;
}

export interface Customer {
  id: number;
  name: string;
  receiptType: "NORMAL" | "TVA";
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  createdAt: string;
  manualBalanceOverride?: number | null;
  manualBalanceNote?: string | null;
  manualBalanceUpdatedAt?: string | null;
  manualBalanceUpdatedById?: number | null;
  manualBalanceUpdatedBy?: BasicUserSummary | null;
  computedBalance?: number;
}

export interface JobSite {
  id: number;
  name: string;
  address?: string | null;
  notes?: string | null;
  customerId: number;
  createdAt: string;
}

export interface Supplier {
  id: number;
  name: string;
  contact?: string | null;
  notes?: string | null;
  createdAt: string;
  manualBalanceOverride?: number | null;
  manualBalanceNote?: string | null;
  manualBalanceUpdatedAt?: string | null;
  manualBalanceUpdatedById?: number | null;
  manualBalanceUpdatedBy?: BasicUserSummary | null;
  computedBalance?: number;
}

export interface Driver {
  id: number;
  name: string;
  phone?: string | null;
}

export interface Truck {
  id: number;
  plateNo: string;
  driverId?: number | null;
  driver?: Driver | null;
  repairs?: TruckRepair[];
  insuranceExpiry?: string | null;
}

export interface TruckRepair {
  id: number;
  truckId: number;
  date: string;
  amount: number;
  quantity?: number;
  description?: string | null;
  supplierId?: number | null;
  supplier?: Supplier | null;
  paymentId?: number | null;
  type?: "REPAIR" | "OIL_CHANGE" | "INSURANCE";
  toolId?: number | null;
  tool?: Tool | null;
}

export interface Product {
  id: number;
  name: string;
  unit: string;
  unitPrice?: number | null;
  description?: string | null;
  stockQty: number;
  isManufactured: boolean;
  isComposite: boolean;
  isFuel: boolean;
  pieceworkRate?: number | null;
  helperPieceworkRate?: number | null;
  tehmilFee?: number | null;
  tenzilFee?: number | null;
  productionPowderProductId?: number | null;
  productionPowderProduct?: Product | null;
  productionPowderQuantity?: number | null;
  productionCementProductId?: number | null;
  productionCementProduct?: Product | null;
  productionCementQuantity?: number | null;
  hasAggregatePresets: boolean;
  compositeComponents?: ProductCompositeComponent[];
}

export interface ProductCompositeComponent {
  id: number;
  parentProductId: number;
  componentProductId: number;
  quantity: number;
  componentProduct?: {
    id: number;
    name: string;
    unit: string;
  } | null;
}

export interface Tool {
  id: number;
  name: string;
  quantity: number;
  unit?: string | null;
  notes?: string | null;
  updatedAt?: string;
  createdAt?: string;
}

export type InventoryEntryType = "PURCHASE" | "PRODUCTION";

export interface InventoryEntry {
  id: number;
  inventoryNo: string;
  createdAt: string;
  entryDate: string;
  type: InventoryEntryType;
  productionSite?: string | null;
  supplierId?: number | null;
  supplier?: Supplier | null;
  productId: number;
  product: Product;
  quantity: number;
  unitCost?: number | null;
  totalCost?: number | null;
  amountPaid?: number | null;
  outstanding?: number | null;
  isPaid: boolean;
  tvaEligible?: boolean;
  powderUsed?: number | null;
  powderProductId?: number | null;
  powderProduct?: Product | null;
  cementUsed?: number | null;
  cementProductId?: number | null;
  cementProduct?: Product | null;
  notes?: string | null;
  laborPaid?: boolean;
  laborPaidAt?: string | null;
  laborAmount?: number | null;
  helperLaborAmount?: number | null;
  workerEmployeeId?: number | null;
  workerEmployee?: Employee | null;
  helperEmployeeId?: number | null;
  helperEmployee?: Employee | null;
}

export interface InventoryPayablesSummary {
  totalDue: number;
  entries: InventoryEntry[];
}

export interface InventoryEntriesResponse {
  entries: InventoryEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sortBy: string;
  order: "asc" | "desc";
}

export interface ProductionLaborSummary {
  totalDue: number;
  entries: InventoryEntry[];
}

export interface ProductionLaborWeeklyWorker {
  id: number | null;
  name: string;
  amount: number;
  entries: Array<{
    entryId: number;
    role: string;
    amount: number;
    date: string | Date;
    productId: number;
  }>;
}

export interface ProductionLaborWeeklySummary {
  start: string | Date;
  end: string | Date;
  workers: ProductionLaborWeeklyWorker[];
}

export interface ProductionHistoryResponse {
  entries: InventoryEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  order: "asc" | "desc";
}

export interface DieselLog {
  id: number;
  date: string;
  truckId?: number | null;
  truck?: Truck | null;
  driverId?: number | null;
  driver?: Driver | null;
  liters: number;
  pricePerLiter?: number | null;
  totalCost?: number | null;
  notes?: string | null;
}

export interface DieselPurchasesResponse {
  purchases: InventoryEntry[];
  totals: {
    liters: number;
    cost: number;
  };
}

export interface DieselLogsResponse {
  logs: DieselLog[];
  totals: {
    liters: number;
    cost: number;
  };
}

export interface ReportSummaryPeriod {
  start: string;
  end: string;
  groupBy: string;
}

export interface MaterialSalesEntry {
  productId: number;
  productName: string;
  quantity: number;
  revenue: number;
  averageSalePrice: number;
  averageCost: number | null;
  profitPerUnit: number | null;
  profitMargin: number | null;
}

export interface SalesTimelineEntry {
  period: string;
  products: MaterialSalesEntry[];
}

export interface PurchaseSupplierSummary {
  supplier: string;
  totalCost: number;
  entries: number;
}

export interface OutstandingPurchaseSummary {
  id: number;
  supplier: string;
  product: string;
  entryDate: string;
  quantity: number;
  unitCost?: number | null;
  totalCost?: number | null;
}

export interface ReportSummary {
  period: ReportSummaryPeriod;
  revenue: {
    totalSales: number;
    totalCashCollected: number;
    outstandingAmount: number;
    averageReceiptValue: number;
    filteredSales?: number;
  };
  materialSales: MaterialSalesEntry[];
  salesTimeline: SalesTimelineEntry[];
  purchases: {
    totalPurchaseCost: number;
    outstandingPayablesTotal: number;
    purchasesBySupplier: PurchaseSupplierSummary[];
    outstanding: OutstandingPurchaseSummary[];
    purchasesByProduct: Array<{
      productId: number;
      product: string;
      totalCost: number;
      quantity: number;
      averageUnitCost: number | null;
    }>;
    recentPurchases: Array<{
      id: number;
      entryDate: string;
      supplier: string;
      product: string;
      quantity: number;
      totalCost: number;
      isPaid: boolean;
      tvaEligible: boolean;
    }>;
  };
  inventory: {
    snapshot: Array<{
      id: number;
      name: string;
      stockQty: number;
      unit: string;
      unitPrice?: number | null;
    }>;
  };
  debris: {
    onHandVolume: number;
    droppedVolume: number;
    removedVolume: number;
    removalCost: number;
  };
  receivables: {
    customers: Array<{
      customerId: number;
      customerName: string;
      outstanding: number;
      overdueOutstanding: number;
      maxDaysOutstanding: number;
      isOverdue: boolean;
      oldestInvoiceDate: string | null;
    }>;
  };
  stoneProduction: {
    totalUnits: number;
    productionByDate: Array<{ period: string; quantity: number }>;
    entries: Array<{ id: number; date: string; product: string; quantity: number }>;
  };
}

export interface DailyReport {
  date: string;
  filters: {
    productIds: number[];
    customerIds?: number[];
  };
  totals: {
    receiptsCount: number;
    totalSales: number;
    filteredSales: number;
    cashCollected: number;
    averageReceiptValue: number;
  };
  receipts: Receipt[];
  payments: Payment[];
  inventory: {
    purchases: InventoryEntry[];
    production: InventoryEntry[];
  };
  dieselLogs: DieselLog[];
  debris: {
    entries: DebrisEntry[];
  };
  payrollEntries: PayrollEntry[];
}

export type InvoiceStatus = "PENDING" | "PAID" | "CANCELLED";

export interface InvoicePreview {
  generatedAt: string;
  customer: Customer;
  jobSite?: { id: number; name: string } | null;
  invoice: {
    receiptCount: number;
    receipts: Receipt[];
    receiptType?: Receipt["type"];
    subtotal: number;
    vatRate?: number;
    vatAmount?: number;
    totalWithVat?: number;
    amountPaid: number;
    outstanding: number;
    oldBalance: number;
  };
}

export interface InvoiceRecord extends InvoicePreview {
  id: number;
  invoiceNo?: string | null;
  status: InvoiceStatus;
  issuedAt: string;
  paidAt?: string | null;
  notes?: string | null;
}

export type DebrisStatus = "PENDING" | "REMOVED";

export interface DebrisEntry {
  id: number;
  date: string;
  customerId?: number | null;
  customer?: Customer | null;
  supplierId?: number | null;
  supplier?: Supplier | null;
  walkInName?: string | null;
  volume: number;
  dumpingFee?: number | null;
  removalCost?: number | null;
  removalDate?: string | null;
  status: DebrisStatus;
  notes?: string | null;
  removalPaymentId?: number | null;
  removalPayment?: Payment | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReceiptItem {
  id: number;
  productId: number;
  product: Product;
  quantity: number;
  displayQuantity?: number | null;
  displayUnit?: string | null;
  unitPrice?: number | null;
  subtotal?: number | null;
}

export interface ReceiptPaymentLink {
  id: number;
  paymentId: number;
  receiptId: number;
  amount: number;
  createdAt: string;
  receipt?: Receipt;
}

export interface Receipt {
  id: number;
  type: "NORMAL" | "TVA";
  receiptNo: string;
  date: string;
  createdAt: string;
  updatedAt: string;
  createdByUserId?: number | null;
  createdByUser?: BasicUserSummary | null;
  customerId?: number | null;
  customer?: Customer | null;
  jobSiteId?: number | null;
  jobSite?: JobSite | null;
  walkInName?: string | null;
  driverId?: number | null;
  driver?: Driver | null;
  truckId?: number | null;
  truck?: Truck | null;
  tehmil?: boolean;
  tenzil?: boolean;
  total: number;
  amountPaid: number;
  isPaid: boolean;
  items: ReceiptItem[];
  receiptPayments?: ReceiptPaymentLink[];
  filteredTotal?: number;
}

export interface TehmilTenzilReceiptSummary {
  id: number;
  date: string | Date;
  receiptNo: string;
  customer: string;
  tehmilTotal: number;
  tenzilTotal: number;
  total: number;
}

export interface TehmilTenzilWeeklySummary {
  start: string | Date;
  end: string | Date;
  total: number;
  receipts: TehmilTenzilReceiptSummary[];
}

export type PaymentType =
  | "GENERAL_EXPENSE"
  | "SUPPLIER"
  | "RECEIPT"
  | "PAYROLL_SALARY"
  | "PAYROLL_PIECEWORK"
  | "PAYROLL_RUN"
  | "DEBRIS_REMOVAL"
  | "CUSTOMER_PAYMENT";

export type CashCustodyType = "HANDOFF" | "RETURN";

export interface Payment {
  id: number;
  date: string;
  amount: number;
  type: PaymentType;
  description?: string | null;
  category?: string | null;
  reference?: string | null;
  customerId?: number | null;
  customer?: Customer | null;
  supplierId?: number | null;
  supplier?: Supplier | null;
  receiptId?: number | null;
  receipt?: Receipt | null;
  payrollEntry?: PayrollEntry | null;
  payrollRun?: PayrollRun | null;
  debrisRemoval?: DebrisEntry | null;
  truckRepair?: TruckRepair | null;
  receiptPayments?: ReceiptPaymentLink[];
}

export type CustomReportDataset = "receipts" | "payments" | "payroll" | "debris" | "inventory";

export interface ReceiptReportItem {
  id: number;
  receiptNo?: string | null;
  date: string | Date;
  type: "NORMAL" | "TVA";
  total: number;
  amountPaid: number;
  isPaid: boolean;
  customer: string | null;
  jobSite: string | null;
  items: { product: string; quantity: number; unitPrice?: number | null; subtotal?: number | null }[];
  payments: { id: number; amount: number; date: string | Date | null }[];
}

export interface PaymentReportItem {
  id: number;
  date: string | Date;
  amount: number;
  type: PaymentType;
  description?: string | null;
  category?: string | null;
  reference?: string | null;
  customer?: string | null;
  supplier?: string | null;
  receiptNo?: string | null;
  payrollEmployee?: string | null;
  debrisVolume?: number | null;
}

export interface PayrollReportItem {
  id: number;
  employee: string;
  helper?: string | null;
  type: PayrollType;
  amount: number;
  quantity?: number | null;
  periodStart: string | Date;
  periodEnd: string | Date;
  paidAt?: string | Date | null;
}

export interface DebrisReportItem {
  id: number;
  date: string | Date;
  status: DebrisStatus;
  volume: number;
  removalCost?: number | null;
  removalDate?: string | Date | null;
  customer?: string | null;
  removalPaymentId?: number | null;
}

export interface InventoryReportItem {
  id: number;
  entryDate: string | Date;
  type: InventoryEntryType;
  supplier?: string | null;
  product: string;
  quantity: number;
  totalCost?: number | null;
  isPaid: boolean;
}

export type CustomReportItem =
  | ReceiptReportItem
  | PaymentReportItem
  | PayrollReportItem
  | DebrisReportItem
  | InventoryReportItem;

export interface CustomReportGroup {
  key: string;
  count: number;
  total?: number;
  amountPaid?: number;
  outstanding?: number;
  totalAmount?: number;
  totalVolume?: number;
  totalRemovalCost?: number;
  totalCost?: number;
  totalQuantity?: number;
  label?: string;
}

export interface CustomReportResponse {
  dataset: CustomReportDataset;
  summary: Record<string, number>;
  groups: CustomReportGroup[];
  items: CustomReportItem[];
}

export interface CashCustodyEntry {
  id: number;
  createdAt: string;
  updatedAt: string;
  type: CashCustodyType;
  amount: number;
  description?: string | null;
  fromEmployee: Pick<Employee, "id" | "name">;
  toEmployee: Pick<Employee, "id" | "name">;
  createdByUser?: {
    id: number;
    name?: string | null;
    email?: string | null;
  } | null;
}

export type EmployeeRole =
  | "DRIVER"
  | "ACCOUNTANT"
  | "MANAGER"
  | "MANUFACTURING"
  | "OTHER";

export type PayrollType = "SALARY" | "PIECEWORK";

export type PayFrequency = "WEEKLY" | "MONTHLY";
export type PayrollRunStatus = "DRAFT" | "FINALIZED" | "PAID" | "CANCELLED";

export interface Employee {
  id: number;
  name: string;
  role: EmployeeRole;
  payType: PayrollType;
  salaryAmount?: number | null;
  salaryFrequency?: PayFrequency | null;
  active: boolean;
  phone?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  pieceRates?: ManufacturingPieceRate[];
}

export interface ManufacturingPieceRate {
  id: number;
  employeeId: number;
  productId: number;
  rate: number;
  helperRate?: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  product?: {
    id: number;
    name: string;
  };
}

export interface PayrollEntry {
  id: number;
  employeeId: number;
  employee: Employee;
  periodStart: string;
  periodEnd: string;
  type: PayrollType;
  amount: number;
  quantity?: number | null;
  notes?: string | null;
  paymentId?: number | null;
  payment?: Payment | null;
  payrollRunId?: number | null;
  payrollRun?: PayrollRun | null;
  stoneProductId?: number | null;
  stoneProduct?: Product | null;
  createdAt: string;
  helperEmployeeId?: number | null;
  helperEmployee?: Employee | null;
}

export interface PayrollRun {
  id: number;
  frequency: PayFrequency;
  status: PayrollRunStatus;
  periodStart: string;
  periodEnd: string;
  debitAt?: string | null;
  paidAt?: string | null;
  totalGross: number;
  totalNet: number;
  totalDeductions: number;
  notes?: string | null;
  payment?: Payment | null;
  entries?: PayrollEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface DashboardSummary {
  receipts: {
    todayTotal: number;
    todayPaid: number;
    monthTotal: number;
    outstandingCount: number;
    outstandingAmount: number;
  };
  finance: {
    receivables: number;
    payables: number;
    purchasePayables: number;
    laborPayables: number;
    outstandingLaborCount: number;
  };
  expenses: {
    monthTotal: number;
  };
  cash: {
    onHand: number;
    paidIn: number;
    paidOut: number;
  };
  debris: {
    onHandVolume: number;
    removalsThisMonth: {
      count: number;
      volume: number;
      cost: number;
    };
  };
  payroll: {
    pendingEntries: PayrollEntry[];
  };
}

export interface FinanceCashEntry {
  id: string;
  type: string;
  label: string;
  amount: number;
  date: string;
  context?: Record<string, unknown>;
}

export interface FinanceReceivableEntry {
  id: number;
  receiptNo: string;
  customer: string;
  date: string;
  total: number;
  outstanding: number;
  isManual?: boolean;
  note?: string | null;
}

export interface FinancePurchasePayableEntry {
  id: number;
  supplier: string;
  product: string;
  date: string;
  amount: number;
  isManual?: boolean;
  note?: string | null;
}

export interface FinanceLaborPayableEntry {
  id: number;
  product: string;
  date: string;
  quantity: number;
  workerDue: number;
  helperDue: number;
  total: number;
  workerName?: string | null;
  helperName?: string | null;
  productionSite?: string | null;
}

export interface FinancePayrollPayableEntry {
  id: number;
  employee: string;
  amount: number;
  periodStart: string;
  periodEnd: string;
  product: string | null;
}

export interface FinanceReceiptDetailEntry {
  id: number;
  receiptNo: string;
  date: string;
  total: number;
  paid: number;
  outstanding: number;
  type?: string | null;
  isPaid?: boolean | null;
}

export interface FinancePurchaseDetailEntry {
  id: number;
  product: string;
  date: string;
  total: number;
  paid: number;
  outstanding: number;
  isPaid?: boolean | null;
}

export interface FinanceOverview {
  cash: {
    onHand: number;
    inflowTotal: number;
    outflowTotal: number;
    inflows: FinanceCashEntry[];
    outflows: FinanceCashEntry[];
  };
  receivables: {
    total: number;
    computedTotal: number;
    overrideValue: number | null;
    receipts: FinanceReceivableEntry[];
  };
  payables: {
    total: number;
    purchaseTotal: number;
    laborTotal: number;
    payrollTotal: number;
    computedTotal: number;
    overrideValue: number | null;
    purchases: FinancePurchasePayableEntry[];
    labor: FinanceLaborPayableEntry[];
    payroll: FinancePayrollPayableEntry[];
  };
  inventory: {
    total: number;
    computedTotal: number;
    overrideValue: number | null;
  };
  details?: {
    customerReceipts: FinanceReceiptDetailEntry[];
    supplierPurchases: FinancePurchaseDetailEntry[];
  };
  displayFlags?: {
    displayCash: boolean;
    displayReceivables: boolean;
    displayPayables: boolean;
    includeReceipts?: boolean;
    includeSupplierPurchases?: boolean;
    includeManufacturing?: boolean;
    includePayroll?: boolean;
    includeDebris?: boolean;
    includeGeneralExpenses?: boolean;
    includeInventoryValue?: boolean;
  };
}

export interface ManualControlUserSummary {
  id: number;
  name?: string | null;
  email: string;
}

export interface ManualControlEntry {
  value: number | null;
  updatedAt: string | null;
  updatedBy: ManualControlUserSummary | null;
}

export interface ManualControlsResponse {
  inventoryValue: ManualControlEntry;
  receivablesTotal: ManualControlEntry;
  payablesTotal: ManualControlEntry;
}

export interface ManualControlsPayload {
  inventoryValue?: number | null;
  receivablesTotal?: number | null;
  payablesTotal?: number | null;
}
