import fetch, { type Response } from "node-fetch";
import { CLI_BASE_URL, APIS_BASE_URL } from "./constants.js";
import { getConfig } from "./config.js";
import type { ApiResponse } from "./types.js";

function getBaseUrl(): string {
  const custom = getConfig("baseUrl") as string | undefined;
  return custom || CLI_BASE_URL;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, string>;
  body?: unknown;
  stream?: boolean;
  headers?: Record<string, string>;
  /** Use domain API base URL (/apis/v1) instead of LLM base (/v1) */
  domain?: boolean;
}

export async function apiRequest<T = unknown>(
  apiKey: string,
  endpoint: string,
  options: RequestOptions = {}
): Promise<ApiResponse<T>> {
  const { method = "GET", query, body, headers: extraHeaders, domain } = options;
  const baseUrl = domain ? APIS_BASE_URL : getBaseUrl();

  let url = `${baseUrl}/${endpoint}`;
  if (query) {
    const params = new URLSearchParams(query);
    url += `?${params.toString()}`;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "x-aisa-source": "cli",
    ...extraHeaders,
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    let errorMsg: string;
    try {
      const json = JSON.parse(text);
      errorMsg = json.error?.message || json.error || json.message || text;
    } catch {
      errorMsg = text;
    }
    return { success: false, error: `${res.status}: ${errorMsg}` };
  }

  const data = (await res.json()) as T;
  return { success: true, data };
}

export async function apiRequestRaw(
  apiKey: string,
  endpoint: string,
  options: RequestOptions = {}
): Promise<Response> {
  const { method = "GET", query, body, headers: extraHeaders, domain } = options;
  const baseUrl = domain ? APIS_BASE_URL : getBaseUrl();

  let url = `${baseUrl}/${endpoint}`;
  if (query) {
    const params = new URLSearchParams(query);
    url += `?${params.toString()}`;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "x-aisa-source": "cli",
    ...extraHeaders,
  };

  return fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}
