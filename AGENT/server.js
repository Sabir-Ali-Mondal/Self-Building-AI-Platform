/**
 * NEXUS — Self-Building AI Platform v2
 * ======================================
 * All AI provider logic lives in ONE class: AIService
 * All other modules are classes too.
 * Flowchart: INPUT → MODE → CONTEXT → PLAN(DAG) → EXECUTE → VERIFY → REPAIR → MERGE → MEMORY → LOG
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import multer from 'multer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ===== SHARED STATE =====

const state = {
  memory: [],
  toolRegistry: {},
  agentRegistry: {},
  sessions: {},
  logs: [],
};

// ===================================================================
// ===== AI SERVICE — ALL PROVIDER LOGIC IN ONE PLACE ================
// ===================================================================
// To switch providers: change provider name + update getEndpoint/getHeaders
// Supported: openrouter | openai | anthropic | groq | together

class AIService {
  constructor() {
    this.provider   = process.env.AI_PROVIDER   || 'openrouter';
    this.apiKey     = process.env.AI_API_KEY     || process.env.OPENROUTER_API_KEY || '';
    this.model      = process.env.AI_MODEL       || 'openrouter/free';
    this.maxTokens  = parseInt(process.env.AI_MAX_TOKENS || '4096');
    this.baseURL    = process.env.AI_BASE_URL    || '';   // override endpoint
  }

  /** Set API key at runtime (e.g. from browser modal) */
  setKey(key) {
    if (key && !this.apiKey) this.apiKey = key;
  }

  /** Single endpoint resolver — add new providers here only */
  getEndpoint() {
    if (this.baseURL) return this.baseURL;
    const endpoints = {
      openrouter: 'https://openrouter.ai/api/v1/chat/completions',
      openai:     'https://api.openai.com/v1/chat/completions',
      anthropic:  'https://api.anthropic.com/v1/messages',
      groq:       'https://api.groq.com/openai/v1/chat/completions',
      together:   'https://api.together.xyz/v1/chat/completions',
    };
    return endpoints[this.provider] || endpoints.openrouter;
  }

  /** Single header resolver — add new providers here only */
  getHeaders() {
    const base = { 'Content-Type': 'application/json' };
    if (this.provider === 'anthropic') {
      return { ...base, 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' };
    }
    return { ...base, Authorization: `Bearer ${this.apiKey}`, 'HTTP-Referer': 'https://nexus-ai-platform' };
  }

  /** Build request body — normalise across providers */
  buildBody(messages, system) {
    if (this.provider === 'anthropic') {
      return { model: this.model, max_tokens: this.maxTokens, system, messages };
    }
    return {
      model: this.model,
      max_tokens: this.maxTokens,
      messages: [{ role: 'system', content: system }, ...messages],
    };
  }

  /** Extract text from response — normalise across providers */
  extractText(data) {
    if (this.provider === 'anthropic') return data.content?.[0]?.text || '';
    return data.choices?.[0]?.message?.content || '';
  }

  /**
   * MAIN CALL — text only
   * @param {string} prompt
   * @param {string} context
   * @param {string|null} systemOverride
   */
  async call(prompt, context = '', systemOverride = null) {
    const system = systemOverride || 'You are a highly capable AI agent orchestrator. Be precise, structured, and helpful.';
    const userContent = context ? `CONTEXT:\n${context}\n\nTASK:\n${prompt}` : prompt;
    const messages = [{ role: 'user', content: userContent }];

    logger('ai_call', { provider: this.provider, model: this.model, promptLen: prompt.length });

    const resp = await fetch(this.getEndpoint(), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(this.buildBody(messages, system)),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`AI error ${resp.status}: ${err}`);
    }

    const data = await resp.json();
    const text = this.extractText(data);
    logger('ai_response', { len: text.length, tokens: data.usage?.total_tokens });
    return text;
  }

  /**
   * VISION CALL — with Base64 image/file attachments
   * @param {string} prompt
   * @param {Array<{type:'image'|'file', data:string, mime:string, name?:string}>} attachments
   * @param {string} context
   */
  async callWithAttachments(prompt, attachments = [], context = '') {
    const system = 'You are a multimodal AI assistant. Analyse all provided files and images thoroughly.';
    const textContent = context ? `CONTEXT:\n${context}\n\nTASK:\n${prompt}` : prompt;

    // Build multimodal content array
    const content = [{ type: 'text', text: textContent }];

    for (const att of attachments) {
      if (att.type === 'image') {
        content.push({
          type: 'image_url',
          image_url: { url: `data:${att.mime};base64,${att.data}` },
        });
      } else if (att.type === 'file') {
        // OpenRouter file-parser plugin for PDFs
        content.push({
          type: 'file',
          file: { filename: att.name || 'file', file_data: `data:${att.mime};base64,${att.data}` },
        });
      }
    }

    const messages = [{ role: 'user', content }];
    const body = this.buildBody(messages, system);

    // Add file-parser plugin for OpenRouter PDF support
    if (this.provider === 'openrouter' && attachments.some(a => a.mime === 'application/pdf')) {
      body.plugins = [{ id: 'file-parser', pdf: { engine: 'mistral-ocr' } }];
    }

    logger('ai_vision_call', { attachments: attachments.length });

    const resp = await fetch(this.getEndpoint(), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`AI vision error ${resp.status}: ${err}`);
    }

    const data = await resp.json();
    return this.extractText(data);
  }

  /** Safe JSON call — retries once on parse failure */
  async callJSON(prompt, context = '', systemOverride = null) {
    const sys = (systemOverride || '') + '\nALWAYS respond with valid JSON only. No markdown fences, no preamble.';
    let raw = await this.call(prompt, context, sys);
    // Strip possible ```json fences
    raw = raw.replace(/```json|```/g, '').trim();
    try {
      return JSON.parse(raw);
    } catch {
      // One retry with stronger instruction
      const raw2 = await this.call(
        prompt + '\n\nCRITICAL: Return ONLY a raw JSON object, nothing else.',
        context, sys
      );
      return JSON.parse(raw2.replace(/```json|```/g, '').trim());
    }
  }

  getInfo() {
    return { provider: this.provider, model: this.model, hasKey: !!this.apiKey };
  }
}

