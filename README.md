# Self-Building AI Platform

## Goal

This project is a single AI platform that works as a chatbot, an agent builder, a memory-aware assistant, and a tool-using execution system. It accepts user input, decides whether the task is simple or complex, retrieves relevant memory, splits large work into smaller steps when needed, verifies each part, merges the results into one final response, and stores useful information for future use. It can also create its own workflow when the task requires a custom agent. When the AI is not accurate enough by itself, it can call functions, execute Python or JavaScript, use free APIs like calculator, forecast, Wikipedia, or generate complex files such as PPTs. The same system handles chat, planning, execution, verification, memory, tools, and self-built agent flows in one platform.

## Single Flowchart

```text
START
  ↓
USER INPUT
  ↓
MODE SELECTOR
  ├── CHAT MODE
  │     ↓
  │   DIRECT RESPONSE FLOW
  │
  ├── AGENT MODE
  │     ↓
  │   META PLANNER
  │   [create flowchart / task graph]
  │     ↓
  │   NODE BUILDER
  │   [create prompt + logic for each node]
  │     ↓
  │   FLOW VALIDATOR
  │   [check flow usability]
  │     ↓
  │   IF FLOW FAILS → REPAIR FLOW LOOP
  │     ↓
  │   EXECUTION ENGINE
  │
  └── AUTO MODE
        ↓
      DECIDE CHAT OR AGENT
        ↓
      GO TO RIGHT FLOW

EXECUTION ENGINE
  ↓
INPUT ANALYZER
  [detect size, complexity, memory need]
  ↓
MEMORY RETRIEVAL (RAG)
  [fetch relevant past memory]
  ↓
CONTEXT BUILDER
  [input + memory + history]
  ↓
IF INPUT TOO LARGE?
  ├── YES → SPLIT INPUT → SUMMARIZE CHUNKS → MERGE SUMMARIES
  └── NO  → CONTINUE
  ↓
TASK PLANNER
  [break work into tree]
  ↓
TASK TREE
  ROOT
   ├── TASK A
   ├── TASK B
   │     ├── SUBTASK B1
   │     └── SUBTASK B2
   └── TASK C
  ↓
ARE TASKS INDEPENDENT?
  ├── YES → PARALLEL EXECUTION
  └── NO  → SEQUENTIAL EXECUTION
  ↓
WORKER NODES
  [solve each part]
  ↓
FOR EACH TASK:
  ├── TOOL DECIDER
  │   [does this need code/tool?]
  │
  ├── YES → TOOL SELECTOR
  │         [calculator / api / python / js]
  │         ↓
  │         CODE GENERATOR
  │         [generate code]
  │         ↓
  │         CODE EXECUTOR
  │         [run python/js safely]
  │         ↓
  │         TOOL RESULT
  │
  └── NO → AI WORKER
            [normal response]
  ↓
LOCAL VERIFICATION
  [check each node output]
  ↓
IF LOCAL VERIFY FAILS?
  ├── YES → RETRY FAILED NODE
  └── NO  → CONTINUE
  ↓
STORE INTERMEDIATE RESULTS
  ↓
MERGE / AGGREGATE
  [combine all parts]
  ↓
IF OUTPUT TOO LARGE?
  ├── YES → SPLIT OUTPUT → BUILD CHUNKS → STITCH FINAL ANSWER
  └── NO  → CONTINUE
  ↓
GLOBAL VERIFICATION
  [check full response against goal]
  ↓
IF GLOBAL VERIFY FAILS?
  ├── YES → REPAIR LOOP → FIX BROKEN PARTS → REVERIFY
  └── NO  → FINAL RESPONSE
  ↓
MEMORY EXTRACTION
  [save useful facts, preferences, goals]
  ↓
MEMORY STORAGE
  [structured memory + embeddings]
  ↓
END
```

## Features

