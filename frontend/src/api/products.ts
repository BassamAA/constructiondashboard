import apiClient from "./client";
import type { Product } from "../types";

export type CreateProductPayload = {
  name: string;
  unit: string;
  unitPrice?: number | null;
  description?: string | null;
  isManufactured?: boolean;
  hasAggregatePresets?: boolean;
  isComposite?: boolean;
  isFuel?: boolean;
  productionPowderQuantity?: number | null;
  productionCementQuantity?: number | null;
  pieceworkRate?: number | null;
  helperPieceworkRate?: number | null;
  tehmilFee?: number | null;
  compositeComponents?: {
    productId: number;
    quantity: number;
  }[];
};

export async function fetchProducts(): Promise<Product[]> {
  const { data } = await apiClient.get<Product[]>("/products");
  return data;
}

export async function createProduct(payload: CreateProductPayload): Promise<Product> {
  const { data } = await apiClient.post<Product>("/products", payload);
  return data;
}

export async function updateProduct(id: number, payload: CreateProductPayload): Promise<Product> {
  const { data } = await apiClient.put<Product>(`/products/${id}`, payload);
  return data;
}

export async function updateProductMaterials(
  id: number,
  payload: {
    productionPowderQuantity: number;
    productionCementQuantity: number;
    pieceworkRate?: number | null;
    helperPieceworkRate?: number | null;
  },
): Promise<Product> {
  const { data } = await apiClient.patch<Product>(`/products/${id}/materials`, payload);
  return data;
}

export async function overrideProductStock(id: number, stockQty: number): Promise<Product> {
  const { data } = await apiClient.post<Product>(`/products/${id}/adjust-stock`, { stockQty });
  return data;
}

export async function deleteProduct(id: number): Promise<void> {
  await apiClient.delete(`/products/${id}`);
}

export type ProductPage = {
  items: Product[];
  nextCursor: number | null;
};

export async function fetchProductsPage({
  cursor,
  limit,
}: {
  cursor?: number;
  limit?: number;
} = {}): Promise<ProductPage> {
  const params = new URLSearchParams();
  if (cursor !== undefined) params.set("cursor", String(cursor));
  if (limit !== undefined) params.set("limit", String(limit));
  const query = params.toString() ? `?${params.toString()}` : "";
  const { data } = await apiClient.get<ProductPage>(`/products/paginated${query}`);
  return data;
}
