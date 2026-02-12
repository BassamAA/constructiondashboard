import apiClient from "./client";
import type { AuthUser } from "../types";

type LoginResponse = {
  user: AuthUser;
};

export async function login(email: string, password: string): Promise<AuthUser> {
  const { data } = await apiClient.post<LoginResponse>("/auth/login", { email, password });
  return data.user;
}

export async function logout(): Promise<void> {
  await apiClient.post("/auth/logout");
}

export async function fetchCurrentUser(): Promise<AuthUser> {
  const { data } = await apiClient.get<{ user: AuthUser }>("/auth/me");
  return data.user;
}
