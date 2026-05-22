import { Router } from 'express';
import { prisma } from '../queue/worker.js';

const router = Router();

/**
 * GET /api/stats/dashboard
 * Aggregates logs database records to present rich charts, error percentages, latency distributions, and throughput speed trends.
 */
router.get('/dashboard', async (req, res) => {
  try {
    const logs = await prisma.inferenceLog.findMany({
      orderBy: { timestamp: 'asc' },
    });

    if (logs.length === 0) {
      return res.json({
        totalRequests: 0,
        successCount: 0,
        errorCount: 0,
        cancelledCount: 0,
        avgLatencyMs: 0,
        p95LatencyMs: 0,
        avgThroughputTokensSec: 0,
        modelBreakdown: [],
        providerBreakdown: [],
        timelinePoints: [],
        errorRate: 0,
      });
    }

    const totalRequests = logs.length;
    let successCount = 0;
    let errorCount = 0;
    let cancelledCount = 0;
    let totalLatency = 0;
    let totalThroughput = 0;
    let throughputCount = 0;

    const latencies: number[] = [];
    const modelStats: Record<string, { count: number; latency: number; provider: string }> = {};
    const providerStats: Record<string, { count: number; latency: number }> = {};

    // Select last 100 data points to plot timeline graph trends
    const timelinePoints = logs.slice(-100).map((log) => ({
      id: log.id,
      timestamp: log.timestamp.toISOString(),
      latencyMs: log.latencyMs,
      tokensPerSecond: log.tokensPerSecond,
      status: log.status,
      model: log.model,
      provider: log.provider,
    }));

    for (const log of logs) {
      if (log.status === 'success') {
        successCount++;
        if (log.tokensPerSecond > 0) {
          totalThroughput += log.tokensPerSecond;
          throughputCount++;
        }
      } else if (log.status === 'error') {
        errorCount++;
      } else if (log.status === 'cancelled') {
        cancelledCount++;
      }

      totalLatency += log.latencyMs;
      latencies.push(log.latencyMs);

      // Model grouping
      if (!modelStats[log.model]) {
        modelStats[log.model] = { count: 0, latency: 0, provider: log.provider };
      }
      modelStats[log.model].count++;
      modelStats[log.model].latency += log.latencyMs;

      // Provider grouping
      if (!providerStats[log.provider]) {
        providerStats[log.provider] = { count: 0, latency: 0 };
      }
      providerStats[log.provider].count++;
      providerStats[log.provider].latency += log.latencyMs;
    }

    // Sort latencies to find exact 95th Percentile (P95)
    latencies.sort((a, b) => a - b);
    const p95Index = Math.floor(latencies.length * 0.95);
    const p95LatencyMs = latencies[p95Index] || latencies[latencies.length - 1] || 0;

    const avgLatencyMs = Math.round(totalLatency / totalRequests);
    const avgThroughputTokensSec = throughputCount > 0 ? parseFloat((totalThroughput / throughputCount).toFixed(2)) : 0;
    const errorRate = parseFloat(((errorCount / totalRequests) * 100).toFixed(2));

    const modelBreakdown = Object.entries(modelStats).map(([name, data]) => ({
      name,
      provider: data.provider,
      count: data.count,
      avgLatencyMs: Math.round(data.latency / data.count),
    }));

    const providerBreakdown = Object.entries(providerStats).map(([name, data]) => ({
      name,
      count: data.count,
      avgLatencyMs: Math.round(data.latency / data.count),
    }));

    return res.json({
      totalRequests,
      successCount,
      errorCount,
      cancelledCount,
      avgLatencyMs,
      p95LatencyMs,
      avgThroughputTokensSec,
      modelBreakdown,
      providerBreakdown,
      timelinePoints,
      errorRate,
    });
  } catch (error: any) {
    console.error('[Dashboard Stats Exception]:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/stats/logs
 * Fetches raw inference logs with filters (provider, model, status, search string) and limits.
 */
router.get('/logs', async (req, res) => {
  try {
    const { provider, model, status, search, limit } = req.query;

    const whereClause: any = {};

    if (provider && provider !== 'all') {
      whereClause.provider = String(provider);
    }
    if (model && model !== 'all') {
      whereClause.model = String(model);
    }
    if (status && status !== 'all') {
      whereClause.status = String(status);
    }
    
    if (search) {
      const searchStr = String(search);
      whereClause.OR = [
        { inputPreview: { contains: searchStr } },
        { outputPreview: { contains: searchStr } },
        { errorMessage: { contains: searchStr } },
      ];
    }

    const queryLimit = limit ? parseInt(String(limit)) : 100;

    const logs = await prisma.inferenceLog.findMany({
      where: whereClause,
      orderBy: { timestamp: 'desc' },
      take: queryLimit,
    });

    return res.json(logs);
  } catch (error: any) {
    console.error('[Logs Fetch Exception]:', error);
    return res.status(500).json({ error: error.message });
  }
});

export default router;
