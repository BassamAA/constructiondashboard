import apiClient from "./client";
import type { Tool } from "../types";

export async function fetchTools(): Promise<Tool[]> {
  const { data } = await apiClient.get<Tool[]>("/tools");
  return data;
}

export async function createTool(payload: Partial<Tool> & { name: string }): Promise<Tool> {
  const { data } = await apiClient.post<Tool>("/tools", payload);
  return data;
}

export async function updateTool(id: number, payload: Partial<Tool>): Promise<Tool> {
  const { data } = await apiClient.put<Tool>(`/tools/${id}`, payload);
  return data;
}

export async function deleteTool(id: number): Promise<void> {
  await apiClient.delete(`/tools/${id}`);
}
