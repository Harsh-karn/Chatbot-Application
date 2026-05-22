import { IngestionClient } from './client.js';
import { InferenceLogPayload, LoggerOptions, LLMCallContext, TokenUsage } from './types.js';

export class InferenceLogger {
  private client: IngestionClient;

  constructor(options: LoggerOptions = {}) {
    this.client = new IngestionClient(options);
  }

  /**
   * Generates a unique UUID v4.
   */
  private generateUuid(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Fast character-based token estimator (approx. 4 characters = 1 token).
   * Provides a fallback when the selected LLM provider fails to return token metadata.
   */
  public estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.max(1, Math.ceil(text.length / 4));
  }

  /**
   * Wrapper for standard (non-streaming) LLM completions.
   * Tracks latency, logs success/error status, handles metrics, and dispatches log asynchronously.
   */
  public async wrap<T>(
    context: LLMCallContext,
    fn: () => Promise<T>,
    extractOutputAndTokens: (response: T) => { output: string; usage?: Partial<TokenUsage> }
  ): Promise<T> {
    const logId = this.generateUuid();
    const startTime = performance.now();
    const timestamp = new Date().toISOString();

    try {
      const response = await fn();
      const endTime = performance.now();
      const latencyMs = Math.round(endTime - startTime);

      const { output, usage } = extractOutputAndTokens(response);

      const promptTokens = usage?.promptTokens ?? this.estimateTokens(context.inputPreview);
      const completionTokens = usage?.completionTokens ?? this.estimateTokens(output);
      const totalTokens = usage?.totalTokens ?? (promptTokens + completionTokens);

      const payload: InferenceLogPayload = {
        id: logId,
        conversationId: context.conversationId,
        messageId: context.messageId,
        model: context.model,
        provider: context.provider,
        latencyMs,
        tokenUsage: { promptTokens, completionTokens, totalTokens },
        status: 'success',
        inputPreview: context.inputPreview,
        outputPreview: output,
        timestamp,
      };

      this.client.log(payload);
      return response;
    } catch (error: any) {
      const endTime = performance.now();
      const latencyMs = Math.round(endTime - startTime);

      const payload: InferenceLogPayload = {
        id: logId,
        conversationId: context.conversationId,
        messageId: context.messageId,
        model: context.model,
        provider: context.provider,
        latencyMs,
        status: 'error',
        errorMessage: error?.message || String(error),
        inputPreview: context.inputPreview,
        timestamp,
      };

      this.client.log(payload);
      throw error;
    }
  }

  /**
   * Creates a reactive streaming telemetry session tracker.
   * Captures chunked texts, handles user stream cancellations, and tracks latency over the connection duration.
   */
  public createStreamTracker(context: LLMCallContext) {
    const logId = this.generateUuid();
    const startTime = performance.now();
    const timestamp = new Date().toISOString();
    let accumulatedText = '';
    let isFinished = false;

    return {
      id: logId,

      /**
       * Append standard streamed text chunk.
       */
      appendChunk: (text: string) => {
        if (isFinished) return;
        accumulatedText += text;
      },

      /**
       * Successfully finalize stream and calculate final metrics.
       */
      complete: (customUsage?: Partial<TokenUsage>) => {
        if (isFinished) return;
        isFinished = true;

        const latencyMs = Math.round(performance.now() - startTime);
        const promptTokens = customUsage?.promptTokens ?? this.estimateTokens(context.inputPreview);
        const completionTokens = customUsage?.completionTokens ?? this.estimateTokens(accumulatedText);
        const totalTokens = customUsage?.totalTokens ?? (promptTokens + completionTokens);

        const payload: InferenceLogPayload = {
          id: logId,
          conversationId: context.conversationId,
          messageId: context.messageId,
          model: context.model,
          provider: context.provider,
          latencyMs,
          tokenUsage: { promptTokens, completionTokens, totalTokens },
          status: 'success',
          inputPreview: context.inputPreview,
          outputPreview: accumulatedText,
          timestamp,
        };

        this.client.log(payload);
      },

      /**
       * Handle cancellation request (e.g. streaming stopped by user clicking cancel).
       * Accurately logs the truncated content accumulated so far with the "cancelled" status.
       */
      cancel: () => {
        if (isFinished) return;
        isFinished = true;

        const latencyMs = Math.round(performance.now() - startTime);
        const promptTokens = this.estimateTokens(context.inputPreview);
        const completionTokens = this.estimateTokens(accumulatedText);

        const payload: InferenceLogPayload = {
          id: logId,
          conversationId: context.conversationId,
          messageId: context.messageId,
          model: context.model,
          provider: context.provider,
          latencyMs,
          tokenUsage: {
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
          },
          status: 'cancelled',
          errorMessage: 'User cancelled stream generation',
          inputPreview: context.inputPreview,
          outputPreview: accumulatedText + ' [STREAM_CANCELLED_BY_USER]',
          timestamp,
        };

        this.client.log(payload);
      },

      /**
       * Record API/network connection failure during streaming process.
       */
      error: (error: any) => {
        if (isFinished) return;
        isFinished = true;

        const latencyMs = Math.round(performance.now() - startTime);
        const promptTokens = this.estimateTokens(context.inputPreview);
        const completionTokens = this.estimateTokens(accumulatedText);

        const payload: InferenceLogPayload = {
          id: logId,
          conversationId: context.conversationId,
          messageId: context.messageId,
          model: context.model,
          provider: context.provider,
          latencyMs,
          tokenUsage: {
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
          },
          status: 'error',
          errorMessage: error?.message || String(error),
          inputPreview: context.inputPreview,
          outputPreview: accumulatedText || undefined,
          timestamp,
        };

        this.client.log(payload);
      }
    };
  }
}
export { InferenceLogPayload, LoggerOptions, LLMCallContext, TokenUsage };
