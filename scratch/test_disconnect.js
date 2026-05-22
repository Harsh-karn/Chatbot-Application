const express = require('express');

const app = express();
app.post('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  console.log("Stream request started");

  req.on('close', () => {
    console.log("req close event fired");
  });
  req.on('aborted', () => {
    console.log("req aborted event fired");
  });
  res.on('close', () => {
    console.log("res close event fired");
  });
  res.on('finish', () => {
    console.log("res finish event fired");
  });

  const interval = setInterval(() => {
    res.write("data: hello\n\n");
  }, 100);

  setTimeout(() => {
    clearInterval(interval);
    res.end();
  }, 2000);
});

const server = app.listen(5099, async () => {
  console.log("Server listening on 5099");
  
  const controller = new AbortController();
  const resPromise = fetch("http://127.0.0.1:5099/stream", {
    method: 'POST',
    signal: controller.signal
  });

  setTimeout(() => {
    console.log("Aborting client request...");
    controller.abort();
  }, 500);

  try {
    await resPromise;
  } catch (e) {
    console.log("Fetch aborted in client");
  }

  setTimeout(() => {
    server.close();
  }, 1000);
});
