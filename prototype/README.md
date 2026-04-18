# NEXUS — Self-Building AI Platform

A complete AI agent system with chat, memory, dynamic tool creation, DAG task planning, verification, and repair.

## Quick Start

```bash
npm install
OPENROUTER_API_KEY=sk-or-v1-... npm start
```

Open http://localhost:3000

## 🚀 How to Run — Complete Guide

### Prerequisites
- **Node.js v18+** (check: `node --version`)
- **An OpenRouter API key** — free at [openrouter.ai/keys](https://openrouter.ai/keys)

### Step 1 — Get the files
Download the three files maintaining this structure:
```
nexus-platform/
├── server.js
├── package.json
└── frontend/
    └── index.html
```

### Step 2 — Install dependencies
```bash
cd nexus-platform
npm install
```
This installs `express` and `ws`. Nothing else needed — no build step, no TypeScript, no bundler.

### Step 3 — Start the server

**Option A — Key as environment variable (recommended)**
```bash
# macOS / Linux
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxx node server.js

# Windows CMD
set OPENROUTER_API_KEY=sk-or-v1-xxxxxxxx && node server.js

# Windows PowerShell
$env:OPENROUTER_API_KEY="sk-or-v1-xxxxxxxx"; node server.js
```

**Option B — Enter key in the browser UI**
```bash
node server.js
```
The UI will prompt for the key on first load. It gets sent securely over WebSocket per message.

### Step 4 — Open the app
```
http://localhost:3000
```

### Step 5 — Test it works
Try these in order:
1. `What is 2847 * 9341?` → should use the calculator tool, return exact answer
2. `Remember that I prefer TypeScript` → should extract to memory (check sidebar Memory tab)
3. `Analyze pros and cons of REST vs GraphQL` → should trigger agent mode with a task plan
4. `Create a tool that reverses a string and test it with "hello world"` → should create + save an AI tool

### Optional: custom port
```bash
PORT=8080 OPENROUTER_API_KEY=sk-or-... node server.js
```

### REST API (no UI needed)
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"input": "What is 100 * 200?", "sessionId": "test1"}'
```


## Architecture

```
server.js
├── configAndState()     — shared state: memory, tools, sessions, logs
├── callLLM()            — all AI calls via OpenRouter
├── prompts()            — all LLM prompt templates
├── memorySystem()       — store/retrieve long-term memory
├── toolSystem()         — built-in + AI-created tool registry
├── contextBuilder()     — assembles context for each request
├── modeRouter()         — classifies: chat vs agent, simple vs complex
├── taskPlanner()        — breaks goals into DAG of tasks
├── toolExecution()      — runs existing or creates new tools
├── verifierAndRepair()  — verify output + repair loop
├── executionEngine()    — runs full task graph with progress events
├── outputBuilder()      — structures final response
├── extractAndSaveMemory()— extracts stable facts after each turn
└── Orchestrator class   — coordinates everything end-to-end
```

## Features

- **Auto mode**: automatically routes to chat or agent
- **Agent mode**: full DAG planning → parallel/sequential execution → verify → repair → merge
- **Tool factory**: AI creates new tools on demand, validates, saves for reuse
- **Memory**: extracts facts/preferences from conversations, retrieves relevant context
- **WebSocket streaming**: real-time progress updates to UI
- **Observability**: all events logged with timestamps

## Environment

| Variable | Description |
|---|---|
| `OPENROUTER_API_KEY` | Required for AI features |
| `PORT` | HTTP port (default 3000) |

## API

| Method | Path | Description |
|---|---|---|
| POST | /api/chat | Send a message (REST) |
| GET | /api/memory | View stored memories |
| GET | /api/tools | View tool registry |
| GET | /api/logs | View recent logs |
| DELETE | /api/session/:id | Clear a session |