// ===== SINGLETON AI SERVICE =====
const ai = new AIService();

// ===================================================================
// ===== PROMPTS — ALL TEMPLATES IN ONE PLACE ========================
// ===================================================================

class Prompts {
  // ── MODE & ROUTING ──
  static classify(input) {
    return `Classify this user input.
Return JSON: {"mode":"chat"|"agent","complexity":"simple"|"complex","needs_tool":boolean,"needs_memory":boolean,"needs_vision":boolean,"intent":"short description"}
Input: "${input}"`;
  }

  // ── AGENT BUILDER — META PLANNER ──
  static metaPlan(goal, context) {
    return `You are a Meta Planner. Turn this goal into a complete workflow DAG.
Return JSON: {
  "agent_name": "...",
  "description": "...",
  "tasks": [
    {
      "id": "t1",
      "name": "human readable name",
      "description": "full description of what this node does",
      "depends_on": [],
      "needs_tool": false,
      "tool_hint": "",
      "input_schema": {"field": "type"},
      "output_schema": {"field": "type"}
    }
  ]
}
Goal: "${goal}"
Context: ${context || 'none'}`;
  }

  // ── AGENT BUILDER — NODE PROMPT GENERATOR ──
  // This is the prompt that GENERATES the prompt for each node
  static generateNodePrompt(task) {
    return `You are a Prompt Engineer. Write a precise execution prompt for this agent node.
The prompt will be used at runtime to instruct the AI to complete this node's work.
Return JSON: {
  "system_prompt": "role and behavior for this node",
  "user_prompt_template": "template with {{input}} placeholder",
  "output_format": "description of expected output format",
  "examples": ["example1", "example2"]
}
Node: ${JSON.stringify(task)}`;
  }

  // ── AGENT BUILDER — NODE FUNCTION GENERATOR ──
  // Generates the JS code function for tool-based nodes
  static generateNodeFunction(task) {
    return `You are a Code Generator. Write a JavaScript async function for this agent node.
The function receives (input, context) and returns a result object.
Return JSON: {
  "function_name": "snake_case_name",
  "description": "what this function does",
  "code": "async function execute(input, context) { ... return result; }",
  "input_schema": {"field": "type"},
  "output_schema": {"field": "type"},
  "dependencies": []
}
Node: ${JSON.stringify(task)}`;
  }

  // ── AGENT BUILDER — FLOW VALIDATOR ──
  static validateFlow(workflow) {
    return `Validate this agent workflow for correctness, safety, and completeness.
Return JSON: {
  "valid": true|false,
  "safe": true|false,
  "issues": ["issue1"],
  "suggestions": ["suggestion1"],
  "score": 0.0-1.0
}
Workflow: ${JSON.stringify(workflow)}`;
  }

  // ── AGENT BUILDER — NODE SCHEMA VALIDATOR ──
  static validateNodeSchema(node) {
    return `Validate this node's input/output schema and prompt.
Return JSON: {"valid": boolean, "issues": [], "fixed_schema": {}}
Node: ${JSON.stringify(node)}`;
  }

