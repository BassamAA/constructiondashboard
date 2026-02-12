import { useMemo, useState } from "react";
import {
  useMutation,
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import {
  fetchProductsPage,
  createProduct,
  updateProduct,
  deleteProduct,
  type CreateProductPayload,
  updateProductMaterials,
} from "../api/products";
import {
  AGGREGATE_DISPLAY_PRESETS,
  CEMENT_DISPLAY_PRESETS,
  DEBRIS_DISPLAY_PRESETS,
  describeDisplayOption,
  isCoreProduct,
  makeBaseDisplayOption,
} from "../constants/materials";
import type { Product } from "../types";

type ProductPageResult = Awaited<ReturnType<typeof fetchProductsPage>>;

const EMPTY_FORM = {
  name: "",
  unit: "",
  unitPrice: "",
  description: "",
  isManufactured: false,
  hasAggregatePresets: false,
  isComposite: false,
  isFuel: false,
  pieceworkRate: "",
  helperPieceworkRate: "",
  tehmilFee: "",
  productionPowderQuantity: "",
  productionCementQuantity: "",
  compositeComponents: [] as Array<{ productId: string; quantity: string }>,
};

type LegacyDraft = {
  name: string;
  unit: string;
  unitPrice: string;
  description: string;
  pieceworkRate: string;
  helperPieceworkRate: string;
  tehmilFee: string;
  isManufactured: boolean;
};

export function ProductsPage() {
  const queryClient = useQueryClient();
  const productsQuery = useInfiniteQuery<
    ProductPageResult,
    Error,
    InfiniteData<ProductPageResult, number | undefined>,
    readonly ["products", "paginated"],
    number | undefined
  >({
    queryKey: ["products", "paginated"] as const,
    queryFn: ({ pageParam }) => fetchProductsPage({ cursor: pageParam, limit: 50 }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined,
  });

  const allProducts = useMemo<Product[]>(
    () => productsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [productsQuery.data],
  );

  const isInitialLoading = productsQuery.status === "pending";
  const isFetchingNextPage = productsQuery.isFetchingNextPage;
  const hasMoreProducts = Boolean(productsQuery.hasNextPage);

  const [formState, setFormState] = useState({ ...EMPTY_FORM });
  const [formError, setFormError] = useState<string | null>(null);
  const [editingProductId, setEditingProductId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [materialsError, setMaterialsError] = useState<string | null>(null);
const [otherDrafts, setOtherDrafts] = useState<Record<number, LegacyDraft>>({});
const [otherErrors, setOtherErrors] = useState<Record<number, string | null>>({});
  const [inlineSavingId, setInlineSavingId] = useState<number | null>(null);

  const createMutation = useMutation({
    mutationFn: (payload: CreateProductPayload) => createProduct(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products", "paginated"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setFormState({ ...EMPTY_FORM });
      setFormError(null);
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.error ?? err?.message ?? "Failed to add product");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: CreateProductPayload }) =>
      updateProduct(id, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["products", "paginated"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      if (editingProductId !== null && variables?.id === editingProductId) {
        setEditingProductId(null);
        setFormState({ ...EMPTY_FORM });
      }
      setFormError(null);
      if (variables) {
        setOtherDrafts((prev) => {
          if (!(variables.id in prev)) return prev;
          const next = { ...prev };
          delete next[variables.id];
          return next;
        });
        setOtherErrors((prev) => {
          if (!(variables.id in prev)) return prev;
          const next = { ...prev };
          delete next[variables.id];
          return next;
        });
      }
    },
    onError: (err: any, variables) => {
      const message = err?.response?.data?.error ?? err?.message ?? "Failed to update product";
      if (variables && otherDrafts[variables.id]) {
        setOtherErrors((prev) => ({ ...prev, [variables.id]: message }));
      } else {
        setFormError(message);
      }
    },
    onSettled: () => {
      setInlineSavingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteProduct(id),
    onMutate: (id: number) => {
      setDeletingId(id);
      setFormError(null);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products", "paginated"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      if (editingProductId !== null) {
        setEditingProductId(null);
        setFormState({ ...EMPTY_FORM });
      }
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.error ?? err?.message ?? "Failed to delete product");
    },
    onSettled: () => {
      setDeletingId(null);
    },
  });

  const materialsMutation = useMutation({
    mutationFn: ({
      id,
      powder,
      cement,
      workerRate,
      helperRate,
    }: {
      id: number;
      powder: number;
      cement: number;
      workerRate?: number | null;
      helperRate?: number | null;
    }) =>
      updateProductMaterials(id, {
        productionPowderQuantity: powder,
        productionCementQuantity: cement,
        ...(workerRate !== undefined ? { pieceworkRate: workerRate } : {}),
        ...(helperRate !== undefined ? { helperPieceworkRate: helperRate } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products", "paginated"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setMaterialsError(null);
    },
    onError: (err: any) => {
      setMaterialsError(err?.response?.data?.error ?? err?.message ?? "Failed to update materials");
    },
  });

  const { catalogProducts, otherProducts } = useMemo(() => {
    const catalog = allProducts.filter((product) => isCoreProduct(product.name));
    const other = allProducts.filter(
      (product) => !isCoreProduct(product.name) && !product.isManufactured,
    );
    return {
      catalogProducts: catalog.sort((a, b) => a.name.localeCompare(b.name)),
      otherProducts: other.sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [allProducts]);

  const manufacturedProducts = useMemo(() => {
    return allProducts
      .filter((product) => product.isManufactured)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allProducts]);

  const aggregateBase = makeBaseDisplayOption("m³");
  const cementBase = makeBaseDisplayOption("bag");
  const debrisBase = makeBaseDisplayOption("m³");
  const powderProduct = useMemo(
    () => allProducts.find((product) => product.name.toLowerCase() === "powder") ?? null,
    [allProducts],
  );
  const cementProduct = useMemo(
    () => allProducts.find((product) => product.name.toLowerCase() === "cement") ?? null,
    [allProducts],
  );

  const isEditing = editingProductId !== null;
  const editingProduct = isEditing
    ? allProducts.find((product) => product.id === editingProductId) ?? null
    : null;
  const isSaving = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  const submitLabel = isEditing
    ? isSaving
      ? "Saving…"
      : "Save changes"
    : isSaving
    ? "Adding…"
    : "Add product";
  const resetLabel = isEditing ? "Cancel edit" : "Reset";

  const handleCancelEdit = () => {
    setEditingProductId(null);
    setFormState({ ...EMPTY_FORM });
    setFormError(null);
    createMutation.reset();
    updateMutation.reset();
  };

  const handleDeleteProduct = (product: Product) => {
    if (!window.confirm(`Delete ${product.name}? This cannot be undone.`)) {
      return;
    }
    deleteMutation.mutate(product.id);
  };

  const handleStartEdit = (product: Product) => {
    setEditingProductId(product.id);
    setFormState({
      name: product.name,
      unit: product.unit,
      unitPrice:
        product.unitPrice !== undefined && product.unitPrice !== null
          ? product.unitPrice.toString()
          : "",
      description: product.description ?? "",
      isManufactured: product.isManufactured,
      hasAggregatePresets: product.hasAggregatePresets,
      isComposite: product.isComposite,
      isFuel: product.isFuel,
      pieceworkRate:
        product.pieceworkRate !== undefined && product.pieceworkRate !== null
          ? product.pieceworkRate.toString()
          : "",
      helperPieceworkRate:
        product.helperPieceworkRate !== undefined && product.helperPieceworkRate !== null
          ? product.helperPieceworkRate.toString()
          : "",
      tehmilFee:
        product.tehmilFee !== undefined && product.tehmilFee !== null ? product.tehmilFee.toString() : "",
      productionPowderQuantity: product.productionPowderQuantity
        ? product.productionPowderQuantity.toString()
        : "",
      productionCementQuantity: product.productionCementQuantity
        ? product.productionCementQuantity.toString()
        : "",
      compositeComponents: product.isComposite
        ? (product.compositeComponents ?? []).map((component) => ({
            productId: component.componentProductId.toString(),
            quantity: component.quantity.toString(),
          }))
        : [],
    });
    setFormError(null);
    createMutation.reset();
    updateMutation.reset();
  };

  const startOtherInlineEdit = (product: Product) => {
    setOtherDrafts((prev) => ({
      ...prev,
      [product.id]: {
        name: product.name,
        unit: product.unit,
        unitPrice: product.unitPrice !== undefined && product.unitPrice !== null ? product.unitPrice.toString() : "",
        description: product.description ?? "",
        pieceworkRate:
          product.pieceworkRate !== undefined && product.pieceworkRate !== null
            ? product.pieceworkRate.toString()
            : "",
        helperPieceworkRate:
          product.helperPieceworkRate !== undefined && product.helperPieceworkRate !== null
            ? product.helperPieceworkRate.toString()
            : "",
        tehmilFee: product.tehmilFee !== undefined && product.tehmilFee !== null ? product.tehmilFee.toString() : "",
        isManufactured: product.isManufactured,
      },
    }));
    setOtherErrors((prev) => ({ ...prev, [product.id]: null }));
  };

  const cancelOtherInlineEdit = (id: number) => {
    setOtherDrafts((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setOtherErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const updateOtherDraftField = (id: number, field: keyof LegacyDraft, value: string) => {
    setOtherDrafts((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        [field]: value,
      },
    }));
  };

  const addCompositeComponentRow = () => {
    setFormState((prev) => ({
      ...prev,
      compositeComponents: [
        ...prev.compositeComponents,
        {
          productId: "",
          quantity: "",
        },
      ],
    }));
  };

  const updateCompositeComponentField = (
    index: number,
    field: "productId" | "quantity",
    value: string,
  ) => {
    setFormState((prev) => {
      const next = [...prev.compositeComponents];
      next[index] = {
        ...next[index],
        [field]: value,
      };
      return {
        ...prev,
        compositeComponents: next,
      };
    });
  };

  const removeCompositeComponentRow = (index: number) => {
    setFormState((prev) => ({
      ...prev,
      compositeComponents: prev.compositeComponents.filter((_, idx) => idx !== index),
    }));
  };

  const saveOtherDraft = (product: Product) => {
    const draft = otherDrafts[product.id];
    if (!draft) return;

    const fail = (message: string) => {
      setOtherErrors((prev) => ({ ...prev, [product.id]: message }));
    };

    const name = draft.name.trim();
    if (!name) {
      fail("Product name is required");
      return;
    }
    const unit = draft.unit.trim();
    if (!unit) {
      fail("Unit is required");
      return;
    }

    const payload: CreateProductPayload = {
      name,
      unit,
      description: draft.description.trim().length > 0 ? draft.description.trim() : undefined,
      isManufactured: product.isManufactured,
      hasAggregatePresets: product.hasAggregatePresets,
      isComposite: product.isComposite,
      isFuel: product.isFuel,
    };

    if (draft.unitPrice.trim().length > 0) {
      const parsed = Number(draft.unitPrice.trim());
      if (Number.isNaN(parsed) || parsed < 0) {
        fail("Unit price must be a valid number");
        return;
      }
      payload.unitPrice = parsed;
    } else {
      payload.unitPrice = null;
    }

    if (draft.pieceworkRate.trim().length > 0) {
      const parsed = Number(draft.pieceworkRate.trim());
      if (Number.isNaN(parsed) || parsed < 0) {
        fail("Piecework rate must be a valid number");
        return;
      }
      payload.pieceworkRate = parsed;
    } else if (product.isManufactured) {
      payload.pieceworkRate = null;
    }

    if (draft.helperPieceworkRate.trim().length > 0) {
      const parsed = Number(draft.helperPieceworkRate.trim());
      if (Number.isNaN(parsed) || parsed < 0) {
        fail("Helper rate must be a valid number");
        return;
      }
      payload.helperPieceworkRate = parsed;
    } else if (product.isManufactured) {
      payload.helperPieceworkRate = null;
    }

    if (draft.tehmilFee.trim().length > 0) {
      const parsed = Number(draft.tehmilFee.trim());
      if (Number.isNaN(parsed) || parsed < 0) {
        fail("Tehmil/Tenzil fee must be a non-negative number");
        return;
      }
      payload.tehmilFee = parsed;
    } else {
      payload.tehmilFee = 0;
    }

    if (draft.tehmilFee.trim().length > 0) {
      const parsed = Number(draft.tehmilFee.trim());
      if (Number.isNaN(parsed) || parsed < 0) {
        fail("Tehmil/Tenzil fee must be a non-negative number");
        return;
      }
      payload.tehmilFee = parsed;
    } else {
      payload.tehmilFee = 0;
    }

    if (product.isComposite) {
      payload.compositeComponents =
        product.compositeComponents?.map((component) => ({
          productId: component.componentProductId,
          quantity: component.quantity,
        })) ?? [];
    } else {
      payload.compositeComponents = [];
    }

    setInlineSavingId(product.id);
    updateMutation.mutate({ id: product.id, payload });
  };

  const handleAdjustMaterials = (product: Product) => {
    const batchInput = window.prompt(
      `How many units are you configuring for ${product.name}?`,
      "1",
    );
    if (batchInput === null) return;
    const batchSize = Number(batchInput);
    if (Number.isNaN(batchSize) || batchSize <= 0) {
      window.alert("Enter a positive batch size");
      return;
    }

    const defaultPowderBatch =
      product.productionPowderQuantity && product.productionPowderQuantity > 0
        ? (product.productionPowderQuantity * batchSize).toString()
        : "";
    const powderInput = window.prompt(
      `Total powder used for ${batchSize} units`,
      defaultPowderBatch,
    );
    if (powderInput === null) return;
    const powderBatchValue = Number(powderInput);
    if (Number.isNaN(powderBatchValue) || powderBatchValue <= 0) {
      window.alert("Enter a positive powder amount");
      return;
    }

    const defaultCementBatch =
      product.productionCementQuantity && product.productionCementQuantity > 0
        ? (product.productionCementQuantity * batchSize).toString()
        : "";
    const cementInput = window.prompt(
      `Total cement used for ${batchSize} units`,
      defaultCementBatch,
    );
    if (cementInput === null) return;
    const cementBatchValue = Number(cementInput);
    if (Number.isNaN(cementBatchValue) || cementBatchValue <= 0) {
      window.alert("Enter a positive cement amount");
      return;
    }

    const powderPerUnit = powderBatchValue / batchSize;
    const cementPerUnit = cementBatchValue / batchSize;

    const workerInput = window.prompt(
      `Worker rate (per unit) for ${product.name}`,
      product.pieceworkRate !== null && product.pieceworkRate !== undefined
        ? product.pieceworkRate.toString()
        : "",
    );
    if (workerInput === null) return;

    const helperInput = window.prompt(
      `Helper rate (per unit) for ${product.name}`,
      product.helperPieceworkRate !== null && product.helperPieceworkRate !== undefined
        ? product.helperPieceworkRate.toString()
        : "",
    );
    if (helperInput === null) return;

    let workerRate: number | null | undefined;
    const workerTrim = workerInput.trim();
    if (workerTrim.length > 0) {
      const parsed = Number(workerTrim);
      if (Number.isNaN(parsed) || parsed <= 0) {
        window.alert("Worker rate must be greater than zero");
        return;
      }
      workerRate = parsed;
    } else {
      workerRate = undefined;
    }

    let helperRate: number | null | undefined;
    const helperTrim = helperInput.trim();
    if (helperTrim.length > 0) {
      const parsed = Number(helperTrim);
      if (Number.isNaN(parsed) || parsed < 0) {
        window.alert("Helper rate must be zero or greater");
        return;
      }
      helperRate = parsed;
    } else {
      helperRate = undefined;
    }

    materialsMutation.mutate({
      id: product.id,
      powder: powderPerUnit,
      cement: cementPerUnit,
      workerRate,
      helperRate,
    });
  };

  const handleBatchHelper = () => {
    const batchInput = window.prompt("How many units are in your recipe?", "50");
    if (batchInput === null) return;
    const batchSize = Number(batchInput);
    if (Number.isNaN(batchSize) || batchSize <= 0) {
      window.alert("Enter a positive batch size");
      return;
    }

    const currentPowderPerUnit = Number(formState.productionPowderQuantity.trim() || "0");
    const powderDefault =
      currentPowderPerUnit > 0 ? (currentPowderPerUnit * batchSize).toString() : "";
    const powderPerBatchInput = window.prompt(
      `Total powder for ${batchSize} units`,
      powderDefault,
    );
    if (powderPerBatchInput === null) return;
    const powderBatchValue = Number(powderPerBatchInput);
    if (Number.isNaN(powderBatchValue) || powderBatchValue <= 0) {
      window.alert("Enter a positive powder amount");
      return;
    }

    const currentCementPerUnit = Number(formState.productionCementQuantity.trim() || "0");
    const cementDefault =
      currentCementPerUnit > 0 ? (currentCementPerUnit * batchSize).toString() : "";
    const cementPerBatchInput = window.prompt(
      `Total cement for ${batchSize} units`,
      cementDefault,
    );
    if (cementPerBatchInput === null) return;
    const cementBatchValue = Number(cementPerBatchInput);
    if (Number.isNaN(cementBatchValue) || cementBatchValue <= 0) {
      window.alert("Enter a positive cement amount");
      return;
    }

    const powderPerUnit = powderBatchValue / batchSize;
    const cementPerUnit = cementBatchValue / batchSize;
    setFormState((prev) => ({
      ...prev,
      productionPowderQuantity: powderPerUnit.toString(),
      productionCementQuantity: cementPerUnit.toString(),
    }));
  };

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const name = formState.name.trim();
    const unit = formState.unit.trim();
    const description = formState.description.trim();
    const unitPriceRaw = formState.unitPrice.trim();

    if (!name) {
      setFormError("Product name is required");
      return;
    }
    if (!unit) {
      setFormError("Unit is required");
      return;
    }

    let parsedUnitPrice: number | null = null;
    if (unitPriceRaw.length > 0) {
      parsedUnitPrice = Number(unitPriceRaw);
      if (Number.isNaN(parsedUnitPrice)) {
        setFormError("Unit price must be a number");
        return;
      }
    }

    const tehmilFeeRaw = formState.tehmilFee.trim();
    let parsedTehmilFee: number = 0;
    if (tehmilFeeRaw.length > 0) {
      const parsed = Number(tehmilFeeRaw);
      if (Number.isNaN(parsed) || parsed < 0) {
        setFormError("Tehmil/Tenzil fee must be a non-negative number");
        return;
      }
      parsedTehmilFee = parsed;
    }

    const payload: CreateProductPayload = {
      name,
      unit,
      description: description.length > 0 ? description : undefined,
      isManufactured: formState.isManufactured,
      isFuel: formState.isFuel,
      tehmilFee: parsedTehmilFee,
    };
    if (parsedUnitPrice !== null) {
      payload.unitPrice = parsedUnitPrice;
    }

    if (formState.isManufactured && formState.pieceworkRate.trim().length > 0) {
      const parsedRate = Number(formState.pieceworkRate.trim());
      if (Number.isNaN(parsedRate) || parsedRate <= 0) {
        setFormError("Piecework rate must be a positive number");
        return;
      }
      payload.pieceworkRate = parsedRate;
    } else if (!formState.isManufactured || formState.pieceworkRate.trim().length === 0) {
      payload.pieceworkRate = null;
    }

    if (formState.isManufactured && formState.helperPieceworkRate.trim().length > 0) {
      const parsedHelperRate = Number(formState.helperPieceworkRate.trim());
      if (Number.isNaN(parsedHelperRate) || parsedHelperRate <= 0) {
        setFormError("Helper rate must be a positive number");
        return;
      }
      payload.helperPieceworkRate = parsedHelperRate;
    } else if (!formState.isManufactured || formState.helperPieceworkRate.trim().length === 0) {
      payload.helperPieceworkRate = null;
    }

    if (formState.isManufactured) {
      if (!powderProduct || !cementProduct) {
        setFormError("Powder and Cement products must exist before configuring manufactured items.");
        return;
      }
      const powderQtyRaw = formState.productionPowderQuantity.trim();
      const cementQtyRaw = formState.productionCementQuantity.trim();

      if (powderQtyRaw.length === 0) {
        setFormError("Enter the powder quantity per unit");
        return;
      }
      const powderQuantity = Number(powderQtyRaw);
      if (Number.isNaN(powderQuantity) || powderQuantity <= 0) {
        setFormError("Powder quantity must be greater than zero");
        return;
      }
      payload.productionPowderQuantity = powderQuantity;

      if (cementQtyRaw.length === 0) {
        setFormError("Enter the cement quantity per unit");
        return;
      }
      const cementQuantity = Number(cementQtyRaw);
      if (Number.isNaN(cementQuantity) || cementQuantity <= 0) {
        setFormError("Cement quantity must be greater than zero");
        return;
      }
      payload.productionCementQuantity = cementQuantity;
    } else {
      payload.productionPowderQuantity = null;
      payload.productionCementQuantity = null;
    }

    payload.hasAggregatePresets = formState.hasAggregatePresets;

    if (formState.isComposite) {
      if (formState.isManufactured) {
        setFormError("Composite mixes cannot also be marked as manufactured");
        return;
      }
      if (formState.compositeComponents.length === 0) {
        setFormError("Add at least one mix component");
        return;
      }
      const componentPayload: { productId: number; quantity: number }[] = [];
      const usedProducts = new Set<number>();
      for (const component of formState.compositeComponents) {
        if (!component.productId || component.productId.trim().length === 0) {
          setFormError("Select a product for each mix component");
          return;
        }
        const parsedProductId = Number(component.productId);
        if (Number.isNaN(parsedProductId) || parsedProductId <= 0) {
          setFormError("Each mix component must reference a valid product");
          return;
        }
        if (editingProductId && parsedProductId === editingProductId) {
          setFormError("A mix cannot reference itself as a component");
          return;
        }
        if (usedProducts.has(parsedProductId)) {
          setFormError("Each mix component can only be listed once");
          return;
        }
        const parsedQuantity = Number(component.quantity);
        if (Number.isNaN(parsedQuantity) || parsedQuantity <= 0) {
          setFormError("Component quantities must be positive numbers");
          return;
        }
        usedProducts.add(parsedProductId);
        componentPayload.push({
          productId: parsedProductId,
          quantity: parsedQuantity,
        });
      }
      payload.isComposite = true;
      payload.compositeComponents = componentPayload;
    } else {
      payload.isComposite = false;
      payload.compositeComponents = [];
    }

    if (editingProductId) {
      updateMutation.mutate({ id: editingProductId, payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  return (
    <section>
      <header>
        <h2>Product Catalog</h2>
        <p>
          Powder, sand, and gravel are standardised. Load shortcuts ensure every truck, pickup, and
          Atego/Hino entry matches the exact cubic meter equivalent.
        </p>
      </header>

      <div className="section-card">
        <h3 style={{ marginTop: 0 }}>{isEditing ? "Edit custom product" : "Add custom product"}</h3>
        <p style={{ marginTop: -8 }}>
          Use {isEditing ? "this form to update" : "this form for new"} materials or manufactured items.
          Core items are managed automatically.
        </p>
        {isEditing && editingProduct ? (
          <p style={{ marginTop: -4, color: "var(--color-muted)" }}>
            Editing <strong>{editingProduct.name}</strong>
          </p>
        ) : null}
        <form onSubmit={handleSubmit} className="form-grid two-columns">
          <label>
            Product name *
            <input
              type="text"
              value={formState.name}
              onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="e.g. Crushed Stone"
              required
              disabled={isSaving}
            />
          </label>
          <label>
            Unit *
            <input
              type="text"
              value={formState.unit}
              onChange={(event) => setFormState((prev) => ({ ...prev, unit: event.target.value }))}
              placeholder="e.g. unit, m³, bag"
              required
              disabled={isSaving}
            />
          </label>
          <label>
            Unit price
            <input
              type="number"
              step="any"
              min="0"
              value={formState.unitPrice}
              onChange={(event) => setFormState((prev) => ({ ...prev, unitPrice: event.target.value }))}
              placeholder="Optional default price"
              disabled={isSaving}
            />
          </label>
          <label>
            Tehmil/Tenzil fee per unit
            <input
              type="number"
              step="any"
              min="0"
              value={formState.tehmilFee}
              onChange={(event) => setFormState((prev) => ({ ...prev, tehmilFee: event.target.value }))}
              placeholder="0.00"
              disabled={isSaving}
            />
          </label>
          <label>
            Description
            <input
              type="text"
              value={formState.description}
              onChange={(event) => setFormState((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="Optional details"
              disabled={isSaving}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={formState.isManufactured}
              onChange={(event) => {
                const checked = event.target.checked;
                setFormState((prev) => ({
                  ...prev,
                  isManufactured: checked,
                  isComposite: checked ? false : prev.isComposite,
                  productionPowderQuantity: checked ? prev.productionPowderQuantity : "",
                  productionCementQuantity: checked ? prev.productionCementQuantity : "",
                  pieceworkRate: checked ? prev.pieceworkRate : "",
                  helperPieceworkRate: checked ? prev.helperPieceworkRate : "",
                }));
              }}
              disabled={isSaving}
            />
            Manufactured product (tracked via production)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={formState.isFuel}
              onChange={(event) => setFormState((prev) => ({ ...prev, isFuel: event.target.checked }))}
              disabled={isSaving}
            />
            Fuel product (appears in diesel logs)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={formState.hasAggregatePresets}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  hasAggregatePresets: event.target.checked,
                }))
              }
              disabled={isSaving}
            />
            Offer aggregate shortcuts (bags, pickups, trucks)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={formState.isComposite}
              onChange={(event) => {
                const checked = event.target.checked;
                setFormState((prev) => ({
                  ...prev,
                  isComposite: checked,
                  isManufactured: checked ? false : prev.isManufactured,
                  compositeComponents: checked
                    ? prev.compositeComponents.length > 0
                      ? prev.compositeComponents
                      : [{ productId: "", quantity: "" }]
                    : [],
                }));
              }}
              disabled={isSaving}
            />
            Composite mix (deducts selected materials when sold)
          </label>
          {formState.isComposite ? (
            <div
              style={{
                gridColumn: "1 / -1",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                padding: 12,
                background: "#f8fafc",
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div>
                <strong>Mix components</strong>
                <p style={{ marginTop: 4, fontSize: 13, color: "var(--color-muted)" }}>
                  Choose the products and quantities deducted per 1 {formState.unit || "unit"} sold.
                </p>
              </div>
              {formState.compositeComponents.length === 0 ? (
                <p style={{ margin: 0, color: "var(--color-muted)" }}>
                  Add at least one component to define this mix.
                </p>
              ) : (
                formState.compositeComponents.map((component, index) => (
                  <div
                    key={`${index}-${component.productId || "new"}`}
                    style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 8, alignItems: "center" }}
                  >
                    <select
                      value={component.productId}
                      onChange={(event) =>
                        updateCompositeComponentField(index, "productId", event.target.value)
                      }
                      disabled={isSaving}
                    >
                      <option value="">Select product</option>
                      {allProducts
                        .filter(
                          (product) =>
                            !product.isComposite &&
                            (editingProductId ? product.id !== editingProductId : true),
                        )
                        .map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name}
                          </option>
                        ))}
                    </select>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={component.quantity}
                      onChange={(event) =>
                        updateCompositeComponentField(index, "quantity", event.target.value)
                      }
                      placeholder="Qty per unit"
                      disabled={isSaving}
                    />
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => removeCompositeComponentRow(index)}
                      disabled={isSaving}
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
              <div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={addCompositeComponentRow}
                  disabled={isSaving}
                >
                  Add component
                </button>
              </div>
            </div>
          ) : null}
          {formState.isManufactured ? (
            <div style={{ gridColumn: "1 / -1", border: "1px solid var(--color-border)", borderRadius: 8, padding: 12, background: "#f8fafc" }}>
              <strong>Production components</strong>
              <p style={{ marginTop: 4, fontSize: 13, color: "var(--color-muted)" }}>
                Powder and cement components are linked automatically. Enter how much of each is consumed to
                produce a single unit.
              </p>
              <button
                type="button"
                className="ghost-button"
                style={{ alignSelf: "flex-start", marginTop: 8 }}
                onClick={handleBatchHelper}
                disabled={isSaving}
              >
                Batch helper
              </button>
              {!powderProduct || !cementProduct ? (
                <p className="error-text" style={{ marginTop: 4 }}>
                  Powder or Cement core products are missing from the catalog. Add them before logging production usage.
                </p>
              ) : null}
              <div className="form-grid two-columns" style={{ marginTop: 12, rowGap: 16 }}>
                <label>
                  Piecework rate (per unit)
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={formState.pieceworkRate}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, pieceworkRate: event.target.value }))
                    }
                    placeholder="e.g. 0.75"
                    disabled={isSaving}
                  />
                </label>
                <label>
                  Helper rate (per unit)
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={formState.helperPieceworkRate}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, helperPieceworkRate: event.target.value }))
                    }
                    placeholder="e.g. 0.25"
                    disabled={isSaving}
                  />
                </label>
                <label>
                  Powder quantity per unit
                  <small style={{ display: "block", color: "var(--color-muted)" }}>
                    Uses {powderProduct?.unit ?? "base unit"} of Powder
                  </small>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={formState.productionPowderQuantity}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, productionPowderQuantity: event.target.value }))
                    }
                    placeholder="0.00"
                    disabled={isSaving || !powderProduct}
                  />
                </label>
                <label>
                  Cement quantity per unit
                  <small style={{ display: "block", color: "var(--color-muted)" }}>
                    Uses {cementProduct?.unit ?? "base unit"} of Cement
                  </small>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={formState.productionCementQuantity}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, productionCementQuantity: event.target.value }))
                    }
                    placeholder="0.00"
                    disabled={isSaving || !cementProduct}
                  />
                </label>
              </div>
            </div>
          ) : null}
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 12 }}>
            <button type="submit" className="primary-button" disabled={isSaving}>
              {submitLabel}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={handleCancelEdit}
              disabled={isSaving}
            >
              {resetLabel}
            </button>
          </div>
          {formError ? (
            <div className="error-text" style={{ gridColumn: "1 / -1" }}>
              {formError}
            </div>
          ) : null}
        </form>
      </div>

      <div className="section-card">
        <h3 style={{ marginTop: 0 }}>Core materials</h3>
        <p style={{ marginTop: -8 }}>
          These three products are fixed for every site. All receipts and inventory entries should
          reference them.
        </p>
        {isInitialLoading ? (
          <p>Loading products…</p>
        ) : catalogProducts.length === 0 ? (
          <p className="error-text">
            Missing catalog entries. Restart the API to regenerate the fixed product list.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Unit</th>
                <th>Description</th>
                <th>Current stock</th>
              </tr>
            </thead>
            <tbody>
              {catalogProducts.map((product) => (
                <tr key={product.id}>
                  <td>{product.name}</td>
                  <td>{product.unit}</td>
                  <td>{product.description ?? "—"}</td>
                  <td>
                    {product.stockQty.toLocaleString(undefined, { maximumFractionDigits: 2 })} {product.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {manufacturedProducts.length > 0 ? (
        <div className="section-card">
          <h3 style={{ marginTop: 0 }}>Manufactured products</h3>
          <p style={{ marginTop: -8 }}>
            Adjust how much powder and cement each item consumes per produced unit.
          </p>
          {materialsError ? <p className="error-text">{materialsError}</p> : null}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Powder / unit</th>
                  <th>Cement / unit</th>
                  <th>Worker rate</th>
                  <th>Helper rate</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {manufacturedProducts.map((product) => (
                  <tr key={product.id}>
                    <td>{product.name}</td>
                    <td>
                      {product.productionPowderQuantity !== null && product.productionPowderQuantity !== undefined
                        ? product.productionPowderQuantity.toLocaleString()
                        : "—"}
                    </td>
                    <td>
                      {product.productionCementQuantity !== null && product.productionCementQuantity !== undefined
                        ? product.productionCementQuantity.toLocaleString()
                        : "—"}
                    </td>
                    <td>
                      {product.pieceworkRate !== null && product.pieceworkRate !== undefined
                        ? `$${product.pieceworkRate.toFixed(2)}`
                        : "—"}
                    </td>
                    <td>
                      {product.helperPieceworkRate !== null && product.helperPieceworkRate !== undefined
                        ? `$${product.helperPieceworkRate.toFixed(2)}`
                        : "—"}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="secondary-button"
                        style={{ padding: "6px 12px" }}
                        onClick={() => handleAdjustMaterials(product)}
                        disabled={materialsMutation.isPending}
                      >
                        Adjust materials
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
        <h3 style={{ marginTop: 0 }}>Load conversions</h3>
        <p style={{ marginTop: -8 }}>
          Use these presets in receipts and inventory to translate every vehicle load back to cubic
          meters automatically.
        </p>
        <h4 style={{ marginTop: 16 }}>Aggregates (powder, sand, gravel)</h4>
        <table>
          <thead>
            <tr>
              <th>Shortcut</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {[aggregateBase, ...AGGREGATE_DISPLAY_PRESETS].map((preset) => (
              <tr key={preset.id}>
                <td>{preset.label}</td>
                <td>{describeDisplayOption(preset)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h4 style={{ marginTop: 24 }}>Debris</h4>
        <p style={{ marginTop: -8 }}>
          Debris is tracked strictly in cubic meters to match stock movements.
        </p>
        <table>
          <thead>
            <tr>
              <th>Shortcut</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {[debrisBase, ...DEBRIS_DISPLAY_PRESETS].map((preset) => (
              <tr key={preset.id}>
                <td>{preset.label}</td>
                <td>{describeDisplayOption(preset)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h4 style={{ marginTop: 24 }}>Cement</h4>
        <p style={{ marginTop: -8 }}>
          Cement stock is tracked in tons. Use this shortcut to convert bag counts instantly.
        </p>
        <table>
          <thead>
            <tr>
              <th>Shortcut</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {[cementBase, ...CEMENT_DISPLAY_PRESETS].map((preset) => (
              <tr key={preset.id}>
                <td>{preset.label}</td>
                <td>{describeDisplayOption(preset)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {otherProducts.length > 0 ? (
        <div className="section-card">
          <h3 style={{ marginTop: 0 }}>Other products</h3>
          <p style={{ marginTop: -8 }}>
            Manage non-core items such as Diesel, Steel, or any custom products alongside the rest of your
            catalog.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Unit</th>
                  <th>Description</th>
                  <th>Piece rate</th>
                  <th>Helper rate</th>
                  <th>Tehmil/Tenzil fee</th>
                  <th style={{ width: 160 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {otherProducts.map((product) => {
                  const inlineDraft = otherDrafts[product.id];
                  const inlineError = otherErrors[product.id];
                  const isDeleting = deletingId === product.id && deleteMutation.isPending;
                  const isInlineSaving = inlineSavingId === product.id && updateMutation.isPending;
                  return (
                    <tr key={product.id}>
                      <td>
                        {inlineDraft ? (
                          <input
                            type="text"
                            value={inlineDraft.name}
                            onChange={(event) =>
                              updateOtherDraftField(product.id, "name", event.target.value)
                            }
                            disabled={isInlineSaving}
                          />
                        ) : (
                          product.name
                        )}
                      </td>
                      <td>
                        {inlineDraft ? (
                          <input
                            type="text"
                            value={inlineDraft.unit}
                            onChange={(event) =>
                              updateOtherDraftField(product.id, "unit", event.target.value)
                            }
                            disabled={isInlineSaving}
                          />
                        ) : (
                          product.unit
                        )}
                      </td>
                      <td>
                        {inlineDraft ? (
                          <input
                            type="text"
                            value={inlineDraft.description}
                            onChange={(event) =>
                              updateOtherDraftField(product.id, "description", event.target.value)
                            }
                            disabled={isInlineSaving}
                          />
                        ) : (
                          <>
                            {product.description ?? "—"}
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                              {product.hasAggregatePresets ? (
                                <span
                                  style={{
                                    display: "inline-block",
                                    padding: "2px 8px",
                                    borderRadius: 999,
                                    background: "var(--color-surface-secondary)",
                                    fontSize: 12,
                                    fontWeight: 600,
                                  }}
                                >
                                  Aggregate presets enabled
                                </span>
                              ) : null}
                              {product.isComposite ? (
                                <span
                                  style={{
                                    display: "inline-block",
                                    padding: "2px 8px",
                                    borderRadius: 999,
                                    background: "var(--color-surface-secondary)",
                                    fontSize: 12,
                                    fontWeight: 600,
                                  }}
                                >
                                  Composite mix
                                </span>
                              ) : null}
                            </div>
                            {product.isComposite && product.compositeComponents && product.compositeComponents.length > 0 ? (
                              <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 18, fontSize: 12 }}>
                                {product.compositeComponents.map((component) => (
                                  <li key={`${product.id}-${component.componentProductId}`}>
                                    {component.quantity.toLocaleString(undefined, {
                                      maximumFractionDigits: 2,
                                    })}{" "}
                                    {component.componentProduct?.unit ?? ""}
                                    {component.componentProduct?.unit ? " " : ""}
                                    {component.componentProduct?.name ?? "Component"}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td>
                        {inlineDraft ? (
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={inlineDraft.pieceworkRate}
                            onChange={(event) =>
                              updateOtherDraftField(product.id, "pieceworkRate", event.target.value)
                            }
                            disabled={isInlineSaving}
                            placeholder="0.00"
                          />
                        ) : product.pieceworkRate !== undefined && product.pieceworkRate !== null ? (
                          `$${product.pieceworkRate.toFixed(2)}`
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {inlineDraft ? (
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={inlineDraft.helperPieceworkRate}
                            onChange={(event) =>
                              updateOtherDraftField(
                                product.id,
                                "helperPieceworkRate",
                                event.target.value,
                              )
                            }
                            disabled={isInlineSaving}
                            placeholder="0.00"
                          />
                        ) : product.helperPieceworkRate !== undefined &&
                          product.helperPieceworkRate !== null ? (
                          `$${product.helperPieceworkRate.toFixed(2)}`
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {inlineDraft ? (
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={inlineDraft.tehmilFee}
                            onChange={(event) =>
                              updateOtherDraftField(product.id, "tehmilFee", event.target.value)
                            }
                            disabled={isInlineSaving}
                            placeholder="0.00"
                          />
                        ) : product.tehmilFee !== undefined && product.tehmilFee !== null ? (
                          `$${product.tehmilFee.toFixed(2)}`
                        ) : (
                          "$0.00"
                        )}
                      </td>
                      <td>
                        <div className="table-actions" style={{ flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
                          {inlineDraft ? (
                            <>
                              <button
                                type="button"
                                className="secondary-button"
                                style={{ padding: "6px 12px" }}
                                onClick={() => saveOtherDraft(product)}
                                disabled={isInlineSaving}
                              >
                                {isInlineSaving ? "Saving…" : "Save"}
                              </button>
                              <button
                                type="button"
                                className="ghost-button"
                                style={{ padding: "6px 12px" }}
                                onClick={() => cancelOtherInlineEdit(product.id)}
                                disabled={isInlineSaving}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="secondary-button"
                                style={{ padding: "6px 12px" }}
                                onClick={() => startOtherInlineEdit(product)}
                                disabled={isDeleting || updateMutation.isPending}
                              >
                                Edit inline
                              </button>
                              <button
                                type="button"
                                className="ghost-button"
                                style={{ padding: "6px 12px" }}
                                onClick={() => handleStartEdit(product)}
                                disabled={isDeleting || updateMutation.isPending}
                              >
                                Edit in form
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            className="ghost-button"
                            style={{ padding: "6px 12px" }}
                            onClick={() => handleDeleteProduct(product)}
                            disabled={isDeleting || isInlineSaving}
                          >
                            {isDeleting ? "Deleting…" : "Delete"}
                          </button>
                          {inlineDraft && inlineError ? (
                            <p className="error-text" style={{ margin: 0 }}>{inlineError}</p>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {hasMoreProducts && !isInitialLoading ? (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 32 }}>
          <button
            type="button"
            className="ghost-button"
            onClick={() => productsQuery.fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? "Loading more…" : "Load more products"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

export default ProductsPage;
