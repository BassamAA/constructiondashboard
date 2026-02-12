import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  createInventoryEntry,
  fetchProductionHistory,
  fetchProductionLaborQueue,
  markProductionLaborPaid,
} from "../api/inventory";
import { useAuth } from "../context/AuthContext";
import type {
  InventoryEntry,
  Employee,
  ManufacturingPieceRate,
  Product,
  ProductionHistoryResponse,
} from "../types";
import { fetchProducts } from "../api/products";
import { fetchManufacturingWorkers } from "../api/employees";
import { createPieceRate, updatePieceRate } from "../api/employees";

const formatCurrency = (value: number): string => `$${value.toFixed(2)}`;
const PIECEWORK_DIVISOR = 100; // quantity entered in units; payout uses rate per 100

const productionSchema = z
  .object({
    productId: z.string().min(1, "Select a product"),
    quantity: z
      .string()
      .min(1, "Quantity is required")
      .refine((val) => !Number.isNaN(Number(val)) && Number(val) > 0, "Enter a valid quantity"),
    date: z.string().optional(),
    notes: z.string().optional(),
    laborPaid: z.boolean().optional(),
    laborAmount: z.string().optional(),
    helperLaborAmount: z.string().optional(),
    workerEmployeeId: z.string().optional(),
    helperEmployeeId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.laborAmount && data.laborAmount.trim().length > 0) {
      if (Number.isNaN(Number(data.laborAmount)) || Number(data.laborAmount) < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["laborAmount"],
          message: "Enter a valid worker payout",
        });
      }
    }
    if (data.helperLaborAmount && data.helperLaborAmount.trim().length > 0) {
      if (Number.isNaN(Number(data.helperLaborAmount)) || Number(data.helperLaborAmount) < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["helperLaborAmount"],
          message: "Enter a valid helper payout",
        });
      }
    }
    const validateEmployee = (value: string | undefined, field: "workerEmployeeId" | "helperEmployeeId") => {
      if (value && value.trim().length > 0 && Number.isNaN(Number(value))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: "Select a valid employee",
        });
      }
    };
    validateEmployee(data.workerEmployeeId, "workerEmployeeId");
    validateEmployee(data.helperEmployeeId, "helperEmployeeId");
  });

type ProductionFormValues = z.infer<typeof productionSchema>;