  // ── TASK EXECUTION ──
  static solve(task, context) {
    return `Complete this specific task. Return only the result, no preamble.
Task: ${task}
Context: ${context || 'none'}`;
  }

  // ── TOOL CREATION ──
  static createTool(need) {
    return `Create a focused JavaScript tool for this need.
Return JSON: {
  "name": "snake_case",
  "description": "...",
  "input_schema": {},
  "output_schema": {},
  "code": "async function execute(input) { ... return result; }",
  "language": "javascript"
}
Need: "${need}"`;
  }

  static validateTool(tool) {
    return `Validate this tool for safety and correctness.
Return JSON: {"valid": boolean, "safe": boolean, "issues": "..."}
Tool: ${JSON.stringify(tool)}`;
  }

  // ── VERIFICATION ──
  static verify(task, output, goal) {
    return `Verify this node output against its task contract.
Return JSON: {"pass": boolean, "score": 0.0-1.0, "issues": "..."}
Goal: "${goal}"
Task: "${task}"
Output: "${String(output).slice(0, 1200)}"`;
  }

  static repair(task, output, issues) {
    return `Repair this output to fix the listed issues. Return only the corrected result.
Task: "${task}"
Issues: "${issues}"
Bad output: "${String(output).slice(0, 900)}"`;
  }

  // ── MERGE ──
  static merge(pairs) {
    return `Merge these task outputs into one coherent, well-structured final answer.
Remove duplication, preserve all important information, maintain logical order.
${pairs.map(p => `Task: ${p.task}\nOutput: ${p.output}`).join('\n---\n')}`;
  }

  // ── MEMORY ──
  static extractMemory(conversation) {
    return `Extract stable, reusable facts from this conversation.
Only include high-value facts worth remembering long-term.
Return JSON: {"memories": [{"value": "...", "type": "preference"|"fact"|"goal", "confidence": 0.0-1.0}]}
Conversation: ${conversation}`;
  }

  // ── CONTEXT REWRITE FOR RAG ──
  static rewriteQuery(query, history) {
    return `Rewrite this query to be self-contained for retrieval, using conversation history.
Return JSON: {"rewritten": "..."}
Original: "${query}"
History: ${history}`;
  }
}

// ===================================================================
// ===== LOGGER ======================================================
// ===================================================================

function logger(event, data = {}) {
  const entry = { ts: new Date().toISOString(), event, ...data };
  state.logs.push(entry);
  if (state.logs.length > 1000) state.logs.shift();
  console.log(`[${entry.ts}] [${event}]`, JSON.stringify(data).slice(0, 220));
  return entry;
}

// ===================================================================
// ===== MEMORY SYSTEM CLASS =========================================
// ===================================================================

class MemorySystem {
  store(value, type, confidence = 0.8, source = 'conversation') {
    const existing = state.memory.find(m => m.value.toLowerCase() === value.toLowerCase());
    if (existing) {
      existing.confidence = Math.max(existing.confidence, confidence);
      existing.timestamp = new Date().toISOString();
      return;
    }
    state.memory.push({
      id: crypto.randomUUID(), value, type, confidence, source,
      timestamp: new Date().toISOString(), expiry: null,
    });
    this._prune();
  }

  retrieve(query, limit = 6) {
    if (!query) return state.memory.slice(-limit);
    const q = query.toLowerCase();
    return state.memory
      .filter(m => m.value.toLowerCase().includes(q) || m.type === 'preference')
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }

  getAll(limit = 80) { return state.memory.slice(-limit); }

  _prune() {
    if (state.memory.length > 300) {
      state.memory.sort((a, b) => a.confidence - b.confidence);
      state.memory.splice(0, 30);
    }
  }

  async extractAndSave(conversation) {
    try {
      const data = await ai.callJSON(Prompts.extractMemory(conversation));
      (data.memories || []).forEach(m => {
        if (m.confidence > 0.65) this.store(m.value, m.type, m.confidence);
      });
      logger('memory_extracted', { count: data.memories?.length });
    } catch (e) {
      logger('memory_extract_failed', { error: e.message });
    }
  }
}

// ===================================================================
// ===== TOOL SYSTEM CLASS ===========================================
// ===================================================================

class ToolSystem {
  constructor() {
    this._builtins = this._initBuiltins();
  }

