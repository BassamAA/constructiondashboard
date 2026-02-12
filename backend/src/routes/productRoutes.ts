import { Router } from "express";
import prisma from "../prismaClient";
import { FIXED_PRODUCT_CATALOG } from "../config/productCatalog";
import { logAudit } from "../utils/auditLogger";

const router = Router();
const fixedProductNames = new Set(
  FIXED_PRODUCT_CATALOG.map((product) => product.name.toLowerCase()),
);

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const productInclude = {
  productionPowderProduct: true,
  productionCementProduct: true,
  compositeComponents: {
    include: {
      componentProduct: {
        select: { id: true, name: true, unit: true },
      },
    },
  },
};

const POWDER_NAME = "powder";
const CEMENT_NAME = "cement";
const AGGREGATE_KEYWORDS = ["powder", "sand", "gravel", "mix", "makhlouta"];

type CompositeComponentInput = {
  productId: number;
  quantity: number;
};

const COMPOSITE_ERRORS = {
  REQUIRED: "COMPOSITE_COMPONENTS_REQUIRED",
  INVALID: "COMPOSITE_COMPONENTS_INVALID",
  SELF: "COMPOSITE_COMPONENTS_SELF",
  DUPLICATE: "COMPOSITE_COMPONENTS_DUPLICATE",
  NOT_FOUND: "COMPOSITE_COMPONENTS_NOT_FOUND",
  DISALLOWED: "COMPOSITE_COMPONENTS_DISALLOWED",
} as const;

function getCompositeErrorMessage(code: string) {
  switch (code) {
    case COMPOSITE_ERRORS.REQUIRED:
      return "Add at least one component for composite mixes.";
    case COMPOSITE_ERRORS.INVALID:
      return "Component quantities must be positive numbers and reference valid products.";
    case COMPOSITE_ERRORS.SELF:
      return "A composite product cannot reference itself as a component.";
    case COMPOSITE_ERRORS.DUPLICATE:
      return "Each component can only be listed once.";
    case COMPOSITE_ERRORS.NOT_FOUND:
      return "One or more selected components no longer exist.";
    case COMPOSITE_ERRORS.DISALLOWED:
      return "Composite mixes cannot reference other composite products.";
    default:
      return "Unable to process composite components.";
  }
}

async function normalizeCompositeComponentsInput(
  rawValue: any,
  parentProductId?: number,
): Promise<CompositeComponentInput[]> {
  if (!Array.isArray(rawValue)) {
    throw new Error(COMPOSITE_ERRORS.REQUIRED);
  }

  const normalized: CompositeComponentInput[] = [];
  for (const entry of rawValue) {
    const productId = Number(entry?.productId);
    const quantity = Number(entry?.quantity);
    if (
      !productId ||
      Number.isNaN(productId) ||
      productId <= 0 ||
      Number.isNaN(quantity) ||
      quantity <= 0
    ) {
      throw new Error(COMPOSITE_ERRORS.INVALID);
    }
    normalized.push({ productId, quantity });
  }

  if (normalized.length === 0) {
    throw new Error(COMPOSITE_ERRORS.REQUIRED);
  }

  const seen = new Set<number>();
  for (const entry of normalized) {
    if (parentProductId && entry.productId === parentProductId) {
      throw new Error(COMPOSITE_ERRORS.SELF);
    }
    if (seen.has(entry.productId)) {
      throw new Error(COMPOSITE_ERRORS.DUPLICATE);
    }
    seen.add(entry.productId);
  }

  const products = await prisma.product.findMany({
    where: { id: { in: Array.from(seen) } },
    select: { id: true, isComposite: true },
  });

  if (products.length !== seen.size) {
    throw new Error(COMPOSITE_ERRORS.NOT_FOUND);
  }

  const compositeComponent = products.find((product) => product.isComposite);
  if (compositeComponent) {
    throw new Error(COMPOSITE_ERRORS.DISALLOWED);
  }

  return normalized;
}

async function resolveCoreComponentIds() {
  const components = await prisma.product.findMany({
    where: {
      name: {
        in: ["Powder", "Cement"],
      },
    },
    select: {
      id: true,
      name: true,
    },
  });

  const powder = components.find(
    (component) => component.name.toLowerCase() === POWDER_NAME,
  );
  const cement = components.find(
    (component) => component.name.toLowerCase() === CEMENT_NAME,
  );

  if (!powder || !cement) {
    throw new Error(
      "Core component products (Powder and Cement) are missing from the catalog.",
    );
  }

  return { powderId: powder.id, cementId: cement.id };
}

