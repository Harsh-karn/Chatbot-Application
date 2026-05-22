# InferenceTelemetry 📡

A lightweight, high-performance, and event-driven LLM inference logging and ingestion system. Built using a monorepo workspace containing a TypeScript Logging SDK, an Express background ingestion API pipeline, and a glowing custom dark-mode Chatbot UI and live Analytics Dashboard.

---

## 🚀 Key Features

*   **Multi-Turn Streaming Chatbot**: Supports Server-Sent Events (SSE) streaming responses from Google Gemini (native) or OpenAI, Anthropic, and DeepSeek (simulated), featuring conversation history listings, resuming past chats, and reactive stream cancellation midway.
*   **Lightweight Telemetry SDK**: A fire-and-forget, non-blocking telemetry wrapper capturing exact latencies, token counts, providers, model properties, status errors, and input/output text previews.
*   **Event-Driven Ingestion Pipeline**: Implements a highly resilient queue architecture using **Redis + BullMQ** for parallel processing, automatically falling back to a reactive local In-Memory FIFO Queue when running without dependencies.
*   **Automatic PII Redaction Worker**: Ingested log texts are scrubbed in the background prior to database serialization, masking credit cards (Luhn filtering), emails, US SSNs, and exposed API keys/secrets.
*   **Dual-Database Strategy**: Transparency is maintained across **SQLite** (default zero-dependency local host run) and **PostgreSQL** (production standard) using Prisma ORM migrations.
*   **Glowing Analytics Dashboard**: Dynamic responsive charts measuring average/P95 processing latency, token speed throughput, success/error gauges, load distributions, and a searchable logs explorer featuring colorized PII redaction labels.
*   **Self-Hosted Deployments**: Ships with instant-on Docker Compose orchestrations and enterprise-grade Kubernetes YAML manifests.

---

## 📐 System Architecture

```
                    ┌──────────────────────────────┐
                    │  React Dashboard & Chat UI   │
                    └──────────────┬───────────────┘
                                   │
                      (Streaming SSE Chat & Stats)
                                   ▼
                    ┌──────────────────────────────┐
                    │      Express Backend API     │
                    └──────────────┬───────────────┘
                                   │
                           (LLM Router / SDK)
                                   ▼
                    ┌──────────────────────────────┐
                    │    Ingestion Queue Endpoint  │
                    └──────────────┬───────────────┘
                                   │
                         (Enqueue Log Payload)
                                   ▼
                    ┌──────────────────────────────┐
                    │     Redis Queue (BullMQ)     │
                    │   [Fallback: Memory Queue]   │
                    └──────────────┬───────────────┘
                                   │
                            (Worker Thread)
                                   ▼
                    ┌──────────────────────────────┐
                    │     PII Redactor Engine      │
                    └──────────────┬───────────────┘
                                   │
                          (Prisma Relational)
                                   ▼
                    ┌──────────────────────────────┐
                    │  SQLite (Dev) / Postgres (Prod)
                    └──────────────────────────────┘
```

### Ingestion & Logging Strategy

1.  **Non-Blocking Telemetry**: The client-side SDK wraps LLM generation calls using high-resolution performance timers. Once completed, it invokes a standard HTTP POST to `/api/logs/ingest` in a non-blocking `fetch` request, completely decoupling logging overhead from the chat response latency.
2.  **Event Queue Buffering**: When logs hit `/api/logs/ingest`, the server validates the schema and enqueues the raw payload to the BullMQ Redis queue immediately, returning `202 Accepted` to the client.
3.  **Background Processing & Sanitization**: The queue worker picks up the job asynchronously, scans input and output text fields to redact sensitive PII (emails, cards, SSNs, secrets), computes the `tokensPerSecond` processing rate, and upserts the clean audit trail into the database.

---

## 🗄️ Database Schema Design

We leverage a relational model using Prisma ORM to maintain data integrity and support complex metrics aggregation.

```prisma
// Represents a multi-turn chat session
model Conversation {
  id        String         @id @default(uuid())
  title     String
  status    String         @default("active") // active | cancelled
  createdAt DateTime       @default(now())
  updatedAt DateTime       @updatedAt
  messages  Message[]
  logs      InferenceLog[]
}

// Stores individual conversation messages
model Message {
  id             String       @id @default(uuid())
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  role           String       // user | assistant
  content        String
  createdAt      DateTime     @default(now())
}

// Captures sanitized inference logs & telemetry metadata
model InferenceLog {
  id               String       @id // Unique UUID supplied by SDK
  conversationId   String
  conversation     Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  model            String
  provider         String
  latencyMs        Int
  promptTokens     Int
  completionTokens Int
  totalTokens      Int
  tokensPerSecond  Float        // Speed throughput: (completionTokens / (latencyMs / 1000))
  status           String       // success | error | cancelled
  errorMessage     String?
  inputPreview     String       // PII Redacted user prompt
  outputPreview    String?      // PII Redacted model response
  timestamp        DateTime
  metadata         String?      // Optional custom JSON configurations

  @@index([timestamp])
  @@index([model])
  @@index([provider])
}
```

