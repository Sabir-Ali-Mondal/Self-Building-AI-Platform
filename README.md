# Self-Building AI Platform

## Goal

This project is a single AI platform that combines chat, memory, retrieval, agent building, dynamic tool creation, code execution, verification, and repair into one system. It should handle simple questions directly, handle complex work by breaking it into a task graph, retrieve relevant memory and knowledge when needed, create tools dynamically when no ready-made tool exists, save those tools for later use, call tools or code when the model is not reliable enough, verify every step, repair failed parts, and return one final response. The same platform should also be able to create reusable agent workflows automatically, so one project can support both normal chatting and self-built agent mode without splitting into separate systems.

## What This Platform Solves

* Direct answers for simple tasks
* Multi-step planning for complex tasks
* Reusable agent creation from a user goal
* Memory retrieval for long-running context
* Dynamic tool creation when no ready-made tool exists
* Tool reuse from a saved registry
* Python and JavaScript execution for complex operations
* Long input handling without losing important details
* Long output handling without breaking the response
* Step-level verification and full-response verification
* Repair loops for failed parts only
* Persistent memory with update and conflict handling
* Safe execution through sandboxing, permissions, and limits

## Core Design Principles

* Keep orchestration, memory, execution, evaluation, governance, and tool creation separate.
* Do not mix planning logic with execution logic.
* Store only useful, stable memory.
* Use retrieval instead of dumping all history into context.
* Create a tool only when it is needed and no reusable tool exists.
* Save generated tools for later reuse.
* Use code or tools when accuracy matters more than model guessing.
* Verify locally first, then verify the merged result.
* Repair only the failed part instead of rerunning everything.
* Treat complex work as a graph, not a single prompt.
* Make every module communicate through a strict contract.

## Layered Architecture

### 1. Interaction Layer

Responsible for UI, API requests, chat streaming, and user session handling.

Input:

* User message
* Button actions
* Agent mode selection

Output:

* Structured request for the orchestrator

### 2. Orchestration Layer

Responsible for deciding what should happen next.

Main jobs:

* Detect task complexity
* Select chat mode, agent mode, or auto mode
* Create a plan or workflow artifact
* Route tasks to the right execution path
* Decide when tools, retrieval, or code are needed
* Decide when a new tool must be created

### 3. Context Layer

Responsible for providing relevant information.

Subsystems:

* Short-term conversation context
* Long-term memory
* RAG retrieval from indexed memory or documents
* Task state and intermediate summaries

### 4. Execution Layer

Responsible for doing the work.

Subsystems:

* AI worker nodes
* Tool caller
* Tool factory
* Python executor
* JavaScript executor
* API connectors
* File generation workers

### 5. Evaluation Layer

Responsible for checking correctness.

Subsystems:

* Local verifier for each node
* Merge verifier for combined output
* Global evaluator for the full answer
* Repair controller for failed parts

### 6. Governance Layer

Responsible for platform safety and control.

Subsystems:

* Permission rules
* Tool access control
* Rate limits
* Retry limits
* Execution timeouts
* Logging and observability
* Memory policies
* Audit trail

## Single Detailed Flowchart

