// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

interface ReqPayload {
  prompt: string;
  think?: boolean; // true=思考档（诊断用，更深但更慢）；否则快档（起名/建议）
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};

// DeepSeek（OpenAI 兼容）。model 统一 deepseek-v4-flash：
//   - 不传 thinking → 非思考模式，快，适合起名/建议这种短任务
//   - thinking:{type:"enabled"} → 思考模式，更深，适合诊断
// key 只存 Supabase secret DEEPSEEK_API_KEY，绝不硬编码。
const DS_URL = "https://api.deepseek.com/chat/completions";
const DS_MODEL = "deepseek-v4-flash";
const TIMEOUT_MS = 25000; // 超时快速失败，别干挂到 Edge Function 墙钟上限

console.info("ai relay (deepseek) started");

export default {
  fetch: withSupabase(
    { auth: ["publishable", "secret"] },
    async (req, _ctx) => {
      if (req.method === "OPTIONS") {
        return new Response("ok", { headers: cors });
      }

      try {
        const { prompt, think }: ReqPayload = await req.json();
        if (!prompt) {
          return Response.json(
            { error: "missing prompt" },
            { status: 400, headers: cors },
          );
        }

        const key = Deno.env.get("DEEPSEEK_API_KEY");
        if (!key) {
          return Response.json(
            { error: "DEEPSEEK_API_KEY not set" },
            { status: 500, headers: cors },
          );
        }

        const body: Record<string, unknown> = {
          model: DS_MODEL,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 2000,
          stream: false,
        };
        if (think) body.thinking = { type: "enabled" };

        // 超时控制：到点 abort，返回 timeout 而不是一直挂着
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

        let r: Response;
        try {
          r = await fetch(DS_URL, {
            method: "POST",
            signal: ctrl.signal,
            headers: {
              "Authorization": "Bearer " + key,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          });
        } catch (e) {
          clearTimeout(timer);
          const msg = (e instanceof Error && e.name === "AbortError")
            ? "timeout"
            : String(e);
          return Response.json({ error: msg }, { status: 504, headers: cors });
        }
        clearTimeout(timer);

        const data = await r.json().catch(() => null);
        if (!r.ok) {
          // 把上游真实报错透传给前端，别静默
          const upstream = data?.error?.message ?? data?.error ?? ("HTTP " + r.status);
          return Response.json({ error: String(upstream) }, { status: 502, headers: cors });
        }

        const choice = data?.choices?.[0];
        // 兜底：思考模式若正文进了 reasoning_content，也取出来
        const text = choice?.message?.content
          || choice?.message?.reasoning_content
          || "";
        const finish_reason = choice?.finish_reason ?? "";

        // content 空但被截断 → 明确告知，便于定位（历史上 max_tokens 太小会这样）
        if (!text && finish_reason === "length") {
          return Response.json(
            { text: "", finish_reason: "length" },
            { headers: cors },
          );
        }

        return Response.json({ text, finish_reason }, { headers: cors });
      } catch (e) {
        return Response.json(
          { error: String(e) },
          { status: 500, headers: cors },
        );
      }
    },
  ),
};
