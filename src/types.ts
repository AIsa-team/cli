export interface ApiEndpoint {
  method: string;
  path: string;
  description: string;
  category: string;
  parameters?: Parameter[];
}

export interface Parameter {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface ApiGroup {
  slug: string;
  name: string;
  description: string;
  category: string;
  endpoints: ApiEndpoint[];
}

export interface Model {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  supported_endpoint_types?: string[] | null;
}

export interface BalanceResponse {
  currency: string;
  account_balance_micros_usd: number;
  available_balance_micros_usd: number;
  api_key: {
    unlimited: boolean;
    remaining_micros_usd: number;
    used_micros_usd: number;
  };
  as_of: string;
}

export interface UsageRecord {
  timestamp: string;
  api: string;
  endpoint: string;
  cost: number;
  tokens?: { input: number; output: number };
  status: "success" | "error";
}

export interface ChatOptions {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream: boolean;
  max_tokens?: number;
  temperature?: number;
}

export interface ChatResponse {
  id: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface VideoTask {
  taskId: string;
  status: "pending" | "processing" | "completed" | "failed";
  prompt: string;
  resultUrl?: string;
  createdAt: string;
}

/**
 * Billing facts the gateway reports in response headers.
 *
 * Metered providers (DataForSEO, Jina) bill per consumed credit, so the
 * catalog's flat `per_request` price does not describe what a call actually
 * cost — these headers are the only accurate source. Plain integration
 * responses carry just a price key, and the LLM gateway sends nothing at all,
 * so every field is optional.
 */
export interface CostInfo {
  /** Dollars charged, e.g. "0.012000". Metered responses only. */
  priceUsd?: string;
  pricingStrategy?: string;
  pricingVersion?: string;
  creditModel?: string;
  estimatedCredits?: string;
  accountedCredits?: string;
  requestMultiplier?: string;
  /** Opaque pricing identifier; present on integration responses. */
  priceKey?: string;
  requestId?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  /** Present when the response carried any billing header. */
  cost?: CostInfo;
}