```text
START PLATFORM
  ↓
USER INPUT / GOAL
  ↓
INTERACTION LAYER
  - capture message, button click, or agent request
  - stream status updates to UI
  ↓
MODE SELECTOR
  - Chat Mode
  - Agent Mode
  - Auto Mode
  ↓
{MODE?}
  ├── CHAT MODE
  │     ↓
  │   ORCHESTRATOR
  │   - analyze complexity
  │   - detect memory need
  │   - detect tool need
  │   - detect whether a tool must be created
  │     ↓
  │   CONTEXT LAYER
  │   - retrieve relevant memory
  │   - retrieve relevant RAG chunks
  │   - build compact working context
  │     ↓
  │   DIRECT EXECUTION
  │   - answer directly if simple
  │   - use existing tool if available
  │   - create new tool if needed and allowed
  │     ↓
  │   VERIFICATION LAYER
  │   - local check
  │   - global check
  │     ↓
  │   FINAL RESPONSE
  │
  ├── AGENT MODE
  │     ↓
  │   META PLANNER
  │   - create workflow JSON
  │   - create task graph / DAG
  │   - define node contracts
  │   - define tool needs per node
  │     ↓
  │   NODE BUILDER
  │   - create prompts
  │   - create node I/O schema
  │   - define tools and validators
  │     ↓
  │   FLOW VALIDATOR
  │   - check schema
  │   - check dependencies
  │   - check retry limits
  │   - check tool registry matches
  │     ↓
  │   {FLOW VALID?}
  │     ├── NO → REPAIR FLOW LOOP
  │     │          - fix graph
  │     │          - fix prompts
  │     │          - fix tool references
  │     │          - validate again
  │     └── YES
  │            ↓
  │      EXECUTION ENGINE
  │
  └── AUTO MODE
        ↓
      ROUTER
      - score task complexity
      - score tool need
      - score memory need
      - score reuse potential
      - score agent reuse potential
        ↓
      {ROUTE?}
        ├── SIMPLE → CHAT PATH
        └── COMPLEX → AGENT PATH

EXECUTION ENGINE
  ↓
INPUT ANALYZER
  - detect task size
  - detect dependency depth
  - detect whether input is a large document
  - detect whether this needs retrieval
  - detect whether this needs tools
  - detect whether this needs tool creation
  ↓
{INPUT TOO LARGE?}
  ├── YES → LARGE INPUT HANDLER
  │          - split into semantic chunks
  │          - index chunks for retrieval
  │          - summarize only when needed
  │          - preserve exact text in retrievable storage
  └── NO → continue
  ↓
CONTEXT BUILDER
  - user request
  - recent messages
  - short-term state
  - relevant long-term memory
  - relevant retrieved chunks
  - workflow state
  ↓
TASK PLANNER
  - convert goal into a DAG or tree
  - attach contracts to every node
  - mark dependencies explicitly
  - mark parallel-safe nodes
  ↓
TASK GRAPH
  ROOT GOAL
   ├── NODE A
   ├── NODE B
   │     ├── NODE B1
   │     └── NODE B2
   └── NODE C
  ↓
{NODES INDEPENDENT?}
  ├── YES → PARALLEL SCHEDULER
  │          - run independent nodes together
  │          - merge only after dependencies resolve
  └── NO → SEQUENTIAL SCHEDULER
            - run dependent nodes step by step
  ↓
FOR EACH NODE
  ↓
TOOL DECIDER
  - decide if reasoning alone is enough
  - decide if a tool or code is needed
  - decide if a new tool must be created
  ↓
{TOOL NEEDED?}
  ├── NO → AI WORKER
  │         - solve node directly
  │
  └── YES → TOOL CHECKER
            - search tool registry
            - look for exact or similar tool
            ↓
            {EXISTING TOOL AVAILABLE?}
              ├── YES → USE EXISTING TOOL
              │          ↓
              │    TOOL EXECUTOR
              │    - call existing function or code
              │    - run in sandbox if needed
              │          ↓
              │    TOOL RESULT NORMALIZER
              │
              └── NO → TOOL FACTORY
                       - define tool goal
                       - generate code
                       - create input/output schema
                       - define language and runtime
                       ↓
                     TOOL VALIDATOR
                       - check correctness
                       - check safety
                       - check schema
                       - run test input
                       ↓
                     {TOOL VALID?}
                       ├── NO → TOOL REPAIR LOOP
                       │          - fix code
                       │          - validate again
                       └── YES → TOOL REGISTRY SAVE
                                - store tool for later use
                                - update usage metadata
                                ↓
                              TOOL EXECUTOR
                                - run created tool
                                ↓
                              TOOL RESULT NORMALIZER

  ↓
LOCAL VERIFICATION
  - check node output against contract
  - check type, completeness, and format
  - check tool result relevance
  ↓
{LOCAL VERIFY PASS?}
  ├── NO → NODE REPAIR LOOP
  │          - retry only failed node
  │          - max retry limit enforced
  │          - if still failing, escalate
  └── YES → STORE INTERMEDIATE RESULT
  ↓
MERGE / AGGREGATE
  - combine node outputs
  - remove duplication
  - preserve ordering
  - reconcile references and assumptions
  ↓
{OUTPUT TOO LARGE?}
  ├── YES → OUTPUT BUILDER
  │          - split answer into sections
  │          - build in chunks
  │          - stitch into one final response
  └── NO → continue
  ↓
GLOBAL VERIFICATION
  - check full response against original goal
  - check consistency across sections
  - check missing requirements
  - check whether all node contracts are satisfied
  - check if tool outputs were used correctly
  ↓
{GLOBAL VERIFY PASS?}
  ├── NO → REPAIR CONTROLLER
  │          - identify broken nodes or merge gaps
  │          - repair only the failed parts
  │          - re-run verification
  └── YES → FINAL RESPONSE
  ↓
MEMORY EXTRACTOR
  - extract stable facts
  - extract preferences
  - extract ongoing goals
  - extract reusable workflow data
  - ignore temporary noise
  ↓
MEMORY POLICY CHECK
  - resolve conflicts
  - update outdated memory
  - attach confidence and timestamp
  - prune low-value entries
  ↓
MEMORY STORE
  - structured memory
  - embeddings for retrieval
  - agent registry for reusable workflows
  - tool registry for reusable tools
  ↓
OBSERVABILITY / LOGGING
  - record tool usage
  - record retries and failures
  - record latency and cost
  - record verification results
  - record tool creation history
  ↓
END
```

## Memory System

The memory system should not store everything. It should store only stable and useful information that may matter later.

### Store

* User preferences
* Stable project goals
* Verified facts
* Reusable workflow templates
* Reusable tool definitions
* Long-running task state

### Do Not Store