export function ManufacturingPage() {
  const queryClient = useQueryClient();
  const { user, can } = useAuth();
  const [paidDates, setPaidDates] = useState<Record<number, string>>({});
  const [groupPaidDates, setGroupPaidDates] = useState<Record<string, string>>({});
  const [bulkPayingKey, setBulkPayingKey] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const hasInventoryAccess = user?.role === "ADMIN" || can("inventory:manage");
  const isAdmin = user?.role === "ADMIN";
  const [outstandingOrder, setOutstandingOrder] = useState<"asc" | "desc">("desc");
  const [outstandingPage, setOutstandingPage] = useState(1);
  const [outstandingPageSize, setOutstandingPageSize] = useState(25);
  const [historyOrder, setHistoryOrder] = useState<"asc" | "desc">("desc");
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(25);
  const logRef = useRef<HTMLDivElement | null>(null);
  const ratesRef = useRef<HTMLDivElement | null>(null);
  const [activeTab, setActiveTab] = useState<"log" | "rates">("log");

  const laborQuery = useQuery({
    queryKey: ["production-labor-queue"],
    queryFn: fetchProductionLaborQueue,
    enabled: hasInventoryAccess,
  });

  const mutation = useMutation({
    mutationFn: ({ id, paidAt }: { id: number; paidAt?: string }) => markProductionLaborPaid(id, paidAt),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["production-labor-queue"] });
    },
  });

  const entries = laborQuery.data?.entries ?? [];
  const totalDue = laborQuery.data?.totalDue ?? 0;
  const sortedOutstandingEntries = useMemo(() => {
    const copy = [...entries];
    copy.sort((a, b) => {
      const dateA = new Date(a.entryDate ?? a.createdAt).getTime();
      const dateB = new Date(b.entryDate ?? b.createdAt).getTime();
      return outstandingOrder === "asc" ? dateA - dateB : dateB - dateA;
    });
    return copy;
  }, [entries, outstandingOrder]);
  const outstandingTotalPages = Math.max(1, Math.ceil(sortedOutstandingEntries.length / Math.max(1, outstandingPageSize)));
  const normalizedOutstandingPage = Math.min(outstandingPage, outstandingTotalPages);
  const outstandingSliceStart = (normalizedOutstandingPage - 1) * outstandingPageSize;
  const outstandingSliceEnd = outstandingSliceStart + outstandingPageSize;
  const paginatedOutstandingEntries = sortedOutstandingEntries.slice(outstandingSliceStart, outstandingSliceEnd);
  const outstandingShowingFrom = paginatedOutstandingEntries.length === 0 ? 0 : outstandingSliceStart + 1;
  const outstandingShowingTo = outstandingSliceStart + paginatedOutstandingEntries.length;
  const handleOutstandingOrderChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setOutstandingOrder(event.target.value === "asc" ? "asc" : "desc");
    setOutstandingPage(1);
  };
  const handleOutstandingPageSizeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const parsed = Number(event.target.value);
    const next = Number.isNaN(parsed) || parsed <= 0 ? 25 : parsed;
    setOutstandingPageSize(next);
    setOutstandingPage(1);
  };
  const goToPreviousOutstandingPage = () => setOutstandingPage((prev) => Math.max(1, prev - 1));
  const goToNextOutstandingPage = () => setOutstandingPage((prev) => Math.min(outstandingTotalPages, prev + 1));
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const { data: products = [], isLoading: productsLoading } = useQuery({
    queryKey: ["products"],
    queryFn: fetchProducts,
    enabled: hasInventoryAccess,
  });

  const manufacturedProducts = useMemo(() => products.filter((product) => product.isManufactured), [products]);

  const { data: employees = [], isLoading: employeesLoading } = useQuery({
    queryKey: ["manufacturing-workers"],
    queryFn: fetchManufacturingWorkers,
    enabled: hasInventoryAccess,
  });

  const historyQuery = useQuery<ProductionHistoryResponse>({
    queryKey: ["production-history", historyPage, historyPageSize, historyOrder],
    queryFn: () =>
      fetchProductionHistory({
        page: historyPage,
        pageSize: historyPageSize,
        order: historyOrder,
      }),
    enabled: hasInventoryAccess,
    placeholderData: keepPreviousData,
  });

  const historyEntries: InventoryEntry[] = historyQuery.data?.entries ?? [];
  const historyTotalCount = historyQuery.data?.total ?? 0;
  const historyTotalPages = historyQuery.data?.totalPages ?? 1;

  const activeEmployees = useMemo(
    () => employees.filter((employee) => employee.active && employee.role === "MANUFACTURING"),
    [employees],
  );

  const [pieceRateOverrides, setPieceRateOverrides] = useState<Record<string, ManufacturingPieceRate>>({});

  const updateWorkerRatesCache = useCallback(
    (employeeId: number, updatedRate: ManufacturingPieceRate) => {
      if (!updatedRate) return;
      queryClient.setQueryData<Employee[] | undefined>(["manufacturing-workers"], (previous) => {
        if (!previous) return previous;
        return previous.map((worker) => {
          if (worker.id !== employeeId) {
            return worker;
          }
          const existingRates = worker.pieceRates ?? [];
          const hasExisting = existingRates.some((rate) => rate.id === updatedRate.id);
          const nextPieceRates = hasExisting
            ? existingRates.map((rate) => (rate.id === updatedRate.id ? { ...rate, ...updatedRate } : rate))
            : [...existingRates, updatedRate];
          return {
            ...worker,
            pieceRates: nextPieceRates,
          };
        });
      });
      setPieceRateOverrides((prev) => ({
        ...prev,
        [`${employeeId}-${updatedRate.productId}`]: updatedRate,
      }));
    },
    [queryClient],
  );

  useEffect(() => {
    if (!historyQuery.data) return;
    if (historyPage > historyTotalPages) {
      setHistoryPage(historyTotalPages || 1);
    }
  }, [historyQuery.data, historyPage, historyTotalPages]);

  const historyShowingFrom = historyEntries.length === 0 ? 0 : (historyPage - 1) * historyPageSize + 1;
  const historyShowingTo = (historyPage - 1) * historyPageSize + historyEntries.length;
  const historyPrevDisabled = historyPage <= 1;
  const historyNextDisabled = historyPage >= historyTotalPages;
  const handleHistoryOrderChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value === "asc" ? "asc" : "desc";
    setHistoryOrder(next);
    setHistoryPage(1);
  };
  const handleHistoryPageSizeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const parsed = Number(event.target.value);
    const next = Number.isNaN(parsed) || parsed <= 0 ? 25 : parsed;
    setHistoryPageSize(next);
    setHistoryPage(1);
  };
  const goToPreviousHistoryPage = () => {
    if (historyPrevDisabled) return;
    setHistoryPage((prev) => Math.max(1, prev - 1));
  };
  const goToNextHistoryPage = () => {
    if (historyNextDisabled) return;
    setHistoryPage((prev) => Math.min(historyTotalPages, prev + 1));
  };
  const isHistoryLoading = historyQuery.isLoading;
  const isHistoryFetching = historyQuery.isFetching && !historyQuery.isLoading;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ProductionFormValues>({
    resolver: zodResolver(productionSchema),
    defaultValues: {
      productId: "",
      quantity: "",
      date: today,
      notes: "",
      laborPaid: false,
      laborAmount: "",
      helperLaborAmount: "",
      workerEmployeeId: "",
      helperEmployeeId: "",
    },
  });
  const [useCustomMaterials, setUseCustomMaterials] = useState(false);
  const [customPowderProductId, setCustomPowderProductId] = useState<string>("");
  const [customPowderUsed, setCustomPowderUsed] = useState<string>("");
  const [customCementProductId, setCustomCementProductId] = useState<string>("");
  const [customCementUsed, setCustomCementUsed] = useState<string>("");

  const selectedProductId = watch("productId");
  const quantityValue = watch("quantity");
  const workerEmployeeIdValue = watch("workerEmployeeId");
  const selectedWorker = useMemo(() => {
    const id = Number(workerEmployeeIdValue);
    if (!workerEmployeeIdValue || Number.isNaN(id)) return undefined;
    return activeEmployees.find((employee) => employee.id === id);
  }, [activeEmployees, workerEmployeeIdValue]);

  useEffect(() => {
    if (!selectedProductId) return;
    const id = Number(selectedProductId);
    if (Number.isNaN(id)) return;
    if (!manufacturedProducts.some((product) => product.id === id)) {
      setValue("productId", "", { shouldDirty: true, shouldValidate: true });
    }
  }, [manufacturedProducts, selectedProductId, setValue]);

  const selectedProduct = useMemo(() => {
    const id = Number(selectedProductId);
    if (!selectedProductId || Number.isNaN(id)) return undefined;
    return manufacturedProducts.find((product) => product.id === id);
  }, [manufacturedProducts, selectedProductId]);

  const quantityNumber = Number(quantityValue || 0) > 0 ? Number(quantityValue || 0) : 0;
  const hasPowderRecipe =
    selectedProduct?.productionPowderProductId !== null &&
    selectedProduct?.productionPowderProductId !== undefined &&
    selectedProduct?.productionPowderQuantity !== null &&
    selectedProduct?.productionPowderQuantity !== undefined;
  const hasCementRecipe =
    selectedProduct?.productionCementProductId !== null &&
    selectedProduct?.productionCementProductId !== undefined &&
    selectedProduct?.productionCementQuantity !== null &&
    selectedProduct?.productionCementQuantity !== undefined;
  const hasAnyRecipe = Boolean(hasPowderRecipe || hasCementRecipe);
  const powderPerUnit = hasPowderRecipe && selectedProduct ? selectedProduct.productionPowderQuantity ?? 0 : null;
  const powderTotal = powderPerUnit !== null && selectedProduct ? powderPerUnit * quantityNumber : null;
  const cementPerUnit = hasCementRecipe && selectedProduct ? selectedProduct.productionCementQuantity ?? 0 : null;
  const cementTotal = cementPerUnit !== null && selectedProduct ? cementPerUnit * quantityNumber : null;
  const selectedProductNumericId = selectedProduct?.id ?? null;
  const workerEmployeeRates = useMemo(() => {
    if (!selectedWorker || !selectedProductNumericId) {
      return { workerRate: null, helperRate: null };
    }
    const overrideKey = `${selectedWorker.id}-${selectedProductNumericId}`;
    const override = pieceRateOverrides[overrideKey];
    if (override) {
      return {
        workerRate: override.rate ?? null,
        helperRate: override.helperRate ?? null,
      };
    }
    const match = selectedWorker.pieceRates?.find((rate) => rate.productId === selectedProductNumericId && rate.isActive);
    return {
      workerRate: match?.rate ?? null,
      helperRate: match?.helperRate ?? null,
    };
  }, [pieceRateOverrides, selectedProductNumericId, selectedWorker]);
  const productWorkerRate =
    selectedProduct?.pieceworkRate !== null && selectedProduct?.pieceworkRate !== undefined ? selectedProduct.pieceworkRate : null;
  const productHelperRate =
    selectedProduct?.helperPieceworkRate !== null && selectedProduct?.helperPieceworkRate !== undefined ? selectedProduct.helperPieceworkRate : null;
  const workerRate = workerEmployeeRates.workerRate ?? productWorkerRate;
  const helperRate = workerEmployeeRates.helperRate ?? productHelperRate;
  const workerRatePer100 = workerRate !== null ? workerRate * PIECEWORK_DIVISOR : null;
  const helperRatePer100 = helperRate !== null ? helperRate * PIECEWORK_DIVISOR : null;
  const workerTotal =
    workerRatePer100 !== null && quantityNumber > 0
      ? (workerRatePer100 * quantityNumber) / PIECEWORK_DIVISOR
      : workerRatePer100 !== null
        ? 0
        : null;
  const helperTotal =
    helperRatePer100 !== null && quantityNumber > 0
      ? (helperRatePer100 * quantityNumber) / PIECEWORK_DIVISOR
      : helperRatePer100 !== null
        ? 0
        : null;

  const productionMutation = useMutation({
    mutationFn: createInventoryEntry,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["production-labor-queue"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-entries"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      reset({
        productId: "",
        quantity: "",
        date: today,
        notes: "",
        laborPaid: false,
        laborAmount: "",
        helperLaborAmount: "",
        workerEmployeeId: "",
        helperEmployeeId: "",
      });
      setFormError(null);
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.error ?? err?.message ?? "Failed to log production run");
    },
  });
  const isCreating = productionMutation.isPending;

  const onSubmitProduction = handleSubmit((data) => {
    setFormError(null);
    const productId = Number(data.productId);
    if (!data.productId || Number.isNaN(productId)) {
      setFormError("Select a product for this production run.");
      return;
    }
    const product = manufacturedProducts.find((item) => item.id === productId);
    if (!product) {
      setFormError("Select a manufactured product to continue.");
      return;
    }
    if (!product.isManufactured) {
      setFormError("This product is not marked as manufactured.");
      return;
    }
    if (product.productionPowderProductId == null && product.productionCementProductId == null) {
      setFormError("Configure the production components for this product before logging runs.");
      return;
    }
    const quantityNumber = Number(data.quantity);
    const payload: any = {
      type: "PRODUCTION" as const,
      productId,
      quantity: quantityNumber,
      date: data.date && data.date.trim().length > 0 ? data.date : today,
      notes: data.notes?.trim() ? data.notes.trim() : null,
      laborPaid: data.laborPaid ?? false,
    };
    if (useCustomMaterials && isAdmin) {
      const parsedPowderProductId = Number(customPowderProductId);
      const parsedPowderUsed = Number(customPowderUsed);
      if (customPowderProductId && !Number.isNaN(parsedPowderProductId)) {
        payload.powderProductId = parsedPowderProductId;
      }
      if (customPowderUsed && !Number.isNaN(parsedPowderUsed)) {
        payload.powderUsed = parsedPowderUsed;
      }
      const parsedCementProductId = Number(customCementProductId);
      const parsedCementUsed = Number(customCementUsed);
      if (customCementProductId && !Number.isNaN(parsedCementProductId)) {
        payload.cementProductId = parsedCementProductId;
      }
      if (customCementUsed && !Number.isNaN(parsedCementUsed)) {
        payload.cementUsed = parsedCementUsed;
      }
    }
    if (product.productionPowderProductId != null && product.productionPowderQuantity != null) {
      payload.powderProductId = product.productionPowderProductId;
      payload.powderUsed = product.productionPowderQuantity * quantityNumber;
    }
    if (product.productionCementProductId != null && product.productionCementQuantity != null) {
      payload.cementProductId = product.productionCementProductId;
      payload.cementUsed = product.productionCementQuantity * quantityNumber;
    }
    if (data.workerEmployeeId?.trim()) {
      payload.workerEmployeeId = Number(data.workerEmployeeId);
    }
    if (data.helperEmployeeId?.trim()) {
      payload.helperEmployeeId = Number(data.helperEmployeeId);
    }
    const laborAmountRaw = data.laborAmount?.trim();
    if (laborAmountRaw && laborAmountRaw.length > 0) {
      const workerRatePer100 = Number(laborAmountRaw);
      payload.laborAmount = (workerRatePer100 * quantityNumber) / PIECEWORK_DIVISOR;
    }
    const helperAmountRaw = data.helperLaborAmount?.trim();
    if (helperAmountRaw && helperAmountRaw.length > 0) {
      const helperRatePer100 = Number(helperAmountRaw);
      payload.helperLaborAmount = (helperRatePer100 * quantityNumber) / PIECEWORK_DIVISOR;
    }
    productionMutation.mutate(payload);
  });

  const getPaidDate = (entry: InventoryEntry) => paidDates[entry.id] ?? today;
  const handleMarkPaid = (entry: InventoryEntry) => {
    const paidAt = getPaidDate(entry);
    mutation.mutate({ id: entry.id, paidAt });
  };
  const getGroupPaidDate = (key: string) => groupPaidDates[key] ?? today;

  const groupedEntries = useMemo(() => {
    if (paginatedOutstandingEntries.length === 0) {
      return [];
    }
    const total = paginatedOutstandingEntries.reduce(
      (sum, entry) => sum + (entry.laborAmount ?? 0) + (entry.helperLaborAmount ?? 0),
      0,
    );
    return [
      {
        key: "ALL",
        label: "All production runs",
        entries: paginatedOutstandingEntries,
        total,
      },
    ];
  }, [paginatedOutstandingEntries]);

  const handleMarkGroupPaid = async (groupKey: string, groupEntries: InventoryEntry[]) => {
    if (groupEntries.length === 0) return;
    try {
      setBulkPayingKey(groupKey);
      const paidAt = getGroupPaidDate(groupKey);
      for (const entry of groupEntries) {
        await markProductionLaborPaid(entry.id, paidAt);
      }
      queryClient.invalidateQueries({ queryKey: ["production-labor-queue"] });
    } catch (err: any) {
      window.alert(err?.response?.data?.error ?? err?.message ?? "Failed to mark group as paid");
    } finally {
      setBulkPayingKey(null);
    }
  };

  if (!hasInventoryAccess) {
    return (
      <section style={{ padding: 32 }}>
        <h2>Manufacturing</h2>
        <p>You do not have permission to manage production runs.</p>
      </section>
    );
  }

  const renderRates = () => (
    <div className="section-card" ref={ratesRef} style={{ marginBottom: 24 }}>
      <h3 style={{ marginTop: 0 }}>Worker piece rates</h3>
      <p style={{ color: "var(--color-muted)", marginTop: -4 }}>
        Adjust per-product piece rates for each manufacturing worker.
      </p>
      {activeEmployees.length === 0 ? (
        <p style={{ color: "var(--color-muted)" }}>No manufacturing workers found.</p>
      ) : (
        activeEmployees.map((worker) => (
          <div
            key={worker.id}
            style={{ borderTop: "1px solid var(--color-border)", paddingTop: 12, marginTop: 12 }}
          >
            <h4 style={{ margin: "0 0 8px 0" }}>{worker.name}</h4>
            <PieceRateManager
              employee={worker}
              products={manufacturedProducts}
              selectedProductId={selectedProductNumericId}
              title="Piece rates"
              onRatesUpdated={(updatedRate) => updateWorkerRatesCache(worker.id, updatedRate)}
            />
          </div>
        ))
      )}
    </div>
  );

  const renderLog = () => (
    <>
      <div className="section-card" style={{ marginBottom: 24 }} ref={logRef}>
        <h3 style={{ marginTop: 0 }}>Log production run</h3>
        {productsLoading || employeesLoading ? (
          <p>Loading production form…</p>
        ) : manufacturedProducts.length === 0 ? (
          <p>No products are marked as manufactured yet. Update a product in Products to enable production logging.</p>
        ) : (
          <form onSubmit={onSubmitProduction} className="form-grid two-columns">
            <label>
              Product *
              <select {...register("productId")}>
                <option value="">Select product</option>
                {manufacturedProducts.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
              {errors.productId ? <span className="error-text">{errors.productId.message}</span> : null}
            </label>

            <label>
              Entry date
              <input type="date" {...register("date")} />
            </label>

            <label>
              Quantity *
              <input type="number" step="any" min="0" {...register("quantity")} placeholder="Enter quantity" />
              {errors.quantity ? <span className="error-text">{errors.quantity.message}</span> : null}
            </label>

            {selectedProduct ? (
              <div
                style={{
                  gridColumn: "1 / -1",
                  background: "#f8fafc",
                  borderRadius: 8,
                  padding: 16,
                  display: "grid",
                  gap: 12,
                }}
              >
                <div>
                  <strong>Production recipe</strong>
                  {!hasAnyRecipe ? (
                    <p style={{ marginTop: 4, color: "#b45309" }}>
                      No components configured for this product. Edit it on the Products page first.
                    </p>
                  ) : (
                    <>
                      <div>
                        Powder:{" "}
                        {hasPowderRecipe
                          ? `${selectedProduct.productionPowderProduct?.name ?? "—"} (${powderPerUnit?.toLocaleString(
                              undefined,
                              { maximumFractionDigits: 3 },
                            )} per unit${powderTotal !== null ? ` • total ${powderTotal.toFixed(2)}` : ""})`
                          : "—"}
                      </div>
                      <div>
                        Cement:{" "}
                        {hasCementRecipe
                          ? `${selectedProduct.productionCementProduct?.name ?? "—"} (${cementPerUnit?.toLocaleString(
                              undefined,
                              { maximumFractionDigits: 3 },
                            )} per unit${cementTotal !== null ? ` • total ${cementTotal.toFixed(2)}` : ""})`
                          : "—"}
                      </div>
                    </>
                  )}
                </div>
                {isAdmin ? (
                  <div
                    style={{
                      borderTop: "1px solid var(--color-border)",
                      paddingTop: 12,
                      display: "grid",
                      gap: 12,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        id="custom-materials-toggle"
                        type="checkbox"
                        checked={useCustomMaterials}
                        onChange={(e) => setUseCustomMaterials(e.target.checked)}
                      />
                      <label htmlFor="custom-materials-toggle" style={{ margin: 0 }}>
                        Override materials (admin)
                      </label>
                    </div>
                    {useCustomMaterials ? (
                      <div className="form-grid two-columns">
                        <label>
                          Powder product (optional)
                          <select
                            value={customPowderProductId}
                            onChange={(e) => setCustomPowderProductId(e.target.value)}
                          >
                            <option value="">Use recipe/default</option>
                            {products.map((product) => (
                              <option key={product.id} value={product.id}>
                                {product.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Powder used (units)
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={customPowderUsed}
                            onChange={(e) => setCustomPowderUsed(e.target.value)}
                            placeholder="Leave blank to use recipe"
                          />
                        </label>
                        <label>
                          Cement product (optional)
                          <select value={customCementProductId} onChange={(e) => setCustomCementProductId(e.target.value)}>
                            <option value="">Use recipe/default</option>
                            {products.map((product) => (
                              <option key={product.id} value={product.id}>
                                {product.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Cement used (units)
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={customCementUsed}
                            onChange={(e) => setCustomCementUsed(e.target.value)}
                            placeholder="Leave blank to use recipe"
                          />
                        </label>
                        <small style={{ gridColumn: "1 / -1", color: "var(--color-muted)" }}>
                          Overrides apply only when checked; leave blank to fall back to the product recipe.
                        </small>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 12 }}>
                  <strong>Labor</strong>
                  <div className="form-grid two-columns" style={{ marginTop: 12 }}>
                    <label>
                      Worker
                      <select {...register("workerEmployeeId")}>
                        <option value="">Select worker (optional)</option>
                        {activeEmployees.map((employee) => (
                          <option key={employee.id} value={employee.id}>
                            {employee.name}
                          </option>
                        ))}
                      </select>
                      {errors.workerEmployeeId ? (
                        <span className="error-text">{errors.workerEmployeeId.message}</span>
                      ) : null}
                    </label>
                    <label>
                      Helper
                      <select {...register("helperEmployeeId")}>
                        <option value="">Select helper (optional)</option>
                        {activeEmployees.map((employee) => (
                          <option key={employee.id} value={employee.id}>
                            {employee.name}
                          </option>
                        ))}
                      </select>
                      {errors.helperEmployeeId ? (
                        <span className="error-text">{errors.helperEmployeeId.message}</span>
                      ) : null}
                    </label>
                  </div>
                  <div className="form-grid two-columns" style={{ marginTop: 12 }}>
                    <label>
                      Worker payout rate per 100
                      <input
                        type="number"
                        min="0"
                        step="any"
                        placeholder={workerTotal !== null ? workerTotal.toFixed(2) : "0.00"}
                        {...register("laborAmount")}
                      />
                      {errors.laborAmount ? (
                        <span className="error-text">{errors.laborAmount.message}</span>
                      ) : (
                        <small style={{ color: "var(--color-muted)" }}>Enter rate per 100 units.</small>
                      )}
                    </label>
                    <label>
                      Helper payout rate per 100
                      <input
                        type="number"
                        min="0"
                        step="any"
                        placeholder={helperTotal !== null ? helperTotal.toFixed(2) : "0.00"}
                        {...register("helperLaborAmount")}
                      />
                      {errors.helperLaborAmount ? (
                        <span className="error-text">{errors.helperLaborAmount.message}</span>
                      ) : (
                        <small style={{ color: "var(--color-muted)" }}>Leave blank to use the suggested total.</small>
                      )}
                    </label>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input type="checkbox" {...register("laborPaid")} />
                    Workers already paid for this run
                  </label>
                  <small style={{ color: "var(--color-muted)" }}>
                    Unpaid runs will appear in the table below so you can settle later.
                  </small>
                </div>
              </div>
            ) : (
              <p style={{ gridColumn: "1 / -1", color: "var(--color-muted)" }}>
                Select a product to review its recipe and crew payouts.
              </p>
            )}

            <label style={{ gridColumn: "1 / -1" }}>
              Notes
              <textarea {...register("notes")} placeholder="Optional notes" />
            </label>

            <div style={{ gridColumn: "1 / -1" }}>
              <button type="submit" className="primary-button" disabled={isCreating}>
                {isCreating ? "Saving…" : "Save production run"}
              </button>
              {formError ? <p className="error-text" style={{ marginTop: 8 }}>{formError}</p> : null}
            </div>
          </form>
        )}
      </div>

      <div className="section-card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Outstanding labor</h3>
        {laborQuery.isLoading ? (
          <p>Loading outstanding runs…</p>
        ) : laborQuery.error ? (
          <p className="error-text">Failed to load manufacturing data.</p>
        ) : entries.length === 0 ? (
          <p>All production runs have been paid.</p>
        ) : (
          <>
            <p style={{ marginBottom: 12 }}>
              Total owed: <strong>{formatCurrency(totalDue)}</strong>
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
              <label style={{ display: "flex", flexDirection: "column", fontSize: 12, color: "var(--color-muted)" }}>
                Sort order
                <select value={outstandingOrder} onChange={handleOutstandingOrderChange} style={{ minWidth: 140 }}>
                  <option value="desc">Newest first</option>
                  <option value="asc">Oldest first</option>
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", fontSize: 12, color: "var(--color-muted)" }}>
                Rows per page
                <select value={outstandingPageSize} onChange={handleOutstandingPageSizeChange} style={{ minWidth: 100 }}>
                  {[10, 25, 50, 100].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {groupedEntries.map((group) => (
              <div key={group.key} style={{ marginBottom: 24 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 12,
                    marginBottom: 8,
                  }}
                >
                  <div>
                    <h4 style={{ margin: 0 }}>{group.label}</h4>
                    <small style={{ color: "var(--color-muted)" }}>
                      {group.entries.length} run{group.entries.length === 1 ? "" : "s"} • {formatCurrency(group.total)}
                    </small>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <input
                      type="date"
                      value={getGroupPaidDate(group.key)}
                      onChange={(event) => setGroupPaidDates((prev) => ({ ...prev, [group.key]: event.target.value }))}
                    />
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => handleMarkGroupPaid(group.key, group.entries)}
                      disabled={bulkPayingKey === group.key || group.entries.length === 0}
                    >
                      {bulkPayingKey === group.key ? "Marking…" : "Mark group paid"}
                    </button>
                  </div>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Product</th>
                        <th>Quantity</th>
                        <th>Workers</th>
                        <th>Helpers</th>
                        <th>Total due</th>
                        <th>Mark paid</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.entries.map((entry) => {
                        const workerAmount = entry.laborAmount ?? 0;
                        const helperAmount = entry.helperLaborAmount ?? 0;
                        const laborTotal = workerAmount + helperAmount;
                        const entryDate = new Date(entry.entryDate ?? entry.createdAt).toLocaleDateString();
                        const pending = mutation.isPending && mutation.variables?.id === entry.id;
                        return (
                          <tr key={entry.id}>
                            <td>{entryDate}</td>
                            <td>{entry.product.name}</td>
                            <td>{entry.quantity.toLocaleString()}</td>
                            <td>
                              {workerAmount > 0
                                ? `${formatCurrency(workerAmount)}${entry.workerEmployee ? ` (${entry.workerEmployee.name})` : ""}`
                                : "—"}
                            </td>
                            <td>
                              {helperAmount > 0
                                ? `${formatCurrency(helperAmount)}${entry.helperEmployee ? ` (${entry.helperEmployee.name})` : ""}`
                                : "—"}
                            </td>
                            <td>{formatCurrency(laborTotal)}</td>
                            <td>
                              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                <input
                                  type="date"
                                  value={getPaidDate(entry)}
                                  onChange={(event) => setPaidDates((prev) => ({ ...prev, [entry.id]: event.target.value }))}
                                />
                                <button
                                  type="button"
                                  className="secondary-button"
                                  onClick={() => handleMarkPaid(entry)}
                                  disabled={pending || bulkPayingKey === group.key}
                                >
                                  {pending ? "Saving…" : "Mark paid"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            <div
              style={{
                marginTop: 8,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <div style={{ color: "var(--color-muted)" }}>
                Showing {outstandingShowingFrom}-{outstandingShowingTo} of {sortedOutstandingEntries.length}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={goToPreviousOutstandingPage}
                  disabled={outstandingPage <= 1}
                >
                  Previous
                </button>
                <span style={{ color: "var(--color-muted)" }}>
                  Page {Math.min(outstandingPage, outstandingTotalPages)} of {outstandingTotalPages}
                </span>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={goToNextOutstandingPage}
                  disabled={outstandingPage >= outstandingTotalPages}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="section-card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <h3 style={{ margin: 0 }}>All production runs</h3>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ display: "flex", flexDirection: "column", fontSize: 12, color: "var(--color-muted)" }}>
              Sort order
              <select value={historyOrder} onChange={handleHistoryOrderChange} style={{ minWidth: 140 }}>
                <option value="desc">Newest first</option>
                <option value="asc">Oldest first</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", fontSize: 12, color: "var(--color-muted)" }}>
              Rows per page
              <select value={historyPageSize} onChange={handleHistoryPageSizeChange} style={{ minWidth: 100 }}>
                {[10, 25, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        {isHistoryLoading ? (
          <p>Loading production history…</p>
        ) : historyEntries.length === 0 ? (
          <p>No production entries recorded yet.</p>
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Product</th>
                    <th>Quantity</th>
                    <th>Labor</th>
                    <th>Crew</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {historyEntries.map((entry) => {
                    const entryDate = new Date(entry.entryDate ?? entry.createdAt).toLocaleDateString();
                    const laborAmount = (entry.laborAmount ?? 0) + (entry.helperLaborAmount ?? 0);
                    const laborLabel =
                      laborAmount > 0
                        ? `${entry.laborPaid ? "Paid" : "Unpaid"} • ${formatCurrency(laborAmount)}`
                        : "—";
                    const crew =
                      [entry.workerEmployee?.name, entry.helperEmployee?.name ? `Helper: ${entry.helperEmployee.name}` : null]
                        .filter(Boolean)
                        .join(" • ") || "—";
                    return (
                      <tr key={entry.id}>
                        <td>{entryDate}</td>
                        <td>{entry.product.name}</td>
                        <td>{entry.quantity.toLocaleString()}</td>
                        <td>{laborLabel}</td>
                        <td>{crew}</td>
                        <td>{entry.notes ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div
              style={{
                marginTop: 12,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <div style={{ color: "var(--color-muted)" }}>
                Showing {historyShowingFrom}-{historyShowingTo} of {historyTotalCount}
                {isHistoryFetching ? <span style={{ marginLeft: 8, fontStyle: "italic" }}>Updating…</span> : null}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button type="button" className="ghost-button" onClick={goToPreviousHistoryPage} disabled={historyPrevDisabled}>
                  Previous
                </button>
                <span style={{ color: "var(--color-muted)" }}>
                  Page {historyPage} of {historyTotalPages}
                </span>
                <button type="button" className="ghost-button" onClick={goToNextHistoryPage} disabled={historyNextDisabled}>
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );

  if (activeTab === "rates") {
    return (
      <section>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2>Manufacturing</h2>
            <p>Track production runs and labor payouts.</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="primary-button" onClick={() => setActiveTab("log")}>
              Back to log
            </button>
          </div>
        </header>
        {renderRates()}
      </section>
    );
  }

  return (
    <section>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2>Manufacturing</h2>
          <p>Track production runs and labor payouts.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="primary-button"
            onClick={() => setActiveTab("log")}
          >
            Log manufacturing
          </button>
          <button
            type="button"
            className="secondary-button ghost-button"
            onClick={() => setActiveTab("rates")}
          >
            Worker rates
          </button>
        </div>
      </header>
      {renderLog()}
    </section>
  );
}

export default ManufacturingPage;

type PieceRateManagerProps = {
  employee: Employee;
  products: Product[];
  selectedProductId: number | null;
  title: string;
  onRatesUpdated?: (updatedRate: ManufacturingPieceRate) => void;
};

function PieceRateManager({
  employee,
  products,
  selectedProductId,
  title,
  onRatesUpdated,
}: PieceRateManagerProps) {
  const queryClient = useQueryClient();
  const [productId, setProductId] = useState<string>(selectedProductId ? String(selectedProductId) : "");
  const [workerRateValue, setWorkerRateValue] = useState("");
  const [helperRateValue, setHelperRateValue] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setProductId(selectedProductId ? String(selectedProductId) : "");
  }, [selectedProductId, employee.id]);

  const existingRate = useMemo(() => {
    const parsed = Number(productId);
    if (!productId || Number.isNaN(parsed)) return null;
    return employee.pieceRates?.find((rate) => rate.productId === parsed && rate.isActive) ?? null;
  }, [employee.pieceRates, productId]);

  useEffect(() => {
    setWorkerRateValue(
      existingRate?.rate != null ? (existingRate.rate * PIECEWORK_DIVISOR).toString() : "",
    );
    setHelperRateValue(
      existingRate?.helperRate != null ? (existingRate.helperRate * PIECEWORK_DIVISOR).toString() : "",
    );
  }, [existingRate?.id, existingRate?.rate, existingRate?.helperRate]);

  const rateMutation = useMutation({
    mutationFn: async (payload: { productId: number; rate: number; helperRate: number | null; existingId?: number }) => {
      if (payload.existingId) {
        return updatePieceRate(payload.existingId, {
          rate: payload.rate,
          helperRate: payload.helperRate,
        });
      }
      return createPieceRate(employee.id, {
        productId: payload.productId,
        rate: payload.rate,
        helperRate: payload.helperRate,
      });
    },
    onMutate: () => {
      setSaveError(null);
    },
    onSuccess: (updatedRate) => {
      setWorkerRateValue(
        updatedRate?.rate != null ? (updatedRate.rate * PIECEWORK_DIVISOR).toString() : "",
      );
      setHelperRateValue(
        updatedRate?.helperRate != null ? (updatedRate.helperRate * PIECEWORK_DIVISOR).toString() : "",
      );
      if (updatedRate) {
        onRatesUpdated?.(updatedRate);
      }
      queryClient.invalidateQueries({ queryKey: ["manufacturing-workers"] });
    },
    onError: (err: any) => {
      const message = err?.response?.data?.error ?? err?.message ?? "Failed to save rates";
      setSaveError(message);
    },
  });

  const handleSaveRates = () => {
    if (!productId) {
      window.alert("Select a product first.");
      return;
    }
    const parsedProductId = Number(productId);
    if (Number.isNaN(parsedProductId) || parsedProductId <= 0) {
      window.alert("Select a valid product.");
      return;
    }
    const parsedWorkerRatePer100 = Number(workerRateValue);
    if (!workerRateValue || Number.isNaN(parsedWorkerRatePer100) || parsedWorkerRatePer100 <= 0) {
      window.alert("Enter a valid worker rate.");
      return;
    }
    const helperTrimmed = helperRateValue.trim();
    const parsedHelperRatePer100 = helperTrimmed.length === 0 ? null : Number(helperTrimmed);
    if (parsedHelperRatePer100 !== null && (Number.isNaN(parsedHelperRatePer100) || parsedHelperRatePer100 <= 0)) {
      window.alert("Enter a valid helper rate or leave blank.");
      return;
    }
    rateMutation.mutate({
      productId: parsedProductId,
      rate: parsedWorkerRatePer100 / PIECEWORK_DIVISOR,
      helperRate: parsedHelperRatePer100 === null ? null : parsedHelperRatePer100 / PIECEWORK_DIVISOR,
      existingId: existingRate?.id,
    });
  };

  if (products.length === 0) {
    return null;
  }

  return (
    <div className="section-card" style={{ marginTop: 16 }}>
      <div className="form-grid two-columns">
        <label>
          {title}
          <select value={productId} onChange={(event) => setProductId(event.target.value)}>
            <option value="">Select product</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Worker rate per 100 *
          <input
            type="number"
            min="0"
            step="any"
            value={workerRateValue}
            onChange={(event) => setWorkerRateValue(event.target.value)}
            placeholder="0.00"
          />
        </label>
        <label>
          Helper rate per 100
          <input
            type="number"
            min="0"
            step="any"
            value={helperRateValue}
            onChange={(event) => setHelperRateValue(event.target.value)}
            placeholder="Optional"
          />
        </label>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button type="button" className="secondary-button" onClick={handleSaveRates} disabled={rateMutation.isPending}>
            {rateMutation.isPending ? "Saving…" : "Save rates"}
          </button>
        </div>
      </div>
      {saveError ? (
        <p className="error-text" style={{ marginTop: 8 }}>
          {saveError}
        </p>
      ) : null}
      {existingRate ? (
        <p style={{ marginTop: 8, color: "var(--color-muted)" }}>
          Current worker rate: {formatCurrency(existingRate.rate * PIECEWORK_DIVISOR)} per 100 units
          {existingRate.helperRate
            ? ` • Helper rate: ${formatCurrency(existingRate.helperRate * PIECEWORK_DIVISOR)} per 100 units`
            : null}
        </p>
      ) : null}
    </div>
  );
}
