# Monorepo Deployment Guide: Chatbot & Telemetry Ingestion System

This guide outlines the optimal strategies, configurations, and step-by-step procedures to deploy your LLM Inference Logging and Chatbot system to production.

---

## 🏗️ Architectural Options at a Glance

Because your monorepo contains a **static Vite React frontend** and a **stateful, real-time Express backend** (using Prisma DB, background PII queues, and SSE stream cancellations), you have three main deployment patterns:

| Option | Frontend Hosting | Backend Hosting | Database | Best For |
| :--- | :--- | :--- | :--- | :--- |
| **Option A (Recommended)** | **Vercel** (Static Edge) | **Render / Railway** (Persistent Node) | **Neon.tech** (Serverless Postgres) or **Prisma SQLite** | Maximum performance, low latency, and infinite frontend scale. |
| **Option B (Easiest)** | **Render / Railway** | **Render / Railway** (Combined) | **SQLite / Postgres** | 1-click, zero-config monorepo hosting using our pre-configured `Dockerfile` & `docker-compose`. |
| **Option C (Serverless)** | **Vercel** | **Vercel Functions** | **Neon.tech** (Serverless Postgres) | Pure serverless stack (with minor SSE and queue constraints). |

---

## 🌟 Option A: Frontend on Vercel + Backend on Render/Railway

This is the industry-standard architecture for modern full-stack single-page applications.

### Step 1: Make the Frontend API URL Configurable
To let your Vite app connect to a deployed backend instead of localhost, we make the base URL dynamic.

Create a new file `frontend/src/config.ts`:
```typescript
// Read VITE_API_URL in production, fallback to relative path (dev proxy) in development
export const API_BASE = import.meta.env.VITE_API_URL || '';
```

Then, update your API fetch routes (e.g. in `frontend/src/App.tsx`, `ChatWindow.tsx`, and `Dashboard.tsx`) to prepend `API_BASE`:
```typescript
import { API_BASE } from './config';
// Example fetch:
const res = await fetch(`${API_BASE}/api/chat/conversations`);
```

### Step 2: Deploy the Backend to Render or Railway
Both Render and Railway support persistent container hosts that handle long-running SSE streams seamlessly.

#### Deploying on Render (Free/Hobby Tier):
1. Create a free account on [Render.com](https://render.com).
2. Click **New +** and select **Web Service**.
3. Link your GitHub repository.
4. Set the following build settings:
   * **Root Directory**: `backend` (or leave blank and use build commands from root)
   * **Runtime**: `Node`
   * **Build Command**: `npm install && npx prisma generate && npm run build`
   * **Start Command**: `node dist/server.js`
5. Under **Environment Variables**, add:
   * `GEMINI_API_KEY`: `AIzaSy...` (your key)
   * `OPENAI_API_KEY`: `sk-proj-...` (your key)
   * `DEEPSEEK_API_KEY`: `sk-fb75...` (your key)
   * `DATABASE_URL`: Set up a persistent SQLite volume path or connect to a free Postgres database (e.g. `postgresql://...` from Neon).

#### Deploying on Railway (Fastest Setup):
1. Sign up on [Railway.app](https://railway.app).
2. Click **New Project** -> **Deploy from GitHub**.
3. Select your repository.
4. Railway will automatically detect the monorepo. Under settings, select the `backend` workspace or point the build context to `backend/`.
5. Set your environment variables in the variables tab and click **Deploy**.

---

### Step 3: Deploy the Frontend to Vercel
Vercel is the ultimate host for Vite static assets.

1. Go to [Vercel.com](https://vercel.com) and click **Add New** -> **Project**.
2. Select your `Chatbot-Application` GitHub repository.
3. In the **Configure Project** settings:
   * **Framework Preset**: `Vite`
   * **Root Directory**: Select `frontend`
   * **Build Command**: `npm run build`
   * **Output Directory**: `dist`
4. Expand **Environment Variables** and add:
   * `VITE_API_URL`: `https://your-backend-render-url.onrender.com` (no trailing slash)
5. Click **Deploy**. Vercel will build and launch your premium dark-mode interface at a secure `.vercel.app` domain!

---

## 📦 Option B: 1-Click Container Deployment (Render/Railway)

Since we have already configured a robust production `Dockerfile` and `docker-compose.yml` in the root workspace, you can deploy both backend and frontend as a unified container in 1 click:

1. Create a **Web Service** on Render or a new deployment slot on Railway.
2. Select **Docker** as the environment (instead of Node).
3. The platform will automatically parse the root `Dockerfile`, build the Vite assets, serve them statically, run database migrations, and activate the Express ingestion engine on a single unified URL.
4. Set your LLM keys in the settings and you are fully online!

---

## ⚡ Option C: Pure Serverless Vercel Deployment

If you want to host both the Frontend and Backend on Vercel:

> [!CAUTION]
> **Important Ephemeral Database Warning**:
> Vercel's execution containers are serverless and spin down when idle. If you use the default **SQLite file** database (`dev.db`), **your chat history and telemetry logs will be wiped out frequently**.
> To prevent this, you **MUST** use an external cloud database like a free **Neon Postgres** database.

### Step 1: Create a Free Neon.tech Postgres Database
1. Go to [Neon.tech](https://neon.tech) and create a free serverless database.
2. Copy your transaction connection string (e.g., `postgresql://...`).

### Step 2: Configure Serverless Functions for Vercel
Vercel looks for a root-level `api/` folder to host Node serverless functions.

1. Create a directory `api/` in your workspace root.
2. Create an `api/index.js` file to bridge Vercel requests to your Express app:
```javascript
const express = require('express');
const app = require('../backend/dist/server.js'); // Point to compiled express app
module.exports = app;
```
3. Create a root `vercel.json` file to route requests to the static frontend and the backend serverless endpoints:
```json
{
  "version": 2,
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/index.js" },
    { "source": "/(.*)", "destination": "/frontend/dist/$1" }
  ]
}
```

### Step 3: Trigger Vercel Deploy
Push these deployment files to GitHub. Vercel will build the frontend statically, register the serverless Express api endpoint, and run your project seamlessly. Ensure you add `DATABASE_URL` pointing to your Neon database as a Vercel Environment Variable.
