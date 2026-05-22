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
    
    let buffer = '';
    let currentText = '';
    
    let braceCount = 0;
    let inString = false;
    let escapeNext = false;
    let startIdx = -1;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
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
                  process.stdout.write(contentText);
                }
              } catch (e) {
                console.error("\nFailed to parse chunk:", e);
              }
              buffer = buffer.substring(i + 1);
              i = -1;
              startIdx = -1;
            }
          }
        }
      }
    }
    console.log("\n\nAll text received:", currentText);
  } catch (err) {
    console.error("Error:", err);
  }
}

test();
