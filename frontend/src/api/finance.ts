import apiClient from "./client";
import type { FinanceOverview } from "../types";

export async function fetchFinanceOverview(params?: {
  start?: string;
  end?: string;
  allTime?: boolean;
  customerId?: string;
  supplierId?: string;
  productId?: string;
}): Promise<FinanceOverview> {
  const { data } = await apiClient.get<FinanceOverview>("/finance/overview", {
    params: params?.allTime
      ? {
          allTime: true,
          customerId: params?.customerId,
          supplierId: params?.supplierId,
          productId: params?.productId,
        }
      : {
        start: params?.start,
        end: params?.end,
        customerId: params?.customerId,
        supplierId: params?.supplierId,
        productId: params?.productId,
      },
  });
  return data;
}