const buildPaginatedResponse = (items: any[], limit: number) => {
  const hasNext = items.length > limit;
  if (hasNext) {
    items.pop();
  }
  const nextCursor = hasNext ? items[items.length - 1]?.id ?? null : null;
  return {
    items,
    nextCursor,
  };
};

router.get("/paginated", async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(Number(req.query.limit) || DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE,
    );
    const cursorRaw = req.query.cursor;
    const cursor = cursorRaw !== undefined ? Number(cursorRaw) : null;
    if (cursor !== null && Number.isNaN(cursor)) {
      return res.status(400).json({ error: "Invalid cursor" });
    }

    const products = await prisma.product.findMany({
      orderBy: { id: "asc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: productInclude,
    });

    res.json(buildPaginatedResponse(products, limit));
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to fetch products" });
  }
});

router.get("/", async (_req, res) => {
  try {
    const products = await prisma.product.findMany({
      orderBy: { name: "asc" },
      include: productInclude,
    });

    // Ensure fixed catalog entries always surface first in the response
    const sorted = products.sort((a, b) => {
      const aFixed = fixedProductNames.has(a.name.toLowerCase());
      const bFixed = fixedProductNames.has(b.name.toLowerCase());
      if (aFixed === bFixed) {
        return a.name.localeCompare(b.name);
      }
      return aFixed ? -1 : 1;
    });

    res.json(sorted);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to fetch products" });
  }
});

