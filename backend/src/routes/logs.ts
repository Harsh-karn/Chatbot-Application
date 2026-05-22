import { Router } from 'express';
import { enqueueLog } from '../queue/worker.js';

const router = Router();

/**
 * POST /api/logs/ingest
 * Receives inference log payloads from the Lightweight SDK.
 * Executes simple schema checks, then enqueues logs for background processing.
 */
router.post('/ingest', async (req, res) => {
  try {
    const payload = req.body;

    // Simple schema validation
    if (
      !payload ||
      typeof payload.id !== 'string' ||
      typeof payload.conversationId !== 'string' ||
      typeof payload.model !== 'string' ||
      typeof payload.provider !== 'string' ||
      typeof payload.inputPreview !== 'string'
    ) {
      return res.status(400).json({
        success: false,
        error: 'Payload schema validation failed. Required properties missing.',
      });
    }

    // Handoff to background worker queue (asynchronous)
    await enqueueLog(payload);

    // Return 202 Accepted immediately
    return res.status(202).json({
      success: true,
      message: 'Log telemetry accepted and enqueued for validation & database ingestion.',
    });
  } catch (error: any) {
    console.error('[Ingest Router] Ingestion pipeline exception:', error);
    return res.status(500).json({
      success: false,
      error: `Internal logging system error: ${error.message}`,
    });
  }
});

export default router;
