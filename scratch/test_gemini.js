const geminiKey = "AIzaSyAIpxwi7WkqQUl0hjwoVMktRlGINatd5n8";
const geminiModel = "gemini-2.5-flash";
const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:streamGenerateContent?key=${geminiKey}`;

async function test() {
  console.log("Testing URL:", url);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Hello" }] }],
      }),
    });
    console.log("Status:", response.status, response.statusText);
    const text = await response.text();
    console.log("Response Body:", text.substring(0, 500));
  } catch (err) {
    console.error("Error:", err);
  }
}

test();
