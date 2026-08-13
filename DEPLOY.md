# 萌宠搞笑工作台 · Cloudflare Pages 部署指南（免费）

## 为什么部署到 Pages 而不是只用 Worker

- `*.workers.dev` 在中国大陆被 GFW 定点 TCP 阻断 → AI 灵感/视角调不通。
- `*.pages.dev` 走 Cloudflare 边缘，国内大多可达（远稳于 workers.dev）。
- 本方案把 **AI 代理写成 Pages Functions（`/llm`）**，与页面**同源**：
  页面在 `xxx.pages.dev`，AI 走 `xxx.pages.dev/llm` → 不再依赖 `*.workers.dev`，
  **彻底绕开 GFW，国内直连即可用 AI 灵感 / AI 视角**。

## 部署包内容（本目录 `petfun-pages/`）

```
petfun-pages/
├── index.html              # 单文件应用（已内置「代理留空→同源 /llm」兜底）
├── functions/
│   ├── llm.js              # Pages Functions：同源 AI 代理（Workers AI）
│   └── _routes.json        # 路由：仅 /llm 走函数，其余静态
├── wrangler.toml           # Pages 项目配置（含 Workers AI 绑定）
└── DEPLOY.md               # 本文件
```

## 方式一：Wrangler 命令行部署（推荐，一键）

在你**自己的电脑**上（需要 Node.js ≥ 18）：

```bash
# 1. 进入部署包目录
cd petfun-pages

# 2. 安装并登录 Wrangler（浏览器跳 Cloudflare 授权，用你已有账户）
npm install -g wrangler
wrangler login

# 3. 部署（首次会让你输入项目名，随意，如 petfun-workbench）
wrangler pages deploy .
```

部署成功会返回形如 `https://petfun-workbench.pages.dev` 的地址。

### 关键一步：绑定 Workers AI（否则 AI 仍不可用）

部署后在 **Cloudflare 控制台 → Pages → 你的项目 → 设置 → 函数 → Workers AI 绑定**
添加：
- 变量名：`AI`
- 类型：Workers AI（免费）

保存后**重新部署一次**（`wrangler pages deploy .` 或控制台点「重新部署」）。

## 方式二：Connect GitHub 自动部署（长期推荐）

> ⚠️ **不要选 Dashboard 里的 "Upload your static files"** —— 那是纯静态上传，
> 会忽略 `functions/llm.js`，部署后 `/llm` 永远 404。要带 Functions 必须用
> Wrangler CLI 或连 Git 仓库。

步骤：

1. **GitHub 建仓库**（如 `petfun-pages`），把 `petfun-pages/` 整个目录内容 push 上去
   （**注意：根目录直接放 `index.html` 和 `functions/`，不要多套一层子目录**）。
   ```bash
   cd petfun-pages
   git init && git add . && git commit -m "init"
   git branch -M main
   git remote add origin https://github.com/你的用户名/petfun-pages.git
   git push -u origin main
   ```
2. 在截图里点 **Connect GitHub** → 选你刚才建的仓库 → 点开始设置
3. **构建设置**：构建命令留空、构建输出目录留空（项目根直接就是静态 + Functions）
4. 保存并部署 → 拿到 `xxx.pages.dev`
5. 同样「关键一步」绑定 Workers AI 后重新部署

> 之后每次 `git push` 都会自动部署，不需要手动上传。

## 方式三：连 Git 自动部署（长期推荐）

把 `petfun-pages/` 推到 GitHub 仓库，在 Cloudflare Pages 选「连接 Git 仓库」，
构建命令留空、输出目录留空（纯静态 + Functions），每次 push 自动更新。

## 验证

部署并绑定 AI 后，浏览器打开 `https://你的项目.pages.dev/llm`（GET）：

期待返回：
```json
{ "ok": true, "service": "petfun-pages-functions", "ts": 1723..., "workersAI": true }
```

`workersAI: true` 即 AI 已就绪。回到应用首页：
- 配置中心 → 代理地址**留空**（自动走同源 /llm）
- AI 接入开关开启、provider 选「Workers AI」
- 跑流水线 → ✨ AI 灵感 / 💡 AI 视角 自动出现

## 与原 Worker 的关系

- 原 `spring-sun-af16.workers.dev` 可保留（海外用户或备用），国内主用 Pages 同源。
- 若日后要接豆包/DeepSeek（需 key），仍走独立 Worker（`proxy-worker.js`），
  Pages 版 `/llm` 仅服务免 key 的 Workers AI。

## 费用

- Cloudflare Pages：免费额度极大（每日 500 次构建、无限静态请求）。
- Workers AI：每月 10,000 次免费额度（本应用轻量调用，个人使用基本不超）。
- 无信用卡强制要求（绑定卡仅用于超额保护，不扣费）。
