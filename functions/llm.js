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

// 兼容两种 Workers AI 响应格式：
//   ① qwq 等推理模型：r.response 是字符串（可能夹带思维链）
//   ② glm/llama/gpt-oss 等 OpenAI 兼容模型：r.choices[0].message.content 是答案，
//                                            r.choices[0].message.reasoning 是思维过程
function extractAssistantText(r) {
  if (!r) return '';
  // ① 字符串式响应（qwq 风格）
  if (typeof r.response === 'string') return r.response;
  if (typeof r.text === 'string') return r.text;
  // ② OpenAI Chat Completions 风格：content 优先，reasoning 兜底
  const msg = r.choices && r.choices[0] && r.choices[0].message;
  if (msg) return msg.content || msg.reasoning || '';
  return '';
}

// 对 qwq 系列的 r.response 串做思维链剥离（其它模型的 content 已天然干净，无需剥离）
function stripReasoning(model, text) {
  if (!text) return text;
  const m = text.match(/<\/think>\s*([\s\S]*)$/i);
  if (m) return m[1].trim();
  if (/qwq/.test(model)) {
    const lines = text.split(/\n+/).map(s => s.trim()).filter(Boolean);
    const thinkHead = /^(好的|首先|其次|然后|可能|我们|让我|用户|思考|分析|综上|所以|应该|考虑到|需要|这里|比如|回到|不过|如果|因此|那|这)/;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!thinkHead.test(lines[i]) && lines[i].length >= 4) return lines[i];
    }
    return lines[lines.length - 1] || text;
  }
  return text;
}

// 仅放行白名单内开源模型，避免被滥用调用任意模型（与 proxy-worker.js 白名单一致）。
// 仅放行 Workers AI 上**真实存在**的模型（已通过 Cloudflare 官方文档核实 ID）。
// 优先非推理模型；reasoning 类模型（qwen3/qwq/gpt-oss/gemma-4）会先输出思维链，
// 容易触发 length 截断导致 content 为 null，故不放进默认白名单。
const ALLOWED_AI = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',         // 强·非推理·默认
  '@cf/qwen/qwen2.5-coder-32b-instruct',             // 中文稳·非推理
  '@cf/meta/llama-3.1-8b-instruct-fp8',              // 轻量·非推理
  '@cf/mistralai/mistral-small-3.1-24b-instruct',    // 24B
  '@cf/meta/llama-3.2-3b-instruct',                  // 轻量
  '@cf/zai-org/glm-4.7-flash',                       // 多语言（部分版本带 reasoning）
  '@cf/qwen/qwen3-30b-a3b-fp8',                      // 中文 reasoning
  '@cf/qwen/qwq-32b'                                 // 深度 reasoning
];
const DEFAULT_AI = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'; // 大尺寸非推理，出答案最稳

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
      // 推理模型（qwq）需要更大的上限才能把思维链跑完并给出最终答案；
      // 非推理模型用前端给的值（缺省 800）即可。
      const reqMax = Number(payload.max_tokens) || 0;
      const maxTokens = /qwq/.test(model) ? Math.max(reqMax, 1200) : (reqMax || 800);
      const r = await env.AI.run(model, {
        messages: Array.isArray(payload.messages) ? payload.messages : [],
        max_tokens: maxTokens,
      });
      const rawText = extractAssistantText(r);
      const text = stripReasoning(model, rawText); // 剥离思维链，只留最终答案
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
