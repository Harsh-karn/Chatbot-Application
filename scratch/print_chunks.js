const geminiKey = "AIzaSyAIpxwi7WkqQUl0hjwoVMktRlGINatd5n8";
const geminiModel = "gemini-2.5-flash";
const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:streamGenerateContent?key=${geminiKey}`;

async function test() {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Write a 3-sentence greeting." }] }],
      }),
    });
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    let chunkCount = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunkCount++;
      const text = decoder.decode(value, { stream: true });
      console.log(`--- Chunk #${chunkCount} ---`);
      console.log(text);
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

test();
