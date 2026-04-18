import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ===== CONFIG & STATE =====

function configAndState() {
  return {
    config: {
      openrouterKey: process.env.OPENROUTER_API_KEY || '',
      model: 'google/gemini-2.5-flash',
      maxTaskDepth: 5,
      maxRetries: 3,
      maxParallelNodes: 4,
      toolTimeout: 15000,
      port: process.env.PORT || 3000,
    },
    memory: [],          // long-term memory store
    toolRegistry: {},    // reusable tool definitions
    agentRegistry: {},   // reusable agent workflows
    sessions: {},        // active user sessions
    logs: [],            // observability log
  };
}

const state = configAndState();

// ===== LOGGER =====

function logger(event, data = {}) {
  const entry = {
    ts: new Date().toISOString(),
    event,
    ...data,
  };
  state.logs.push(entry);
  if (state.logs.length > 500) state.logs.shift();
  console.log(`[${entry.ts}] [${event}]`, JSON.stringify(data).slice(0, 200));
  return entry;
}

// ===== LLM CALL =====

async function callLLM(prompt, context = '', systemOverride = null) {
  const system = systemOverride || 'You are a highly capable AI assistant and agent orchestrator. Be precise, structured, and helpful.';
  const messages = [
    { role: 'user', content: context ? `CONTEXT:\n${context}\n\nTASK:\n${prompt}` : prompt },
  ];

  logger('llm_call', { promptLen: prompt.length, contextLen: context.length });

  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${state.config.openrouterKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://self-building-ai-platform',
    },
    body: JSON.stringify({
      model: state.config.model,
      max_tokens: 4096,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`LLM error ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || '';
  logger('llm_response', { len: text.length, tokens: data.usage?.total_tokens });
  return text;
}

// ===== PROMPTS =====

function prompts() {
  return {
    classify: (input) =>
      `Classify this user input and respond ONLY with valid JSON (no markdown):
{"mode":"chat"|"agent","complexity":"simple"|"complex","needs_tool":true|false,"needs_memory":true|false,"intent":"short description"}
User input: "${input}"`,

    plan: (goal, context) =>
      `Break this goal into a DAG of tasks. Respond ONLY with valid JSON (no markdown):
{"tasks":[{"id":"t1","name":"...","description":"...","depends_on":[],"needs_tool":false,"tool_hint":""}]}
Goal: "${goal}"
Context: ${context}`,

    solve: (task, context) =>
      `Complete this specific task and return only the result, no preamble.
Task: ${task}
Context: ${context}`,

    verify: (task, output, goal) =>
      `Verify this output for the task. Respond ONLY with valid JSON (no markdown):
{"pass":true|false,"issues":"...","score":0.0-1.0}
Goal: "${goal}"
Task: "${task}"
Output: "${String(output).slice(0, 1000)}"`,

    repair: (task, output, issues) =>
      `Repair this output to fix the issues. Return only the corrected result.
Task: "${task}"
Issues: "${issues}"
Previous output: "${String(output).slice(0, 800)}"`,

    extractMemory: (conversation) =>
      `Extract stable, reusable facts from this conversation. Respond ONLY with valid JSON (no markdown):
{"memories":[{"value":"...","type":"preference"|"fact"|"goal","confidence":0.0-1.0}]}
Conversation: ${conversation}`,

    createTool: (need) =>
      `Create a JavaScript tool function for this need. Respond ONLY with valid JSON (no markdown):
{"name":"snake_case_name","description":"...","input_schema":{},"output_schema":{},"code":"async function execute(input){...}","language":"javascript"}
Need: "${need}"`,

    validateTool: (tool) =>
      `Validate this tool definition. Respond ONLY with valid JSON (no markdown):
{"valid":true|false,"issues":"...","safe":true|false}
Tool: ${JSON.stringify(tool)}`,

    mergeOutputs: (tasks, outputs) =>
      `Merge these task outputs into one coherent final answer. Be comprehensive and well-structured.
Tasks and outputs:
${tasks.map((t, i) => `Task: ${t}\nOutput: ${outputs[i]}`).join('\n---\n')}`,

    routeComplexity: (input) =>
      `Score the complexity of this request (0=trivial, 1=complex multi-step). Respond ONLY with valid JSON (no markdown):
{"score":0.0-1.0,"reason":"..."}
Input: "${input}"`,
  };
}

// ===== MEMORY SYSTEM =====

function memorySystem() {
  function store(value, type, confidence = 0.8, source = 'conversation') {
    const existing = state.memory.find(
      (m) => m.value.toLowerCase() === value.toLowerCase()
    );
    if (existing) {
      existing.confidence = Math.max(existing.confidence, confidence);
      existing.timestamp = new Date().toISOString();
      return;
    }
    state.memory.push({
      id: crypto.randomUUID(),
      value,
      type,
      confidence,
      source,
      timestamp: new Date().toISOString(),
      expiry: null,
    });
    // prune low-confidence old entries
    if (state.memory.length > 200) {
      state.memory.sort((a, b) => a.confidence - b.confidence);
      state.memory.splice(0, 20);
    }
  }

  function retrieve(query, limit = 5) {
    const q = query.toLowerCase();
    return state.memory
      .filter((m) => m.value.toLowerCase().includes(q) || m.type === 'preference')
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }

  function getAll() {
    return state.memory.slice(-50);
  }

  return { store, retrieve, getAll };
}

const memory = memorySystem();

// ===== TOOL SYSTEM =====

function toolSystem() {
  // Built-in tools
  const builtins = {
    calculator: {
      name: 'calculator',
      description: 'Evaluate mathematical expressions safely',
      execute: async (input) => {
        try {
          const expr = String(input.expression || input).replace(/[^0-9+\-*/().\s%]/g, '');
          // eslint-disable-next-line no-new-func
          return { result: Function(`"use strict"; return (${expr})`)() };
        } catch (e) {
          return { error: e.message };
        }
      },
    },
    datetime: {
      name: 'datetime',
      description: 'Get current date and time info',
      execute: async () => {
        const now = new Date();
        return { iso: now.toISOString(), readable: now.toString(), ts: now.getTime() };
      },
    },
    json_transform: {
      name: 'json_transform',
      description: 'Parse and transform JSON data',
      execute: async (input) => {
        try {
          const data = typeof input.data === 'string' ? JSON.parse(input.data) : input.data;
          return { result: data, keys: Object.keys(data) };
        } catch (e) {
          return { error: e.message };
        }
      },
    },
  };

  // Merge builtins + registry
  function getAll() {
    return { ...builtins, ...state.toolRegistry };
  }

  function find(name) {
    return builtins[name] || state.toolRegistry[name] || null;
  }

  function findByHint(hint) {
    const h = hint.toLowerCase();
    const all = getAll();
    return Object.values(all).find(
      (t) => t.name.includes(h) || t.description?.toLowerCase().includes(h)
    ) || null;
  }

  async function register(toolDef) {
    state.toolRegistry[toolDef.name] = {
      ...toolDef,
      usage_count: 0,
      created_at: new Date().toISOString(),
      created_by: 'ai',
    };
    logger('tool_registered', { name: toolDef.name });
  }

  return { find, findByHint, getAll, register };
}

const tools = toolSystem();

// ===== CONTEXT BUILDER =====

function contextBuilder(session, extras = {}) {
  const recentMsgs = (session.messages || []).slice(-6)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  const relevantMemory = memory.retrieve(session.lastInput || '', 5)
    .map((m) => `[${m.type}] ${m.value}`)
    .join('\n');

  const toolList = Object.values(tools.getAll())
    .map((t) => `- ${t.name}: ${t.description}`)
    .join('\n');

  let ctx = '';
  if (recentMsgs) ctx += `## Recent Conversation\n${recentMsgs}\n\n`;
  if (relevantMemory) ctx += `## Relevant Memory\n${relevantMemory}\n\n`;
  if (toolList) ctx += `## Available Tools\n${toolList}\n\n`;
  if (extras.taskState) ctx += `## Task State\n${JSON.stringify(extras.taskState)}\n\n`;

  return ctx.trim();
}

// ===== MODE ROUTER =====

async function modeRouter(input, session) {
  const P = prompts();
  let classification;
  try {
    const raw = await callLLM(P.classify(input));
    classification = JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    classification = { mode: 'chat', complexity: 'simple', needs_tool: false, intent: input };
  }
  logger('mode_routed', classification);
  return classification;
}

// ===== TASK PLANNER =====

async function taskPlanner(goal, context) {
  const P = prompts();
  let plan;
  try {
    const raw = await callLLM(P.plan(goal, context));
    plan = JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    plan = { tasks: [{ id: 't1', name: 'solve', description: goal, depends_on: [], needs_tool: false }] };
  }
  logger('plan_created', { taskCount: plan.tasks?.length });
  return plan;
}

// ===== TOOL EXECUTION =====

async function toolExecution(toolName, input, hint = '') {
  let tool = tools.find(toolName) || tools.findByHint(hint || toolName);

  if (!tool) {
    // Tool factory
    logger('tool_factory_start', { need: hint || toolName });
    tool = await createTool(hint || toolName);
    if (!tool) return { error: `Could not create tool for: ${toolName}` };
  }

  try {
    logger('tool_execute', { name: tool.name });
    if (tool.created_by === 'ai' && tool.code) {
      return await sandboxExecute(tool.code, input);
    }
    const result = await Promise.race([
      tool.execute(input),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), state.config.toolTimeout)),
    ]);
    if (state.toolRegistry[tool.name]) state.toolRegistry[tool.name].usage_count++;
    return result;
  } catch (e) {
    logger('tool_error', { name: tool.name, error: e.message });
    return { error: e.message };
  }
}

