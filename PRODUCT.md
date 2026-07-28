# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
DevOps engineers, sysadmins, container operators, and infrastructure leads managing multi-endpoint Docker & Portainer fleets.

## Product Purpose
Real-time container operations platform extending Portainer with live metrics monitoring, multi-method anomaly detection, AI-powered root cause analysis, and automated remediation workflows.

## Positioning
An AI-powered Portainer companion dashboard built around an observer-first philosophy: deep visibility, live telemetry, and intelligent insights, with container-mutating actions gated behind strict multi-step approval workflows.

## Operating Context
Multi-endpoint Portainer environments, Docker infrastructure monitoring, live incident analysis, distributed tracing, packet capture (PCAP), and interactive conversational AI assistance.

## Capabilities and Constraints
- Monorepo structure with Fastify 5 backend, React 19 + Vite frontend, PostgreSQL, TimescaleDB, and Redis.
- Portainer telemetry via live `/docker/info` polling.
- Strict Observer-First Model: Mutating container actions require Admin role and explicit Remediation Approval.
- OpenAI-compatible LLM client guarded centrally by prompt-injection filters.

## Brand Commitments
- Name: AI Portainer Dashboard (Container Insights)
- Aesthetic: Modern, premium glassmorphic visual system with bento-grid layouts, backdrop blur cards, dark/light theme engines, smooth micro-interactions, and vibrant data visualizers.

## Evidence on Hand
Fully functional codebase with 9 workspace packages (`packages/*`), React 19 frontend with Tailwind CSS v4, Framer Motion (`LazyMotion`), Recharts, TanStack Query, Radix UI, and full-featured UI components.

## Product Principles
1. Observer-First Integrity — Visibility comes first; actions require explicit human approval.
2. Visual Excellence — High-contrast typography, harmonious color systems, glassmorphism, and responsive bento grids.
3. Real-Time Telemetry — Fast, cached background polling with immediate UI feedback and auto-refresh invalidation.
4. AI-Augmented Operations — Streamlined NLP log analysis, anomaly explanations, and interactive assistant chat.
