# Product Requirements Document (PRD)

## 1. Overview

This document outlines the design and implementation plan for adding a **real-time AI voice chat feature** to the existing AI-powered portfolio terminal.

The feature enables users to have a **1:1 audio conversation with an AI version of Yubi**, powered by the **OpenAI Realtime API** (WebSocket-based, handling STT + LLM + TTS in a single unified session), with future extensibility to video/avatar-based interaction.

---

## 2. Goals

### Primary Goals
- Enable real-time **audio-to-audio conversation**
- Achieve **low latency (<800ms to first response)**
- Support **interruptions (barge-in)**
- Maintain **natural conversational flow**

### Secondary Goals
- Reuse existing knowledge (resume, projects, RAG)
- Keep system **low-cost and scalable for low traffic**
- Extend to video/avatar in future

---

## 3. Non-Goals (MVP)

- Multi-user or group calls
- Recording or playback
- Perfect factual accuracy on first response
- Real-time GitHub API calls

---

## 4. Key Design Principles

1. **Speed over accuracy (first response)**
2. **Precomputed knowledge over live fetching**
3. **Streaming over blocking responses**
4. **Separation of concerns (voice vs terminal system)**

---

## 5. High-Level Architecture

```mermaid
graph TD

A[Frontend - React] -->|Terminal Mode| B[FastAPI Backend]
A -->|Voice Mode| C[Node.js Voice Service]

C --> D[OpenAI Realtime API - WSS]
D --> D1[STT - built-in]
D --> D2[GPT-4o Realtime - LLM]
D --> D3[TTS - built-in]
C --> E[Redis (Memory Store)]
C -->|Optional| B

B --> F[Neon Postgres (RAG)]
```

---

## 6. System Components

### 6.1 Frontend
- Microphone input (MediaStream API)
- Audio playback
- UI states:
  - Listening
  - Thinking
  - Speaking

---

### 6.2 Node.js Voice Service (NEW)

#### Responsibilities
- Proxy real-time audio between browser and **OpenAI Realtime API** over a secure WebSocket
- Manage the OpenAI Realtime session (session creation, config, system prompt injection)
- Handle server-side VAD events and interruption signals from OpenAI
- Inject persona context and Redis knowledge into the session before conversation starts
- Forward `response.audio.delta` chunks back to the browser for streaming playback

#### Technology
- **OpenAI Realtime API** (`wss://api.openai.com/v1/realtime`) — unified STT + LLM + TTS
- Model: `gpt-4o-realtime-preview`
- Transport: WebSocket (server-side relay pattern — browser → Node → OpenAI)

#### Non-Responsibilities
- No MCP/tool orchestration
- No heavy RAG processing
- No separate STT or TTS services (handled by OpenAI Realtime API)

---

### 6.3 FastAPI Backend (EXISTING)

#### Responsibilities
- Tool-based reasoning (MCP)
- RAG queries
- Data aggregation

---

### 6.4 Redis (Shared Memory Layer)

#### Purpose
- Store precomputed knowledge
- Enable instant access for voice responses

---

## 7. Data Architecture

### 7.1 Redis Schema

#### Full Project Data
```
project:{id} -> full project JSON
```

#### Project Index
```
projects:index -> [{ name, tags }]
```

#### Top Projects (for prompt)
```
projects:top -> [{ name, summary }]
```

#### Experience Summary
```
profile:summary -> short bio
```

---

## 8. Knowledge Layers

### Layer 1: Instant Memory
- Top projects (5–10)
- Skills
- Summary

Used for: immediate responses

---

### Layer 2: Fast Retrieval
- Redis lookup
- Lightweight RAG (Neon)

Used for: follow-ups or specific queries

---

### Layer 3: Deep Processing
- MCP tools
- Full pipeline

Used for: terminal mode only or rare cases

---

## 9. Voice Response Flow

```mermaid
sequenceDiagram
participant User
participant Browser
participant VoiceService as Node.js Voice Service
participant OAI as OpenAI Realtime API
participant Redis

User->>Browser: Speak (mic audio PCM16)
Browser->>VoiceService: Audio chunks over WS
VoiceService->>OAI: Forward audio (input_audio_buffer.append)
OAI-->>OAI: VAD detects end of speech
OAI-->>OAI: STT transcription (internal)
OAI-->>OAI: GPT-4o Realtime generates response
OAI-->>VoiceService: response.audio.delta (TTS audio chunks)
VoiceService-->>Browser: Stream audio chunks
Browser-->>User: Play audio in real time

Note over VoiceService,Redis: Optional: Redis lookup to enrich system prompt before session start
```