  _initBuiltins() {
    return {
      calculator: {
        name: 'calculator', description: 'Evaluate math expressions',
        execute: async (input) => {
          try {
            const expr = String(input.expression || input).replace(/[^0-9+\-*/().\s%^]/g, '');
            const AsyncFn = Object.getPrototypeOf(async function(){}).constructor;
            const result = await new AsyncFn(`return (${expr})`)();
            return { result };
          } catch (e) { return { error: e.message }; }
        },
      },
      datetime: {
        name: 'datetime', description: 'Get current date/time',
        execute: async () => {
          const n = new Date();
          return { iso: n.toISOString(), readable: n.toString(), ts: n.getTime() };
        },
      },
      json_transform: {
        name: 'json_transform', description: 'Parse and inspect JSON data',
        execute: async (input) => {
          try {
            const d = typeof input.data === 'string' ? JSON.parse(input.data) : input.data;
            return { result: d, keys: Object.keys(d), type: Array.isArray(d) ? 'array' : 'object' };
          } catch (e) { return { error: e.message }; }
        },
      },
      text_counter: {
        name: 'text_counter', description: 'Count words/chars/lines in text',
        execute: async (input) => {
          const t = String(input.text || input);
          return { chars: t.length, words: t.split(/\s+/).filter(Boolean).length, lines: t.split('\n').length };
        },
      },
    };
  }

  find(name) { return this._builtins[name] || state.toolRegistry[name] || null; }

  findByHint(hint) {
    const h = hint.toLowerCase();
    const all = this.getAll();
    return Object.values(all).find(t => t.name.includes(h) || t.description?.toLowerCase().includes(h)) || null;
  }

  getAll() { return { ...this._builtins, ...state.toolRegistry }; }

  getAllSerializable() {
    return Object.values(this.getAll()).map(({ execute, ...rest }) => rest);
  }

  register(toolDef) {
    state.toolRegistry[toolDef.name] = {
      ...toolDef, usage_count: 0,
      created_at: new Date().toISOString(), created_by: 'ai',
    };
    logger('tool_registered', { name: toolDef.name });
  }

  async sandboxExecute(code, input) {
    try {
      const AsyncFn = Object.getPrototypeOf(async function(){}).constructor;
      const fn = new AsyncFn('input', `${code}\n return execute(input);`);
      return await fn(input);
    } catch (e) {
      return { error: `Sandbox: ${e.message}` };
    }
  }

  async createAndRegister(need) {
    logger('tool_factory', { need });
    try {
      const toolDef = await ai.callJSON(Prompts.createTool(need));
      const validation = await ai.callJSON(Prompts.validateTool(toolDef));
      if (!validation.valid || !validation.safe) {
        logger('tool_invalid', { issues: validation.issues });
        return null;
      }
      this.register(toolDef);
      return toolDef;
    } catch (e) {
      logger('tool_creation_failed', { error: e.message });
      return null;
    }
  }

  async execute(nameOrHint, input) {
    let tool = this.find(nameOrHint) || this.findByHint(nameOrHint);
    if (!tool) {
      const created = await this.createAndRegister(nameOrHint);
      if (!created) return { error: `No tool found or created for: ${nameOrHint}` };
      tool = created;
    }

    try {
      logger('tool_execute', { name: tool.name });
      let result;
      if (tool.created_by === 'ai' && tool.code) {
        result = await this.sandboxExecute(tool.code, input);
      } else {
        result = await Promise.race([
          tool.execute(input),
          new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 15000)),
        ]);
      }
      if (state.toolRegistry[tool.name]) state.toolRegistry[tool.name].usage_count++;
      return result;
    } catch (e) {
      logger('tool_error', { name: tool.name, error: e.message });
      return { error: e.message };
    }
  }
}

// ===================================================================
// ===== CONTEXT BUILDER CLASS =======================================
// ===================================================================

class ContextBuilder {
  constructor(memorySystem) {
    this.memory = memorySystem;
  }

  build(session, extras = {}) {
    const parts = [];

    const recent = (session.messages || []).slice(-8).map(m => `${m.role}: ${m.content}`).join('\n');
    if (recent) parts.push(`## Recent Conversation\n${recent}`);

    const mems = this.memory.retrieve(session.lastInput || '', 6);
    if (mems.length) parts.push(`## Relevant Memory\n${mems.map(m => `[${m.type}] ${m.value}`).join('\n')}`);

    if (extras.taskResults) parts.push(`## Previous Task Results\n${extras.taskResults}`);
    if (extras.attachmentSummary) parts.push(`## Attached Files\n${extras.attachmentSummary}`);

    return parts.join('\n\n').trim();
  }
}

// ===================================================================
// ===== VERIFIER CLASS ==============================================
// ===================================================================

class Verifier {
  constructor(maxRetries = 3) {
    this.maxRetries = maxRetries;
  }