* Temporary answers
* Failed attempts
* Repeated noise
* Raw unfiltered tool outputs
* One-time details with no future value

### Memory Record Shape

```json
{
  "value": "User prefers JavaScript-based implementation",
  "type": "preference",
  "source": "conversation",
  "confidence": 0.92,
  "timestamp": "2026-04-16",
  "expiry": null
}
```

## Retrieval System

RAG should search meaning, not just exact text. Large chats or documents should be chunked semantically, embedded, and indexed so the system can retrieve the right part later.

### Retrieval Flow

```text
User Query
  ↓
Query Rewrite
  ↓
Embedding Search + Keyword Search + Recency Filter
  ↓
Top Relevant Chunks
  ↓
Context Builder
  ↓
Model
```

## Agent Builder

The agent builder is the self-creating part of the platform. It should turn a user goal into a workflow artifact that can be reused later.

### Agent Builder Flow

```text
User Goal
  ↓
Meta Planner
  ↓
Workflow JSON / DAG
  ↓
Node Builder
  ↓
Schema Validation
  ↓
Simulation or Dry Run
  ↓
Execution
  ↓
Agent Registry Storage
```

## Tool Factory

The tool factory is the self-extending part of the platform. It creates new tools when no reusable tool exists.

### Tool Lifecycle

```text
Need Tool
  ↓
Search Tool Registry
  ↓
{Tool Exists?}
  ├── Yes → Use Existing Tool
  └── No  → Create Tool
                ↓
           Generate Code
                ↓
           Validate Tool
                ↓
           Save to Tool Registry
                ↓
           Execute Tool
                ↓
           Return Result
```

### Tool Representation

```json
{
  "name": "ppt_generator",
  "description": "create ppt from topic",
  "input_schema": {
    "topic": "string",
    "slides": "number"
  },
  "output_schema": {
    "file": "pptx"
  },
  "code": "python code here",
  "language": "python",
  "created_by": "ai",
  "created_at": "2026-04-16",
  "usage_count": 0
}
```

### Tool Rules

* Keep tools small and focused
* Give each tool a clear input and output schema
* Validate before saving
* Run in sandboxed execution
* Track usage and version history
* Merge or remove unused tools over time

## Tool Calling Layer

The tool layer is used when the model should not guess.

### Supported Tool Types

* Calculator
* Forecast or weather API
* Wikipedia API
* Search or lookup API
* Python execution
* JavaScript execution
* File generation tools
* Data processing tools
* AI-generated custom tools

### Tool Decision Rule

Use a tool when the task needs:

* Exact computation
* Up-to-date external data
* File generation
* Structured data transformation
* Repeated logic better handled in code
* A new capability that should be saved as a reusable tool

## Safety and Limits

The platform must include strict limits.

* Maximum task depth
* Maximum retry count
* Maximum parallel nodes
* Tool timeouts
* Code sandboxing
* Permission control
* Cost controls
* Memory pruning
* Conflict resolution
* Tool creation validation

## Verification System

Verification must happen at multiple levels.

* Local verification: checks one node
* Merge verification: checks combined parts
* Global verification: checks the full answer
* Repair loop: fixes only the failed part

## Failure Types

The system should classify failures separately.

* Planning failure
* Tool failure
* Tool creation failure
* Code execution failure
* Retrieval failure
* Merge failure
* Global verification failure
* Timeout failure
* Safety failure

## Reusable Agent Registry

When a workflow passes validation, save it so it can be reused later instead of being rebuilt every time.

### Registry Entry

```json
{
  "agent_name": "PPT Generator",
  "intent_hash": "...",
  "workflow": {},
  "tool_permissions": [],
  "created_at": "2026-04-16"
}
```

## Reusable Tool Registry

When a tool is created and validated, save it so later tasks can use it immediately.

### Registry Entry

```json
{
  "tool_name": "weather_fetcher",
  "version": "1.0",
  "language": "python",
  "schema": {},
  "code": "...",
  "usage_count": 0,
  "created_at": "2026-04-16"
}
```

## Observability

Add logging for:

* plan creation
* node execution
* tool usage
* tool creation
* retries
* verification results
* memory updates
* latency
* token usage
* failures

## Future Improvements

* Visual flow builder UI
* Saved reusable agents
* Saved reusable tools
* Better tool routing
* Vector database integration
* Multi-model orchestration
* Streaming intermediate progress
* Stronger sandboxing
* Better memory decay and conflict resolution
* Workflow and tool simulation before execution

## Conclusion

This platform is designed to be one unified AI system instead of multiple separate projects. It can chat directly, build and reuse agents, retrieve memory intelligently, create tools dynamically, call tools when needed, execute code safely, verify each step, repair failures, and store only meaningful memory. The key improvements over the earlier version are clear module boundaries, DAG-based planning, safer memory policy, tool governance, sandboxed execution, dynamic tool creation, and multi-stage verification. This makes the system much closer to a production-ready AI platform.