router.post("/", async (req, res) => {
  try {
    const {
      name,
      unit,
      unitPrice,
      description,
      isManufactured,
      hasAggregatePresets,
      isComposite,
      isFuel,
      pieceworkRate,
      helperPieceworkRate,
      productionPowderQuantity,
      productionCementQuantity,
      compositeComponents,
    } = req.body ?? {};

    if (typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "Product name is required" });
    }

    const normalizedName = name.trim();
    if (fixedProductNames.has(normalizedName.toLowerCase())) {
      return res.status(400).json({ error: "This product is managed automatically and cannot be recreated." });
    }

    const existing = await prisma.product.findFirst({
      where: { name: normalizedName },
    });
    if (existing) {
      return res.status(409).json({ error: "A product with this name already exists." });
    }

    if (typeof unit !== "string" || unit.trim().length === 0) {
      return res.status(400).json({ error: "Unit is required" });
    }

    const normalizedUnit = unit.trim();
    const parsedUnitPrice =
      unitPrice === undefined || unitPrice === null || String(unitPrice).trim() === ""
        ? null
        : Number(unitPrice);
    if (parsedUnitPrice !== null && Number.isNaN(parsedUnitPrice)) {
      return res.status(400).json({ error: "unitPrice must be a number" });
    }

    const manufactured = Boolean(isManufactured);
    const composite = Boolean(isComposite);
    const aggregatePresets =
      hasAggregatePresets === undefined || hasAggregatePresets === null
        ? shouldEnableAggregatePresets(normalizedName, normalizedUnit, composite)
        : Boolean(hasAggregatePresets);
    const fuel = Boolean(isFuel);

    if (manufactured && composite) {
      return res
        .status(400)
        .json({ error: "A product cannot be both manufactured and a composite mix." });
    }

    const parsedPieceworkRate =
      pieceworkRate === undefined || pieceworkRate === null || `${pieceworkRate}`.trim() === ""
        ? null
        : Number(pieceworkRate);
    if (parsedPieceworkRate !== null && Number.isNaN(parsedPieceworkRate)) {
      return res.status(400).json({ error: "pieceworkRate must be a number" });
    }

    const parsedHelperPieceworkRate =
      helperPieceworkRate === undefined || helperPieceworkRate === null || `${helperPieceworkRate}`.trim() === ""
        ? null
        : Number(helperPieceworkRate);
    if (parsedHelperPieceworkRate !== null && Number.isNaN(parsedHelperPieceworkRate)) {
      return res.status(400).json({ error: "helperPieceworkRate must be a number" });
    }

    let parsedTehmilFee: number | null = null;
    if (req.body?.tehmilFee !== undefined) {
      const rawFee = req.body.tehmilFee;
      if (rawFee === null || String(rawFee).trim() === "") {
        parsedTehmilFee = 0;
      } else {
        const feeVal = Number(rawFee);
        if (Number.isNaN(feeVal) || feeVal < 0) {
          return res.status(400).json({ error: "tehmilFee must be a non-negative number" });
        }
        parsedTehmilFee = feeVal;
      }
    }

    let parsedPowderQuantity: number | null = null;
    if (productionPowderQuantity !== undefined && productionPowderQuantity !== null && String(productionPowderQuantity).trim() !== "") {
      parsedPowderQuantity = Number(productionPowderQuantity);
      if (Number.isNaN(parsedPowderQuantity) || parsedPowderQuantity <= 0) {
        return res.status(400).json({ error: "productionPowderQuantity must be greater than zero" });
      }
    }

    let parsedCementQuantity: number | null = null;
    if (productionCementQuantity !== undefined && productionCementQuantity !== null && String(productionCementQuantity).trim() !== "") {
      parsedCementQuantity = Number(productionCementQuantity);
      if (Number.isNaN(parsedCementQuantity) || parsedCementQuantity <= 0) {
        return res.status(400).json({ error: "productionCementQuantity must be greater than zero" });
      }
    }

    let componentIds: { powderId: number; cementId: number } | null = null;
    if (manufactured) {
      if (parsedPowderQuantity === null) {
        return res.status(400).json({ error: "Provide powder quantity per unit for manufactured products" });
      }
      if (parsedCementQuantity === null) {
        return res.status(400).json({ error: "Provide cement quantity per unit for manufactured products" });
      }
      try {
        componentIds = await resolveCoreComponentIds();
      } catch (componentError: any) {
        console.error(componentError);
        return res.status(500).json({ error: componentError.message ?? "Core component lookup failed" });
      }
    } else {
      parsedPowderQuantity = null;
      parsedCementQuantity = null;
    }

    const powderQuantityValue = manufactured ? parsedPowderQuantity : null;
    const cementQuantityValue = manufactured ? parsedCementQuantity : null;

    let compositeComponentInput: CompositeComponentInput[] = [];
    if (composite) {
      try {
        compositeComponentInput = await normalizeCompositeComponentsInput(compositeComponents);
      } catch (componentError: any) {
        const message = getCompositeErrorMessage(componentError?.message ?? "");
        return res.status(400).json({ error: message });
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          name: normalizedName,
          unit: normalizedUnit,
          unitPrice: parsedUnitPrice,
          description:
            typeof description === "string" && description.trim().length > 0
              ? description.trim()
              : null,
          isManufactured: manufactured,
          isComposite: composite,
          hasAggregatePresets: aggregatePresets,
          isFuel: fuel,
          pieceworkRate: manufactured ? parsedPieceworkRate : null,
          helperPieceworkRate: manufactured ? parsedHelperPieceworkRate : null,
          productionPowderProductId: componentIds?.powderId ?? null,
          productionPowderQuantity: powderQuantityValue,
          productionCementProductId: componentIds?.cementId ?? null,
          productionCementQuantity: cementQuantityValue,
          tehmilFee: parsedTehmilFee ?? 0,
          tenzilFee: parsedTehmilFee ?? 0,
        },
      });

      if (composite && compositeComponentInput.length > 0) {
        await tx.productComponent.createMany({
          data: compositeComponentInput.map((component) => ({
            parentProductId: product.id,
            componentProductId: component.productId,
            quantity: component.quantity,
          })),
        });
      }

      return tx.product.findUnique({
        where: { id: product.id },
        include: productInclude,
      });
    });

    res.status(201).json(created);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to create product" });
  }
});

