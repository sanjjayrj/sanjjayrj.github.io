---
title: "Grimoire"
subtitle: "AI-Native Workflow Automation Platform"
tags: ["FastAPI", "Claude AI", "React", "PostgreSQL", "Docker", "WebSocket", "WhatsApp", "ELK.js"]
image: null
liveUrl: "https://grimoire-automation-app.vercel.app"
githubUrl: null
status: "live"
---

## Overview

Grimoire is an AI-native workflow automation platform — self-hostable or cloud-hosted. Describe what you want automated in plain English, and Grimoire compiles it into a verified, inspectable workflow DAG that runs on a schedule, webhook, or on demand.

Built for individuals and teams who want the power of n8n or Zapier without the click-heavy configuration, with Claude as the workflow compiler and runtime brain.

## How It Works

Write one sentence. Grimoire's multi-agent compiler — Orchestrator → parallel Step Generators → Data Flow Resolver — produces a typed, policy-checked workflow DAG. Not pseudocode, not a suggestion: a machine-executable definition with typed inputs and outputs at every edge.

```
"Every Monday, pull unread Gmail bills, extract amounts and due dates,
log to Sheets, and send me a WhatsApp summary with any unusual amounts flagged."
```

That compiles into: polling trigger → LLM parse step → branch step (anomaly check) → tool steps (Sheets append, WhatsApp send) → wait step (approval gate if anomaly detected).

## Key Features

**Visual DAG Editor** — Full-screen React Flow canvas with ELK.js auto-layout. Every step type has its own node component. Live execution overlay: steps turn green or red as they run via WebSocket. Fork-join rendering for parallel branches, drill-down drawers for subworkflows, Cmd+F step search, full undo/redo.

**Simulate Before You Ship** — Every workflow runs in simulation mode by default. No real API calls, no data written. Per-step mock editor lets you define what each connector returns and test branch logic against realistic data. Switch to live with one toggle and a confirmation gate.

**Human Approval Gates** — Any step can be a gate. When confidence falls below a threshold, or when a write action needs sign-off, the run pauses. Resume via the Studio UI, the API, or a WhatsApp reply. 24-hour timeout with configurable escalation.

**WhatsApp Native (Hedwig)** — WhatsApp is a trigger, a notification channel, and a conversational interface. Text Hedwig to trigger workflows, ask questions about run history, or request new automations. Hedwig replies in plain English after every run.

**Extend With Any API** — REST connectors via JSON config, OpenAPI spec import, database connectors, GraphQL, MCP servers, OAuth2 apps. The compiler auto-generates connectors for unknown APIs at compile time.

**Agents** — Named AI personas with persistent memory, configurable triggers, and channel assignments. Hedwig (WhatsApp) is seeded automatically. Build custom agents with their own system prompts and memory scope.

**Cost Tracking** — Per-step and per-run LLM cost tracking built into the execution engine.

## Architecture

```
User → Natural Language Prompt
          ↓
  Multi-Agent Compiler
  (Orchestrator → Step Generators → Data Flow Resolver)
          ↓
  Workflow DAG (typed, policy-checked)
          ↓
  Runtime Engine
  ├── Connectors (real / simulation)
  ├── LLM Layer (parse, generate, recover)
  ├── Scheduler (APScheduler)
  └── WebSocket (live step status)
          ↓
  User Context Memory
  (entities, patterns, cost)
```

**Backend:** FastAPI with async support, PostgreSQL via SQLAlchemy, APScheduler for cron/polling triggers, WebSocket for real-time execution streaming.

**Frontend:** React with React Flow for the DAG canvas, ELK.js for auto-layout, real-time WebSocket overlays.

**Self-hostable:** One Docker Compose command. Bring your own Postgres, Anthropic key, and Google OAuth credentials.