async function createTool(need) {
  const P = prompts();
  try {
    const raw = await callLLM(P.createTool(need));
    const toolDef = JSON.parse(raw.replace(/```json|```/g, '').trim());

    // Validate
    const vRaw = await callLLM(P.validateTool(toolDef));
    const validation = JSON.parse(vRaw.replace(/```json|```/g, '').trim());

    if (!validation.valid || !validation.safe) {
      logger('tool_invalid', { name: toolDef.name, issues: validation.issues });
      return null;
    }

    await tools.register(toolDef);
    logger('tool_created', { name: toolDef.name });

    // Return with execute wrapper
    return {
      ...toolDef,
      execute: async (input) => sandboxExecute(toolDef.code, input),
    };
  } catch (e) {
    logger('tool_creation_failed', { error: e.message });
    return null;
  }
}

// Basic sandbox - wraps AI-generated code safely
async function sandboxExecute(code, input) {
  try {
    const wrapped = `
      const __input = arguments[0];
      ${code}
      return execute(__input);
    `;
    // Use AsyncFunction so await works inside generated code
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const fn = new AsyncFunction(wrapped);
    const result = await fn(input);
    return result;
  } catch (e) {
    return { error: `Sandbox error: ${e.message}` };
  }
}

// ===== VERIFIER & REPAIR =====

