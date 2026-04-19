# NEXUS v2 — Self-Building AI Platform

> Visual agent builder · Dynamic tool creation · Multi-provider AI · File/image analysis · Memory

---

## Quick Start

```bash
# 1. Install
npm install

# 2. Configure (copy and edit .env)
cp .env.example .env
# Edit .env — set AI_API_KEY and AI_MODEL

# 3. Run
npm start
# → http://localhost:3000
```

---

## Architecture — All Classes

```
server.js
│
├── AIService          ← ALL AI provider logic in ONE class
│   ├── call()         — text prompt
│   ├── callWithAttachments() — vision/file (Base64)
│   ├── callJSON()     — structured JSON output
│   ├── setKey()       — runtime key injection (from browser)
│   └── getEndpoint/getHeaders/buildBody/extractText()
│       (add new providers here ONLY)
│
├── Prompts            ← All prompt templates (static class)
│   ├── classify()          — mode routing
│   ├── metaPlan()          — DAG workflow creation
│   ├── generateNodePrompt() — ← AI generates prompt FOR each node
│   ├── generateNodeFunction() — ← AI generates JS function for each node
│   ├── validateFlow()      — n8n-style flow validation
│   ├── validateNodeSchema() — per-node schema validation
│   ├── solve/verify/repair/merge()
│   └── createTool/validateTool/extractMemory()
│
├── MemorySystem       ← Store/retrieve long-term facts
├── ToolSystem         ← Built-in + AI-created tool registry + sandbox
├── ContextBuilder     ← Assemble context (conversation + memory + attachments)
├── Verifier           ← Per-node + global verification + repair loop
│
├── AgentBuilder       ← n8n-like agent creation pipeline
│   ├── buildFromGoal()     — full pipeline:
│   │   ├── MetaPlanner → DAG
│   │   ├── NodeBuilder → generates prompt + function for EACH node
│   │   ├── FlowValidator → validate + repair loop
│   │   └── AgentRegistry → save for reuse
│   └── findExisting()      — reuse cached agents
│
├── ExecutionEngine    ← DAG execution with dependency resolution
│   ├── execute()           — correct dependency queue (not broken skip)
│   ├── per-node tool/function/prompt routing
│   ├── local verification per node
│   └── merge + global verification
│
└── Orchestrator       ← Top-level controller (exact flowchart)
    └── run()               — INPUT→MODE→CONTEXT→PLAN→EXECUTE→VERIFY→MERGE→MEMORY→LOG
```

---

## Flowchart (as implemented)

```
USER INPUT + ATTACHMENTS
  ↓
MODE ROUTER (AIService.callJSON → Prompts.classify)
  ├── chat/simple → AIService.call (or callWithAttachments if files)
  └── agent/complex or "build agent:"
        ├── if "build agent:" → AgentBuilder.buildFromGoal()
        │     ├── MetaPlanner (Prompts.metaPlan)
        │     ├── NodeBuilder (Prompts.generateNodePrompt + generateNodeFunction per node)
        │     ├── FlowValidator (Prompts.validateFlow → repair loop)
        │     └── Save to agentRegistry → send workflow to UI canvas
        └── else → ExecutionEngine.execute(plan)
              ↓
            DEPENDENCY QUEUE LOOP
              for each ready node:
                ├── tool needed? → ToolSystem.execute (or createAndRegister)
                ├── nodeFunction.code? → ToolSystem.sandboxExecute
                ├── nodePrompt? → AIService.call with node system/user prompt
                └── fallback → AIService.call(Prompts.solve)
              ↓
            LOCAL VERIFY (Verifier.verifyAndRepair per node)
              ↓
            MERGE (Prompts.merge)
              ↓
            GLOBAL VERIFY (Verifier.verifyAndRepair)
  ↓
MEMORY EXTRACTOR (async, MemorySystem.extractAndSave)
  ↓
LOGGER
```

---

## File Upload / Vision (Base64)

```
User picks file in UI
  → POST /api/upload (multer, memoryStorage)
  → Buffer.toString('base64')
  → Returns {name, mime, type, data} to browser
  → Browser attaches to WS message as pendingAttachments[]
  → server.js: AIService.callWithAttachments(prompt, attachments, ctx)
  → Builds multimodal content[] with image_url or file blocks
  → OpenRouter file-parser plugin for PDFs
```

Supported: JPG, PNG, GIF, WebP (images) + PDF, TXT, JSON, CSV (files)

---

## AI Provider Switching

Everything is in `AIService`. To switch:

```bash
# .env
AI_PROVIDER=groq
AI_API_KEY=gsk_your_groq_key
AI_MODEL=llama-3.3-70b-versatile
```

Or at runtime from the browser settings modal. No code changes needed.

**Supported providers:** `openrouter` | `openai` | `groq` | `together` | `anthropic`

---

## API Reference

| Method | Path | Description |
|---|---|---|
| POST | /api/upload | Upload files → Base64 encoded response |
| POST | /api/chat | REST chat (no streaming) |
| GET | /api/memory | All stored memories |
| GET | /api/tools | All registered tools |
| GET | /api/agents | All saved agent workflows |
| GET | /api/logs | Recent observability log |
| GET | /api/ai-info | Current provider/model info |
| GET | /api/health | Health check |
| DELETE | /api/session/:id | Clear session |

WebSocket at `ws://localhost:3000` — send `{type:"chat", input, sessionId, apiKey, attachments[]}`

---

## How to Run (Full Guide)

### Requirements
- Node.js v18 or higher (`node --version`)
- An API key (free options: OpenRouter, Groq)

### Step-by-step

```bash
# Clone / download the project
cd nexus-platform

# Install dependencies
npm install

# Configure environment
cp .env.example .env
nano .env   # or use any text editor

# Fill in:
#   AI_PROVIDER=openrouter
#   AI_API_KEY=sk-or-v1-xxxxxxxx
#   AI_MODEL=google/gemma-4-31b-it:free

# Start
npm start

# Or development mode (auto-restart on changes)
npm run dev
```

### Open in browser
```
http://localhost:3000
```

### Test the features

**1. Simple chat:**
```
What is the capital of Japan?
```

**2. Tool creation:**
```
Create a tool that checks if a number is prime and test it with 97
```

**3. Agent builder (opens canvas):**
```
Build agent: Research renewable energy, compare solar vs wind, write a structured report
```

**4. File/image upload:**
- Click 📎 or drag a file
- Ask: "What's in this image?" or "Summarise this PDF"

**5. Memory:**
```
Remember that I always want responses in bullet points
```
Then later ask anything — it uses your preference.

**6. Math via calculator tool:**
```
What is 98473 * 28491 + 17362?
```

### Environment variables summary

| Variable | Default | Description |
|---|---|---|
| `AI_PROVIDER` | `openrouter` | Provider name |
| `AI_API_KEY` | — | Your API key |
| `AI_MODEL` | `google/gemma-4-31b-it:free` | Model to use |
| `AI_MAX_TOKENS` | `4096` | Max output tokens |
| `AI_BASE_URL` | — | Custom endpoint override |
| `PORT` | `3000` | HTTP port |
