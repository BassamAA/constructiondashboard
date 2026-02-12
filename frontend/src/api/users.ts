import apiClient from "./client";
import type { AuthUser, UserRole } from "../types";
import type { PermissionMap } from "../constants/permissions";

export type AdminUserRow = AuthUser & {
  createdAt: string;
  updatedAt: string;
  permissionOverrides?: Partial<PermissionMap> | null;
};

type UsersResponse = {
  users: AdminUserRow[];
};

type CreateUserPayload = {
  email: string;
  password: string;
  role: UserRole;
  name?: string;
  permissions?: Partial<PermissionMap> | null;
};

export async function fetchUsers(): Promise<UsersResponse["users"]> {
  const { data } = await apiClient.get<UsersResponse>("/auth/users");
  return data.users;
}

export async function createUser(payload: CreateUserPayload): Promise<AuthUser> {
  const { data } = await apiClient.post<{ user: AuthUser }>("/auth/users", payload);
  return data.user;
}

export async function updateUser(
  userId: number,
  payload: Partial<{ role: UserRole; permissions: PermissionMap; name?: string; password?: string }>,
): Promise<AuthUser> {
  const { data } = await apiClient.patch<{ user: AuthUser }>(`/auth/users/${userId}`, payload);
  return data.user;
}