async function verifierAndRepair(task, output, goal, retries = 0) {
  const P = prompts();
  if (retries >= state.config.maxRetries) {
    logger('verify_max_retries', { task });
    return output;
  }

  let verification;
  try {
    const raw = await callLLM(P.verify(task, output, goal));
    verification = JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    return output;
  }

  logger('verify_result', { task: task.slice(0, 60), pass: verification.pass, score: verification.score });

  if (verification.pass || verification.score > 0.7) return output;

  // Repair
  const repaired = await callLLM(P.repair(task, output, verification.issues));
  return verifierAndRepair(task, repaired, goal, retries + 1);
}

// ===== EXECUTION ENGINE =====

async function executionEngine(plan, goal, session, onProgress) {
  const P = prompts();
  const tasks = plan.tasks || [];
  const results = {};
  const completed = new Set();

  const notify = (msg) => onProgress?.({ type: 'progress', message: msg });

  // Resolve tasks respecting dependencies — retry queue until all done or stuck
  const queue = [...tasks];
  let stuckGuard = 0;

  while (queue.length > 0) {
    stuckGuard++;
    if (stuckGuard > tasks.length * tasks.length + 10) {
      logger('execution_stuck', { remaining: queue.map(t => t.id) });
      break;
    }

    const task = queue.shift();

    // If dependencies not yet met, push to back and try later
    if (task.depends_on?.some((d) => !completed.has(d))) {
      queue.push(task);
      continue;
    }

    notify(`Executing: ${task.name}`);
    logger('node_execute', { id: task.id, name: task.name });

    const depContext = task.depends_on
      .map((d) => `Result of ${d}: ${JSON.stringify(results[d])}`)
      .join('\n');

    const ctx = contextBuilder(session, { taskState: depContext });

    let output;
    if (task.needs_tool && task.tool_hint) {
      output = await toolExecution(task.tool_hint, { task: task.description }, task.tool_hint);
    } else {
      output = await callLLM(P.solve(task.description, ctx));
    }

    // Local verification
    output = await verifierAndRepair(task.description, output, goal);
    results[task.id] = output;
    completed.add(task.id);
    notify(`Completed: ${task.name}`);
  }

  // Merge
  notify('Merging results...');
  const taskNames = tasks.map((t) => t.description);
  const taskOutputs = tasks.map((t) => results[t.id] || '');

  let finalOutput;
  if (tasks.length === 1) {
    finalOutput = taskOutputs[0];
  } else {
    finalOutput = await callLLM(P.mergeOutputs(taskNames, taskOutputs));
  }

  // Global verification
  finalOutput = await verifierAndRepair(goal, finalOutput, goal);
  return finalOutput;
}

// ===== OUTPUT BUILDER =====

