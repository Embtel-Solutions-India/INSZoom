const DEFAULT_MODEL = process.env.GEMINI_DOCUMENT_MODEL || process.env.GEMINI_MODEL || "gemini-flash-latest";

function apiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
}

function stripJson(text = "") {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  return start >= 0 && end >= start ? candidate.slice(start, end + 1) : candidate;
}

async function generateStructuredJson({ prompt, buffer, mimeType, model = DEFAULT_MODEL }) {
  const key = apiKey();
  if (!key) {
    const error = new Error("Gemini API key is not configured");
    error.statusCode = 503;
    throw error;
  }

  const parts = [{ text: prompt }];
  if (buffer) {
    parts.push({
      inlineData: {
        mimeType: mimeType || "application/octet-stream",
        data: Buffer.from(buffer).toString("base64"),
      },
    });
  }
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts,
        },
      ],
      generationConfig: {
        temperature: 0,
        topP: 0.1,
        responseMimeType: "application/json",
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `Gemini request failed with status ${response.status}`;
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }

  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  try {
    return JSON.parse(stripJson(text));
  } catch (error) {
    error.message = `Gemini returned invalid JSON: ${error.message}`;
    error.rawText = text;
    throw error;
  }
}

module.exports = {
  generateStructuredJson,
};
