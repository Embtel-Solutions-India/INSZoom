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
  const requestBody = JSON.stringify({
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
    });

  // Google answers 503 "high demand" / 429 in short bursts. Those are temporary, so retry with backoff before giving up -
  // otherwise one busy moment fails a whole document scan.
  const RETRYABLE = new Set([429, 500, 502, 503, 504]);
  const attempts = Math.max(1, Number(process.env.GEMINI_MAX_ATTEMPTS || 5));
  let response;
  let payload;
  // every attempt has a deadline (AbortController): a Gemini call that never answers must not hang a document scan, a queue worker or an AI job forever.
  // A timeout or a dropped connection is retried like a 503; after the last attempt it fails with a clear 504.
  const timeoutMs = Math.max(1000, Number(process.env.GEMINI_TIMEOUT_MS || 90000));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
        signal: controller.signal,
      });
      payload = await response.json().catch(() => ({}));
    } catch (networkError) {
      const timedOut = controller.signal.aborted || networkError?.name === "AbortError";
      if (attempt === attempts) {
        const error = new Error(timedOut ? `Gemini did not answer within ${Math.round(timeoutMs / 1000)}s` : `Gemini request failed: ${networkError?.message || "network error"}`);
        error.statusCode = timedOut ? 504 : 503;
        throw error;
      }
      response = null;
      await new Promise((resolve) => setTimeout(resolve, Math.min(2000 * attempt, 10000)));
      continue;
    } finally {
      clearTimeout(timer);
    }
    if (response.ok || !RETRYABLE.has(response.status) || attempt === attempts) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(2000 * attempt, 10000)));
  }
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
