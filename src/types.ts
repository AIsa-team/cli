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
  name: string;
  provider: string;
  contextWindow: number;
  maxTokens: number;
  pricing: { input: number; output: number };
  capabilities: string[];
}

export interface SkillMeta {
  name: string;
  description: string;
  owner: string;
  slug: string;
  tags: string[];
  category: string;
  verified: boolean;
  installs: number;
}

export interface SkillDetail extends SkillMeta {
  files: Array<{ path: string; content: string }>;
}

export interface BalanceResponse {
  balance: number;
  currency: string;
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

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
