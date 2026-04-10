# Yuba Raj Khadka (Yubi)

**Senior AI Engineer**

Melbourne, Australia • ubrajkhadka@gmail.com • [yubikhadka.com](https://yubikhadka.com) • [linkedin.com/in/ubrajkhadka](https://linkedin.com/in/ubrajkhadka) • [github.com/yubi00](https://github.com/yubi00)

---

## Profile

Senior software engineer specialising in applied LLM and agent systems — building production AI features from prompt design and RAG through to multi-agent architectures using the Model Context Protocol, AWS Bedrock, and the OpenAI and Anthropic APIs. Backed by 4.5+ years shipping cloud-native backends on Node.js, TypeScript, and AWS serverless, bringing the production rigour (auth, multi-tenancy, observability, CI/CD) that turns AI prototypes into reliable products.

---

## Core Skills

- **AI / LLM:** OpenAI API, Anthropic Claude API, AWS Bedrock & Bedrock Agents, Model Context Protocol (MCP), AWS Strands, RAG, prompt engineering, context engineering, tool use, single-agent and multi-agent patterns, streaming (SSE / chunked HTTP)
- **Languages:** TypeScript, JavaScript, Node.js, Python
- **Backend:** GraphQL (AppSync, VTL), REST, FastAPI, event-driven architectures
- **Cloud / Infra:** AWS Lambda, DynamoDB, S3, Cognito, CloudFront, AWS CDK, Google Cloud Run, Vercel, Render
- **Data:** DynamoDB, MongoDB, PostgreSQL (Neon), Redis / Valkey
- **DevOps:** GitLab CI/CD, Infrastructure as Code, CloudWatch observability

---

## Selected AI Projects

### Conor AI — In-Product LLM Assistant (FifthDomain)
- LLM-powered assistant embedded in cybersecurity challenges, assessments, and competitions; uses context injection (challenge metadata, learning objectives) to keep responses grounded and pedagogically useful.
- OpenAI Assistants API, streaming via AWS Lambda Function URLs (chunked HTTP), with guardrails to avoid revealing solutions.

### Bedrock Agent — Event Creation System
- AWS Bedrock Agent with Lambda action groups that turn natural-language requests into validated event creation workflows, replacing manual multi-step admin flows.
- Designed action group schemas, prompt scaffolding, and Lambda backends to handle tool calls reliably.

### NL Query Agent — Multi-Agent AWS Strands Pipeline
- Three-agent architecture (Analyser → Planner → Executor) built on AWS Strands that translates analyst questions into executable queries, plans the steps, and runs them safely.
- Demonstrates separation of reasoning, planning, and execution — a pattern that scales to richer agentic workflows without one monolithic prompt.

### MCP Terminal Portfolio — yubikhadka.com
- Interactive terminal-style portfolio where an LLM answers questions about my work using a custom MCP server with intent-based tools (projects, experience, skills, contact).
- Stack: Vite/React on Vercel, FastAPI client on Render, custom MCP server on Google Cloud Run, Neon Postgres for visitor analytics, Server-Sent Events for streaming responses.

### MatchCast — AI Pundit Audio for EPL Matches
- Full-stack EPL match analysis tool: GPT-4o generates pundit-style verdicts and ElevenLabs renders them as natural audio commentary; Redis/Valkey caching and UploadThing for audio persistence.
- Built as a technical assessment, now maintained as a portfolio piece on Render's free tier; deliberately avoided agent overhead to keep latency and cost predictable.

---

## Experience

### Senior Backend Developer — FifthDomain, Canberra ACT
*Dec 2024 – Jan 2026*

- Designed and shipped Conor AI, an LLM-powered assistant integrated into challenges, assessments, and competitions, helping users get unstuck without breaking learning flow.
- Built per-challenge assistants on the OpenAI Assistants API with context injection from challenge metadata; streamed responses to the browser via chunked HTTP through AWS Lambda Function URLs.
- Owned backend architecture across the platform — AWS CDK, AppSync, Lambda, DynamoDB — supporting multi-tenant workloads for government, defence, and university clients.
- Implemented field-level GraphQL authorisation and scoped IAM per resolver to enforce tenant data isolation across a shared multi-tenant data layer.
- Solved CloudFormation cross-stack reference limits with a consistent-hashing sharding approach, unblocking continued growth of the CDK infrastructure.
- Built an SES/SNS/SQS email observability pipeline and engagement analytics powering insights across assessments and courses.
- Hardened CI/CD on GitLab and improved reliability with CloudWatch monitoring and caching strategies.

### Software Engineer — FifthDomain, Canberra ACT
*Jul 2022 – Dec 2024*

- Modernised the platform on AWS serverless with Node.js, GraphQL, and React, partnering with product and design to ship production features.
- Established CI/CD workflows enabling frequent, reliable deployments.
- Investigated and resolved production incidents, improving overall system reliability.

### Junior Software Engineer — FifthDomain, Canberra ACT
*Jun 2021 – Jul 2022*

- Developed early platform features and shared component libraries with React and Material UI.
- Contributed to migrating legacy systems onto AWS infrastructure and modern tooling.
- Participated in code reviews and collaborative development.

---

## Education

- **Master of Information Technology** — La Trobe University, Melbourne (High Distinction)
- **BSc (Hons) Computing** — Islington College / London Metropolitan University

---

## Certifications

- AWS Certified Developer – Associate
- Red Hat Certified Engineer (RHCE)
- Red Hat Certified System Administrator (RHCSA)
