import { InferenceLogPayload, LoggerOptions } from './types.js';

export class IngestionClient {
  private ingestUrl: string;
  private apiKey?: string;
  private enabled: boolean;

  constructor(options: LoggerOptions = {}) {
    // In local development, the fallback points to our Express ingestion backend port
    this.ingestUrl = options.ingestUrl || 'http://localhost:5000/api/logs/ingest';
    this.apiKey = options.apiKey;
    this.enabled = options.enabled !== false;
  }

  /**
   * Submits an inference log to the ingestion service in a non-blocking, asynchronous manner.
   * Leverages fire-and-forget fetch call patterns so LLM responsiveness is not impacted.
   */
  public log(payload: InferenceLogPayload): void {
    if (!this.enabled) return;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    // Fire-and-forget fetch call (non-blocking)
    fetch(this.ingestUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
      .then((response) => {
        if (!response.ok) {
          console.error(`[Inference SDK] Failed to ingest log ${payload.id}:`, response.statusText);
        }
      })
      .catch((error) => {
        console.error(`[Inference SDK] Network error during log ingestion fetch for ${payload.id}:`, error);
      });
  }
}
