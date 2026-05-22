export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface InferenceLogPayload {
  id: string; // Unique log event identifier
  conversationId: string;
  messageId?: string;
  model: string;
  provider: string;
  latencyMs: number;
  tokenUsage?: TokenUsage;
  status: 'success' | 'error' | 'cancelled';
  errorMessage?: string;
  inputPreview: string;
  outputPreview?: string;
  timestamp: string; // ISO 8601 Timestamp
}

export interface LoggerOptions {
  ingestUrl?: string; // URL for the ingestion server, defaults to http://localhost:5000/api/logs/ingest
  apiKey?: string;    // Optional API key for internal authorization
  enabled?: boolean;  // Toggle logging system globally
}

export interface LLMCallContext {
  model: string;
  provider: string;
  conversationId: string;
  messageId?: string;
  inputPreview: string;
}