### OpenAI Realtime API Session Config

```json
{
  "model": "gpt-4o-realtime-preview",
  "modalities": ["text", "audio"],
  "voice": "alloy",
  "turn_detection": {
    "type": "server_vad",
    "threshold": 0.5,
    "silence_duration_ms": 600
  },
  "instructions": "<persona + preloaded Redis context injected here>"
}
```

---

## 10. Response Strategy

### Fast Path (Default)
- Direct LLM response
- Uses only instant memory
- No tools

### Slow Path (Optional)
- Triggered for detailed queries
- Fetch from Redis or RAG
- Used in subsequent responses

---

## 11. Latency Targets

With OpenAI Realtime API, STT, LLM, and TTS are handled in a **single streaming pipeline** — there is no sequential hand-off between separate services.

| Component | Target | Notes |
|----------|--------|-------|
| Audio capture → OpenAI | ~50ms | Browser WS relay via Node |
| VAD end-of-speech detection | 200–600ms | Configurable `silence_duration_ms` |
| First audio chunk back | 300–600ms | GPT-4o realtime streams TTS directly |
| **Total perceived latency** | **<800ms** | End-to-end |

> Previous architecture had separate STT → LLM → TTS hops. OpenAI Realtime API collapses these into one, significantly reducing total latency.

---

## 12. Interrupt Handling

### Requirements
- Detect user speech during AI response
- Cancel current response
- Start new processing cycle

### Mechanism (OpenAI Realtime API — built-in)
- **Server-side VAD** detects barge-in automatically
- OpenAI sends `input_audio_buffer.speech_started` event during AI playback
- Client must send `response.cancel` and truncate the audio buffer
- OpenAI Realtime API handles the state reset — no custom VAD library needed

---

## 13. Data Freshness Strategy

### Background Job
- Runs on deploy or periodically
- Fetches GitHub data
- Generates summaries
- Updates Redis

---

## 14. Technology Stack

### Frontend
- React
- Web Audio API

### Voice Backend
- Node.js
- WebSocket/WebRTC

### AI
- **OpenAI Realtime API** (`gpt-4o-realtime-preview`) — unified STT + LLM + TTS
- Voice: `alloy` (configurable)
- Transport: WebSocket (`wss://api.openai.com/v1/realtime`)
- No separate Whisper, ElevenLabs, or TTS service required

### Data
- Redis
- Neon Postgres (existing)

---

## 15. Implementation Phases

### Phase 1: Basic Audio Chat
- Push-to-talk
- STT → LLM → TTS

### Phase 2: Continuous Conversation
- Auto speech detection
- Loop conversation

### Phase 3: Interruptions
- Cancel + restart logic

### Phase 4: Memory Integration
- Redis integration

### Phase 5: Optional Enhancements
- Avatar/video
- Smarter RAG triggers

---

## 16. Risks & Trade-offs

### Risks
- **OpenAI Realtime API cost** — priced per audio token, can add up with long sessions
- **Single vendor dependency** — all STT/LLM/TTS in OpenAI; no fallback
- **Browser audio format** — must send PCM16 at 24kHz; encoding must be correct
- **WebSocket relay complexity** — Node.js acts as a relay; any crash breaks the session
- **Context window limits** — system prompt + Redis data must fit within model context

### Trade-offs
- Speed + simplicity vs vendor lock-in (chose OpenAI Realtime API for both)
- Preloaded Redis knowledge vs live RAG (preload wins for latency)
- Server VAD vs client VAD (server VAD chosen — less code, works reliably)

---

## 17. Future Enhancements

- Avatar-based video chat
- Emotion-aware responses
- Personalized voice cloning
- Multi-session memory

---

## 18. Summary

The system introduces a dedicated **voice-first architecture** that prioritizes speed and conversational flow, while leveraging existing systems for deeper knowledge when required.

Core idea:

> Precompute knowledge → inject into OpenAI Realtime session → stream audio back instantly

### Key Technical Decision

**OpenAI Realtime API** is the single AI engine for this feature:
- Replaces separate STT (Whisper), LLM (chat completions), and TTS (ElevenLabs/OpenAI TTS) services
- One WebSocket session handles the full audio-in → audio-out pipeline
- Built-in VAD and barge-in support simplifies interrupt handling
- Node.js voice service acts as a **secure relay** between browser and OpenAI

