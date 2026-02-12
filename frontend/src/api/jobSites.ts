import apiClient from "./client";
import type { JobSite } from "../types";

export type CreateJobSiteInput = {
  customerId: number;
  name: string;
  address?: string;
  notes?: string;
};

export type UpdateJobSiteInput = Partial<Omit<CreateJobSiteInput, "customerId">>;

export async function fetchJobSites(customerId?: number): Promise<JobSite[]> {
  const { data } = await apiClient.get<JobSite[]>("/job-sites", {
    params: customerId ? { customerId } : undefined,
  });
  return data;
}

export async function createJobSite(payload: CreateJobSiteInput): Promise<JobSite> {
  const { data } = await apiClient.post<JobSite>("/job-sites", payload);
  return data;
}

export async function updateJobSite(
  id: number,
  payload: UpdateJobSiteInput,
): Promise<JobSite> {
  const { data } = await apiClient.put<JobSite>(`/job-sites/${id}`, payload);
  return data;
}

export async function deleteJobSite(id: number): Promise<void> {
  await apiClient.delete(`/job-sites/${id}`);
}