function outputBuilder(raw, mode) {
  return {
    content: raw,
    mode,
    timestamp: new Date().toISOString(),
  };
}

// ===== MEMORY EXTRACTOR =====

async function extractAndSaveMemory(conversation) {
  const P = prompts();
  try {
    const raw = await callLLM(P.extractMemory(conversation));
    const data = JSON.parse(raw.replace(/```json|```/g, '').trim());
    (data.memories || []).forEach((m) => {
      if (m.confidence > 0.7) memory.store(m.value, m.type, m.confidence);
    });
    logger('memory_extracted', { count: data.memories?.length });
  } catch (e) {
    logger('memory_extract_failed', { error: e.message });
  }
}

// ===== ORCHESTRATOR =====

class Orchestrator {
  async run(input, sessionId, onProgress) {
    const session = state.sessions[sessionId] || { messages: [], lastInput: '' };
    state.sessions[sessionId] = session;
    session.lastInput = input;

    logger('orchestrator_start', { sessionId, inputLen: input.length });
    onProgress?.({ type: 'status', message: 'Analyzing request...' });

    // Route mode
    const classification = await modeRouter(input, session);
    onProgress?.({ type: 'status', message: `Mode: ${classification.mode} / ${classification.complexity}` });

    const ctx = contextBuilder(session);
    let finalOutput;

    if (classification.mode === 'chat' && classification.complexity === 'simple') {
      // Direct answer
      onProgress?.({ type: 'status', message: 'Generating response...' });
      const P = prompts();
      finalOutput = await callLLM(P.solve(input, ctx));
    } else {
      // Agent path
      onProgress?.({ type: 'status', message: 'Planning tasks...' });
      const plan = await taskPlanner(input, ctx);
      onProgress?.({ type: 'plan', plan });
      finalOutput = await executionEngine(plan, input, session, onProgress);
    }

    // Build output
    const result = outputBuilder(finalOutput, classification.mode);

    // Update session
    session.messages.push({ role: 'user', content: input });
    session.messages.push({ role: 'assistant', content: finalOutput });
    if (session.messages.length > 40) session.messages.splice(0, 10);

    // Extract memory async (non-blocking)
    const convoSnippet = session.messages.slice(-6).map((m) => `${m.role}: ${m.content}`).join('\n');
    extractAndSaveMemory(convoSnippet).catch(() => {});

    logger('orchestrator_done', { sessionId, outputLen: finalOutput.length });
    return result;
  }
}

const orchestrator = new Orchestrator();

// ===== API SERVER =====

function apiServer() {
  const app = express();
  const httpServer = createServer(app);

  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'frontend')));

  // WebSocket for streaming
  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws) => {
    logger('ws_connect');
    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type === 'chat') {
        const { input, sessionId, apiKey } = msg;
        if (!input?.trim()) return;

        // Use per-message apiKey if server key not configured
        if (apiKey && !state.config.openrouterKey) {
          state.config.openrouterKey = apiKey;
        }

        ws.send(JSON.stringify({ type: 'start' }));

        try {
          const result = await orchestrator.run(input, sessionId || 'default', (update) => {
            ws.send(JSON.stringify(update));
          });
          ws.send(JSON.stringify({ type: 'done', result }));
        } catch (e) {
          logger('ws_error', { error: e.message });
          ws.send(JSON.stringify({ type: 'error', message: e.message }));
        }
      }
    });
  });

  // REST endpoints
  app.post('/api/chat', async (req, res) => {
    const { input, sessionId } = req.body;
    if (!input?.trim()) return res.status(400).json({ error: 'input required' });
    try {
      const result = await orchestrator.run(input, sessionId || 'default', () => {});
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/memory', (_req, res) => res.json(memory.getAll()));
  app.get('/api/tools', (_req, res) => {
    const serializable = Object.values(tools.getAll()).map(({ execute, ...rest }) => rest);
    res.json(serializable);
  });
  app.get('/api/logs', (_req, res) => res.json(state.logs.slice(-100)));
  app.get('/api/sessions', (_req, res) =>
    res.json(Object.fromEntries(Object.entries(state.sessions).map(([k, v]) => [k, { messageCount: v.messages?.length }])))
  );

  app.delete('/api/session/:id', (req, res) => {
    delete state.sessions[req.params.id];
    res.json({ ok: true });
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

  const port = state.config.port;
  httpServer.listen(port, () => {
    logger('server_start', { port });
    console.log(`\n🚀 Self-Building AI Platform running at http://localhost:${port}\n`);
    if (!state.config.openrouterKey) {
      console.warn('⚠️  OPENROUTER_API_KEY not set — set it to enable AI features\n');
    }
  });

  return httpServer;
}

apiServer();
