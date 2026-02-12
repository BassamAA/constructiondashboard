export type RateRole = "worker" | "helper";

export type StoredRateMap = Record<string, number>;

const RATE_STORAGE_KEY = "manufacturingRates";

export const loadStoredRates = (): StoredRateMap => {
  try {
    const value = window.localStorage.getItem(RATE_STORAGE_KEY);
    if (!value) {
      return {};
    }
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? (parsed as StoredRateMap) : {};
  } catch (err) {
    console.error("Failed to load manufacturing rates", err);
    return {};
  }
};

export const persistStoredRates = (map: StoredRateMap): void => {
  try {
    window.localStorage.setItem(RATE_STORAGE_KEY, JSON.stringify(map));
  } catch (err) {
    console.error("Failed to persist manufacturing rates", err);
  }
};

export const makeRateKey = (role: RateRole, employeeId: number, productId: number) =>
  `${role}:${employeeId}:${productId}`;

export const getRateFromMap = (
  map: StoredRateMap,
  role: RateRole,
  employeeIdValue?: string,
  productIdValue?: number | null,
) => {
  if (!employeeIdValue || productIdValue === null || productIdValue === undefined) {
    return null;
  }
  const employeeId = Number(employeeIdValue);
  if (Number.isNaN(employeeId)) {
    return null;
  }
  const key = makeRateKey(role, employeeId, productIdValue);
  const value = map[key];
  return typeof value === "number" ? value : null;
};