router.patch("/:id/materials", async (req, res) => {
  try {
    const { id } = req.params;
    const productId = Number(id);
    if (Number.isNaN(productId)) {
      return res.status(400).json({ error: "Invalid product id" });
    }

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    if (!product.isManufactured) {
      return res.status(400).json({ error: "Only manufactured products have material usage" });
    }

    const {
      productionPowderQuantity,
      productionCementQuantity,
      pieceworkRate,
      helperPieceworkRate,
    } = req.body ?? {};
    if (
      productionPowderQuantity === undefined ||
      productionCementQuantity === undefined
    ) {
      return res.status(400).json({ error: "Provide both powder and cement quantities" });
    }

    const parsedPowder = Number(productionPowderQuantity);
    const parsedCement = Number(productionCementQuantity);
    if (Number.isNaN(parsedPowder) || parsedPowder <= 0) {
      return res.status(400).json({ error: "Powder quantity must be greater than zero" });
    }
    if (Number.isNaN(parsedCement) || parsedCement <= 0) {
      return res.status(400).json({ error: "Cement quantity must be greater than zero" });
    }

    let nextPieceworkRate: number | null | undefined;
    if (pieceworkRate !== undefined) {
      if (pieceworkRate === null || `${pieceworkRate}`.trim() === "") {
        nextPieceworkRate = null;
      } else {
        const parsed = Number(pieceworkRate);
        if (Number.isNaN(parsed) || parsed <= 0) {
          return res.status(400).json({ error: "Piecework rate must be greater than zero" });
        }
        nextPieceworkRate = parsed;
      }
    }

    let nextHelperRate: number | null | undefined;
    if (helperPieceworkRate !== undefined) {
      if (helperPieceworkRate === null || `${helperPieceworkRate}`.trim() === "") {
        nextHelperRate = null;
      } else {
        const parsed = Number(helperPieceworkRate);
        if (Number.isNaN(parsed) || parsed < 0) {
          return res.status(400).json({ error: "Helper rate must be zero or greater" });
        }
        nextHelperRate = parsed;
      }
    }

    const componentIds = await resolveCoreComponentIds();

    const updateData: Record<string, any> = {
      productionPowderQuantity: parsedPowder,
      productionCementQuantity: parsedCement,
      productionPowderProductId: componentIds.powderId,
      productionCementProductId: componentIds.cementId,
    };

    if (nextPieceworkRate !== undefined) {
      updateData.pieceworkRate = nextPieceworkRate;
    }
    if (nextHelperRate !== undefined) {
      updateData.helperPieceworkRate = nextHelperRate;
    }

    const updated = await prisma.product.update({
      where: { id: productId },
      data: updateData,
      include: productInclude,
    });

    res.json(updated);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to update material usage" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const productId = Number(id);
    if (Number.isNaN(productId)) {
      return res.status(400).json({ error: "Invalid product id" });
    }

    const existing = await prisma.product.findUnique({ where: { id: productId } });
    if (!existing) {
      return res.status(404).json({ error: "Product not found" });
    }

    const {
      name,
      unit,
      unitPrice,
      description,
      isManufactured,
      hasAggregatePresets,
      isComposite,
      isFuel,
      pieceworkRate,
      helperPieceworkRate,
      productionPowderQuantity,
      productionCementQuantity,
      compositeComponents,
    } = req.body ?? {};

    if (typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "Product name is required" });
    }
    const normalizedName = name.trim();
    if (normalizedName.toLowerCase() !== existing.name.toLowerCase()) {
      const conflicting = await prisma.product.findFirst({
        where: {
          name: normalizedName,
          NOT: { id: productId },
        },
      });
      if (conflicting) {
        return res.status(409).json({ error: "A product with this name already exists." });
      }
    }

    if (typeof unit !== "string" || unit.trim().length === 0) {
      return res.status(400).json({ error: "Unit is required" });
    }

    const normalizedUnit = unit.trim();
    const parsedUnitPrice =
      unitPrice === undefined || unitPrice === null || String(unitPrice).trim() === ""
        ? null
        : Number(unitPrice);
    if (parsedUnitPrice !== null && Number.isNaN(parsedUnitPrice)) {
      return res.status(400).json({ error: "unitPrice must be a number" });
    }

    const manufactured = Boolean(isManufactured);
    const compositeFlagProvided = isComposite !== undefined;
    const compositeValue = compositeFlagProvided ? Boolean(isComposite) : existing.isComposite;
    const aggregatePresets =
      hasAggregatePresets !== undefined
        ? Boolean(hasAggregatePresets)
        : existing.hasAggregatePresets ||
          shouldEnableAggregatePresets(normalizedName, normalizedUnit, compositeValue);
    const fuel = Boolean(isFuel);

    if (manufactured && compositeValue) {
      return res
        .status(400)
        .json({ error: "A product cannot be both manufactured and a composite mix." });
    }

    const parsedPieceworkRate =
      pieceworkRate === undefined || pieceworkRate === null || `${pieceworkRate}`.trim() === ""
        ? null
        : Number(pieceworkRate);
    if (parsedPieceworkRate !== null && (Number.isNaN(parsedPieceworkRate) || parsedPieceworkRate < 0)) {
      return res.status(400).json({ error: "pieceworkRate must be a positive number" });
    }

    const parsedHelperPieceworkRate =
      helperPieceworkRate === undefined || helperPieceworkRate === null || `${helperPieceworkRate}`.trim() === ""
        ? null
        : Number(helperPieceworkRate);
    if (
      parsedHelperPieceworkRate !== null &&
      (Number.isNaN(parsedHelperPieceworkRate) || parsedHelperPieceworkRate < 0)
    ) {
      return res.status(400).json({ error: "helperPieceworkRate must be a positive number" });
    }

    const hasPowderQuantityInput = productionPowderQuantity !== undefined;
    let parsedPowderQuantity: number | null = null;
    if (
      productionPowderQuantity !== undefined &&
      productionPowderQuantity !== null &&
      String(productionPowderQuantity).trim() !== ""
    ) {
      parsedPowderQuantity = Number(productionPowderQuantity);
      if (Number.isNaN(parsedPowderQuantity) || parsedPowderQuantity <= 0) {
        return res.status(400).json({ error: "productionPowderQuantity must be greater than zero" });
      }
    } else if (
      productionPowderQuantity !== undefined &&
      (productionPowderQuantity === null || String(productionPowderQuantity).trim() === "")
    ) {
      parsedPowderQuantity = null;
    }

    const hasCementQuantityInput = productionCementQuantity !== undefined;
    let parsedCementQuantity: number | null = null;
    if (
      productionCementQuantity !== undefined &&
      productionCementQuantity !== null &&
      String(productionCementQuantity).trim() !== ""
    ) {
      parsedCementQuantity = Number(productionCementQuantity);
      if (Number.isNaN(parsedCementQuantity) || parsedCementQuantity <= 0) {
        return res.status(400).json({ error: "productionCementQuantity must be greater than zero" });
      }
    } else if (
      productionCementQuantity !== undefined &&
      (productionCementQuantity === null || String(productionCementQuantity).trim() === "")
    ) {
      parsedCementQuantity = null;
    }

    let componentIds: { powderId: number; cementId: number } | null = null;
    let powderQuantityValue: number | null;
    let cementQuantityValue: number | null;

    if (manufactured) {
      powderQuantityValue = hasPowderQuantityInput
        ? parsedPowderQuantity
        : existing.productionPowderQuantity ?? null;
      cementQuantityValue = hasCementQuantityInput
        ? parsedCementQuantity
        : existing.productionCementQuantity ?? null;

      if (powderQuantityValue === null || powderQuantityValue === undefined) {
        return res.status(400).json({ error: "Provide powder quantity per unit for manufactured products" });
      }
      if (cementQuantityValue === null || cementQuantityValue === undefined) {
        return res.status(400).json({ error: "Provide cement quantity per unit for manufactured products" });
      }

      try {
        componentIds = await resolveCoreComponentIds();
      } catch (componentError: any) {
        console.error(componentError);
        return res.status(500).json({ error: componentError.message ?? "Core component lookup failed" });
      }
    } else {
      powderQuantityValue = null;
      cementQuantityValue = null;
    }

    let compositeComponentInput: CompositeComponentInput[] | null = null;
    if (compositeValue) {
      if (Array.isArray(compositeComponents)) {
        try {
          compositeComponentInput = await normalizeCompositeComponentsInput(
            compositeComponents,
            productId,
          );
        } catch (componentError: any) {
          const message = getCompositeErrorMessage(componentError?.message ?? "");
          return res.status(400).json({ error: message });
        }
      } else if (!existing.isComposite) {
        return res
          .status(400)
          .json({ error: "Add at least one component for composite mixes." });
      }
    } else if (existing.isComposite) {
      compositeComponentInput = [];
    }

    const updated = await prisma.$transaction(async (tx) => {
      const product = await tx.product.update({
        where: { id: productId },
        data: {
          name: normalizedName,
          unit: normalizedUnit,
          unitPrice: parsedUnitPrice,
          description:
            typeof description === "string" && description.trim().length > 0
              ? description.trim()
              : null,
          isManufactured: manufactured,
          isComposite: compositeValue,
          hasAggregatePresets: aggregatePresets,
          isFuel: fuel,
          pieceworkRate: manufactured ? parsedPieceworkRate : null,
          helperPieceworkRate: manufactured ? parsedHelperPieceworkRate : null,
          productionPowderProductId: componentIds?.powderId ?? null,
          productionPowderQuantity: powderQuantityValue,
          productionCementProductId: componentIds?.cementId ?? null,
          productionCementQuantity: cementQuantityValue,
          ...(req.body?.tehmilFee !== undefined
            ? (() => {
                const rawFee = req.body.tehmilFee;
                let parsedTehmil: number | null = null;
                if (rawFee === null || String(rawFee).trim() === "") {
                  parsedTehmil = 0;
                } else {
                  const val = Number(rawFee);
                  if (Number.isNaN(val) || val < 0) {
                    throw new Error("TEHMIL_FEE_INVALID");
                  }
                  parsedTehmil = val;
                }
                return { tehmilFee: parsedTehmil ?? 0, tenzilFee: parsedTehmil ?? 0 };
              })()
            : {}),
        },
      });

      if (!compositeValue) {
        await tx.productComponent.deleteMany({ where: { parentProductId: productId } });
      } else if (Array.isArray(compositeComponentInput)) {
        await tx.productComponent.deleteMany({ where: { parentProductId: productId } });
        if (compositeComponentInput.length === 0) {
          throw new Error(COMPOSITE_ERRORS.REQUIRED);
        }
        await tx.productComponent.createMany({
          data: compositeComponentInput.map((component) => ({
            parentProductId: productId,
            componentProductId: component.productId,
            quantity: component.quantity,
          })),
        });
      }

      return tx.product.findUnique({
        where: { id: product.id },
        include: productInclude,
      });
    });

    res.json(updated);
  } catch (err: any) {
    if (err instanceof Error && err.message && err.message in COMPOSITE_ERRORS) {
      return res.status(400).json({ error: getCompositeErrorMessage(err.message) });
    }
    if (err?.message === "TEHMIL_FEE_INVALID") {
      return res.status(400).json({ error: "tehmilFee must be a non-negative number" });
    }
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to update product" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const productId = Number(id);
    if (Number.isNaN(productId)) {
      return res.status(400).json({ error: "Invalid product id" });
    }

    const existing = await prisma.product.findUnique({ where: { id: productId } });
    if (!existing) {
      return res.status(404).json({ error: "Product not found" });
    }

    try {
      await prisma.product.delete({ where: { id: productId } });
      res.status(204).end();
    } catch (err: any) {
      console.error(err);
      if (err.code === "P2003") {
        return res.status(409).json({ error: "Product is in use and cannot be deleted." });
      }
      throw err;
    }
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to delete product" });
  }
});

