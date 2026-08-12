/**
 * 萌宠搞笑工作台 · AI 代理（Cloudflare Pages Functions）
 *
 * 与页面同源部署：页面在 xxx.pages.dev，本函数暴露同源 /llm 端点，
 * 前端（index.html）在「代理地址留空」时自动 POST 到 /llm —— 彻底绕开
 * *.workers.dev 的 GFW 阻断，国内直连即可用 AI 灵感 / AI 视角。
 *
 * 部署后在 Pages 项目「设置 → 函数 → Workers AI 绑定」添加变量名 AI（免费）。
 */

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function json(body, status, extra) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(), ...(extra || {}) },
  });
}

// 仅放行白名单内开源模型，避免被滥用调用任意模型（与 proxy-worker.js 白名单一致）。
const ALLOWED_AI = [
  '@cf/qwen/qwen3-30b-a3b-fp8', '@cf/qwen/qwq-32b', '@cf/zai-org/glm-4.7-flash',
  '@cf/google/gemma-4-26b-a4b-it', '@cf/mistralai/mistral-small-3.1-24b-instruct',
  '@cf/meta/llama-3.2-3b-instruct', '@cf/openai/gpt-oss-20b',
  '@cf/qwen/qwen2.5-7b-instruct', '@cf/qwen/qwen2.5-72b-instruct'
];
const DEFAULT_AI = '@cf/qwen/qwen3-30b-a3b-fp8'; // 中文友好、免费额度内、活跃维护

// 预检
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// POST /llm —— 转发到 Workers AI（同源免 key）
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    let payload;
    try { payload = await request.json(); } catch (e) { return json({ error: 'invalid json' }, 400); }

    // Pages 部署版只服务 Workers AI（同源无 key）；其他厂商请在独立 Worker 中配置。
    const provider = (payload.provider || 'workersai').toLowerCase();
    if (provider !== 'workersai') {
      return json({ error: 'Pages 部署版仅支持 workersai（同源免 key）；豆包/DeepSeek/OpenAI 请在独立 Worker 配置' }, 400);
    }
    if (!env || !env.AI) {
      return json({ ok: false, error: 'Workers AI 未绑定：请在 Pages 项目设置 → 函数 → 绑定 Workers AI（变量名 AI）后重新部署' }, 500);
    }

    const m = (payload.model || '').trim();
    const model = ALLOWED_AI.includes(m) ? m : DEFAULT_AI;
    try {
      const r = await env.AI.run(model, { messages: Array.isArray(payload.messages) ? payload.messages : [] });
      const text = (r && (r.response || r.text)) || '';
      return json({ ok: true, text, model, raw: r }, 200);
    } catch (e) {
      return json({ ok: false, error: 'workers ai failed (' + model + '): ' + (e && e.message ? e.message : String(e)) }, 502);
    }
  } catch (e) {
    return json({ ok: false, error: 'llm crashed: ' + (e && e.message ? e.message : String(e)) }, 500);
  }
}

// GET /llm —— 健康检查（含 Workers AI 绑定状态）
export async function onRequestGet(context) {
  const { env } = context;
  return json({ ok: true, service: 'petfun-pages-functions', ts: Date.now(), workersAI: !!(env && env.AI) }, 200);
}
