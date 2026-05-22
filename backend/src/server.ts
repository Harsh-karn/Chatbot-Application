import dotenv from 'dotenv';
// 1. Initialize environment variables before importing routers
dotenv.config();

import express from 'express';
import cors from 'cors';
import { initializeQueue } from './queue/worker.js';
import logsRouter from './routes/logs.js';
import chatRouter from './routes/chat.js';
import statsRouter from './routes/stats.js';

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares
app.use(cors());
app.use(express.json());

// 2. Initialize dual-mode Background Ingestion Queue
initializeQueue();

// 3. Register Namespace Routes
app.use('/api/logs', logsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/stats', statsRouter);

// Serve compiled static frontend assets in production
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '../../frontend/dist');
  app.use(express.static(distPath));
  // Catch-all route to serve Index.html for React router
  app.get(/^(?!\/api|\/health).*$/, (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Health probe
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development'
  });
});

// Fallback error middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Server Error Hook]:', err);
  res.status(500).json({
    success: false,
    error: err?.message || 'An unhandled backend application failure occurred.',
  });
});

// Start listening
app.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`🚀 Inference logging server active at port ${PORT}`);
  console.log(`   Health route: http://localhost:${PORT}/health`);
  console.log(`===================================================`);
});