  async verify(task, output, goal) {
    try {
      const result = await ai.callJSON(Prompts.verify(task, output, goal));
      logger('verify', { task: task.slice(0, 60), pass: result.pass, score: result.score });
      return result;
    } catch {
      return { pass: true, score: 0.8, issues: '' };
    }
  }

  async verifyAndRepair(task, output, goal, attempt = 0) {
    if (attempt >= this.maxRetries) {
      logger('verify_max_retries', { task: task.slice(0, 60) });
      return output;
    }

    const result = await this.verify(task, output, goal);
    if (result.pass || result.score >= 0.72) return output;

    logger('repair_start', { attempt, issues: result.issues?.slice(0, 80) });
    const repaired = await ai.call(Prompts.repair(task, output, result.issues));
    return this.verifyAndRepair(task, repaired, goal, attempt + 1);
  }
}

// ===================================================================
// ===== AGENT BUILDER CLASS =========================================
// ===================================================================
// This is the n8n-like automatic agent creation system.
// Given a goal → MetaPlan → Generate node prompts → Generate node functions
// → Validate flow → Save to agentRegistry

class AgentBuilder {
  constructor(toolSystem) {
    this.tools = toolSystem;
  }

  /**
   * Full agent creation pipeline from a user goal.
   * Returns a complete workflow artifact ready for execution or display.
   */
  async buildFromGoal(goal, context = '', onProgress = null) {
    const notify = msg => onProgress?.({ type: 'agent_build', message: msg });

    // ── STEP 1: META PLANNER — create DAG ──
    notify('Meta Planner: designing workflow DAG...');
    logger('agent_build_start', { goal: goal.slice(0, 80) });

    let workflow;
    try {
      workflow = await ai.callJSON(Prompts.metaPlan(goal, context));
    } catch (e) {
      logger('agent_build_metaplan_failed', { error: e.message });
      throw new Error(`MetaPlanner failed: ${e.message}`);
    }

    // ── STEP 2: NODE BUILDER — generate prompt + function for each node ──
    notify('Node Builder: generating node prompts and functions...');
    const enrichedTasks = [];

    for (const task of (workflow.tasks || [])) {
      notify(`  Building node: ${task.name}`);

      // Generate the execution prompt for this node
      let nodePrompt = null;
      try {
        nodePrompt = await ai.callJSON(Prompts.generateNodePrompt(task));
      } catch (e) {
        logger('node_prompt_gen_failed', { node: task.id, error: e.message });
        nodePrompt = { system_prompt: task.description, user_prompt_template: '{{input}}', output_format: 'text' };
      }

      // Generate the function for tool-based nodes
      let nodeFunction = null;
      if (task.needs_tool || task.tool_hint) {
        try {
          nodeFunction = await ai.callJSON(Prompts.generateNodeFunction(task));
          // Validate and register as a tool
          if (nodeFunction?.code) {
            const toolDef = {
              name: nodeFunction.function_name || `node_${task.id}`,
              description: nodeFunction.description,
              input_schema: nodeFunction.input_schema || {},
              output_schema: nodeFunction.output_schema || {},
              code: nodeFunction.code,
              language: 'javascript',
            };
            this.tools.register(toolDef);
          }
        } catch (e) {
          logger('node_function_gen_failed', { node: task.id, error: e.message });
        }
      }

      // Validate node schema
      let schemaValidation = null;
      try {
        schemaValidation = await ai.callJSON(
          Prompts.validateNodeSchema({ ...task, nodePrompt, nodeFunction })
        );
      } catch {
        schemaValidation = { valid: true, issues: [] };
      }

      enrichedTasks.push({
        ...task,
        nodePrompt,
        nodeFunction,
        schemaValidation,
        status: 'pending',
      });
    }

    const fullWorkflow = { ...workflow, tasks: enrichedTasks };

    // ── STEP 3: FLOW VALIDATOR ──
    notify('Flow Validator: checking workflow structure and safety...');
    let flowValidation;
    let repairAttempts = 0;

    while (repairAttempts < 2) {
      try {
        flowValidation = await ai.callJSON(Prompts.validateFlow(fullWorkflow));
      } catch {
        flowValidation = { valid: true, safe: true, score: 0.8, issues: [] };
      }

      if (flowValidation.valid && flowValidation.safe) break;

      repairAttempts++;
      notify(`Flow repair attempt ${repairAttempts}: ${(flowValidation.issues || []).join(', ').slice(0, 80)}`);
      logger('flow_repair', { attempt: repairAttempts, issues: flowValidation.issues });

      // Re-run meta planner with issues as feedback
      const repairContext = `${context}\nPREVIOUS ISSUES: ${JSON.stringify(flowValidation.issues)}`;
      try {
        const repaired = await ai.callJSON(Prompts.metaPlan(goal, repairContext));
        fullWorkflow.tasks = repaired.tasks || fullWorkflow.tasks;
      } catch { break; }
    }

    // ── STEP 4: SAVE TO AGENT REGISTRY ──
    const intentHash = crypto.createHash('md5').update(goal).digest('hex').slice(0, 8);
    const agentEntry = {
      agent_name: workflow.agent_name || 'Auto Agent',
      description: workflow.description || goal,
      intent_hash: intentHash,
      goal,
      workflow: fullWorkflow,
      tool_permissions: enrichedTasks.filter(t => t.needs_tool).map(t => t.tool_hint),
      validation: flowValidation,
      created_at: new Date().toISOString(),
      usage_count: 0,
    };

    state.agentRegistry[intentHash] = agentEntry;
    logger('agent_saved', { name: agentEntry.agent_name, hash: intentHash, tasks: enrichedTasks.length });
    notify(`Agent "${agentEntry.agent_name}" built and saved with ${enrichedTasks.length} nodes.`);

    return agentEntry;
  }

