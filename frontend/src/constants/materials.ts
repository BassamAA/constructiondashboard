import type { Product } from "../types";

export const CORE_PRODUCT_NAMES = ["Powder", "Sand", "Gravel", "Cement", "Debris"] as const;
export const AGGREGATE_PRODUCT_NAMES = ["Powder", "Sand", "Gravel"] as const;
export const DEBRIS_PRODUCT_NAMES = ["Debris"] as const;

export type DisplayOption = {
  id: string;
  label: string;
  promptLabel: string;
  toBaseFactor: number;
  detail?: string;
};

const AGGREGATE_PRESETS: DisplayOption[] = [
  {
    id: "aggregate-bag",
    label: "Bag",
    promptLabel: "bags",
    toBaseFactor: 1 / 85,
    detail: undefined,
  },
  {
    id: "pickup",
    label: "Pickup",
    promptLabel: "pickups",
    toBaseFactor: 2.5,
    detail: undefined,
  },
  {
    id: "atego",
    label: "Atego / Hino",
    promptLabel: "atego / hino loads",
    toBaseFactor: 5,
    detail: undefined,
  },
  {
    id: "truck",
    label: "Truck",
    promptLabel: "trucks",
    toBaseFactor: 27,
    detail: undefined,
  },
];

const CEMENT_PRESETS: DisplayOption[] = [
  {
    id: "cement-bag",
    label: "Bag",
    promptLabel: "bags of cement",
    toBaseFactor: 1,
    detail: "Enter bag count (20 bags = 1 ton)",
  },
  {
    id: "cement-ton",
    label: "Ton (20 bags)",
    promptLabel: "tons of cement",
    toBaseFactor: 20,
    detail: "20 bags per ton",
  },
];

const BASE_ID_PREFIX = "base:";

export function isAggregateProduct(name: string | null | undefined): boolean {
  if (!name) return false;
  const normalized = name.trim().toLowerCase();
  return AGGREGATE_PRODUCT_NAMES.some((coreName) =>
    normalized.includes(coreName.toLowerCase()),
  );
}

export function isCementProduct(name: string | null | undefined): boolean {
  if (!name) return false;
  return name.trim().toLowerCase() === "cement";
}

export function isDebrisProduct(name: string | null | undefined): boolean {
  if (!name) return false;
  return DEBRIS_PRODUCT_NAMES.some(
    (coreName) => coreName.toLowerCase() === name.trim().toLowerCase(),
  );
}

export function isCoreProduct(name: string | null | undefined): boolean {
  if (!name) return false;
  return CORE_PRODUCT_NAMES.some(
    (coreName) => coreName.toLowerCase() === name.trim().toLowerCase(),
  );
}

const DEBRIS_PRESETS: DisplayOption[] = AGGREGATE_PRESETS.filter(
  (option) => option.id !== "aggregate-bag",
);

export const AGGREGATE_DISPLAY_PRESETS = AGGREGATE_PRESETS;
export const CEMENT_DISPLAY_PRESETS = CEMENT_PRESETS;
export const DEBRIS_DISPLAY_PRESETS = DEBRIS_PRESETS;

export const makeBaseDisplayOption = (unit: string): DisplayOption => ({
  id: `${BASE_ID_PREFIX}${unit}`,
  label: unit,
  promptLabel: unit,
  toBaseFactor: 1,
  detail: `Display in ${unit}`,
});

export function getDisplayOptionsForProduct(product?: Product): DisplayOption[] {
  if (!product) return [];
  const baseOption = makeBaseDisplayOption(product.unit);
  if (isCementProduct(product.name)) {
    return [baseOption, ...CEMENT_PRESETS];
  }
  if (isDebrisProduct(product.name)) {
    return [baseOption, ...DEBRIS_DISPLAY_PRESETS];
  }
  if (product.hasAggregatePresets || isAggregateProduct(product.name)) {
    return [baseOption, ...AGGREGATE_PRESETS];
  }
  return [baseOption];
}

export function findDisplayOption(
  product: Product | undefined,
  optionId: string | undefined,
): DisplayOption | undefined {
  if (!product || !optionId) return undefined;
  return getDisplayOptionsForProduct(product).find((option) => option.id === optionId);
}

export function describeDisplayOption(option: DisplayOption): string {
  return option.detail ? `${option.label} – ${option.detail}` : option.label;
}
