import apiClient from "./client";
import type {
  Employee,
  EmployeeRole,
  PayFrequency,
  PayrollType,
  ManufacturingPieceRate,
} from "../types";

export type CreateEmployeeInput = {
  name: string;
  role: EmployeeRole;
  payType: PayrollType;
  salaryAmount?: number;
  salaryFrequency?: PayFrequency;
  phone?: string;
  notes?: string;
  active?: boolean;
};

export type UpdateEmployeeInput = Partial<CreateEmployeeInput>;

export async function fetchEmployees(): Promise<Employee[]> {
  const { data } = await apiClient.get<Employee[]>("/employees");
  return data;
}

export async function fetchManufacturingWorkers(): Promise<Employee[]> {
  const { data } = await apiClient.get<Employee[]>("/inventory/workers");
  return data;
}

export async function createEmployee(payload: CreateEmployeeInput): Promise<Employee> {
  const { data } = await apiClient.post<Employee>("/employees", payload);
  return data;
}

export async function updateEmployee(
  id: number,
  payload: UpdateEmployeeInput,
): Promise<Employee> {
  const { data } = await apiClient.put<Employee>(`/employees/${id}`, payload);
  return data;
}

export async function archiveEmployee(id: number): Promise<void> {
  await apiClient.delete(`/employees/${id}`);
}

export async function fetchEmployeePieceRates(employeeId: number): Promise<ManufacturingPieceRate[]> {
  const { data } = await apiClient.get<ManufacturingPieceRate[]>(
    `/employees/${employeeId}/piece-rates`,
  );
  return data;
}

export async function createPieceRate(
  employeeId: number,
  payload: { productId: number; rate: number; helperRate?: number | null },
): Promise<ManufacturingPieceRate> {
  const { data } = await apiClient.post<ManufacturingPieceRate>(
    `/employees/${employeeId}/piece-rates`,
    payload,
  );
  return data;
}

export async function updatePieceRate(
  pieceRateId: number,
  payload: Partial<{ rate: number; helperRate: number | null; isActive: boolean }>,
): Promise<ManufacturingPieceRate> {
  const { data } = await apiClient.put<ManufacturingPieceRate>(
    `/employees/piece-rates/${pieceRateId}`,
    payload,
  );
  return data;
}

export async function deletePieceRate(pieceRateId: number): Promise<void> {
  await apiClient.delete(`/employees/piece-rates/${pieceRateId}`);
}
