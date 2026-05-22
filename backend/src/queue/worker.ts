import { PrismaClient } from '@prisma/client';
// @ts-ignore
import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { redactPII } from '../utils/pii.js';
import { InferenceLogPayload } from 'llm-inference-sdk';

const prisma = new PrismaClient();

// Dual-mode queue setup
let enqueueLog: (payload: InferenceLogPayload) => Promise<void>;

/**
 * Clean In-Memory Queue system.
 * Simulates asynchronous queuing for local runs where Redis is not present.
 */
class MemoryQueue {
  private queue: InferenceLogPayload[] = [];
  private processing = false;

  public async add(payload: InferenceLogPayload) {
    this.queue.push(payload);
    this.processNext();
  }

  private async processNext() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    const payload = this.queue.shift();
    if (payload) {
      try {
        await processInferenceLog(payload);
      } catch (err) {
        console.error('[Memory Queue] Failed to process log entry:', err);
      }
    }

    this.processing = false;
    this.processNext();
  }
}

/**
 * Processes a single inference log job:
 * 1. Sanitizes input/output logs using the PII Redactor
 * 2. Formulates telemetry and throughput math (tokens per second)
 * 3. Ensures the conversation thread exists (healing orphan records)
 * 4. Commits the fully parsed inference audit trail log to PostgreSQL/SQLite
 */
export async function processInferenceLog(payload: InferenceLogPayload) {
  // 1. Redact PII
  const cleanInput = redactPII(payload.inputPreview);
  const cleanOutput = payload.outputPreview ? redactPII(payload.outputPreview) : null;

  // 2. Throughput calculation
  const latencySec = payload.latencyMs / 1000;
  const completionTokens = payload.tokenUsage?.completionTokens || 0;
  const tokensPerSecond = latencySec > 0 ? parseFloat((completionTokens / latencySec).toFixed(2)) : 0;

  // 3. DB upsert transaction
  await prisma.$transaction(async (tx) => {
    // Resiliency: check if session exists, create a default session if sdk logs arrive orphaned
    let conversation = await tx.conversation.findUnique({
      where: { id: payload.conversationId },
    });

    if (!conversation) {
      conversation = await tx.conversation.create({
        data: {
          id: payload.conversationId,
          title: `Archived Session (${payload.model})`,
          status: payload.status === 'cancelled' ? 'cancelled' : 'active',
        },
      });
    }

    // Now insert/update the inference record
    await tx.inferenceLog.upsert({
      where: { id: payload.id },
      update: {},
      create: {
        id: payload.id,
        conversationId: payload.conversationId,
        model: payload.model,
        provider: payload.provider,
        latencyMs: payload.latencyMs,
        promptTokens: payload.tokenUsage?.promptTokens || 0,
        completionTokens: completionTokens,
        totalTokens: payload.tokenUsage?.totalTokens || 0,
        tokensPerSecond,
        status: payload.status,
        errorMessage: payload.errorMessage || null,
        inputPreview: cleanInput,
        outputPreview: cleanOutput,
        timestamp: new Date(payload.timestamp),
        metadata: payload.errorMessage 
          ? JSON.stringify({ error: payload.errorMessage }) 
          : JSON.stringify({ originalStatus: payload.status }),
      },
    });
  });
}

// Initialization hooks
let bullQueue: Queue | null = null;
let bullWorker: Worker | null = null;
let memoryQueueFallback: MemoryQueue | null = null;

export function initializeQueue() {
  const REDIS_URL = process.env.REDIS_URL;

  if (REDIS_URL) {
    try {
      console.log(`[Queue] Attempting Redis-backed BullMQ Queue initialization: ${REDIS_URL}`);
      
      const connection = new IORedis.default(REDIS_URL, {
        maxRetriesPerRequest: null,
      });

      bullQueue = new Queue('inference-logs', { connection });
      bullWorker = new Worker('inference-logs', async (job: Job) => {
        await processInferenceLog(job.data);
      }, { connection, concurrency: 5 });

      bullWorker.on('failed', (job: any, err: any) => {
        console.error(`[BullMQ Worker] Ingestion Task ${job?.id} failed:`, err);
      });

      enqueueLog = async (payload: InferenceLogPayload) => {
        if (bullQueue) {
          await bullQueue.add(payload.id, payload, {
            removeOnComplete: true,
            removeOnFail: { count: 1000 },
          });
        }
      };

      console.log('[Queue] BullMQ Redis worker pipeline successfully active.');
    } catch (error) {
      console.warn('[Queue] Redis initialization failed, mapping to local Memory Fallback:', error);
      setupMemoryFallback();
    }
  } else {
    console.log('[Queue] No REDIS_URL present. Enabling lightweight local Memory Queue fallback.');
    setupMemoryFallback();
  }
}

function setupMemoryFallback() {
  memoryQueueFallback = new MemoryQueue();
  enqueueLog = async (payload: InferenceLogPayload) => {
    if (memoryQueueFallback) {
      await memoryQueueFallback.add(payload);
    }
  };
}

export { enqueueLog };
export { prisma };