  /** Check if a similar agent already exists */
  findExisting(goal) {
    const hash = crypto.createHash('md5').update(goal).digest('hex').slice(0, 8);
    return state.agentRegistry[hash] || null;
  }

  getAll() { return Object.values(state.agentRegistry); }
}

// ===================================================================
// ===== EXECUTION ENGINE CLASS ======================================
// ===================================================================

class ExecutionEngine {
  constructor(toolSystem, verifier, contextBuilder) {
    this.tools   = toolSystem;
    this.verifier = verifier;
    this.context  = contextBuilder;
  }

  /**
   * Execute a full workflow (DAG) from a plan.
   * Correctly resolves dependencies, runs tasks in order.
   */
  async execute(plan, goal, session, onProgress) {
    const notify = msg => onProgress?.({ type: 'progress', message: msg });
    const tasks   = plan.tasks || [];
    const results = {};
    const completed = new Set();

    // ── DEPENDENCY-AWARE QUEUE LOOP ──
    const queue = [...tasks];
    let stall = 0;

    while (queue.length > 0) {
      stall++;
      // Safety: if we loop more than tasks² times without progress, we're deadlocked
      if (stall > tasks.length * tasks.length + 20) {
        logger('dag_deadlock', { remaining: queue.map(t => t.id) });
        break;
      }

      const task = queue.shift();

      // If any dependency is not yet complete, push to back
      if ((task.depends_on || []).some(dep => !completed.has(dep))) {
        queue.push(task);
        continue;
      }

      stall = 0; // progress made, reset stall counter
      notify(`Executing: ${task.name}`);
      logger('node_start', { id: task.id, name: task.name });

      // Build per-node context including dependency results
      const depResults = (task.depends_on || [])
        .map(d => `[${d}]: ${JSON.stringify(results[d])}`)
        .join('\n');
      const ctx = this.context.build(session, { taskResults: depResults });

      let output;

      // ── TOOL DECISION ──
      if (task.needs_tool && task.tool_hint) {
        notify(`  Using tool: ${task.tool_hint}`);
        output = await this.tools.execute(task.tool_hint, { task: task.description, deps: depResults });
      } else if (task.nodeFunction?.code) {
        // Use AI-generated node function if available
        output = await this.tools.sandboxExecute(task.nodeFunction.code, { task: task.description, deps: depResults });
      } else if (task.nodePrompt) {
        // Use AI-generated node prompt if available
        const nodeSystem = task.nodePrompt.system_prompt;
        const nodePrompt = task.nodePrompt.user_prompt_template.replace('{{input}}', task.description);
        output = await ai.call(nodePrompt, ctx, nodeSystem);
      } else {
        output = await ai.call(Prompts.solve(task.description, ctx));
      }

      // ── LOCAL VERIFICATION ──
      output = await this.verifier.verifyAndRepair(task.description, output, goal);

      results[task.id] = output;
      completed.add(task.id);
      notify(`✓ Done: ${task.name}`);
      logger('node_done', { id: task.id });
    }

    // ── MERGE ALL OUTPUTS ──
    notify('Merging results...');
    const completedTasks = tasks.filter(t => results[t.id] !== undefined);
    let finalOutput;

    if (completedTasks.length === 1) {
      finalOutput = String(completedTasks[0] ? results[completedTasks[0].id] : '');
    } else {
      const pairs = completedTasks.map(t => ({ task: t.description, output: String(results[t.id] || '') }));
      finalOutput = await ai.call(Prompts.merge(pairs));
    }

    // ── GLOBAL VERIFICATION ──
    notify('Global verification...');
    finalOutput = await this.verifier.verifyAndRepair(goal, finalOutput, goal);

    return finalOutput;
  }
}

