import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createInventoryEntry,
  deleteInventoryEntry,
  fetchInventoryEntries,
  fetchNextInventoryNumbers,
  updateInventoryEntry,
  type InventoryEntryPayload,
} from "../api/inventory";
import { fetchProducts, overrideProductStock } from "../api/products";
import { fetchSuppliers } from "../api/suppliers";
import { fetchManufacturingWorkers } from "../api/employees";
import type { InventoryEntry, InventoryEntryType } from "../types";
import {
  findDisplayOption,
  getDisplayOptionsForProduct,
  type DisplayOption,
} from "../constants/materials";
import { MAKBASES, formatMakbas } from "../constants/makbas";
import { useAuth } from "../context/AuthContext";
import {
  getRateFromMap,
  loadStoredRates,
  makeRateKey,
  persistStoredRates,
  type RateRole,
  type StoredRateMap,
} from "../utils/manufacturingRates";

const MAKBASE_ID_SET = new Set(MAKBASES.map((option) => option.id));

const inventorySchema = z
  .object({
    type: z.enum(["PURCHASE", "PRODUCTION"]),
    inventoryNo: z.string().optional(),
    supplierId: z.string().optional(),
    productId: z.string().min(1, "Select a product"),
    quantity: z
      .string()
      .min(1, "Quantity is required")
      .refine((val) => !Number.isNaN(Number(val)) && Number(val) > 0, "Enter a valid quantity"),
    notes: z.string().optional(),
    date: z.string().optional(),
    pricePerDisplayUnit: z.string().optional(),
    priceDisplayOptionId: z.string().optional(),
    isPaid: z.boolean().optional(),
    tvaEligible: z.boolean().optional(),
    laborPaid: z.boolean().optional(),
    laborAmount: z.string().optional(),
    helperLaborAmount: z.string().optional(),
    workerEmployeeId: z.string().optional(),
    helperEmployeeId: z.string().optional(),
    productionSite: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "PURCHASE") {
      if (!data.supplierId || data.supplierId.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["supplierId"],
          message: "Supplier is required for purchases",
        });
      }
      if (!data.priceDisplayOptionId || data.priceDisplayOptionId.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["priceDisplayOptionId"],
          message: "Select the unit you are pricing",
        });
      }
      if (!data.pricePerDisplayUnit || data.pricePerDisplayUnit.trim() === "" || Number(data.pricePerDisplayUnit) <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pricePerDisplayUnit"],
          message: "Enter a valid price",
        });
      }
    }

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

    if (data.type === "PRODUCTION") {
      if (!data.productionSite || !MAKBASE_ID_SET.has(data.productionSite)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["productionSite"],
          message: "Select a Makbas location",
        });
      }
    }

    const validateEmployeeField = (value: string | undefined, field: "workerEmployeeId" | "helperEmployeeId") => {
      if (value && value.trim().length > 0 && Number.isNaN(Number(value))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: "Select a valid employee",
        });
      }
    };

    validateEmployeeField(data.workerEmployeeId, "workerEmployeeId");
    validateEmployeeField(data.helperEmployeeId, "helperEmployeeId");
  });

type InventoryFormValues = z.infer<typeof inventorySchema>;

const formatCurrency = (value: number): string => `$${value.toFixed(2)}`;

