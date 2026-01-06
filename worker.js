export default {
  async fetch(request, env, ctx) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-BookMaker-Token",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: cors });

    try {
      // --- Auth ---
      const token = request.headers.get("X-BookMaker-Token") || "";
      if (!env.BOOKMAKER_TOKEN || token !== env.BOOKMAKER_TOKEN) {
        return json({ error: "AI access not authorized" }, 401, cors);
      }

      // --- Identify IP (best-effort) ---
      const ip =
        request.headers.get("cf-connecting-ip") ||
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        "unknown";

      // --- Rate limit: 30/day/IP (KV) ---
      if (!env.BOOKMAKER_LIMITS) {
        return json({ error: "Server misconfigured: BOOKMAKER_LIMITS missing" }, 500, cors);
      }

      const now = new Date();
      const ymd = now.toISOString().slice(0, 10); // YYYY-MM-DD UTC
      const limitKey = `ai:${ip}:${ymd}`;

      const countRaw = await env.BOOKMAKER_LIMITS.get(limitKey);
      const count = countRaw ? parseInt(countRaw, 10) : 0;

      if (count >= 30) {
        return json({ error: "Daily AI limit reached" }, 429, cors);
      }

      // TTL until end of UTC day
      const endOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
      const ttlSeconds = Math.max(60, Math.floor((endOfDay.getTime() - now.getTime()) / 1000));

      await env.BOOKMAKER_LIMITS.put(limitKey, String(count + 1), { expirationTtl: ttlSeconds });

      // --- Parse request body ---
      const body = await request.json();
      const instruction = String(body.instruction || "").trim();
      const text = String(body.text || "").trim();
      const model = String(body.model || "gpt-5.2");

      if (!instruction || !text) {
        return json({ error: "Missing instruction or text" }, 400, cors);
      }

      const charCount = text.length;

      // --- Metrics (KV best-effort) ---
      ctx.waitUntil(incrementKV(env.BOOKMAKER_LIMITS, "metrics:requests", 1));
      ctx.waitUntil(incrementKV(env.BOOKMAKER_LIMITS, "metrics:chars", charCount));

      console.log(JSON.stringify({ ip, ymd, count: count + 1, charCount, model }));

      // --- OpenAI proxy (Responses API) ---
      if (!env.OPENAI_API_KEY) {
        return json({ error: "Server misconfigured: OPENAI_API_KEY missing" }, 500, cors);
      }

      const openaiRes = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: [
            {
              role: "system",
              content:
                "You are a professional book editor. Return ONLY the rewritten content as clean HTML paragraphs (<p>…</p>). No markdown fences. No commentary.",
            },
            {
              role: "user",
              content: `Instruction:\n${instruction}\n\nText:\n${text}`,
            },
          ],
          temperature: 0.7,
        }),
      });

      if (!openaiRes.ok) {
        const errText = await openaiRes.text();
        return json({ error: errText }, openaiRes.status, cors);
      }

      const data = await openaiRes.json();

      // Responses API commonly provides `output_text`
      const out =
        (data && typeof data.output_text === "string" && data.output_text) ||
        extractFromOutput(data) ||
        "";

      return json({ text: out.trim() }, 200, cors);
    } catch (e) {
      return json({ error: e?.message || "Unknown error" }, 500, cors);
    }
  },
};

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

async function incrementKV(kv, key, by) {
  try {
    const raw = await kv.get(key);
    const n = raw ? parseInt(raw, 10) : 0;
    await kv.put(key, String(n + by));
  } catch {
    // ignore
  }
}

function extractFromOutput(data) {
  try {
    const out = data?.output?.[0]?.content;
    if (!Array.isArray(out)) return "";
    return out.map((c) => c?.text || "").join("");
  } catch {
    return "";
  }
}
