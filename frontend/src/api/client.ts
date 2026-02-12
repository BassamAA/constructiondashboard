import axios from "axios";

const baseURL =
  import.meta.env.VITE_API_BASE?.replace(/\/$/, "") ?? "http://localhost:4000";

export const apiClient = axios.create({
  baseURL,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 15000,
  withCredentials: true,
});

export default apiClient;
