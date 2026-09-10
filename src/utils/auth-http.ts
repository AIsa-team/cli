import { refreshAccessToken } from "../config.js";
import { httpFetch, type HttpOptions } from "./http.js";

/** Retry only an explicit authentication rejection, at most once. */
export async function authenticatedFetch(url: string, options: HttpOptions): Promise<Response> {
  const response = await httpFetch(url, options);
  if (response.status !== 401) return response;
  const headers = new Headers(options.headers);
  const authorization = headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return response;
  const token = await refreshAccessToken(authorization.slice(7));
  if (!token) return response;
  await response.body?.cancel();
  headers.set("Authorization", `Bearer ${token}`);
  return httpFetch(url, { ...options, headers: Object.fromEntries(headers.entries()) });
}
