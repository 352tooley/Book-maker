export default {
  async fetch(request, env) {
    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, X-BookMaker-Token",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Only allow POST
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    try {
      // Check auth token
      const token = request.headers.get("X-BookMaker-Token");
      if (!token || token !== env.BOOKMAKER_TOKEN) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: corsHeaders }
        );
      }

      // Rate limiting by IP
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
      const rateLimitKey = `ratelimit:${ip}:${today}`;

      const currentCount = await env.USAGE_KV.get(rateLimitKey);
      const count = currentCount ? parseInt(currentCount) : 0;

      if (count >= 30) {
        return new Response(
          JSON.stringify({ error: "Daily limit reached (30 requests/day)" }),
          { status: 429, headers: corsHeaders }
        );
      }

      // Parse request
      const body = await request.json();
      const { model, instruction, text } = body;

      if (!text || !instruction) {
        return new Response(
          JSON.stringify({ error: "Missing text or instruction" }),
          { status: 400, headers: corsHeaders }
        );
      }

      // Call OpenAI
      const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model || "gpt-4",
          messages: [
            {
              role: "system",
              content: "You are a professional book editor. Return only the rewritten text. No quotes. No commentary.",
            },
            {
              role: "user",
              content: `Instruction: ${instruction}\n\nText:\n${text}`,
            },
          ],
          temperature: 0.7,
        }),
      });

      if (!openaiRes.ok) {
        const errText = await openaiRes.text();
        return new Response(
          JSON.stringify({ error: errText }),
          { status: openaiRes.status, headers: corsHeaders }
        );
      }

      const data = await openaiRes.json();
      const output = data?.choices?.[0]?.message?.content || "";

      // Increment rate limit
      await env.USAGE_KV.put(rateLimitKey, (count + 1).toString(), {
        expirationTtl: 86400 * 2, // 2 days
      });

      // Log usage metrics
      const metricsKey = `metrics:${today}`;
      const metrics = await env.USAGE_KV.get(metricsKey);
      const metricsObj = metrics ? JSON.parse(metrics) : { requests: 0, ips: {} };
      metricsObj.requests++;
      metricsObj.ips[ip] = (metricsObj.ips[ip] || 0) + 1;
      await env.USAGE_KV.put(metricsKey, JSON.stringify(metricsObj), {
        expirationTtl: 86400 * 30, // 30 days
      });

      return new Response(
        JSON.stringify({ text: output.trim() }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err.message }),
        { status: 500, headers: corsHeaders }
      );
    }
  },
};