export function InventoryPage() {
  const queryClient = useQueryClient();
  const { user, can } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const canManageInventory = user?.role === "ADMIN" || can("inventory:manage");
  const [formError, setFormError] = useState<string | null>(null);
  const [stockOverrideError, setStockOverrideError] = useState<string | null>(null);
  const [stockOverrideMessage, setStockOverrideMessage] = useState<string | null>(null);
  const [stockEdits, setStockEdits] = useState<Record<number, string>>({});
  const [savingStockId, setSavingStockId] = useState<number | null>(null);
  const [entriesPage, setEntriesPage] = useState(1);
  const [entriesPageSize, setEntriesPageSize] = useState(25);
  const [entriesSortBy, setEntriesSortBy] = useState<string>("entryDate");
  const [entriesOrder, setEntriesOrder] = useState<"asc" | "desc">("desc");
  const [lastSaveError, setLastSaveError] = useState<{
    timestamp: string;
    message: string;
  } | null>(null);
  const [nextInventoryNumber, setNextInventoryNumber] = useState<string>("");
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: fetchProducts,
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: fetchSuppliers,
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["manufacturing-workers"],
    queryFn: fetchManufacturingWorkers,
  });

  const activeEmployees = useMemo(() => {
    const manufacturing = employees.filter(
      (employee) => employee.active && employee.role === "MANUFACTURING",
    );
    if (manufacturing.length > 0) {
      return manufacturing;
    }
    return employees.filter((employee) => employee.active);
  }, [employees]);

  const [entriesProductFilter, setEntriesProductFilter] = useState<string>("");
  const [useCustomMaterials, setUseCustomMaterials] = useState(false);
  const [customPowderProductId, setCustomPowderProductId] = useState<string>("");
  const [customPowderUsed, setCustomPowderUsed] = useState<string>("");
  const [customCementProductId, setCustomCementProductId] = useState<string>("");
  const [customCementUsed, setCustomCementUsed] = useState<string>("");
  const {
    data: entriesResponse,
    isLoading: loadingEntries,
    isFetching: fetchingEntries,
  } = useQuery({
    queryKey: [
      "inventory-entries",
      entriesProductFilter || "all",
      entriesPage,
      entriesPageSize,
      entriesSortBy,
      entriesOrder,
    ],
    queryFn: () =>
      fetchInventoryEntries({
        productId: entriesProductFilter ? Number(entriesProductFilter) : undefined,
        page: entriesPage,
        pageSize: entriesPageSize,
        sortBy: entriesSortBy,
        order: entriesOrder,
      }),
  });
  const { data: nextNumbers } = useQuery({
    queryKey: ["inventory", "next-number"],
    queryFn: fetchNextInventoryNumbers,
  });

  const stockOverrideMutation = useMutation({
    mutationFn: ({ productId, stockQty }: { productId: number; stockQty: number }) =>
      overrideProductStock(productId, stockQty),
    onSuccess: (_data, variables) => {
      setStockOverrideError(null);
      setStockOverrideMessage("Stock level updated.");
      setStockEdits((prev) => ({ ...prev, [variables.productId]: "" }));
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-entries"] });
    },
    onError: (err: any) => {
      setStockOverrideMessage(null);
      setStockOverrideError(err?.response?.data?.error ?? err?.message ?? "Failed to update stock");
    },
    onSettled: () => {
      setSavingStockId(null);
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<InventoryFormValues>({
    resolver: zodResolver(inventorySchema),
    defaultValues: {
      type: "PURCHASE",
      inventoryNo: "",
      supplierId: "",
      productId: "",
      quantity: "",
      notes: "",
      date: today,
      pricePerDisplayUnit: "",
      priceDisplayOptionId: "",
      isPaid: true,
      tvaEligible: false,
      laborPaid: false,
      laborAmount: "",
      helperLaborAmount: "",
      workerEmployeeId: "",
      helperEmployeeId: "",
      productionSite: MAKBASES[0]?.id ?? "",
    },
  });
  const [storedRates, setStoredRates] = useState<StoredRateMap>(() => loadStoredRates());
  const [editingEntry, setEditingEntry] = useState<InventoryEntry | null>(null);

  const updateStoredRates = useCallback((updater: (prev: StoredRateMap) => StoredRateMap) => {
    setStoredRates((prev) => {
      const next = updater(prev);
      persistStoredRates(next);
      return next;
    });
  }, []);

  const selectedType = watch("type");
  const selectedProductId = watch("productId");
  const quantityValue = watch("quantity");
  const pricePerDisplayUnitValue = watch("pricePerDisplayUnit");
  const priceDisplayOptionId = watch("priceDisplayOptionId");
  const productionSiteValue = watch("productionSite");
  const workerEmployeeIdValue = watch("workerEmployeeId");
  const helperEmployeeIdValue = watch("helperEmployeeId");
  const inventoryNoValue = watch("inventoryNo");

  const filteredProducts = useMemo(() => {
    if (selectedType === "PURCHASE") {
      return products.filter((product) => !product.isManufactured);
    }
    if (selectedType === "PRODUCTION") {
      return products.filter((product) => product.isManufactured);
    }
    return products;
  }, [products, selectedType]);

  const selectedProduct = useMemo(() => {
    const id = Number(selectedProductId);
    if (!selectedProductId || Number.isNaN(id)) return undefined;
    return products.find((product) => product.id === id);
  }, [products, selectedProductId]);
  const selectedProductNumericId = selectedProduct?.id ?? null;

  const hasPowderRecipe =
    selectedType === "PRODUCTION" &&
    selectedProduct?.isManufactured &&
    selectedProduct.productionPowderProductId !== null &&
    selectedProduct.productionPowderProductId !== undefined &&
    selectedProduct.productionPowderQuantity !== null &&
    selectedProduct.productionPowderQuantity !== undefined;

  const hasCementRecipe =
    selectedType === "PRODUCTION" &&
    selectedProduct?.isManufactured &&
    selectedProduct.productionCementProductId !== null &&
    selectedProduct.productionCementProductId !== undefined &&
    selectedProduct.productionCementQuantity !== null &&
    selectedProduct.productionCementQuantity !== undefined;

  const hasAnyRecipe = hasPowderRecipe || hasCementRecipe;

  useEffect(() => {
    if (editingEntry) return;
    if (!nextNumbers) return;
    const suggested = selectedType === "PRODUCTION" ? nextNumbers.production : nextNumbers.purchase;
    if (suggested && suggested !== nextInventoryNumber) {
      setNextInventoryNumber(suggested);
    }
  }, [editingEntry, nextNumbers, selectedType, nextInventoryNumber]);

  useEffect(() => {
    if (editingEntry) return;
    if (!nextInventoryNumber) return;
    if (!inventoryNoValue || inventoryNoValue.trim().length === 0) {
      setValue("inventoryNo", nextInventoryNumber, { shouldDirty: false });
    }
  }, [editingEntry, nextInventoryNumber, inventoryNoValue, setValue]);

  useEffect(() => {
    if (selectedType !== "PURCHASE") {
      setValue("supplierId", "");
      setValue("isPaid", true);
      setValue("tvaEligible", false);
      setValue("pricePerDisplayUnit", "");
      setValue("priceDisplayOptionId", "");
      setValue("laborPaid", false);
      setValue("laborAmount", "");
      setValue("helperLaborAmount", "");
      setValue("workerEmployeeId", "");
      setValue("helperEmployeeId", "");
    } else {
      setValue("laborPaid", true);
      setValue("laborAmount", "");
      setValue("helperLaborAmount", "");
      setValue("workerEmployeeId", "");
      setValue("helperEmployeeId", "");
    }
  }, [selectedType, setValue]);

  useEffect(() => {
    if (!selectedProductId) return;
    const id = Number(selectedProductId);
    if (Number.isNaN(id)) return;
    if (!filteredProducts.some((product) => product.id === id)) {
      setValue("productId", "", { shouldDirty: true, shouldValidate: true });
    }
  }, [filteredProducts, selectedProductId, setValue]);

  const quantityNumber = Number(quantityValue || 0) > 0 ? Number(quantityValue || 0) : 0;
  const powderPerUnit =
    hasPowderRecipe && selectedProduct
      ? selectedProduct.productionPowderQuantity ?? 0
      : null;
  const powderTotal =
    powderPerUnit !== null && selectedProduct
      ? powderPerUnit * quantityNumber
      : null;
  const cementPerUnit =
    hasCementRecipe && selectedProduct
      ? selectedProduct.productionCementQuantity ?? 0
      : null;
  const cementTotal =
    cementPerUnit !== null && selectedProduct
      ? cementPerUnit * quantityNumber
      : null;
  const customWorkerRate = useMemo(
    () => getRateFromMap(storedRates, "worker", workerEmployeeIdValue, selectedProductNumericId),
    [storedRates, workerEmployeeIdValue, selectedProductNumericId],
  );
  const customHelperRate = useMemo(
    () => getRateFromMap(storedRates, "helper", helperEmployeeIdValue, selectedProductNumericId),
    [storedRates, helperEmployeeIdValue, selectedProductNumericId],
  );
  const productWorkerRate =
    selectedProduct?.pieceworkRate !== undefined && selectedProduct?.pieceworkRate !== null
      ? selectedProduct.pieceworkRate
      : null;
  const productHelperRate =
    selectedProduct?.helperPieceworkRate !== undefined && selectedProduct?.helperPieceworkRate !== null
      ? selectedProduct.helperPieceworkRate
      : null;
  const workerRate = customWorkerRate ?? productWorkerRate;
  const helperRate = customHelperRate ?? productHelperRate;
  const workerTotal =
    workerRate !== null && quantityNumber > 0 ? workerRate * quantityNumber : workerRate !== null ? 0 : null;
  const helperTotal =
    helperRate !== null && quantityNumber > 0 ? helperRate * quantityNumber : helperRate !== null ? 0 : null;
  const hasLaborRates = workerRate !== null || helperRate !== null;
  const workerRateSource =
    workerRate === null
      ? null
      : customWorkerRate !== null
      ? "Saved rate"
      : productWorkerRate !== null
      ? "Product rate"
      : null;
  const helperRateSource =
    helperRate === null
      ? null
      : customHelperRate !== null
      ? "Saved rate"
      : productHelperRate !== null
      ? "Product rate"
      : null;
  const displayOptions = useMemo(
    () => getDisplayOptionsForProduct(selectedProduct),
    [selectedProduct],
  );
  const quickPresets = displayOptions.filter((option) => !option.id.startsWith("base:"));
  const showLoadPresets = quickPresets.length > 0;
  const selectedPriceOption =
    selectedProduct && priceDisplayOptionId
      ? findDisplayOption(selectedProduct, priceDisplayOptionId) ?? displayOptions[0]
      : displayOptions[0];
  const pricePerDisplayUnitNumber =
    typeof pricePerDisplayUnitValue === "string" && pricePerDisplayUnitValue.trim().length > 0
      ? Number(pricePerDisplayUnitValue)
      : null;
  const convertedBaseUnitCost =
    selectedProduct &&
    selectedPriceOption &&
    pricePerDisplayUnitNumber !== null &&
    !Number.isNaN(pricePerDisplayUnitNumber)
      ? pricePerDisplayUnitNumber / (selectedPriceOption.toBaseFactor || 1)
      : null;
  const handleStockInputChange = (productId: number, value: string) => {
    setStockEdits((prev) => ({ ...prev, [productId]: value }));
  };
  const handleSaveCustomRate = useCallback(
    (role: RateRole) => {
      if (!selectedProduct || !selectedProductNumericId) {
        window.alert("Select a product first.");
        return;
      }
      const employeeIdValue = role === "worker" ? workerEmployeeIdValue : helperEmployeeIdValue;
      if (!employeeIdValue) {
        window.alert(`Select a ${role === "worker" ? "worker" : "helper"} first.`);
        return;
      }
      const employeeId = Number(employeeIdValue);
      if (Number.isNaN(employeeId)) {
        window.alert("Invalid employee selection.");
        return;
      }
      const existing =
        role === "worker"
          ? customWorkerRate ?? productWorkerRate
          : customHelperRate ?? productHelperRate;
      const promptLabel =
        role === "worker"
          ? `Enter per-unit rate for ${selectedProduct.name}`
          : `Enter helper per-unit rate for ${selectedProduct.name}`;
      const input = window.prompt(
        `${promptLabel}\nLeave empty to remove the saved rate.`,
        existing !== null && existing !== undefined ? existing.toString() : "",
      );
      if (input === null) return;
      const trimmed = input.trim();
      const key = makeRateKey(role, employeeId, selectedProductNumericId);
      if (trimmed.length === 0) {
        updateStoredRates((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        return;
      }
      const parsed = Number(trimmed);
      if (Number.isNaN(parsed) || parsed <= 0) {
        window.alert("Enter a positive number.");
        return;
      }
      updateStoredRates((prev) => ({
        ...prev,
        [key]: parsed,
      }));
    },
    [
      customHelperRate,
      customWorkerRate,
      helperEmployeeIdValue,
      productHelperRate,
      productWorkerRate,
      selectedProduct,
      selectedProductNumericId,
      updateStoredRates,
      workerEmployeeIdValue,
    ],
  );

  const handleEditEntry = (entry: InventoryEntry) => {
    if (entry.type !== "PRODUCTION") {
      window.alert("Only production entries can be edited.");
      return;
    }
    setEditingEntry(entry);
    setValue("inventoryNo", entry.inventoryNo, { shouldDirty: false });
    setValue("type", "PRODUCTION", { shouldDirty: true });
    setValue("productId", String(entry.productId), { shouldDirty: true });
    setValue("quantity", entry.quantity.toString(), { shouldDirty: true });
    const entryDate = entry.entryDate ?? entry.createdAt;
    const formattedDate = entryDate ? new Date(entryDate).toISOString().slice(0, 10) : today;
    setValue("date", formattedDate, { shouldDirty: true });
    setValue("notes", entry.notes ?? "", { shouldDirty: true });
    setValue("productionSite", entry.productionSite ?? MAKBASES[0]?.id ?? "", { shouldDirty: true });
    setValue("laborPaid", entry.laborPaid ?? false, { shouldDirty: true });
    setValue("laborAmount", entry.laborAmount != null ? entry.laborAmount.toString() : "", {
      shouldDirty: true,
    });
    setValue(
      "helperLaborAmount",
      entry.helperLaborAmount != null ? entry.helperLaborAmount.toString() : "",
      { shouldDirty: true },
    );
    setValue("workerEmployeeId", entry.workerEmployeeId ? String(entry.workerEmployeeId) : "", {
      shouldDirty: true,
    });
    setValue("helperEmployeeId", entry.helperEmployeeId ? String(entry.helperEmployeeId) : "", {
      shouldDirty: true,
    });
  };

  const cancelEditing = () => {
    setEditingEntry(null);
    const currentDate = watch("date");
    reset({
      type: selectedType,
      inventoryNo: nextInventoryNumber || "",
      supplierId: "",
      productId: "",
      quantity: "",
      notes: "",
      date: currentDate && currentDate.trim().length > 0 ? currentDate : today,
      pricePerDisplayUnit: "",
      priceDisplayOptionId: "",
      isPaid: selectedType === "PURCHASE",
      laborPaid: selectedType === "PRODUCTION" ? false : true,
      laborAmount: "",
      helperLaborAmount: "",
      workerEmployeeId: "",
      helperEmployeeId: "",
      productionSite: selectedType === "PRODUCTION" ? MAKBASES[0]?.id ?? "" : "",
    });
    setFormError(null);
  };

  const handleStockSave = (productId: number, currentStock: number) => {
    const rawValue = (stockEdits[productId] ?? "").trim();
    if (rawValue.length === 0) {
      setStockOverrideError("Enter a new stock amount before saving.");
      setStockOverrideMessage(null);
      return;
    }
    const parsedValue = Number(rawValue);
    if (Number.isNaN(parsedValue) || parsedValue < 0) {
      setStockOverrideError("Stock must be a non-negative number.");
      setStockOverrideMessage(null);
      return;
    }
    if (parsedValue === currentStock) {
      setStockOverrideError("Stock value is unchanged.");
      setStockOverrideMessage(null);
      return;
    }
    setSavingStockId(productId);
    stockOverrideMutation.mutate({ productId, stockQty: parsedValue });
  };
  useEffect(() => {
    if (selectedType !== "PURCHASE") {
      return;
    }
    if (!selectedProduct) {
      return;
    }
    if (!priceDisplayOptionId || !displayOptions.some((option) => option.id === priceDisplayOptionId)) {
      const fallback = displayOptions[0];
      if (fallback) {
        setValue("priceDisplayOptionId", fallback.id, { shouldDirty: false });
      }
    }
  }, [selectedType, selectedProduct, priceDisplayOptionId, displayOptions, setValue]);

  useEffect(() => {
    if (selectedType === "PRODUCTION") {
      if (!productionSiteValue || !MAKBASE_ID_SET.has(productionSiteValue)) {
        const fallbackSite = MAKBASES[0]?.id ?? "";
        if (fallbackSite.length > 0) {
          setValue("productionSite", fallbackSite, { shouldDirty: false });
        }
      }
    } else if (productionSiteValue) {
      setValue("productionSite", "", { shouldDirty: false });
    }
  }, [productionSiteValue, selectedType, setValue]);

  const applyQuantityPreset = (preset: DisplayOption) => {
    const contextLabel = selectedProduct?.name ?? "this entry";
    const input = window.prompt(`How many ${preset.promptLabel} for ${contextLabel}?`, "1");
    if (input === null) {
      return;
    }
    const count = Number(input.trim());
    if (Number.isNaN(count) || count <= 0) {
      window.alert("Enter a positive number of loads.");
      return;
    }
    const quantity = count * preset.toBaseFactor;
    setValue("quantity", quantity.toString(), { shouldDirty: true, shouldValidate: true });
    if (selectedType === "PURCHASE" && displayOptions.some((option) => option.id === preset.id)) {
      setValue("priceDisplayOptionId", preset.id, { shouldDirty: true, shouldValidate: true });
    }
  };

  const createMutation = useMutation({
    mutationFn: createInventoryEntry,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-entries"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["production-labor-queue"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-payables"] });
      queryClient.invalidateQueries({ queryKey: ["inventory", "next-number"] });
      setNextInventoryNumber("");
      const currentDate = watch("date");
      reset({
        type: selectedType,
        inventoryNo: "",
        supplierId: "",
        productId: "",
        quantity: "",
        notes: "",
        date: currentDate && currentDate.trim().length > 0 ? currentDate : today,
        pricePerDisplayUnit: "",
        priceDisplayOptionId: "",
        isPaid: true,
        laborPaid: selectedType === "PRODUCTION" ? false : true,
        laborAmount: "",
        helperLaborAmount: "",
        workerEmployeeId: "",
        helperEmployeeId: "",
        productionSite: selectedType === "PRODUCTION" ? MAKBASES[0]?.id ?? "" : "",
      });
      setFormError(null);
      setLastSaveError(null);
    },
    onError: (err: any) => {
      const message = err?.response?.data?.error ?? err?.message ?? "Failed to create entry";
      setFormError(message);
      setLastSaveError({
        timestamp: new Date().toISOString(),
        message,
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteInventoryEntry,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-entries"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: InventoryEntryPayload }) =>
      updateInventoryEntry(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-entries"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["inventory", "next-number"] });
      setEditingEntry(null);
      const currentDate = watch("date");
      reset({
        type: "PRODUCTION",
        inventoryNo: "",
        supplierId: "",
        productId: "",
        quantity: "",
        notes: "",
        date: currentDate && currentDate.trim().length > 0 ? currentDate : today,
        pricePerDisplayUnit: "",
        priceDisplayOptionId: "",
        isPaid: true,
        laborPaid: true,
        laborAmount: "",
        helperLaborAmount: "",
        workerEmployeeId: "",
        helperEmployeeId: "",
        productionSite: MAKBASES[0]?.id ?? "",
      });
      setFormError(null);
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.error ?? err?.message ?? "Failed to update entry");
    },
  });

  const onSubmit = handleSubmit((data) => {
    setFormError(null);
    const payloadType: InventoryEntryType = data.type;
    const quantityNumber = Number(data.quantity);

    const payload: InventoryEntryPayload = {
      type: payloadType,
      productId: Number(data.productId),
      quantity: quantityNumber,
      notes: data.notes?.trim() ? data.notes.trim() : null,
      supplierId:
        payloadType === "PURCHASE" && data.supplierId?.trim()
          ? Number(data.supplierId)
          : null,
      date: data.date && data.date.trim().length > 0 ? data.date : today,
    };

    if (payloadType === "PRODUCTION") {
      if (!selectedProduct) {
        setFormError("Select a product for this production entry");
        return;
      }

      if (!selectedProduct.isManufactured) {
        setFormError("This product is not marked as manufactured. Update it in Products first.");
        return;
      }

      const adminOverrideActive = isAdmin && useCustomMaterials;
      if (!hasAnyRecipe && !adminOverrideActive) {
        setFormError(
          "Set up production components for this product on the Products page before logging production, or enable admin overrides.",
        );
        return;
      }

      if (hasPowderRecipe && selectedProduct.productionPowderProductId != null && selectedProduct.productionPowderQuantity != null) {
        const powderQuantity = selectedProduct.productionPowderQuantity;
        payload.powderProductId = selectedProduct.productionPowderProductId;
        payload.powderUsed = powderQuantity * quantityNumber;
      } else if (!adminOverrideActive) {
        payload.powderProductId = null;
        payload.powderUsed = null;
      }

      if (hasCementRecipe && selectedProduct.productionCementProductId != null && selectedProduct.productionCementQuantity != null) {
        const cementQuantity = selectedProduct.productionCementQuantity;
        payload.cementProductId = selectedProduct.productionCementProductId;
        payload.cementUsed = cementQuantity * quantityNumber;
      } else if (!adminOverrideActive) {
        payload.cementProductId = null;
        payload.cementUsed = null;
      }

      payload.productionSite = data.productionSite ?? null;

      const laborAmountRaw = data.laborAmount?.trim();
      const helperAmountRaw = data.helperLaborAmount?.trim();
      if (laborAmountRaw && laborAmountRaw.length > 0) {
        payload.laborAmount = Number(laborAmountRaw);
      }
      if (helperAmountRaw && helperAmountRaw.length > 0) {
        payload.helperLaborAmount = Number(helperAmountRaw);
      }

      payload.laborPaid = data.laborPaid ?? false;

      const workerSelection = data.workerEmployeeId?.trim();
      if (workerSelection && workerSelection.length > 0) {
        payload.workerEmployeeId = Number(workerSelection);
      }

      const helperSelection = data.helperEmployeeId?.trim();
      if (helperSelection && helperSelection.length > 0) {
        payload.helperEmployeeId = Number(helperSelection);
      }

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
    }

    if (payloadType === "PURCHASE") {
      if (!selectedProduct) {
        setFormError("Select a product before saving a purchase entry");
        return;
      }
      const pricingOption =
        findDisplayOption(selectedProduct, data.priceDisplayOptionId ?? "") ?? displayOptions[0];
      if (!pricingOption) {
        setFormError("Select a unit for pricing");
        return;
      }
      const parsedPrice = Number(data.pricePerDisplayUnit);
      if (Number.isNaN(parsedPrice) || parsedPrice <= 0) {
        setFormError("Enter a valid price");
        return;
      }
      const convertedUnitCost =
        pricingOption.toBaseFactor === 0 ? parsedPrice : parsedPrice / pricingOption.toBaseFactor;
      payload.unitCost = convertedUnitCost;
      payload.isPaid = data.isPaid ?? true;
      payload.tvaEligible = data.tvaEligible ?? false;
    }

    if (editingEntry) {
      if (payloadType !== "PRODUCTION") {
        setFormError("Only production entries can be edited.");
        return;
      }
      updateMutation.mutate({ id: editingEntry.id, payload });
      return;
    }

    createMutation.mutate(payload);
  });

  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const isDeleting = deleteMutation.isPending;
  const busy = useMemo(
    () => loadingEntries || fetchingEntries || isDeleting,
    [loadingEntries, fetchingEntries, isDeleting],
  );
  const entries = entriesResponse?.entries ?? [];
  const totalEntryPagesFiltered = entriesResponse?.totalPages ?? 1;
  const currentEntriesPage = Math.min(entriesPage, totalEntryPagesFiltered);
  const paginatedEntries = entries;
  useEffect(() => {
    setEntriesPage(1);
  }, [entriesProductFilter, entriesSortBy, entriesOrder, entriesPageSize]);

  return (
    <section>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
      <div>
        <h2>Inventory</h2>
        <p>Log purchases and production runs to keep stock accurate.</p>
      </div>
      <Link to="/manufacturing" className="secondary-button">
        Manufacturing window
      </Link>
    </header>
      {lastSaveError ? (
        <div
          className="section-card"
          style={{
            border: "1px solid #f87171",
            background: "#fef2f2",
            color: "#7f1d1d",
            marginBottom: 24,
          }}
        >
          <strong>Last save failed</strong>
          <p style={{ marginTop: 4, marginBottom: 4 }}>
            {lastSaveError.message}
          </p>
          <small>
            Nothing was saved. Try again once your connection is stable (last attempt{" "}
            {new Date(lastSaveError.timestamp).toLocaleString()}).
          </small>
        </div>
      ) : null}

      {isAdmin ? (
        <div className="section-card" style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div>
              <h3 style={{ marginTop: 0 }}>Manual stock adjustments</h3>
              <p style={{ marginBottom: 0, color: "var(--color-muted)" }}>
                Update on-hand quantities for any product. This immediately updates stock balances and audit logs the change.
              </p>
            </div>
          </div>
          {stockOverrideError ? (
            <p className="error-text" style={{ marginTop: 12 }}>
              {stockOverrideError}
            </p>
          ) : null}
          {stockOverrideMessage ? (
            <p style={{ marginTop: 12, color: "var(--color-success, #15803d)" }}>{stockOverrideMessage}</p>
          ) : null}
          <div className="table-scroll" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Unit</th>
                  <th>Current stock</th>
                  <th style={{ width: 220 }}>New stock</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id}>
                    <td>{product.name}</td>
                    <td>{product.unit}</td>
                    <td>{product.stockQty.toLocaleString(undefined, { maximumFractionDigits: 3 })}</td>
                    <td>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={stockEdits[product.id] ?? ""}
                        placeholder={product.stockQty.toString()}
                        onChange={(event) => handleStockInputChange(product.id, event.target.value)}
                      />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => handleStockSave(product.id, product.stockQty)}
                        disabled={savingStockId === product.id && stockOverrideMutation.isPending}
                      >
                        {savingStockId === product.id && stockOverrideMutation.isPending ? "Saving…" : "Save"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="section-card">
        <h3 style={{ marginTop: 0 }}>Add entry</h3>
        {editingEntry ? (
          <div
            style={{
              background: "#fff7ed",
              border: "1px solid #fdba74",
              borderRadius: 8,
              padding: 12,
              marginBottom: 12,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <strong>Editing production run for {editingEntry.product.name}</strong>
              <div style={{ color: "var(--color-muted)" }}>
                Quantity: {editingEntry.quantity.toLocaleString()} •{" "}
                {new Date(editingEntry.entryDate ?? editingEntry.createdAt).toLocaleDateString()}
              </div>
            </div>
            <button type="button" className="ghost-button" onClick={cancelEditing}>
              Cancel edit
            </button>
          </div>
        ) : null}
        <form onSubmit={onSubmit} className="form-grid two-columns">
          <label>
            Entry number
            <input
              {...register("inventoryNo")}
              placeholder="Auto-assigned"
              readOnly
              disabled
            />
            <small className="muted-text">
              Auto-assigned in sequence (P for purchases, M for production).
            </small>
          </label>
          <label>
            Entry type *
            <select {...register("type")} disabled={Boolean(editingEntry)}>
              <option value="PURCHASE">Purchase</option>
              <option value="PRODUCTION">Production</option>
            </select>
          </label>

          <label>
            Entry date
            <input type="date" {...register("date")} />
          </label>

          <label>
            Product *
            <select {...register("productId")}>
              <option value="">Select product</option>
              {filteredProducts.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
            {errors.productId && <span className="error-text">{errors.productId.message}</span>}
          </label>

          <label>
            Quantity *
            <input
              type="number"
              step="any"
              min="0"
              {...register("quantity")}
              placeholder="Enter quantity"
            />
            {errors.quantity && <span className="error-text">{errors.quantity.message}</span>}
            {showLoadPresets ? (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  marginTop: 6,
                  alignItems: "center",
                }}
              >
                <small style={{ fontSize: 11, color: "var(--color-muted)" }}>Quick loads:</small>
                {quickPresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyQuantityPreset(preset)}
                    style={{
                      border: "1px solid var(--color-border)",
                      background: "white",
                      padding: "2px 8px",
                      borderRadius: 12,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                    title={preset.detail}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            ) : null}
          </label>

          {selectedType === "PURCHASE" && (
            <>
              <label>
                Supplier *
                <select {...register("supplierId")}>
                  <option value="">Select supplier</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
                {errors.supplierId && <span className="error-text">{errors.supplierId.message}</span>}
              </label>

              <label>
                Price per *
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    {...register("pricePerDisplayUnit")}
                    placeholder="0.00"
                    disabled={!selectedProduct}
                  />
                  <select {...register("priceDisplayOptionId")} disabled={!selectedProduct || displayOptions.length === 0}>
                    {displayOptions.length === 0 ? (
                      <option value="">Select unit</option>
                    ) : null}
                    {displayOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                {selectedProduct ? (
                  <small style={{ display: "block", marginTop: 4, color: "var(--color-muted)" }}>
                    Converted to {selectedProduct.unit}:{" "}
                    {convertedBaseUnitCost !== null && !Number.isNaN(convertedBaseUnitCost)
                      ? formatCurrency(convertedBaseUnitCost)
                      : "—"}
                  </small>
                ) : (
                  <small style={{ display: "block", marginTop: 4, color: "var(--color-muted)" }}>
                    Select a product to choose units.
                  </small>
                )}
                {errors.pricePerDisplayUnit && (
                  <span className="error-text">{errors.pricePerDisplayUnit.message}</span>
                )}
                {errors.priceDisplayOptionId && (
                  <span className="error-text">{errors.priceDisplayOptionId.message}</span>
                )}
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" {...register("isPaid")} />
                Mark as paid
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" {...register("tvaEligible")} />
                TVA invoice
              </label>
              <small style={{ display: "block", color: "var(--color-muted)" }}>
                Only TVA purchases appear on the Tax tab.
              </small>
            </>
          )}

          {selectedType === "PRODUCTION" && selectedProduct ? (
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
              <label>
                Makbas location *
                <select {...register("productionSite")}>
                  <option value="">Select Makbas</option>
                  {MAKBASES.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.label}
                    </option>
                  ))}
                </select>
                {errors.productionSite ? (
                  <span className="error-text">{errors.productionSite.message}</span>
                ) : null}
              </label>
              <div>
                <strong>Production recipe</strong>
                {!selectedProduct.isManufactured ? (
                  <p style={{ marginTop: 4, color: "#b91c1c" }}>
                    This product is not marked as manufactured. Update it in Products to log production automatically.
                  </p>
                ) : hasAnyRecipe ? (
                  <>
                    <div>
                      Powder:{" "}
                      {hasPowderRecipe
                        ? `${selectedProduct.productionPowderProduct?.name ?? "—"} (${powderPerUnit?.toLocaleString(
                            undefined,
                            {
                              maximumFractionDigits: 3,
                            },
                          )} per unit${powderTotal !== null ? ` • total ${powderTotal.toFixed(2)}` : ""})`
                        : "—"}
                    </div>
                    <div>
                      Cement:{" "}
                      {hasCementRecipe
                        ? `${selectedProduct.productionCementProduct?.name ?? "—"} (${cementPerUnit?.toLocaleString(
                            undefined,
                            {
                              maximumFractionDigits: 3,
                            },
                          )} per unit${cementTotal !== null ? ` • total ${cementTotal.toFixed(2)}` : ""})`
                        : "—"}
                    </div>
                  </>
                ) : (
                  <p style={{ marginTop: 4, color: "#b45309" }}>
                    No production components configured yet. Edit this product on the Products page.
                  </p>
                )}
                {isAdmin ? (
                  <div style={{ marginTop: 12, borderTop: "1px solid var(--color-border)", paddingTop: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        id="inv-custom-materials-toggle"
                        type="checkbox"
                        checked={useCustomMaterials}
                        onChange={(e) => setUseCustomMaterials(e.target.checked)}
                      />
                      <label htmlFor="inv-custom-materials-toggle" style={{ margin: 0 }}>
                        Override materials (admin)
                      </label>
                    </div>
                    {useCustomMaterials ? (
                      <div className="form-grid two-columns" style={{ marginTop: 8 }}>
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
                          <select
                            value={customCementProductId}
                            onChange={(e) => setCustomCementProductId(e.target.value)}
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
              </div>
              <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 12 }}>
                <strong>Worker payout preview</strong>
                <div style={{ color: "var(--color-muted)", fontSize: 14 }}>
                  {workerRate !== null ? (
                    <div>
                      Workers: {formatCurrency(workerRate)} per unit{" "}
                      {workerRateSource ? `(${workerRateSource})` : ""} →{" "}
                      {formatCurrency(workerTotal ?? 0)}
                    </div>
                  ) : (
                    <div>Workers: No rate configured</div>
                  )}
                  {helperRate !== null ? (
                    <div>
                      Helpers: {formatCurrency(helperRate)} per unit{" "}
                      {helperRateSource ? `(${helperRateSource})` : ""} →{" "}
                      {formatCurrency(helperTotal ?? 0)}
                    </div>
                  ) : (
                    <div>Helpers: No rate configured</div>
                  )}
                  <div style={{ marginTop: 4 }}>
                    Total due:{" "}
                    {hasLaborRates
                      ? formatCurrency((workerTotal ?? 0) + (helperTotal ?? 0))
                      : "Set piecework rates to track payouts"}
                  </div>
                </div>
                <div className="form-grid two-columns" style={{ marginTop: 12 }}>
                  <label>
                    Worker
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <select {...register("workerEmployeeId")}>
                        <option value="">Select worker (optional)</option>
                        {activeEmployees.map((employee) => (
                          <option key={employee.id} value={employee.id}>
                            {employee.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => handleSaveCustomRate("worker")}
                        disabled={!selectedProduct || !workerEmployeeIdValue}
                      >
                        {customWorkerRate ? "Edit rate" : "Save rate"}
                      </button>
                    </div>
                    {customWorkerRate ? (
                      <small style={{ color: "var(--color-muted)" }}>
                        Saved rate: {formatCurrency(customWorkerRate)} per unit
                      </small>
                    ) : (
                      <small style={{ color: "var(--color-muted)" }}>
                        Defaults to product rate when available.
                      </small>
                    )}
                    {errors.workerEmployeeId ? (
                      <span className="error-text">{errors.workerEmployeeId.message}</span>
                    ) : null}
                  </label>
                  <label>
                    Helper
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <select {...register("helperEmployeeId")}>
                        <option value="">Select helper (optional)</option>
                        {activeEmployees.map((employee) => (
                          <option key={employee.id} value={employee.id}>
                            {employee.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => handleSaveCustomRate("helper")}
                        disabled={!selectedProduct || !helperEmployeeIdValue}
                      >
                        {customHelperRate ? "Edit rate" : "Save rate"}
                      </button>
                    </div>
                    {customHelperRate ? (
                      <small style={{ color: "var(--color-muted)" }}>
                        Saved rate: {formatCurrency(customHelperRate)} per unit
                      </small>
                    ) : (
                      <small style={{ color: "var(--color-muted)" }}>
                        Defaults to product rate when available.
                      </small>
                    )}
                    {errors.helperEmployeeId ? (
                      <span className="error-text">{errors.helperEmployeeId.message}</span>
                    ) : null}
                  </label>
                </div>
                <div className="form-grid two-columns" style={{ marginTop: 12 }}>
                  <label>
                    Worker payout
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
                      <small style={{ color: "var(--color-muted)" }}>
                        Leave blank to use the suggested total.
                      </small>
                    )}
                  </label>
                  <label>
                    Helper payout
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
                      <small style={{ color: "var(--color-muted)" }}>
                        Leave blank to use the suggested total.
                      </small>
                    )}
                  </label>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" {...register("laborPaid")} />
                  Workers already paid for this run
                </label>
                <small style={{ color: "var(--color-muted)" }}>
                  Unpaid runs appear in the Manufacturing tab so you can settle later.
                </small>
              </div>
            </div>
          ) : null}

          <label style={{ gridColumn: "1 / -1" }}>
            Notes
            <textarea {...register("notes")} placeholder="Optional notes about this entry" />
          </label>

          <div style={{ gridColumn: "1 / -1" }}>
            <button type="submit" className="primary-button" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Save entry"}
            </button>
            {formError && <div className="error-text">{formError}</div>}
          </div>
        </form>
      </div>

      <div className="section-card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <h3 style={{ margin: 0 }}>Recent entries</h3>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ minWidth: 220 }}>
              Filter by product
              <select
                value={entriesProductFilter}
                onChange={(event) => setEntriesProductFilter(event.target.value)}
              >
                <option value="">All products</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Sort by
              <select
                value={entriesSortBy}
                onChange={(e) => {
                  setEntriesSortBy(e.target.value);
                  setEntriesPage(1);
                }}
              >
                <option value="entryDate">Entry date</option>
                <option value="createdAt">Created at</option>
                <option value="productName">Product</option>
                <option value="quantity">Quantity</option>
              </select>
            </label>
            <label>
              Order
              <select
                value={entriesOrder}
                onChange={(e) => {
                  setEntriesOrder(e.target.value as "asc" | "desc");
                  setEntriesPage(1);
                }}
              >
                <option value="desc">Desc</option>
                <option value="asc">Asc</option>
              </select>
            </label>
            <label>
              Rows per page
              <select
                value={entriesPageSize}
                onChange={(e) => {
                  setEntriesPageSize(Number(e.target.value));
                  setEntriesPage(1);
                }}
              >
                {[10, 25, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        {busy ? (
          <p>Loading entries…</p>
        ) : entries.length === 0 ? (
          <p>
            {entriesProductFilter
              ? "No entries found for the selected product."
              : "No inventory activity recorded yet."}
          </p>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Makbas</th>
                  <th>Product</th>
                  <th>Quantity</th>
                  <th>Cost / Supplier</th>
                  <th>TVA</th>
                  <th>Status</th>
                  <th>Crew</th>
                  <th>Labor</th>
                  <th>Notes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {paginatedEntries.map((entry) => {
                  const formattedDate = new Date(entry.entryDate ?? entry.createdAt).toLocaleDateString();
                  const isPurchase = entry.type === "PURCHASE";
                  const supplierLabel = isPurchase && entry.supplier ? entry.supplier.name : "—";
                  const unitCost = entry.unitCost ?? undefined;
                  const totalCost = entry.totalCost ?? undefined;
                  const costDisplay = isPurchase
                    ? [
                        supplierLabel !== "—" ? `Supplier: ${supplierLabel}` : null,
                        unitCost !== undefined ? `Unit: ${formatCurrency(unitCost)}` : null,
                        totalCost !== undefined ? `Total: ${formatCurrency(totalCost)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" • ") || "—"
                    : [
                        entry.powderProduct && entry.powderUsed
                          ? `Powder: ${entry.powderProduct.name} (${entry.powderUsed})`
                          : null,
                        entry.cementProduct && entry.cementUsed
                          ? `Cement: ${entry.cementProduct.name} (${entry.cementUsed})`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" • ") || "—";
                  const workerPortion = entry.laborAmount ?? 0;
                  const helperPortion = entry.helperLaborAmount ?? 0;
                  const laborTotal = workerPortion + helperPortion;
                  const hasLabor = entry.type === "PRODUCTION" && laborTotal > 0;
                  const laborDisplay = hasLabor
                    ? `${entry.laborPaid ? "Paid" : "Unpaid"} • ${formatCurrency(laborTotal)}`
                    : "—";
                  const crewDisplay =
                    entry.workerEmployee || entry.helperEmployee
                      ? [
                          entry.workerEmployee?.name ?? null,
                          entry.helperEmployee?.name ? `Helper: ${entry.helperEmployee.name}` : null,
                        ]
                          .filter(Boolean)
                          .join(" • ")
                      : "—";
                  return (
                    <tr key={entry.id}>
                      <td>{entry.inventoryNo}</td>
                      <td>{formattedDate}</td>
                      <td>{isPurchase ? "Purchase" : "Production"}</td>
                      <td>{entry.type === "PRODUCTION" ? formatMakbas(entry.productionSite) : "—"}</td>
                      <td>{entry.product.name}</td>
                      <td>{entry.quantity.toLocaleString()}</td>
                      <td>{costDisplay}</td>
                      <td>{isPurchase ? (entry.tvaEligible ? "Yes" : "No") : "—"}</td>
                      <td>
                        {isPurchase ? (
                          <span style={{ color: entry.isPaid ? "#1b5e20" : "#b71c1c" }}>
                            {entry.isPaid ? "Paid" : "Unpaid"}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{crewDisplay}</td>
                      <td>{laborDisplay}</td>
                      <td>{entry.notes ?? "—"}</td>
                    <td>
                      <div className="table-actions">
                        <Link
                          className="secondary-button"
                          to={`/inventory/print?inventoryId=${entry.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Print
                        </Link>
                        {entry.type === "PRODUCTION" && canManageInventory ? (
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => handleEditEntry(entry)}
                            disabled={isSubmitting}
                          >
                            Edit
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => deleteMutation.mutate(entry.id)}
                          disabled={isDeleting}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {totalEntryPagesFiltered > 1 ? (
              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setEntriesPage((prev) => Math.max(1, prev - 1))}
                  disabled={currentEntriesPage === 1}
                >
                  Previous
                </button>
                <span>
                  Page {currentEntriesPage} of {totalEntryPagesFiltered}
                </span>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() =>
                    setEntriesPage((prev) => Math.min(totalEntryPagesFiltered, prev + 1))
                  }
                  disabled={currentEntriesPage === totalEntryPagesFiltered}
                >
                  Next
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

export default InventoryPage;