* Chat mode for direct replies
* Agent mode for self-built workflows
* Auto mode for automatic mode selection
* Long input handling with split and summary
* Long output handling with chunking and stitching
* Memory retrieval with RAG
* Task tree planning
* Parallel and sequential execution
* Local verification for each step
* Global verification for the final response
* Repair loop for failed parts
* Memory extraction after successful completion
* Function calling for tools and APIs
* Python execution for complex tasks
* JavaScript execution for browser-side or lightweight tasks
* Free tool support like calculator, forecast, Wikipedia, and other public APIs
* Complex file generation tasks like PPT creation
* Reusable architecture for future tasks

## Tool Calling Layer

The platform includes a tool decision layer that checks whether the AI should answer directly or call a function.

### Supported Tool Types

* Calculator
* Date and time
* Weather or forecast API
* Wikipedia API
* Search or lookup APIs
* Python code execution
* JavaScript code execution
* File generation tools
* Data processing tools

### Tool Decision Flow

```text
Task received
  ↓
Need tool?
  ├── No → AI answer directly
  └── Yes → select tool
              ↓
           generate code or request
              ↓
           execute safely
              ↓
           return result
              ↓
           verify result
```

## Example Tool Use Cases

### Calculator

* Math operations
* Percentages
* Unit conversions
* Formula solving

### Forecast

* Weather lookup
* Temperature and condition data
* Location-based queries

### Wikipedia API

* General knowledge lookup
* Summaries of topics
* Entity information

### Python Execution

* Generate PPT files
* Build spreadsheets
* Process data
* Create reports
* Run complex logic

### JavaScript Execution

* Browser-side logic
* UI-related tasks
* Fast calculations
* Small transformation tasks

## System Structure

* Input layer
* Mode selector
* Agent builder
* Execution engine
* Tool calling layer
* Verification system
* Memory system
* Repair system
* Final response builder

## Memory System

Memory is used to make the platform adaptive over time.

### Memory Flow

```text
Response
  ↓
Extract Important Data
  ↓
Store Structured Memory
  ↓
Retrieve in Future Queries
```

### What to Store

* User preferences
* Repeated goals
* Stable project information
* Important task context
* Reusable workflow data

### What Not to Store

* Temporary messages
* One-time details
* Noise from long outputs
* Low-value repeated content

## Verification System

The system verifies work at multiple levels.

### Local Verification

Checks each step or node individually.

### Merge Verification

Checks whether all parts fit together correctly.

### Global Verification

Checks whether the final response fully satisfies the original goal.

### Repair Loop

If verification fails, the system fixes only the broken part instead of restarting everything.

## Large Input Handling

If input is too long, the system automatically splits it into chunks, summarizes each chunk, and merges the summaries into a compact task representation before continuing.

## Large Output Handling

If the final answer is too big, the system splits the output into parts, builds them in sequence, and stitches them into one clean response.

## Agent Builder

The agent builder is the self-creating part of the platform.

### Flow

```text
User Goal
  ↓
AI creates flowchart JSON
  ↓
AI creates nodes with prompts and logic
  ↓
Validate the flow
  ↓
Execute using the engine
```

This allows the chatbot to become an agent builder when needed.

## Example Agent Flow

```json
{
  "tasks": [
    "analyze input",
    "generate output",
    "call tools if needed",
    "validate result",
    "merge response"
  ]
}
```

## Example Use Cases

* Ask a normal question and get a direct answer
* Ask for a complex answer and let the system split it into steps
* Ask for a calculation and let the tool system solve it exactly
* Ask for a weather lookup and use the forecast tool
* Ask for a PPT and use Python to generate the file
* Ask for a reusable workflow and let the AI create an agent flow
* Ask for a large structured response and let the system build it safely

## Safety and Limits

The platform should include limits for:

* Maximum task depth
* Maximum retries
* Maximum number of nodes
* Tool execution timeout
* Safe code execution rules
* Input and output size controls

## Future Improvements

* Visual flow builder UI
* Saved reusable agents
* Better tool routing
* Vector database integration
* Multi-model orchestration
* Real-time streaming outputs
* Automatic workflow optimization
* More advanced code execution sandboxing

## Conclusion

This platform combines chatbot behavior, agent creation, memory, verification, and tool calling into one system. It is designed to handle simple and complex tasks in a single architecture, using AI reasoning where possible and code execution where needed. The result is a self-building, self-executing, and self-improving AI platform.
