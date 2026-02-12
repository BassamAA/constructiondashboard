import { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  useFieldArray,
  useForm,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { fetchCustomers } from "../api/customers";
import { fetchProducts } from "../api/products";
import { fetchDrivers } from "../api/drivers";
import { fetchTrucks } from "../api/trucks";
import { fetchJobSites } from "../api/jobSites";
import {
  createReceipt,
  deleteReceipt,
  fetchReceiptsPage,
  fetchNextReceiptNumbers,
  updateReceipt,
  overrideReceiptNumber,
} from "../api/receipts";
import type { UpdateReceiptInput, ReceiptsPage as ReceiptsPageResponse } from "../api/receipts";
import type { Product, Receipt } from "../types";
import {
  findDisplayOption,
  getDisplayOptionsForProduct,
  type DisplayOption,
} from "../constants/materials";
import { useAuth } from "../context/AuthContext";

const lineSchema = z.object({
  productId: z.string().min(1, "Select a product"),
  quantity: z
    .string()
    .min(1, "Quantity is required")
    .refine((val) => !Number.isNaN(Number(val)) && Number(val) > 0, "Enter a valid quantity"),
  unitPrice: z
    .string()
    .optional()
    .superRefine((val, ctx) => {
      if (!val || val.trim().length === 0) {
        return;
      }
      const parsed = Number(val);
      if (Number.isNaN(parsed) || parsed < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Enter a valid unit price",
        });
      }
    }),
  displayUnit: z.string().optional(),
});

const receiptSchema = z
  .object({
    receiptType: z.enum(["NORMAL", "TVA"]),
    receiptNo: z.string().optional(),
    date: z.string().optional(),
    customerType: z.enum(["ACCOUNT", "WALK_IN"]),
    customerId: z.string().optional(),
    jobSiteId: z.string().optional(),
    walkInName: z.string().optional(),
    driverId: z.string().optional(),
    truckId: z.string().optional(),
    tehmil: z.boolean().optional(),
    tenzil: z.boolean().optional(),
    isPaid: z.boolean().optional(),
    items: z.array(lineSchema).min(1, "Add at least one line item"),
  })
  .superRefine((data, ctx) => {
    if (data.customerType === "ACCOUNT") {
      if (!data.customerId || data.customerId.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["customerId"],
          message: "Select a customer",
        });
      }
    } else if (!data.walkInName || data.walkInName.trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["walkInName"],
        message: "Provide the walk-in customer's name",
      });
    }
  });

type ReceiptFormValues = z.infer<typeof receiptSchema>;

const emptyLine = {
  productId: "",
  quantity: "",
  unitPrice: "",
  displayUnit: "",
};

const formatCompositeMix = (product?: Product): string | null => {
  if (!product?.isComposite || !product.compositeComponents || product.compositeComponents.length === 0) {
    return null;
  }
  return product.compositeComponents
    .map((component) => {
      const amount = component.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 });
      const unit = component.componentProduct?.unit ? ` ${component.componentProduct.unit}` : "";
      const name = component.componentProduct?.name ?? "Component";
      return `${amount}${unit} ${name}`;
    })
    .join(", ");
};

const receiptNumberPattern = /(.*?)(\d+)([^\d]*)$/;

const incrementReceiptNumber = (value: string | undefined): string => {
  if (!value) return "";
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }

  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric)) {
    if (/^0\d+$/.test(trimmed)) {
      return String(numeric + 1).padStart(trimmed.length, "0");
    }
    return String(numeric + 1);
  }

  const match = trimmed.match(receiptNumberPattern);
  if (!match) {
    return trimmed;
  }

  const [, prefix, digits, suffix] = match;
  const incremented = String(Number(digits) + 1).padStart(digits.length, "0");
  return `${prefix}${incremented}${suffix}`;
};

