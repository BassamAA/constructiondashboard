import apiClient from "./client";
import type { DashboardSummary } from "../types";

export async function fetchDashboard(): Promise<DashboardSummary> {
  const { data } = await apiClient.get<DashboardSummary>("/dashboard");
  return data;
}
