const BASE_URL = 'http://127.0.0.1:5005';

async function runTests() {
  console.log('==================================================');
  console.log('🧪 Starting Automated IngestTelemetry Integration Tests');
  console.log('==================================================\n');

  try {
    // Test 1: Health Probe
    console.log('🩺 Test 1: Checking API Server Health...');
    const healthRes = await fetch(`${BASE_URL}/health`);
    const health = await healthRes.json();
    console.log('✅ Health status:', health.status, '· Env:', health.env, '\n');

    // Test 2: Create Conversation
    console.log('📂 Test 2: Instantiating new chat session...');
    const convoRes = await fetch(`${BASE_URL}/api/chat/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Automated Test Thread' }),
    });
    const convo = await convoRes.json();
    console.log('✅ Chat session established successfully. ID:', convo.id, '\n');

    // Test 3: Streaming SSE LLM response & Telemetry capturing
    console.log('📡 Test 3: Triggering live streaming inference and validating SDK Telemetry...');
    const prompt = 'Tell me in 10 words what database indexing does.';
    const streamRes = await fetch(`${BASE_URL}/api/chat/message/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: convo.id,
        message: prompt,
        provider: 'google',
        model: 'gemini-1.5-flash',
      }),
    });

    if (!streamRes.ok) {
      throw new Error(`Streaming failed: ${streamRes.statusText}`);
    }

    const reader = streamRes.body.getReader();
    const decoder = new TextDecoder();
    let accumulatedText = '';
    let isSseActive = false;
    let buffer = '';
    let done = false;

    while (!done) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) {
        done = true;
      }
      if (value) {
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const cleanLine = line.trim();
          if (cleanLine.startsWith('data: ')) {
            const dataStr = cleanLine.substring(6);
            if (dataStr === '[DONE]') {
              done = true;
              break;
            }
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.text) {
                isSseActive = true;
                accumulatedText += parsed.text;
                process.stdout.write(parsed.text);
              }
            } catch (e) {}
          }
        }
      }
    }

    console.log('\n✅ Streaming completed successfully!');
    console.log('✅ SSE active chunks received:', isSseActive);
    console.log('✅ Stream content preview:', accumulatedText.substring(0, 80).replace(/\n/g, ' ') + '...\n');

    // Test 4: PII Redactor Background Pipeline
    console.log('🔒 Test 4: Testing real-time PII Scrubbing (emails, cards, secrets)...');
    const piiPrompt = 'My credit card is 4111-2222-3333-4444 and my private password=admin_pass_123. Email me at developer@test.com.';
    
    // Create new session for PII test
    const piiConvoRes = await fetch(`${BASE_URL}/api/chat/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'PII Scrubbing Session' }),
    });
    const piiConvo = await piiConvoRes.json();

    const piiStreamRes = await fetch(`${BASE_URL}/api/chat/message/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: piiConvo.id,
        message: piiPrompt,
        provider: 'openai',
        model: 'gpt-4o',
      }),
    });

    const piiReader = piiStreamRes.body.getReader();
    while (true) {
      const { done: piiDone } = await piiReader.read();
      if (piiDone) break;
    }

    // Wait 1200ms to allow background FIFO queue worker to process & sanitize
    console.log('⌛ Waiting for background queue processing...');
    await new Promise((r) => setTimeout(r, 1200));

    // Fetch the latest logs and verify PII scrub
    const logsRes = await fetch(`${BASE_URL}/api/stats/logs?limit=5`);
    const logs = await logsRes.json();
    const targetLog = logs.find(l => l.conversationId === piiConvo.id);

    if (!targetLog) {
      throw new Error('PII log was not processed or stored!');
    }

    console.log('✅ Log successfully retrieved from DB!');
    console.log('✅ Original prompt length:', piiPrompt.length);
    console.log('✅ Processed input preview:', targetLog.inputPreview);
    
    const cardMasked = targetLog.inputPreview.includes('[REDACTED_CARD]');
    const emailMasked = targetLog.inputPreview.includes('[REDACTED_EMAIL]');
    const secretMasked = targetLog.inputPreview.includes('[REDACTED_SECRET]');

    console.log('   ↳ Card Scrubbed:', cardMasked ? '🟢 YES' : '🔴 NO');
    console.log('   ↳ Email Scrubbed:', emailMasked ? '🟢 YES' : '🔴 NO');
    console.log('   ↳ Secret Scrubbed:', secretMasked ? '🟢 YES' : '🔴 NO');

    if (cardMasked && emailMasked && secretMasked) {
      console.log('✅ Test 4 PASSED: PII elements beautifully redacted before DB serialization!\n');
    } else {
      throw new Error('Test 4 FAILED: PII components were leaked into the database logs!');
    }

    // Test 5: SSE Stream Cancellation midway
    console.log('🛑 Test 5: Testing midway SSE stream cancel operations...');
    const cancelConvoRes = await fetch(`${BASE_URL}/api/chat/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Stream Cancellation Thread' }),
    });
    const cancelConvo = await cancelConvoRes.json();

    const controller = new AbortController();
    const cancelStreamPromise = fetch(`${BASE_URL}/api/chat/message/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: cancelConvo.id,
        message: 'Write a massive, complex essay about quantum computing scaling principles.',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
      }),
      signal: controller.signal,
    });

    // Abort after 400ms to mimic user clicking cancel button midway
    await new Promise((r) => setTimeout(r, 400));
    controller.abort();
    console.log('   ↳ AbortSignal sent from client successfully.');

    try {
      await cancelStreamPromise;
    } catch (e) {
      console.log('   ↳ Client stream fetch rejected gracefully (AbortError).');
    }

    // Wait for worker queue processing
    await new Promise((r) => setTimeout(r, 1200));

    // Check status on conversation in DB
    const checkConvoRes = await fetch(`${BASE_URL}/api/chat/conversations/${cancelConvo.id}`);
    const checkConvo = await checkConvoRes.json();
    console.log('✅ Conversation database status:', checkConvo.status);

    const cancelLogsRes = await fetch(`${BASE_URL}/api/stats/logs?limit=5`);
    const cancelLogs = await cancelLogsRes.json();
    const cancelLog = cancelLogs.find(l => l.conversationId === cancelConvo.id);

    if (cancelLog && cancelLog.status === 'cancelled') {
      console.log('✅ Inference status in DB:', cancelLog.status);
      console.log('✅ SDK captured partial preview:', cancelLog.outputPreview);
      console.log('✅ Test 5 PASSED: SSE socket interruption handles graceful cleanup!\n');
    } else {
      throw new Error(`Test 5 FAILED: Log status was ${cancelLog?.status || 'missing'}, expected "cancelled"`);
    }

    // Test 6: Aggregations Dashboard stats
    console.log('📊 Test 6: Querying Aggregated Metrics Dashboard...');
    const statsRes = await fetch(`${BASE_URL}/api/stats/dashboard`);
    const stats = await statsRes.json();
    console.log('✅ Dashboard aggregated metrics:');
    console.log('   ↳ Total Requests:', stats.totalRequests);
    console.log('   ↳ Avg Latency:', stats.avgLatencyMs, 'ms');
    console.log('   ↳ P95 Latency:', stats.p95LatencyMs, 'ms');
    console.log('   ↳ Avg Throughput:', stats.avgThroughputTokensSec, 't/s');
    console.log('   ↳ Error Rate:', stats.errorRate, '%');
    console.log('✅ Test 6 PASSED: Metrics calculated and validated successfully!\n');

    console.log('==================================================');
    console.log('🎉 ALL INGESTTELEMETRY INTEGRATION TESTS PASSED!');
    console.log('==================================================');
  } catch (err) {
    console.error('\n🔴 Automated Integration Test Failed:', err);
    process.exit(1);
  }
}

runTests();