router.post("/:id/adjust-stock", async (req, res) => {
  try {
    const productId = Number(req.params.id);
    if (Number.isNaN(productId)) {
      return res.status(400).json({ error: "Invalid product id" });
    }

    const { stockQty } = req.body ?? {};
    if (stockQty === undefined || stockQty === null || String(stockQty).trim() === "") {
      return res.status(400).json({ error: "stockQty is required" });
    }
    const parsedStockQty = Number(stockQty);
    if (!Number.isFinite(parsedStockQty) || parsedStockQty < 0) {
      return res.status(400).json({ error: "stockQty must be a non-negative number" });
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, stockQty: true, unit: true },
    });

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    const updated = await prisma.product.update({
      where: { id: productId },
      data: { stockQty: parsedStockQty },
      include: productInclude,
    });

    await logAudit({
      action: "INVENTORY_STOCK_OVERRIDE",
      entityType: "PRODUCT",
      entityId: productId,
      description: `Manual stock set to ${parsedStockQty} ${product.unit}`,
      user: req.user?.email ?? null,
      metadata: {
        previousStock: product.stockQty,
        newStock: parsedStockQty,
        productName: product.name,
      },
    });

    res.json(updated);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to adjust stock" });
  }
});

export default router;
const shouldEnableAggregatePresets = (
  name: string,
  unit: string,
  forceComposite: boolean,
) => {
  if (forceComposite) {
    return true;
  }
  const normalizedName = name.trim().toLowerCase();
  const normalizedUnit = unit.trim().toLowerCase();
  if (AGGREGATE_KEYWORDS.some((keyword) => normalizedName.includes(keyword))) {
    return true;
  }
  if (normalizedUnit.includes("m3") || normalizedUnit.includes("m³")) {
    return true;
  }
  return false;
};
