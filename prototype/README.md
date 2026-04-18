# NEXUS — Self-Building AI Platform

A complete AI agent system with chat, memory, dynamic tool creation, DAG task planning, verification, and repair.

## Quick Start

```bash
npm install
OPENROUTER_API_KEY=sk-or-v1-... npm start
```

Open http://localhost:3000

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
