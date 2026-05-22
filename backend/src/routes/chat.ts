import { Router } from 'express';
import { prisma } from '../queue/worker.js';
import { InferenceLogger } from 'llm-inference-sdk';

const router = Router();
const inferenceLogger = new InferenceLogger({
  ingestUrl: `http://127.0.0.1:${process.env.PORT || 5005}/api/logs/ingest`
});

/**
 * GET /api/chat/conversations
 * Lists all conversation sessions, sorted by last updated.
 */
router.get('/conversations', async (req, res) => {
  try {
    const conversations = await prisma.conversation.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    return res.json(conversations);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/chat/conversations
 * Instantiates a new chat session.
 */
router.post('/conversations', async (req, res) => {
  try {
    const { title } = req.body;
    const conversation = await prisma.conversation.create({
      data: {
        title: title || 'New Conversation',
        status: 'active',
      },
    });
    return res.status(201).json(conversation);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/chat/conversations/:id
 * Retrieves a single conversation session and its complete message history.
 */
router.get('/conversations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation session not found.' });
    }

    return res.json(conversation);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/chat/conversations/:id
 * Deletes a conversation and its messages.
 */
router.delete('/conversations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.conversation.delete({
      where: { id },
    });
    return res.json({ success: true, message: 'Conversation deleted.' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/chat/conversations/:id/cancel
 * Manually sets conversation status to cancelled.
 */
router.post('/conversations/:id/cancel', async (req, res) => {
  try {
    const { id } = req.params;
    const conversation = await prisma.conversation.update({
      where: { id },
      data: { status: 'cancelled' },
    });
    return res.json({ success: true, conversation });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/chat/message/stream
 * Server-Sent Events (SSE) streaming chat API endpoint.
 * Fully wrapped with SDK stream trackers.
 */
router.post('/message/stream', async (req, res) => {
  const { conversationId, message, provider, model } = req.body;

  if (!conversationId || !message || !provider || !model) {
    return res.status(400).json({ error: 'Missing conversationId, message, provider, or model parameters.' });
  }

  // 1. Store User Message in DB
  try {
    await prisma.message.create({
      data: {
        conversationId,
        role: 'user',
        content: message,
      },
    });

    // Touch conversation updated timestamp
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });
  } catch (dbErr: any) {
    return res.status(500).json({ error: 'Failed to record user message: ' + dbErr.message });
  }

  // 2. Setup SDK Stream Telemetry Tracker
  const tracker = inferenceLogger.createStreamTracker({
    model,
    provider,
    conversationId,
    inputPreview: message,
  });

  // 3. Configure Express SSE Headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let isClosed = false;

  const closeStream = async (status: 'complete' | 'cancelled' | 'error', errorObj?: any) => {
    if (isClosed) return;
    isClosed = true;

    const accumulatedResponse = currentText;

    if (status === 'complete') {
      tracker.complete();
      // Commit final assistant response to DB
      try {
        await prisma.message.create({
          data: {
            conversationId,
            role: 'assistant',
            content: accumulatedResponse,
          },
        });
      } catch (e) {
        console.error('Failed to commit response to DB:', e);
      }
    } else if (status === 'cancelled') {
      tracker.cancel();
      // Commit partial response indicating cancellation
      try {
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { status: 'cancelled' },
        });
        await prisma.message.create({
          data: {
            conversationId,
            role: 'assistant',
            content: accumulatedResponse + '\n\n_[Stream cancelled by user]_',
          },
        });
      } catch (e) {
        console.error('Failed to commit cancelled message to DB:', e);
      }
    } else {
      tracker.error(errorObj || new Error('Stream interrupted'));
      try {
        await prisma.message.create({
          data: {
            conversationId,
            role: 'assistant',
            content: accumulatedResponse + `\n\n_[Stream error: ${errorObj?.message || 'Interrupted'}]_`,
          },
        });
      } catch (e) {
        console.error('Failed to commit error message to DB:', e);
      }
    }

    res.write('event: done\ndata: [DONE]\n\n');
    res.end();
  };

  // Keep track of accumulated text
  let currentText = '';

  // Intercept client disconnect (cancellation / browser close)
  const handleCancel = () => {
    if (!isClosed) {
      console.log(`[Stream] Client disconnected conversation: ${conversationId}`);
      closeStream('cancelled');
    }
  };
  req.on('close', handleCancel);
  res.on('close', handleCancel);

  // 4. Retrieve recent conversation history context (limit to last 10 messages for short conversational context)
  let historyMessages: any[] = [];
  try {
    historyMessages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
  } catch (err) {
    console.error('Failed to fetch message history context:', err);
  }

  // Retrieve credentials from environment
  const geminiKey = process.env.GEMINI_API_KEY;
  const isGeminiAvailable = geminiKey && geminiKey !== 'YOUR_GEMINI_API_KEY' && geminiKey.trim().length > 10;

  const openaiKey = process.env.OPENAI_API_KEY;
  const isOpenAIAvailable = openaiKey && openaiKey !== 'YOUR_OPENAI_API_KEY_OPTIONAL' && openaiKey.trim().length > 10;

  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const isDeepSeekAvailable = deepseekKey && deepseekKey !== 'YOUR_DEEPSEEK_API_KEY_OPTIONAL' && deepseekKey.trim().length > 10;

  if (provider === 'google' && isGeminiAvailable) {
    try {
      // Connect to official Google Gemini stream Generate Content REST API
      let geminiModel = model || 'gemini-2.5-flash';
      if (geminiModel === 'gemini-1.5-flash') {
        geminiModel = 'gemini-2.5-flash';
      }
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:streamGenerateContent?key=${geminiKey}`;
      
      // Build context history for Gemini REST format
      const contents = historyMessages.map((msg) => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }));
      if (contents.length === 0) {
        contents.push({ role: 'user', parts: [{ text: message }] });
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: {
            maxOutputTokens: 1000,
          }
        }),
      });

      if (!response.ok) {
        throw new Error(`Gemini API responded with status: ${response.status} ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('Failed to get Gemini stream reader.');

      const decoder = new TextDecoder();
      let buffer = '';
      let braceCount = 0;
      let inString = false;
      let escapeNext = false;
      let startIdx = -1;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (isClosed) break;

        buffer += decoder.decode(value, { stream: true });
        
        for (let i = 0; i < buffer.length; i++) {
          const char = buffer[i];
          if (escapeNext) {
            escapeNext = false;
            continue;
          }
          if (char === '\\') {
            escapeNext = true;
            continue;
          }
          if (char === '"') {
            inString = !inString;
            continue;
          }
          if (!inString) {
            if (char === '{') {
              if (braceCount === 0) {
                startIdx = i;
              }
              braceCount++;
            } else if (char === '}') {
              braceCount--;
              if (braceCount === 0 && startIdx !== -1) {
                const objStr = buffer.substring(startIdx, i + 1);
                try {
                  const parsed = JSON.parse(objStr);
                  const contentText = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                  if (contentText) {
                    currentText += contentText;
                    tracker.appendChunk(contentText);
                    res.write(`data: ${JSON.stringify({ text: contentText })}\n\n`);
                  }
                } catch (e) {
                  // Ignore parsing error for incomplete chunks, collect more buffer
                }
                buffer = buffer.substring(i + 1);
                i = -1;
                startIdx = -1;
              }
            }
          }
        }
      }

      if (!isClosed) {
        await closeStream('complete');
      }
    } catch (err: any) {
      console.error('[Gemini Route Error]:', err);
      if (!isClosed) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
        await closeStream('error', err);
      }
    }
  } else if (provider === 'openai' && isOpenAIAvailable) {
    try {
      // Build context history for OpenAI format
      const formattedMessages = historyMessages.map((msg) => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      }));
      if (formattedMessages.length === 0) {
        formattedMessages.push({ role: 'user', content: message });
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: model || 'gpt-4o',
          messages: formattedMessages,
          stream: true,
          max_tokens: 1000
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API responded with status: ${response.status} - ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('Failed to get OpenAI stream reader.');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (isClosed) break;

        buffer += decoder.decode(value, { stream: true });
        
        let lineEndIdx;
        while ((lineEndIdx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.substring(0, lineEndIdx).trim();
          buffer = buffer.substring(lineEndIdx + 1);

          if (line.startsWith('data: ')) {
            const dataStr = line.substring(6).trim();
            if (dataStr === '[DONE]') {
              break;
            }
            try {
              const parsed = JSON.parse(dataStr);
              const contentText = parsed.choices?.[0]?.delta?.content;
              if (contentText) {
                currentText += contentText;
                tracker.appendChunk(contentText);
                res.write(`data: ${JSON.stringify({ text: contentText })}\n\n`);
              }
            } catch (e) {
              // Wait for more data chunks
            }
          }
        }
      }

      if (!isClosed) {
        await closeStream('complete');
      }
    } catch (err: any) {
      console.error('[OpenAI Route Error]:', err);
      if (!isClosed) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
        await closeStream('error', err);
      }
    }
  } else if (provider === 'deepseek' && isDeepSeekAvailable) {
    try {
      // Build context history for OpenAI/DeepSeek format
      const formattedMessages = historyMessages.map((msg) => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      }));
      if (formattedMessages.length === 0) {
        formattedMessages.push({ role: 'user', content: message });
      }

      // Map model target
      const targetModel = model === 'deepseek-coder' ? 'deepseek-coder' : (model || 'deepseek-chat');

      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${deepseekKey}`
        },
        body: JSON.stringify({
          model: targetModel,
          messages: formattedMessages,
          stream: true,
          max_tokens: 1000
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DeepSeek API responded with status: ${response.status} - ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('Failed to get DeepSeek stream reader.');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (isClosed) break;

        buffer += decoder.decode(value, { stream: true });
        
        let lineEndIdx;
        while ((lineEndIdx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.substring(0, lineEndIdx).trim();
          buffer = buffer.substring(lineEndIdx + 1);

          if (line.startsWith('data: ')) {
            const dataStr = line.substring(6).trim();
            if (dataStr === '[DONE]') {
              break;
            }
            try {
              const parsed = JSON.parse(dataStr);
              const contentText = parsed.choices?.[0]?.delta?.content;
              if (contentText) {
                currentText += contentText;
                tracker.appendChunk(contentText);
                res.write(`data: ${JSON.stringify({ text: contentText })}\n\n`);
              }
            } catch (e) {
              // Wait for more chunks
            }
          }
        }
      }

      if (!isClosed) {
        await closeStream('complete');
      }
    } catch (err: any) {
      console.error('[DeepSeek Route Error]:', err);
      if (!isClosed) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
        await closeStream('error', err);
      }
    }
  } else {
    // Elegant, highly realistic mock streaming generator for other providers
    try {
      const mockResponses: Record<string, string> = {
        'gpt-4o': `### Hello from GPT-4o! 🚀

As a highly scalable model from OpenAI, I can process complex prompts with low latency. Your conversation ID is \`${conversationId}\`. 

Here is some sample text demonstrating that I can render rich Markdown:
* **Real-time logs**: Captured seamlessly by the lightweight SDK wrapper.
* **PII Filter**: Enabled inside the ingestion server background queues.
* **Latency aggregates**: Plotted automatically in the premium analytics dashboard page.

Is there anything specific you would like to test about token throughput or latency calculations?`,

        'claude-3-5-sonnet': `### Greetings, human user! 🎭

This is Anthropic's Claude 3.5 Sonnet streaming back to you in real-time. I specialize in nuanced, high-quality reasoning and precise coding capability.

Since you are running this in a mock mode (no direct API key provided for Anthropic), I am showcasing our streaming performance using local scheduling:
1. **Server-Sent Events (SSE)** chunking.
2. **Cancellation listening** on request close signals.
3. **Throughput simulation** at an average rate of 45 tokens per second.

Let me know how I can assist with building the self-hosted Kubernetes setups next!`,

        'deepseek-coder': `### DeepSeek Coder V2 Stream Active 💻

Initializing developer agent sequence...
\`\`\`typescript
interface SystemTelemetry {
  status: "active" | "cancelled";
  latencyMs: number;
  tokensPerSecond: number;
}
\`\`\`

Logs are enqueued immediately using Redis or memory failovers. PII details (like emails, secret credentials, or credit cards) are auto-masked by the back-end processing thread before hitting the database table. 

Feel free to try writing credit card details in your next chat query to inspect the masking mechanism in the log viewer dashboard!`,

        'gemini-1.5-flash': `### Google Gemini 1.5 Flash (Simulated Stream) ⚡

You requested the Gemini Flash model! (If you have a real Gemini API Key, place it in your root \`.env\` file as \`GEMINI_API_KEY\` to activate direct live generations).

I am highly optimized for speed:
* **Context**: Handles short conversational windows easily.
* **Analytics**: Throughput calculations (tokens/sec) and P95 curves update dynamically as you message me.
* **Actions**: Click the **Cancel** button below during this stream to test partial SDK ingestion records.

What shall we construct next?`
      };

      const selectedResponse = mockResponses[model] || mockResponses['gemini-1.5-flash'];
      const words = selectedResponse.split(/(\s+)/); // Keep whitespace

      let wordIndex = 0;
      const interval = setInterval(async () => {
        if (isClosed) {
          clearInterval(interval);
          return;
        }

        if (wordIndex >= words.length) {
          clearInterval(interval);
          await closeStream('complete');
          return;
        }

        const chunkText = words[wordIndex];
        currentText += chunkText;
        tracker.appendChunk(chunkText);

        res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
        wordIndex++;
      }, 35); // 35ms per chunk for natural fluid streaming speed
    } catch (err: any) {
      if (!isClosed) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
        await closeStream('error', err);
      }
    }
  }
});

export default router;
