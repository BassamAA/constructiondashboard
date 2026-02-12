import apiClient from "./client";

export async function mergeCustomers(sourceId: number, targetId: number) {
  const { data } = await apiClient.post("/merge/customers", { sourceId, targetId });
  return data;
}

export async function mergeSuppliers(sourceId: number, targetId: number) {
  const { data } = await apiClient.post("/merge/suppliers", { sourceId, targetId });
  return data;
}

export async function pairCustomerSupplier(customerId: number, supplierId: number) {
  const { data } = await apiClient.post("/merge/pair-customer-supplier", { customerId, supplierId });
  return data;
}