export function ReceiptsPage() {
  const { can, user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const [editingReceiptId, setEditingReceiptId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [nextReceiptNumber, setNextReceiptNumber] = useState<string>("");
  const [stickyDate, setStickyDate] = useState<string>("");
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [typeFilter, setTypeFilter] = useState<"ALL" | "NORMAL" | "TVA">("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "UNPAID" | "PAID">("ALL");
  const [customerFilter, setCustomerFilter] = useState<string>("");
  const [driverFilter, setDriverFilter] = useState<string>("");
  const [truckFilter, setTruckFilter] = useState<string>("");
  const [productFilter, setProductFilter] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [sortField, setSortField] = useState<"date" | "receiptNo" | "total" | "amountPaid">("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const canEditReceipts = can("receipts:update");
  const canDeleteReceipts = can("receipts:delete");

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: fetchCustomers,
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: fetchProducts,
  });

  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers"],
    queryFn: fetchDrivers,
  });

  const { data: trucks = [] } = useQuery({
    queryKey: ["trucks"],
    queryFn: fetchTrucks,
  });

  useEffect(() => {
    setPage(1);
  }, [
    typeFilter,
    statusFilter,
    customerFilter,
    driverFilter,
    truckFilter,
    productFilter,
    searchTerm,
    startDate,
    endDate,
    sortField,
    sortOrder,
  ]);

  const receiptQueryParams = useMemo(
    () => ({
      page,
      limit: pageSize,
      type: typeFilter !== "ALL" ? (typeFilter as "NORMAL" | "TVA") : undefined,
      isPaid: statusFilter === "ALL" ? undefined : statusFilter === "PAID",
      customerId: customerFilter ? Number(customerFilter) : undefined,
      driverId: driverFilter ? Number(driverFilter) : undefined,
      truckId: truckFilter ? Number(truckFilter) : undefined,
      productId: productFilter ? Number(productFilter) : undefined,
      search: searchTerm.trim() || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      sortField,
      sortOrder,
    }),
    [
      page,
      pageSize,
      typeFilter,
      statusFilter,
      customerFilter,
      driverFilter,
      truckFilter,
      productFilter,
      searchTerm,
      startDate,
      endDate,
      sortField,
      sortOrder,
    ],
  );

  const receiptsQuery = useQuery<ReceiptsPageResponse>({
    queryKey: ["receipts", "paginated", receiptQueryParams],
    queryFn: () => fetchReceiptsPage(receiptQueryParams),
  });
  const receiptsData = receiptsQuery.data;
  const receipts: Receipt[] = receiptsData?.items ?? [];
  const receiptsForDisplay = useMemo(() => {
    if (!productFilter) return receipts;
    const parsed = Number(productFilter);
    if (Number.isNaN(parsed)) return receipts;
    return receipts.filter((receipt) =>
      receipt.items?.some((item) => item.productId === parsed),
    );
  }, [receipts, productFilter]);
  const isLoadingReceipts = receiptsQuery.isLoading;
  const isFetchingReceipts = receiptsQuery.isFetching;
  const totalPages = receiptsData?.totalPages ?? 1;
  const totalItems = receiptsData?.totalItems ?? 0;
  const canGoPrev = page > 1;
  const canGoNext = page < totalPages;
  const displayRangeStart = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const displayRangeEnd = totalItems === 0 ? 0 : Math.min(page * pageSize, totalItems);
  const emptyStateMessage = useMemo(() => {
    if (statusFilter === "UNPAID") return "No unpaid receipts match the filters.";
    if (statusFilter === "PAID") return "No paid receipts match the filters.";
    if (productFilter) return "No receipts match the selected product.";
    return "No receipts match the filters.";
  }, [statusFilter, productFilter]);

  useEffect(() => {
    if (!receiptsData) return;
    const maxPages = receiptsData.totalPages ?? 1;
    if (page > maxPages) {
      setPage(maxPages);
    }
  }, [receiptsData, page]);

  const { data: nextReceiptNumbers } = useQuery({
    queryKey: ["receipts", "next-number"],
    queryFn: fetchNextReceiptNumbers,
  });

  const {
    register,
    control,
    handleSubmit,
    watch,
    reset,
    setValue,
    formState: { errors },
  } = useForm<ReceiptFormValues>({
    resolver: zodResolver(receiptSchema),
    defaultValues: {
      receiptType: "NORMAL",
      receiptNo: "",
      date: "",
      customerType: "ACCOUNT",
      customerId: "",
      jobSiteId: "",
      walkInName: "",
      driverId: "",
      truckId: "",
      tehmil: false,
      tenzil: false,
      isPaid: false,
      items: [emptyLine],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "items",
  });

  const [productFilters, setProductFilters] = useState<Record<string, string>>({});

  const receiptType = watch("receiptType");
  const customerType = watch("customerType");
  const selectedCustomerId = watch("customerId");
  const formItems = watch("items");
  const watchedReceiptNo = watch("receiptNo");
  const watchedDate = watch("date");

  const prevReceiptTypeRef = useRef<Receipt["type"] | undefined>(undefined);
  const selectedCustomer = useMemo(
    () => customers.find((customer) => String(customer.id) === String(selectedCustomerId)),
    [customers, selectedCustomerId],
  );
  const lockedReceiptType = customerType === "ACCOUNT" ? selectedCustomer?.receiptType : null;

  useEffect(() => {
    const prev = prevReceiptTypeRef.current;
    const current = (lockedReceiptType ?? receiptType) as Receipt["type"];
    prevReceiptTypeRef.current = current;

    if (editingReceiptId) return;
    if (!nextReceiptNumbers) return;
    if (!current) return;

    const suggested =
      current === "TVA" ? nextReceiptNumbers.tva : nextReceiptNumbers.normal;
    if (!suggested) return;

    const currentValue = (watchedReceiptNo ?? "").trim();
    const shouldOverwrite =
      !prev ||
      prev !== current ||
      currentValue.length === 0 ||
      (current === "TVA" && !currentValue.toUpperCase().startsWith("T"));

    if (shouldOverwrite) {
      setNextReceiptNumber(suggested);
      setValue("receiptNo", suggested, { shouldDirty: false });
    }
  }, [receiptType, nextReceiptNumbers, editingReceiptId, watchedReceiptNo, setValue]);

  const getProductForLine = (lineIndex: number) => {
    const rawProductId = formItems?.[lineIndex]?.productId ?? "";
    if (!rawProductId) return undefined;
    return products.find((item) => String(item.id) === rawProductId);
  };

  const getDisplayPresetForLine = (
    lineIndex: number,
    defaultToFirst = true,
  ): DisplayOption | undefined => {
    const product = getProductForLine(lineIndex);
    const options = getDisplayOptionsForProduct(product);
    if (options.length === 0) return undefined;
    const selectedId = formItems?.[lineIndex]?.displayUnit ?? "";
    const preset = options.find((option) => option.id === selectedId);
    if (preset) return preset;
    return defaultToFirst ? options[0] : undefined;
  };

  const applyDisplayPreset = (lineIndex: number, preset: DisplayOption) => {
    const contextLabel = getProductForLine(lineIndex)?.name ?? "this line";
    const input = window.prompt(`How many ${preset.promptLabel} for ${contextLabel}?`, "1");
    if (input === null) return;
    const trimmed = input.trim();
    if (trimmed.length === 0) return;
    const count = Number(trimmed);
    if (Number.isNaN(count) || count <= 0) {
      window.alert("Enter a positive number.");
      return;
    }
    setValue(`items.${lineIndex}.quantity`, count.toString(), {
      shouldDirty: true,
      shouldValidate: true,
    });
    setValue(`items.${lineIndex}.displayUnit`, preset.id, {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const handleDisplayUnitChange = (lineIndex: number, optionId: string) => {
    const product = getProductForLine(lineIndex);
    const options = getDisplayOptionsForProduct(product);
    if (options.length === 0) return;

    const currentPreset = getDisplayPresetForLine(lineIndex);
    const newPreset = options.find((option) => option.id === optionId) ?? options[0];

    const currentQuantityValue = formItems?.[lineIndex]?.quantity ?? "";
    const currentPriceValue = formItems?.[lineIndex]?.unitPrice ?? "";
    const currentQuantity = Number(currentQuantityValue);
    const hasCurrentPrice = typeof currentPriceValue === "string" && currentPriceValue.trim().length > 0;
    const currentPrice = hasCurrentPrice ? Number(currentPriceValue) : null;

    const prevFactor = currentPreset?.toBaseFactor ?? 1;
    const newFactor = newPreset?.toBaseFactor ?? 1;

    const baseQuantity = !Number.isNaN(currentQuantity) ? currentQuantity * prevFactor : 0;
    const baseUnitPrice =
      currentPrice !== null && !Number.isNaN(currentPrice) ? currentPrice / (prevFactor || 1) : null;

    const nextDisplayQuantity = newFactor > 0 ? baseQuantity / newFactor : baseQuantity;
    const nextDisplayPrice =
      baseUnitPrice !== null ? (newFactor > 0 ? baseUnitPrice * newFactor : baseUnitPrice) : null;

    setValue(`items.${lineIndex}.displayUnit`, newPreset.id, {
      shouldDirty: true,
      shouldValidate: true,
    });
    setValue(`items.${lineIndex}.quantity`, nextDisplayQuantity.toString(), {
      shouldDirty: true,
      shouldValidate: true,
    });
    setValue(
      `items.${lineIndex}.unitPrice`,
      nextDisplayPrice !== null ? nextDisplayPrice.toString() : "",
      {
        shouldDirty: true,
        shouldValidate: true,
      },
    );
  };

  const formatLineItemDisplay = (item: Receipt["items"][number]): string => {
    const preset = findDisplayOption(item.product, item.displayUnit ?? undefined);
    const productName = item.product?.name ?? "Item";
    const displayQuantity = (() => {
      if (item.displayQuantity !== null && item.displayQuantity !== undefined) {
        return item.displayQuantity;
      }
      if (preset && preset.toBaseFactor > 0) {
        return item.quantity / preset.toBaseFactor;
      }
      return undefined;
    })();
    const hasPrice = item.unitPrice !== null && item.unitPrice !== undefined;
    const baseUnitPrice = hasPrice ? item.unitPrice! : null;
    const displayUnitPrice =
      baseUnitPrice !== null && preset && preset.toBaseFactor > 0
        ? baseUnitPrice * preset.toBaseFactor
        : baseUnitPrice;

    if (preset && displayQuantity !== undefined && !Number.isNaN(displayQuantity)) {
      if (!hasPrice || displayUnitPrice === null) {
        return `${productName} – ${displayQuantity.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })} ${preset.label} (price pending)`;
      }
      return `${productName} – ${displayQuantity.toLocaleString(undefined, {
        maximumFractionDigits: 2,
      })} ${preset.label} @ $${displayUnitPrice.toFixed(2)}`;
    }

    const baseUnit = item.product?.unit ?? "";
    if (!hasPrice) {
      return `${productName} – ${item.quantity.toLocaleString(undefined, {
        maximumFractionDigits: 2,
      })}${baseUnit ? ` ${baseUnit}` : ""} (price pending)`;
    }
    return `${productName} – ${item.quantity.toLocaleString(undefined, {
      maximumFractionDigits: 2,
    })}${baseUnit ? ` ${baseUnit}` : ""} @ $${baseUnitPrice!.toFixed(2)}`;
  };

  const toLineStateFromReceiptItem = (item: Receipt["items"][number]) => {
    const options = getDisplayOptionsForProduct(item.product);
    const preset = findDisplayOption(item.product, item.displayUnit ?? undefined) ?? options[0];
    let displayQuantity = item.quantity;
    if (item.displayQuantity !== null && item.displayQuantity !== undefined) {
      displayQuantity = item.displayQuantity;
    } else if (preset && preset.toBaseFactor > 0) {
      const derived = item.quantity / preset.toBaseFactor;
      if (!Number.isNaN(derived) && Number.isFinite(derived)) {
        displayQuantity = derived;
      }
    }

    const hasUnitPrice = item.unitPrice !== null && item.unitPrice !== undefined;
    const baseUnitPrice = hasUnitPrice ? item.unitPrice! : null;
    const adjustedUnitPrice =
      baseUnitPrice !== null && preset && preset.toBaseFactor > 0
        ? baseUnitPrice * preset.toBaseFactor
        : baseUnitPrice;

    return {
      productId: String(item.productId),
      quantity: displayQuantity.toString(),
      unitPrice: adjustedUnitPrice !== null ? adjustedUnitPrice.toString() : "",
      displayUnit: preset ? preset.id : "",
    };
  };

  useEffect(() => {
    if (editingReceiptId) return;
    if (!nextReceiptNumbers) return;
    const currentType = ((lockedReceiptType ?? receiptType) as Receipt["type"]) ?? "NORMAL";
    const suggested = currentType === "TVA" ? nextReceiptNumbers.tva : nextReceiptNumbers.normal;
    if (suggested && suggested !== nextReceiptNumber) {
      setNextReceiptNumber(suggested);
    }
  }, [editingReceiptId, nextReceiptNumbers, receiptType, lockedReceiptType, nextReceiptNumber]);

  useEffect(() => {
    if (editingReceiptId) return;
    if (!nextReceiptNumber) return;
    if (!watchedReceiptNo || watchedReceiptNo.trim().length === 0) {
      setValue("receiptNo", nextReceiptNumber, { shouldDirty: false });
    }
  }, [editingReceiptId, nextReceiptNumber, watchedReceiptNo, setValue]);

  useEffect(() => {
    if (editingReceiptId) return;
    if (!stickyDate) return;
    if (!watchedDate || watchedDate.trim().length === 0) {
      setValue("date", stickyDate, { shouldDirty: false });
    }
  }, [editingReceiptId, stickyDate, watchedDate, setValue]);

  useEffect(() => {
    if (customerType === "WALK_IN") {
      setValue("customerId", "");
      setValue("jobSiteId", "");
      setValue("receiptType", receiptType || "NORMAL", { shouldDirty: false });
    } else {
      setValue("walkInName", "");
    }
  }, [customerType, setValue]);

  useEffect(() => {
    if (customerType !== "ACCOUNT") return;
    if (!selectedCustomer) return;
    const enforcedType = selectedCustomer.receiptType as Receipt["type"];
    if (receiptType !== enforcedType) {
      setValue("receiptType", enforcedType, { shouldDirty: false });
    }
    if (!editingReceiptId && nextReceiptNumbers) {
      const suggested = enforcedType === "TVA" ? nextReceiptNumbers.tva : nextReceiptNumbers.normal;
      if (suggested) {
        setNextReceiptNumber(suggested);
        setValue("receiptNo", suggested, { shouldDirty: false });
      }
    }
  }, [
    customerType,
    selectedCustomer,
    receiptType,
    setValue,
    nextReceiptNumbers,
    editingReceiptId,
  ]);

  useEffect(() => {
    if (!formItems) return;
    formItems.forEach((item, index) => {
      const product = products.find((product) => String(product.id) === (item?.productId ?? ""));
      if (!product) return;
      const options = getDisplayOptionsForProduct(product);
      if (options.length === 0) return;
      const hasValidUnit = item?.displayUnit && options.some((option) => option.id === item.displayUnit);
      if (!hasValidUnit && options[0]) {
        setValue(`items.${index}.displayUnit`, options[0].id, { shouldDirty: false });
      }
    });
  }, [formItems, products, setValue]);

  const { data: jobSites = [] } = useQuery({
    queryKey: ["job-sites", customerType === "ACCOUNT" ? selectedCustomerId || "all" : "none"],
    queryFn: () =>
      fetchJobSites(
        selectedCustomerId && customerType === "ACCOUNT"
          ? Number(selectedCustomerId)
          : undefined,
      ),
    enabled: customerType === "ACCOUNT" && !!selectedCustomerId,
  });

  const createMutation = useMutation({
    mutationFn: createReceipt,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receipts", "paginated"] });
      queryClient.invalidateQueries({ queryKey: ["receipts", "next-number"] });
      queryClient.invalidateQueries({ queryKey: ["receipts", "flags-summary"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      reset({
        receiptType,
        receiptNo: nextReceiptNumber || "",
        date: stickyDate || "",
        customerType,
        customerId: customerType === "ACCOUNT" ? "" : undefined,
        jobSiteId: "",
        walkInName: "",
        driverId: "",
        truckId: "",
        tehmil: false,
        tenzil: false,
        isPaid: false,
        items: [{ ...emptyLine }],
      });
      setFormError(null);
      setPage(1);
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.error ?? err?.message ?? "Failed to create receipt");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: UpdateReceiptInput }) =>
      updateReceipt(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receipts", "paginated"] });
      queryClient.invalidateQueries({ queryKey: ["receipts", "flags-summary"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      cancelEditing();
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.error ?? err?.message ?? "Failed to update receipt");
    },
  });

  const markPaidMutation = useMutation({
    mutationFn: ({ id, total }: { id: number; total: number }) =>
      updateReceipt(id, { isPaid: true, amountPaid: total }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receipts", "paginated"] });
    },
  });

const cancelEditing = () => {
  setEditingReceiptId(null);
  setFormError(null);
  reset({
    receiptType: "NORMAL",
    receiptNo: nextReceiptNumber || "",
    date: stickyDate || "",
    customerType: "ACCOUNT",
    customerId: "",
    jobSiteId: "",
    walkInName: "",
    driverId: "",
    truckId: "",
    tehmil: false,
    tenzil: false,
    isPaid: false,
    items: [{ ...emptyLine }],
  });
};

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteReceipt(id),
    onSuccess: (_, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ["receipts", "paginated"] });
      queryClient.invalidateQueries({ queryKey: ["receipts", "flags-summary"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      if (editingReceiptId === deletedId) {
        cancelEditing();
      }
      setDeletingId(null);
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.error ?? err?.message ?? "Failed to delete receipt");
      setDeletingId(null);
    },
  });

  const overrideNumberMutation = useMutation({
    mutationFn: ({ id, receiptNo }: { id: number; receiptNo: string }) =>
      overrideReceiptNumber(id, receiptNo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receipts", "paginated"] });
    },
    onError: (err: any) => {
      window.alert(err?.response?.data?.error ?? err?.message ?? "Failed to update receipt number");
    },
  });

  const handleOpenPrint = (receipt: Receipt) => {
    navigate(`/receipts/print?receiptId=${receipt.id}`);
  };

  const handleOverrideReceiptNumber = (receipt: Receipt) => {
    const current = receipt.receiptNo ?? "";
    const input = window.prompt("Enter the new receipt number", current);
    if (input === null) return;
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      window.alert("Receipt number cannot be empty.");
      return;
    }
    overrideNumberMutation.mutate({ id: receipt.id, receiptNo: trimmed });
  };

  const onSubmit = handleSubmit((data) => {
    const payload = {
      type: data.receiptType,
      receiptNo: data.receiptNo?.trim() ? data.receiptNo.trim() : undefined,
      date: data.date ? new Date(data.date).toISOString() : undefined,
      customerId:
        data.customerType === "ACCOUNT" && data.customerId
          ? Number(data.customerId)
          : null,
      jobSiteId:
        data.customerType === "ACCOUNT" && data.jobSiteId
          ? Number(data.jobSiteId)
          : null,
      walkInName:
        data.customerType === "WALK_IN" && data.walkInName
          ? data.walkInName.trim()
          : null,
      driverId: data.driverId ? Number(data.driverId) : null,
      truckId: data.truckId ? Number(data.truckId) : null,
      tehmil: Boolean(data.tehmil),
      tenzil: Boolean(data.tenzil),
      isPaid: !!data.isPaid,
      items: data.items.map((item) => {
        const product = products.find((p) => String(p.id) === item.productId);
        const options = getDisplayOptionsForProduct(product);
        const preset = findDisplayOption(product, item.displayUnit ?? undefined) ?? options[0];
        const displayQuantityRaw = Number(item.quantity);
        const safeDisplayQuantity =
          !Number.isNaN(displayQuantityRaw) && displayQuantityRaw >= 0 ? displayQuantityRaw : 0;
        const factor = preset?.toBaseFactor ?? 1;
        const baseQuantity = safeDisplayQuantity * factor;
        const hasUnitPrice = typeof item.unitPrice === "string" && item.unitPrice.trim().length > 0;
        const displayUnitPriceRaw = hasUnitPrice ? Number(item.unitPrice) : null;
        const baseUnitPrice =
          displayUnitPriceRaw !== null && !Number.isNaN(displayUnitPriceRaw)
            ? factor > 0
              ? displayUnitPriceRaw / factor
              : displayUnitPriceRaw
            : null;

        return {
          productId: Number(item.productId),
          quantity: baseQuantity,
          unitPrice: baseUnitPrice,
          displayUnit: preset ? preset.id : undefined,
          displayQuantity: safeDisplayQuantity,
        };
      }),
    };

    if (!editingReceiptId) {
      const trimmedReceiptNo = data.receiptNo?.trim();
      if (trimmedReceiptNo) {
        setNextReceiptNumber(incrementReceiptNumber(trimmedReceiptNo));
      }
      if (data.date) {
        setStickyDate(data.date);
      }
    }

    setFormError(null);
    if (editingReceiptId) {
      updateMutation.mutate({ id: editingReceiptId, payload });
    } else {
      createMutation.mutate(payload);
    }
  });

  const handleStartEditing = (receipt: Receipt) => {
    if (!canEditReceipts) {
      setFormError("You do not have permission to edit receipts.");
      return;
    }
    setEditingReceiptId(receipt.id);
    setFormError(null);
    reset({
      receiptType: receipt.type,
      receiptNo: receipt.receiptNo ?? "",
      date: receipt.date ? receipt.date.slice(0, 10) : "",
      customerType: receipt.customerId ? "ACCOUNT" : "WALK_IN",
      customerId: receipt.customerId ? String(receipt.customerId) : "",
      jobSiteId: receipt.jobSiteId ? String(receipt.jobSiteId) : "",
      walkInName: receipt.walkInName ?? "",
      driverId: receipt.driverId ? String(receipt.driverId) : "",
      truckId: receipt.truckId ? String(receipt.truckId) : "",
      tehmil: Boolean(receipt.tehmil),
      tenzil: Boolean(receipt.tenzil),
      isPaid: receipt.isPaid,
      items:
        receipt.items.length > 0
          ? receipt.items.map((item) => ({
              ...toLineStateFromReceiptItem(item),
            }))
          : [{ ...emptyLine }],
    });
  };

  const handleDelete = (receipt: Receipt) => {
    if (!canDeleteReceipts) {
      setFormError("You do not have permission to delete receipts.");
      return;
    }
    if (deleteMutation.isPending) {
      return;
    }
    const confirmed = window.confirm(
      "Delete this receipt? Product stock will be restored and linked payments will be detached.",
    );
    if (!confirmed) {
      return;
    }
    setDeletingId(receipt.id);
    deleteMutation.mutate(receipt.id);
  };

  const handleMarkPaid = (receipt: Receipt) => {
    if (markPaidMutation.isPending) {
      return;
    }
    if (receipt.items.some((item) => item.unitPrice === null || item.unitPrice === undefined)) {
      setFormError("Set prices for this receipt before marking it as paid.");
      return;
    }
    markPaidMutation.mutate({ id: receipt.id, total: receipt.total });
  };

  const calculatedTotal = useMemo(() => {
    if (!formItems) return 0;
    return formItems.reduce((sum, item) => {
      const quantity = Number(item.quantity);
      const trimmedPrice = typeof item.unitPrice === "string" ? item.unitPrice.trim() : "";
      if (trimmedPrice.length === 0) {
        return sum;
      }
      const price = Number(trimmedPrice);
      if (Number.isNaN(quantity) || Number.isNaN(price)) {
        return sum;
      }
      return sum + quantity * price;
    }, 0);
  }, [formItems]);

  const hasPendingLinePricing = useMemo(() => {
    if (!formItems) return false;
    return formItems.some((item) => {
      if (typeof item.unitPrice !== "string") {
        return false;
      }
      return item.unitPrice.trim().length === 0;
    });
  }, [formItems]);

  const editingReceipt = useMemo<Receipt | null>(() => {
    if (!editingReceiptId) {
      return null;
    }
    return receipts.find((receipt) => receipt.id === editingReceiptId) ?? null;
  }, [editingReceiptId, receipts]);

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <section>
      <header>
        <h2>Receipts</h2>
        <p>Record outgoing loads, track who was billed, and update payment status.</p>
      </header>

      <div className="section-card">
        <h3 style={{ marginTop: 0 }}>
          {editingReceiptId ? "Edit receipt" : "Create receipt"}
        </h3>
        {editingReceipt ? (
          <p style={{ marginTop: -8, marginBottom: 16 }}>
            Editing {editingReceipt.receiptNo ? `receipt ${editingReceipt.receiptNo}` : `receipt #${editingReceipt.id}`}.
            Save your changes or cancel to switch back to a new invoice.
          </p>
        ) : null}
        <form onSubmit={onSubmit}>
          <div className="form-grid two-columns">
          <label>
            Receipt number
            <input {...register("receiptNo")} placeholder="Optional reference" />
          </label>
          <label>
            Date
            <input type="date" {...register("date")} />
          </label>
          <label>
            Receipt type *
            <select {...register("receiptType")} disabled={customerType === "ACCOUNT" && !!lockedReceiptType}>
              <option value="NORMAL">Normal</option>
              <option value="TVA">T</option>
            </select>
            {customerType === "ACCOUNT" && lockedReceiptType ? (
              <small className="muted-text">
                Locked to this customer’s type ({lockedReceiptType === "TVA" ? "T / TVA" : "Normal"}).
              </small>
            ) : (
              <small className="muted-text">Choose T for TVA receipts with T-prefixed numbers.</small>
            )}
          </label>
          <label>
            Customer type *
            <select {...register("customerType")}>
              <option value="ACCOUNT">Account customer</option>
              <option value="WALK_IN">Walk-in customer</option>
              </select>
            </label>

            {customerType === "ACCOUNT" ? (
              <>
                <label>
                  Customer *
                  <select {...register("customerId")}>
                    <option value="">Select a customer</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name}
                      </option>
                    ))}
                  </select>
                  {errors.customerId && (
                    <span className="error-text">{errors.customerId.message}</span>
                  )}
                </label>

                <label>
                  Job site
                  <select {...register("jobSiteId")}>
                    <option value="">No job site</option>
                    {jobSites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <label style={{ gridColumn: "1 / -1" }}>
                Walk-in customer name *
                <input {...register("walkInName")} placeholder="Customer name" />
                {errors.walkInName && (
                  <span className="error-text">{errors.walkInName.message}</span>
                )}
              </label>
            )}

            <label>
              Driver
              <select {...register("driverId")}>
                <option value="">No driver</option>
                {drivers.map((driver) => (
                  <option key={driver.id} value={driver.id}>
                    {driver.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Truck
              <select {...register("truckId")}>
                <option value="">No truck</option>
                {trucks.map((truck) => (
                  <option key={truck.id} value={truck.id}>
                    {truck.plateNo}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" {...register("tehmil")} />
              <span>Tehmil complete</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" {...register("tenzil")} />
              <span>Tenzil complete</span>
            </label>
            <label>
              Mark as paid
              <input type="checkbox" {...register("isPaid")} />
            </label>
          </div>

          <div style={{ marginTop: 24 }}>
            <h4>Line items</h4>
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                  <th style={{ minWidth: 180 }}>Product</th>
                  <th>Quantity</th>
                  <th>Unit price</th>
                  <th>Subtotal</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {fields.map((field, index) => {
                  const line = formItems?.[index];
                  const quantity = Number(line?.quantity ?? 0);
                  const unitPriceInput = typeof line?.unitPrice === "string" ? line.unitPrice.trim() : "";
                  const unitPrice =
                    unitPriceInput.length > 0 && !Number.isNaN(Number(unitPriceInput))
                      ? Number(unitPriceInput)
                      : null;
                  const subtotal =
                    unitPrice !== null && !Number.isNaN(quantity)
                      ? quantity * unitPrice
                      : null;
                  const productError = errors.items?.[index]?.productId?.message;
                  const quantityError = errors.items?.[index]?.quantity?.message;
                  const unitPriceError = errors.items?.[index]?.unitPrice?.message;
                  const selectedProduct = getProductForLine(index);
                  const displayOptions = getDisplayOptionsForProduct(selectedProduct);
                  const selectedDisplayUnitId =
                    line?.displayUnit && displayOptions.some((option) => option.id === line.displayUnit)
                      ? line.displayUnit
                      : displayOptions[0]?.id ?? "";
                  const quickPresets = displayOptions.filter((option) => !option.id.startsWith("base:"));
                  const compositeDescription = formatCompositeMix(selectedProduct);
                  const showQuickPresets = quickPresets.length > 0;
                  const productField = register(`items.${index}.productId`);
                  const quantityField = register(`items.${index}.quantity`);
                  const unitPriceField = register(`items.${index}.unitPrice`);
                  const displayUnitField = register(`items.${index}.displayUnit`);

                  return (
                    <tr key={field.id}>
                      <td>
                        <div style={{ display: "grid", gap: 6 }}>
                          <input
                            type="text"
                            value={productFilters[field.id] ?? ""}
                            onChange={(event) => {
                              setProductFilters((prev) => ({
                                ...prev,
                                [field.id]: event.target.value,
                              }));
                            }}
                            placeholder="Type to filter products…"
                            style={{ width: "100%" }}
                          />
                          <select
                            {...productField}
                            value={line?.productId ?? ""}
                            onChange={(event) => {
                              productField.onChange(event);
                            }}
                          >
                            <option value="">Select product</option>
                            {products
                              .filter((product) => {
                                const filter = (productFilters[field.id] ?? "").trim().toLowerCase();
                                if (!filter) return true;
                                return product.name.toLowerCase().includes(filter);
                              })
                              .slice(0, 50)
                              .map((product) => (
                              <option key={product.id} value={product.id}>
                                {product.name}
                              </option>
                              ))}
                          </select>
                        </div>
                        {productError && <span className="error-text">{productError}</span>}
                        {compositeDescription ? (
                          <p style={{ marginTop: 6, fontSize: 12, color: "var(--color-muted)" }}>
                            Mix details: {compositeDescription}
                          </p>
                        ) : null}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 8 }}>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            {...quantityField}
                            value={line?.quantity ?? ""}
                            onChange={(event) => {
                              quantityField.onChange(event);
                            }}
                          />
                          {displayOptions.length > 0 ? (
                            <select
                              {...displayUnitField}
                              value={selectedDisplayUnitId}
                              onChange={(event) => {
                                displayUnitField.onChange(event);
                                handleDisplayUnitChange(index, event.target.value);
                              }}
                            >
                              {displayOptions.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          ) : null}
                        </div>
                        {quantityError && <span className="error-text">{quantityError}</span>}
                        {showQuickPresets ? (
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              gap: 6,
                              marginTop: 6,
                              alignItems: "center",
                            }}
                          >
                            <small style={{ fontSize: 11, color: "var(--color-muted)" }}>
                              Quick presets:
                            </small>
                            {quickPresets.map((preset) => (
                              <button
                                key={`${field.id}-${preset.id}`}
                                type="button"
                                onClick={() => applyDisplayPreset(index, preset)}
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
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          {...unitPriceField}
                          value={line?.unitPrice ?? ""}
                          onChange={(event) => {
                            unitPriceField.onChange(event);
                          }}
                          placeholder="Price (optional)"
                        />
                        {unitPriceError && <span className="error-text">{unitPriceError}</span>}
                      </td>
                      <td>
                        {subtotal !== null ? (
                          `$${subtotal.toFixed(2)}`
                        ) : (
                          <span style={{ color: "var(--color-muted)" }}>Pending pricing</span>
                        )}
                      </td>
                      <td>
                        <div className="table-actions">
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => remove(index)}
                            disabled={fields.length === 1}
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            className="secondary-button"
            style={{ marginTop: 12 }}
            onClick={() => append({ ...emptyLine })}
          >
            Add line
          </button>
        </div>

        <div style={{ marginTop: 16, fontWeight: 600, display: "flex", gap: 8, alignItems: "center" }}>
          <span>
            Estimated total:{" "}
            {hasPendingLinePricing && calculatedTotal === 0
              ? "Pending pricing"
              : `$${calculatedTotal.toFixed(2)}`}
          </span>
          {hasPendingLinePricing ? (
            <span style={{ fontWeight: 400, color: "var(--color-muted)" }}>
              Pending line items are excluded until priced
            </span>
          ) : null}
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
          <button type="submit" className="primary-button" disabled={isSubmitting}>
            {isSubmitting
              ? editingReceiptId
                ? "Updating..."
                : "Saving..."
              : editingReceiptId
                ? "Update receipt"
                : "Save receipt"}
          </button>
          {editingReceiptId ? (
            <button
              type="button"
              className="secondary-button"
              onClick={cancelEditing}
              disabled={isSubmitting}
            >
              Cancel edit
            </button>
          ) : null}
        </div>
        {formError && <div className="error-text" style={{ marginTop: 8 }}>{formError}</div>}
        </form>
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
          <h3 style={{ marginTop: 0 }}>Recent receipts</h3>
          <span style={{ color: "var(--color-muted)" }}>
            {isFetchingReceipts && !isLoadingReceipts
              ? "Refreshing…"
              : `Page ${page} of ${totalPages}`}
          </span>
        </div>

        <div
          className="form-grid"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            rowGap: 12,
            marginBottom: 16,
          }}
        >
          <label>
            Type
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as "ALL" | "NORMAL" | "TVA")}
            >
              <option value="ALL">All types</option>
              <option value="NORMAL">Normal</option>
              <option value="TVA">T</option>
            </select>
          </label>
          <label>
            Status
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "ALL" | "UNPAID" | "PAID")}
            >
              <option value="ALL">All statuses</option>
              <option value="UNPAID">Unpaid</option>
              <option value="PAID">Paid</option>
            </select>
          </label>
          <label>
            Customer
            <select
              value={customerFilter}
              onChange={(event) => setCustomerFilter(event.target.value)}
            >
              <option value="">All customers</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Driver
            <select
              value={driverFilter}
              onChange={(event) => setDriverFilter(event.target.value)}
            >
              <option value="">All drivers</option>
              {drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Truck
            <select
              value={truckFilter}
              onChange={(event) => setTruckFilter(event.target.value)}
            >
              <option value="">All trucks</option>
              {trucks.map((truck) => (
                <option key={truck.id} value={truck.id}>
                  {truck.plateNo}
                </option>
              ))}
            </select>
          </label>
          <label>
            Product
            <select
              value={productFilter}
              onChange={(event) => setProductFilter(event.target.value)}
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
            Search
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Receipt #, customer, driver"
            />
          </label>
          <label>
            Sort by
            <select
              value={sortField}
              onChange={(event) =>
                setSortField(event.target.value as "date" | "receiptNo" | "total" | "amountPaid")
              }
            >
              <option value="date">Date</option>
              <option value="receiptNo">Receipt #</option>
              <option value="total">Total amount</option>
              <option value="amountPaid">Amount paid</option>
            </select>
          </label>
          <label>
            Order
            <select
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value as "asc" | "desc")}
            >
              <option value="desc">Highest / latest first</option>
              <option value="asc">Lowest / oldest first</option>
            </select>
          </label>
          <label>
            Date from
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>
          <label>
            Date to
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </label>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setTypeFilter("ALL");
                setStatusFilter("ALL");
                setCustomerFilter("");
                setDriverFilter("");
                setTruckFilter("");
                setProductFilter("");
                setSearchTerm("");
                setStartDate("");
                setEndDate("");
                 setSortField("date");
                 setSortOrder("desc");
                setPage(1);
              }}
            >
              Clear filters
            </button>
          </div>
        </div>

        {isLoadingReceipts ? (
          <p>Loading receipts…</p>
        ) : receiptsForDisplay.length === 0 ? (
          <p>{emptyStateMessage}</p>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Receipt #</th>
                  <th>Type</th>
                  <th>Customer</th>
                  <th>Items</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {receiptsForDisplay.map((receipt) => {
                  const needsPricing = receipt.items.some(
                    (item) => item.unitPrice === null || item.unitPrice === undefined,
                  );
                  const outstanding = needsPricing
                    ? null
                    : Math.max(0, receipt.total - receipt.amountPaid);
                  const explicitlyPaid = receipt.isPaid && !needsPricing;
                  const hasPartialPayment =
                    !explicitlyPaid && !needsPricing && receipt.amountPaid > 1e-6;
                  const statusLabel = needsPricing
                    ? "Awaiting pricing"
                    : explicitlyPaid
                    ? "Paid"
                    : hasPartialPayment
                    ? `Partial – $${outstanding!.toFixed(2)} due`
                    : "Pending";
                  const isDeleting = deleteMutation.isPending && deletingId === receipt.id;

                  const savedAt = new Date(receipt.createdAt);
                  const savedAtText = savedAt.toLocaleString();
                  const createdByLabel = receipt.createdByUser?.name ?? receipt.createdByUser?.email ?? null;

                  return (
                    <tr key={receipt.id}>
                      <td>
                        <div>{new Date(receipt.date).toLocaleDateString()}</div>
                        <div style={{ fontSize: 12, color: "var(--color-muted)" }}>
                          Saved {savedAtText}
                        </div>
                        {isAdmin && createdByLabel ? (
                          <div style={{ fontSize: 12, color: "var(--color-muted)" }}>
                            By {createdByLabel}
                          </div>
                        ) : null}
                      </td>
                      <td>{receipt.receiptNo || "—"}</td>
                      <td>{receipt.type === "TVA" ? "T" : "Normal"}</td>
                      <td>
                        {receipt.customer
                          ? receipt.customer.name
                          : receipt.walkInName ?? "Walk-in"}
                        {receipt.jobSite ? <div>{receipt.jobSite.name}</div> : null}
                      </td>
                      <td>{receipt.items.map((item) => formatLineItemDisplay(item)).join("; ")}</td>
                      <td>{needsPricing ? "Pending pricing" : `$${receipt.total.toFixed(2)}`}</td>
                      <td>
                        {statusLabel}
                        {!needsPricing && receipt.amountPaid > 0 ? (
                          <div style={{ fontSize: 12, color: "#555" }}>
                            Paid ${receipt.amountPaid.toFixed(2)} of ${receipt.total.toFixed(2)}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <div className="table-actions">
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => handleOpenPrint(receipt)}
                          >
                            Print
                          </button>
                          {isAdmin ? (
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => handleOverrideReceiptNumber(receipt)}
                              disabled={overrideNumberMutation.isPending}
                            >
                              Edit number
                            </button>
                          ) : null}
                          {canEditReceipts ? (
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => handleStartEditing(receipt)}
                            >
                              Edit
                            </button>
                          ) : null}
                          {canDeleteReceipts ? (
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => handleDelete(receipt)}
                              disabled={isDeleting}
                            >
                              {isDeleting ? "Deleting..." : "Delete"}
                            </button>
                          ) : null}
                          {!needsPricing && !explicitlyPaid ? (
                            <button
                              type="button"
                              className="primary-button"
                              onClick={() => handleMarkPaid(receipt)}
                              disabled={markPaidMutation.isPending}
                            >
                              {markPaidMutation.isPending ? "Marking..." : "Mark paid"}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 12,
                marginTop: 16,
              }}
            >
              <span style={{ color: "var(--color-muted)" }}>
                {totalItems > 0
                  ? `Showing ${displayRangeStart.toLocaleString()}–${displayRangeEnd.toLocaleString()} of ${totalItems.toLocaleString()} receipts`
                  : "Nothing to display"}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
                  disabled={!canGoPrev || isFetchingReceipts}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setPage((prev) => prev + 1)}
                  disabled={!canGoNext || isFetchingReceipts}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

export default ReceiptsPage;