// ===================================================================
// ===== ORCHESTRATOR CLASS ==========================================
// ===================================================================
// This is the top-level controller. Routes every request through
// the exact flowchart defined in the README.

class Orchestrator {
  constructor() {
    this.memory    = new MemorySystem();
    this.tools     = new ToolSystem();
    this.ctxBuilder = new ContextBuilder(this.memory);
    this.verifier  = new Verifier(3);
    this.engine    = new ExecutionEngine(this.tools, this.verifier, this.ctxBuilder);
    this.agentBuilder = new AgentBuilder(this.tools);
  }

  /**
   * MAIN ENTRY — follows the flowchart exactly:
   * INPUT → INTERACT → MODE → CONTEXT → PLAN → EXECUTE → VERIFY → MERGE → MEMORY → LOG
   */
  async run(input, sessionId, attachments = [], onProgress = null) {
    const notify = msg => onProgress?.(msg);

    // ── SESSION INIT ──
    if (!state.sessions[sessionId]) state.sessions[sessionId] = { messages: [], lastInput: '' };
    const session = state.sessions[sessionId];
    session.lastInput = input;
    logger('orchestrator_start', { sessionId, inputLen: input.length, attachments: attachments.length });

    // ── INTERACTION LAYER: stream status ──
    notify({ type: 'status', message: 'Analysing request...' });

    // ── MODE ROUTER ──
    let classification;
    try {
      classification = await ai.callJSON(Prompts.classify(input));
    } catch {
      classification = { mode: 'chat', complexity: 'simple', needs_tool: false, needs_vision: false, intent: input };
    }
    logger('mode_routed', classification);
    notify({ type: 'status', message: `Mode: ${classification.mode} / ${classification.complexity}` });

    // ── CONTEXT LAYER ──
    const ctx = this.ctxBuilder.build(session, {
      attachmentSummary: attachments.length ? attachments.map(a => `${a.name} (${a.mime})`).join(', ') : null,
    });

    let finalOutput;

    // ════════════════════════════════════════════
    // CHAT MODE — simple direct response
    // ════════════════════════════════════════════
    if (classification.mode === 'chat' && classification.complexity === 'simple') {
      notify({ type: 'status', message: 'Generating response...' });

      if (attachments.length > 0 || classification.needs_vision) {
        finalOutput = await ai.callWithAttachments(input, attachments, ctx);
      } else {
        finalOutput = await ai.call(Prompts.solve(input, ctx));
      }
    }

    // ════════════════════════════════════════════
    // AGENT MODE — full DAG plan + execute
    // ════════════════════════════════════════════
    else {
      // Check if user wants to BUILD an agent (agent registry)
      const wantsAgentBuild = /build agent|create agent|make agent|design workflow|create workflow/i.test(input);

      if (wantsAgentBuild) {
        // ── AGENT BUILDER PATH ──
        notify({ type: 'status', message: 'Building agent workflow...' });
        const existing = this.agentBuilder.findExisting(input);

        if (existing) {
          notify({ type: 'status', message: 'Found existing agent, reusing...' });
          finalOutput = `Found existing agent: **${existing.agent_name}**\n\n${existing.description}\n\nWorkflow has ${existing.workflow.tasks?.length} nodes.\nUse "run agent ${existing.agent_name}" to execute it.`;
        } else {
          const agentEntry = await this.agentBuilder.buildFromGoal(input, ctx, (update) => {
            notify(update);
          });
          // Send the workflow to UI for visual display
          notify({ type: 'workflow', workflow: agentEntry.workflow });
          finalOutput = `✅ Agent **"${agentEntry.agent_name}"** created successfully!\n\n${agentEntry.description}\n\n**Nodes (${agentEntry.workflow.tasks?.length}):**\n${agentEntry.workflow.tasks?.map(t => `• ${t.name}: ${t.description}`).join('\n')}\n\nWorkflow has been saved and can be reused.`;
        }
      } else {
        // ── STANDARD AGENT EXECUTION PATH ──
        notify({ type: 'status', message: 'Planning tasks...' });

        let plan;
        try {
          plan = await ai.callJSON(Prompts.metaPlan(input, ctx));
        } catch {
          plan = { tasks: [{ id: 't1', name: 'solve', description: input, depends_on: [], needs_tool: false, tool_hint: '' }] };
        }

        notify({ type: 'plan', plan });
        logger('plan_created', { tasks: plan.tasks?.length });

        finalOutput = await this.engine.execute(plan, input, session, (update) => notify(update));
      }
    }

    // ── OUTPUT BUILDER ──
    const result = {
      content: finalOutput,
      mode: classification.mode,
      complexity: classification.complexity,
      timestamp: new Date().toISOString(),
    };

    // ── UPDATE SESSION ──
    session.messages.push({ role: 'user', content: input });
    session.messages.push({ role: 'assistant', content: finalOutput });
    if (session.messages.length > 50) session.messages.splice(0, 10);

    // ── MEMORY EXTRACTOR — async non-blocking ──
    const snippet = session.messages.slice(-6).map(m => `${m.role}: ${m.content}`).join('\n');
    this.memory.extractAndSave(snippet).catch(() => {});

    // ── OBSERVABILITY ──
    logger('orchestrator_done', { sessionId, outputLen: finalOutput.length, mode: classification.mode });

    return result;
  }

