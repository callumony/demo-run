# Deploying Agent-Omni to Railway

This guide walks you through deploying the agent as a public web app on Railway so anyone can access it via a URL.

---

## Prerequisites

- A [Railway](https://railway.app) account (free tier works for demos)
- Your code pushed to a GitHub repository
- Your `OPENAI_API_KEY`

---

## Step 1 — Push to GitHub

If not already in a GitHub repo:

```bash
git init
git add .
git commit -m "Initial commit"
# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/agent-omni.git
git push -u origin main
```

> **Note:** `.env` is already in `.gitignore` — your API key stays local.

---

## Step 2 — Create a Railway Project

1. Go to [railway.app](https://railway.app) → **New Project**
2. Choose **Deploy from GitHub repo**
3. Select your `agent-omni` repository
4. Railway will auto-detect the `railway.json` and `nixpacks.toml` configuration

---

## Step 3 — Set Environment Variables

In the Railway project dashboard → **Variables** tab, add:

### Required
| Variable | Value |
|---|---|
| `OPENAI_API_KEY` | `sk-...your key...` |
| `NODE_ENV` | `production` |

### Web Deployment
| Variable | Value |
|---|---|
| `DISABLE_TERMINAL` | `true` |
| `ALLOWED_ORIGINS` | `*` |

### Frontend (Build Variables — set before first deploy)
| Variable | Value | Note |
|---|---|---|
| `VITE_API_URL` | *(leave empty)* | Same-origin routing |
| `VITE_WS_URL` | *(leave empty)* | Terminal disabled anyway |

> To set build variables in Railway: Variables → **New Variable** → check **"Available at build time"**

### Branding (Optional)
| Variable | Value |
|---|---|
| `COMPANY_NAME` | Your company name |
| `COMPANY_TAGLINE` | Your tagline |
| `COMPANY_DESCRIPTION` | Brief description of your company/bot |
| `BOT_NAME` | Display name for the AI |
| `PRIMARY_COLOR` | Hex color, e.g. `#0A0A0A` |
| `ACCENT_COLOR` | Hex color, e.g. `#6366F1` |

---

## Step 4 — Add a Volume (for persistent memory)

The bot's knowledge base (LanceDB) and SQLite databases live in `/data`. Without a volume, data resets on every deploy.

1. Railway dashboard → your service → **Volumes** tab
2. Click **New Volume**
3. Mount path: `/data`
4. Add environment variable: `LANCEDB_PATH=/data/lancedb`

---

## Step 5 — Deploy

Railway auto-deploys when you push to GitHub. You can also trigger manually:

- Dashboard → **Deploy** button

Watch the build logs — Railway will:
1. Install Node.js 20 + native build tools (gcc, make)
2. Run `npm install` (root) + `npm install` (client)
3. Build the React frontend with Vite
4. Start `node server/index.js`

---

## Step 6 — Get Your Public URL

After deploy succeeds:
1. Railway dashboard → **Settings** → **Domains**
2. Either use the auto-generated `*.up.railway.app` URL, or add a custom domain
3. Share this URL — anyone can now access the full IDE layout in their browser

---

## What Works in Web Mode

| Feature | Status |
|---|---|
| AI Chat (GPT-4o) | ✅ Full |
| RAG / Knowledge Base | ✅ Full (if volume attached) |
| Chat Memory & Learnings | ✅ Full |
| Training / Library | ✅ Full |
| Code Editor (Monaco) | ✅ Full |
| All Panels (Email, Todo, etc.) | ✅ UI works |
| File System Workspace | ⚠️ Server-side (no local files) |
| Terminal | ❌ Disabled (node-pty unavailable) |
| Electron App | ❌ Not applicable |

---

## Testing Locally in Production Mode

Before pushing, you can test the production build locally:

```bash
# 1. Build the React client
npm run build:web

# 2. Run in production mode
NODE_ENV=production OPENAI_API_KEY=sk-... DISABLE_TERMINAL=true node server/index.js

# 3. Open http://localhost:3001
```

---

## Troubleshooting

**Build fails on `better-sqlite3`:**
Railway's nixpacks includes gcc/make for native compilation. If it still fails, add to Railway Variables:
```
npm_config_build_from_source=true
```

**"Cannot reach server" in the chat:**
Make sure `VITE_API_URL` is set to empty (not `http://localhost:3001`) in Railway build variables. The React app must use same-origin API calls.

**Data lost after redeploy:**
Add a Railway Volume mounted at `/data` (Step 4 above).

**CORS errors:**
Set `ALLOWED_ORIGINS=*` in Railway variables (already in the env var list above).
