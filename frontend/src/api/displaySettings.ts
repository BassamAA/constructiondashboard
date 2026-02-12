import apiClient from "./client";

export type DisplaySettings = {
  displayCash: boolean;
  displayReceivables: boolean;
  displayPayables: boolean;
  includeReceipts: boolean;
  includeSupplierPurchases: boolean;
  includeManufacturing: boolean;
  includePayroll: boolean;
  includeDebris: boolean;
  includeGeneralExpenses: boolean;
  includeInventoryValue: boolean;
  updatedAt?: string;
};

export async function fetchDisplaySettings(): Promise<DisplaySettings> {
  const { data } = await apiClient.get<DisplaySettings>("/display-settings");
  return data;
}

export async function updateDisplaySettings(
  payload: Partial<DisplaySettings>,
): Promise<DisplaySettings> {
  const { data } = await apiClient.put<DisplaySettings>("/display-settings", payload);
  return data;
}