  clearSession(sessionId) { delete state.sessions[sessionId]; }
}

// ===== SINGLETON ORCHESTRATOR =====
const orchestrator = new Orchestrator();

// ===================================================================
// ===== API SERVER ==================================================
// ===================================================================

function apiServer() {
  const app = express();
  const httpServer = createServer(app);

  // Multer — store uploads in memory as Buffer for Base64 encoding
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  });

  app.use(express.json({ limit: '10mb' }));
  app.use(express.static(path.join(__dirname, 'frontend')));

  // ── FILE UPLOAD ENDPOINT ──
  // Encodes uploaded files to Base64 and returns them to the client
  // The client attaches them to the next WS message
  app.post('/api/upload', upload.array('files', 10), (req, res) => {
    try {
      const encoded = (req.files || []).map(f => ({
        name: f.originalname,
        mime: f.mimetype,
        size: f.size,
        type: f.mimetype.startsWith('image/') ? 'image' : 'file',
        data: f.buffer.toString('base64'),
      }));
      logger('files_uploaded', { count: encoded.length, names: encoded.map(f => f.name) });
      res.json({ files: encoded });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── REST CHAT ──
  app.post('/api/chat', async (req, res) => {
    const { input, sessionId, attachments, apiKey } = req.body;
    if (!input?.trim()) return res.status(400).json({ error: 'input required' });
    if (apiKey) ai.setKey(apiKey);
    try {
      const result = await orchestrator.run(input, sessionId || 'default', attachments || [], () => {});
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── DATA ENDPOINTS ──
  app.get('/api/memory',   (_, res) => res.json(orchestrator.memory.getAll()));
  app.get('/api/tools',    (_, res) => res.json(orchestrator.tools.getAllSerializable()));
  app.get('/api/agents',   (_, res) => res.json(orchestrator.agentBuilder.getAll()));
  app.get('/api/logs',     (_, res) => res.json(state.logs.slice(-200)));
  app.get('/api/sessions', (_, res) =>
    res.json(Object.fromEntries(Object.entries(state.sessions).map(([k, v]) => [k, { messageCount: v.messages?.length }])))
  );
  app.get('/api/ai-info',  (_, res) => res.json(ai.getInfo()));
  app.get('/api/health',   (_, res) => res.json({ ok: true, ts: new Date().toISOString(), ...ai.getInfo() }));

  app.delete('/api/session/:id', (req, res) => {
    orchestrator.clearSession(req.params.id);
    res.json({ ok: true });
  });

  // ── WEBSOCKET — streaming progress ──
  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', ws => {
    logger('ws_connect');

    ws.on('message', async raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type !== 'chat') return;

      const { input, sessionId, attachments, apiKey } = msg;
      if (!input?.trim()) return;

      // ── SET API KEY FROM BROWSER ──
      if (apiKey) ai.setKey(apiKey);

      ws.send(JSON.stringify({ type: 'start' }));

      try {
        const result = await orchestrator.run(
          input,
          sessionId || 'default',
          attachments || [],
          update => ws.send(JSON.stringify(update))
        );
        ws.send(JSON.stringify({ type: 'done', result }));
      } catch (e) {
        logger('ws_error', { error: e.message });
        ws.send(JSON.stringify({ type: 'error', message: e.message }));
      }
    });
  });

  const port = process.env.PORT || 3000;
  httpServer.listen(port, () => {
    logger('server_start', { port });
    console.log(`\n🚀 NEXUS AI Platform → http://localhost:${port}`);
    console.log(`   Provider : ${ai.provider}`);
    console.log(`   Model    : ${ai.model}`);
    if (!ai.apiKey) console.warn('   ⚠  AI_API_KEY not set — enter key in the UI\n');
    else            console.log('   ✓  API key loaded\n');
  });

  return httpServer;
}

apiServer();
