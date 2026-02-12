import apiClient from "./client";
import type { ManualControlsPayload, ManualControlsResponse } from "../types";

export async function fetchManualControls(): Promise<ManualControlsResponse> {
  const { data } = await apiClient.get<ManualControlsResponse>("/manual-controls");
  return data;
}

export async function updateManualControls(
  payload: ManualControlsPayload,
): Promise<ManualControlsResponse> {
  const { data } = await apiClient.put<ManualControlsResponse>("/manual-controls", payload);
  return data;
}