### Schema Decisions & Tradeoffs:
*   **UUID Mapping**: The SDK generates a unique UUID `id` on the client side. The ingestion service uses this ID as the database primary key. This prevents duplicate log writes (idempotency) if network retries occur.
*   **Sanitized Previews**: Prompt and completion previews are stored in the `InferenceLog` table *after* PII redaction. The raw text remains in the transient `Message` table for active chat history, but the permanent logs are fully scrubbed to ensure compliance.
*   **Database Indexes**: Heavy read indexes are configured on `timestamp`, `model`, and `provider` columns to guarantee sub-millisecond aggregations inside the dashboard at scale.

---

## 🛠️ Setup & Execution

### Prerequisites
*   **Node.js**: v20 or v22
*   **NPM**: Workspace-compliant package manager
*   **Docker & Docker Compose** (Optional, for production containers)

---

### Option A: Zero-Dependency Host Setup (Local Dev)
The application is pre-configured to run with SQLite on your host machine out of the box, requiring zero external server configuration.

1.  **Configure Environment**:
    Create a `.env` file in the root directory (a pre-configured template is already in place):
    ```bash
    PORT=5000
    DATABASE_URL="file:./dev.db"
    GEMINI_API_KEY="your_api_key_here"  # Optional, native streaming runs if key is valid
    ```

2.  **Bootstrap Packages**:
    Run from the root directory to install dependencies for all workspaces:
    ```bash
    npm install
    ```

3.  **Build the Logging SDK**:
    ```bash
    npm run build:sdk
    ```

4.  **Run Database Migrations**:
    Apply structural tables directly to the SQLite local database file:
    ```bash
    npx prisma migrate dev --name init --schema=./backend/prisma/schema.prisma
    ```

5.  **Start Services**:
    This will spin up both the Vite React dashboard (on Port 3000) and the Express backend (on Port 5000) in concurrent watch modes:
    ```bash
    # Tab 1: Start Backend server
    npm --workspace=backend run dev

    # Tab 2: Start Frontend dashboard
    npm --workspace=frontend run dev
    ```

6.  **Access App**:
    Open [http://localhost:3000](http://localhost:3000) in your web browser.

---

### Option B: Docker Compose Setup (Production Ready)
Orchestrates PostgreSQL, Redis, and our unified monorepo into a one-command production configuration.

1.  **Ensure host environmental values are mapped**:
    ```bash
    export GEMINI_API_KEY="your_gemini_key_here"
    ```

2.  **Launch Compose**:
    ```bash
    docker-compose up --build
    ```
    *This command compiles the monorepo inside a multi-stage Alpine node runner, spins up the secure PostgreSQL database, launches Redis, sets up health-checks, executes Prisma migrations, and exposes the full-stack portal at [http://localhost:5000](http://localhost:5000).*

---

### Option C: Self-Hosted Kubernetes (k8s/)
Kubernetes manifests are organized inside the `k8s/` directory.

1.  **Create Secrets**:
    ```bash
    kubectl create secret generic llm-secrets \
      --from-literal=gemini-api-key="your_gemini_api_key" \
      --from-literal=openai-api-key="optional_openai_key" \
      --from-literal=anthropic-api-key="optional_anthropic_key"
    ```

2.  **Deploy manifests**:
    ```bash
    kubectl apply -f k8s/deployment-postgres.yaml
    kubectl apply -f k8s/deployment-redis.yaml
    kubectl apply -f k8s/deployment-app.yaml
    kubectl apply -f k8s/ingress.yaml
    ```

---

## ⚖️ Tradeoffs Made & Architectural Reasoning

1.  **Dual Ingestion Queue Fallback**:
    In production environments, high volumes of telemetry data necessitate a durable broker like Redis with `BullMQ` to handle concurrent tasks, prevent database locking, and retry failed operations. However, requesting Redis as a hard requirement makes local developer setup friction-heavy. 
    *Decision*: We implemented a dynamic check. If `REDIS_URL` is omitted, the system registers an in-memory queue fallback, achieving zero-dependency local runs while scaling smoothly to enterprise message buses.

2.  **Luhn Algorithm Filter in Credit Card scrubbing**:
    Simple 16-digit regex sweeps risk blocking harmless integers (e.g. tracking keys, phone numbers, or file sizes). 
    *Decision*: We developed a length and formatting check that intercepts matched numeric arrays and only masks strings that fit active payment card structures.

3.  **SSE Streaming Client-Disconnect Hooks**:
    Streaming connections run the risk of leaking sockets if clients close tabs during inference, resulting in orphaned backend threads.
    *Decision*: The backend monitors the Express connection `close` event. If the client disconnects or clicks the cancel button, the SDK stream controller immediately registers an abort sequence, stops generating, compiles the partial content generated so far, and logs the operation as `cancelled` in the database.

---

## 🔮 What I Would Improve With More Time

1.  **Dynamic Token Tokenization**: Currently, the system uses a highly performant average estimate (`1 token ≈ 4 characters`) for simulated models. While highly accurate for long texts, integrating `tiktoken` (OpenAI) or native Gemini tokenization APIs directly in the background worker would improve metrics precision.
2.  **Distributed Trace ID (OpenTelemetry)**: Integrate OpenTelemetry standards (`W3C Trace Context`) to propagate trace IDs across downstream backend microservices, allowing unified tracing of complex chained LLM agent systems.
3.  **Vector Store Integration**: Store message embeddings to provide a semantic logs search engine inside the analytics explorer.
