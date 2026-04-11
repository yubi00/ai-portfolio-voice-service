# Voice Service — Build Progress

> Work phase by phase. Complete each item before moving to the next.
> Mark items done with `[x]` as you go.

---

## Engineering Principles (Always Apply)

These apply to every line written, every phase, no exceptions:

- **Single Responsibility** — each module, function, and class does one thing only
- **Separation of Concerns** — audio relay, session management, knowledge loading, and HTTP are separate layers; never mix them
- **Open/Closed** — design modules to be extended (new voices, new knowledge sources) without modifying existing logic
- **Dependency Inversion** — depend on abstractions (interfaces/types), not concrete implementations (e.g. abstract the OpenAI WS behind a `RealtimeSession` interface so it can be swapped or mocked)
- **DRY** — no duplicated logic; shared utilities live in `src/utils/` or `src/lib/`
- **YAGNI** — don't build what isn't needed yet; each phase ships only what that phase requires
- **Fail loudly in dev, fail gracefully in prod** — throw errors clearly during development; surface user-friendly fallbacks in production
- **No magic strings/numbers** — all constants (model name, voices, timeouts, silence duration) live in a central `config.ts`

---

## Phase 1 — Project Scaffold & Basic WebSocket Relay

> Goal: Node.js service is running and can open a WebSocket connection to OpenAI Realtime API.

- [x] Init Node.js project (`package.json`, TypeScript config, `tsconfig.json`)
- [x] Install dependencies: `ws`, `dotenv`, `express`, `openai` (or raw `ws` to OpenAI)
- [x] Create `.env` with `OPENAI_API_KEY`, `PORT`
- [x] Implement basic Express HTTP server with a `/health` endpoint
- [x] Implement server-side WebSocket upgrade endpoint (`/ws`)
- [x] On client WS connect → open upstream WS to `wss://api.openai.com/v1/realtime`
- [x] Forward raw messages: browser → Node → OpenAI (relay pattern)
- [x] Forward raw messages: OpenAI → Node → browser (relay pattern)
- [x] Log OpenAI session events to console for debugging
- [x] Test: connect manually via browser WebSocket and confirm OpenAI session is created

**Phase 1 done when:** WebSocket relay is working end-to-end with OpenAI Realtime API.

---

## Phase 2 — OpenAI Realtime Session Configuration

> Goal: Session is initialized with the right model, voice, VAD, and a placeholder system prompt.

- [x] Send `session.update` event after upstream WS connects with:
  - `model: "gpt-4o-realtime-preview"`
  - `modalities: ["text", "audio"]`
  - `voice: "alloy"`
  - `turn_detection: { type: "server_vad", silence_duration_ms: 600 }`
  - `instructions`: placeholder persona string ("You are Yubi, a software engineer...")
- [x] Handle `session.created` and `session.updated` events; log confirmation
- [x] Handle `error` events from OpenAI and forward to browser with a clear error shape
- [x] Set audio format: `input_audio_format: "pcm16"`, `output_audio_format: "pcm16"`
- [x] Test: verify session config is accepted by OpenAI (check `session.updated` event)

**Phase 2 done when:** Session is correctly configured and confirmed by OpenAI.

---

## Phase 3 — Browser Audio Capture & Streaming

> Goal: Browser captures mic audio and streams PCM16 chunks to Node relay.

- [x] Create minimal frontend HTML/JS test page (no React yet, keep it simple)
- [x] Request mic via `getUserMedia({ audio: true })`
- [x] Use `AudioContext` + `ScriptProcessorNode` (or `AudioWorkletNode`) to capture PCM16 at 24kHz
- [x] Open WebSocket to Node relay from browser
- [x] Send audio as `input_audio_buffer.append` events (base64 encoded PCM16 chunks)
- [x] Receive `response.audio.delta` events from Node relay
- [x] Decode base64 audio delta and queue for playback via `AudioContext`
- [x] Play audio chunks in order without gaps
- [x] Test: speak into mic → hear AI voice response played back

**Phase 3 done when:** Can have a basic voice conversation end-to-end (no persona, no knowledge yet).

---

## Phase 4 — Persona & Knowledge Injection

> Goal: AI responds as "Yubi" using preloaded portfolio knowledge from a provider-backed store.

- [x] Create provider abstraction for persona knowledge (`KnowledgeProvider`)
- [x] Implement `InMemoryProvider` seeded from `data.json`
- [x] Load `profile:summary`, `projects:top`, `profile:skills`, `profile:experience`, and `profile:contact`
- [x] Compose full system prompt: persona instructions + knowledge snippets + guardrails
- [x] Inject into `session.update` → `instructions` field before conversation starts
- [x] Enable input transcription with `whisper-1` for transcript display
- [x] Add an offline GitHub sync script that fetches repository metadata into a generated JSON knowledge file
- [x] Load generated GitHub project summaries through the same provider-backed prompt system used for resume data
- [x] Test: ask "What projects have you worked on?" — confirm AI answers with real data
- [x] Test: ask "Tell me about yourself" — confirm persona sounds like Yubi

**Phase 4 done when:** AI introduces itself correctly, answers portfolio questions from preloaded knowledge, and stays within role guardrails.

---

## Phase 4B — Local GitHub Project Retrieval

> Goal: Keep the base prompt small, but let the assistant answer questions about any GitHub project by retrieving only the most relevant local project cards at runtime.

- [x] Change generated GitHub knowledge from one large prompt string into structured project cards
- [x] Add a curated featured-project list that stays in the always-on prompt
- [x] Keep the full synced GitHub catalog off-prompt as a local data source
- [x] Add exact-name / alias project matching as the first retrieval path
- [x] Add local text search over repo name, description, topics, languages, and summary (MiniSearch or equivalent lightweight local index)
- [x] Add ranking boosts for featured projects and strong exact matches
- [x] Return top-k matched GitHub projects for a user query instead of injecting the full catalog
- [x] Inject matched project cards into turn-based responses on a per-turn basis
- [x] Keep a clear fallback when no confident GitHub project match is found
- [ ] Evaluate whether to port the same retrieval path into Realtime mode after turn-based validation
- [x] Test: ask about a featured project — confirm the answer stays concise and grounded
- [x] Test: ask about a non-featured GitHub repo by name — confirm the assistant finds it from local synced data
- [x] Test: ask broad stack questions like "what React projects have you built?" — confirm only the most relevant repos are surfaced

**Phase 4B done when:** The assistant can answer GitHub project questions from the full local repo catalog without dumping the entire catalog into the system prompt.

---

## Phase 5 — Interruption Handling (Barge-in)

> Goal: User can interrupt the AI mid-response and it handles it gracefully.

- [x] Listen for `input_audio_buffer.speech_started` event from OpenAI during AI playback
- [x] Add local mic-energy interrupt detection for faster barge-in than server VAD alone
- [x] On barge-in event: send `response.cancel` to OpenAI
- [x] On barge-in event: stop browser audio playback immediately
- [x] Keep queued playback tracked until audio actually drains
- [x] Stream transcript live for both user and assistant during interruption scenarios
- [x] Resume listening for next user speech after cancel
- [x] Test: start speaking while AI is talking — confirm AI stops and listens
- [x] Test: interrupt after transcript finishes but while queued audio is still playing
- [x] Test: complete sentence after barge-in — confirm AI responds to the new input

**Phase 5 done when:** Barge-in feels natural with no audio glitches or stuck states.

---

## Phase 6 — Voice Backend Abstraction & Low-Cost Mode

> Goal: Keep the Realtime path, but make the voice layer swappable so production can use a cheaper turn-based STT + LLM + TTS pipeline.

- [x] Define a `VoiceSessionService` / `AudioConversationService` interface for the voice orchestration layer
- [x] Add a thin adapter/wrapper around the existing Realtime implementation — no behavioral changes to the current Realtime code path
- [x] Add config-based mode selection (for example: `VOICE_MODE=realtime|turn-based`)
- [x] Design the turn-based flow: browser utterance -> STT -> LLM -> TTS -> playback
- [x] Reuse existing persona/knowledge prompt building in both modes
- [x] Implement the turn-based backend mode behind the same interface
- [x] Define transcript/event contract that both implementations can emit to the frontend
- [x] Keep the current Realtime implementation as the stable reference path for demos/dev
- [x] Do not modify the existing Realtime behavior while introducing the abstraction layer
- [x] Document trade-offs: Realtime = barge-in/full duplex, Turn-based = cheaper but no mid-sentence interrupt

**Phase 6 done when:** The codebase can support both Realtime and low-cost turn-based voice backends without changing frontend-facing behavior, and the current Realtime path remains behaviorally unchanged.

---

## Phase 7 — React Integration (Frontend)

> Goal: Voice feature is integrated into the portfolio React app.

- [ ] Create `VoiceChat` React component with UI states: Idle / Listening / Speaking
- [ ] Add push-to-talk button OR auto-VAD toggle (start with button, add auto later)
- [ ] Manage WebSocket lifecycle inside the component (connect on open, disconnect on close)
- [ ] Show visual indicator (pulsing mic, waveform, or spinner) per state
- [ ] Handle connection errors with user-facing message
- [ ] Ensure voice mode and terminal mode are independent (no shared state clashes)
- [ ] Test on desktop Chrome and Firefox
- [ ] Test on mobile Safari (check AudioContext unlock requirement on iOS)

**Phase 7 done when:** Voice chat button works inside the real portfolio frontend.

---

## Phase 8 — Hardening & Production Readiness

> Goal: Safe to deploy and show to visitors.

- [ ] Add auth/rate-limit to Node WS endpoint (prevent abuse — simple token or origin check)
- [ ] Add session timeout: auto-close OpenAI WS after N minutes of silence
- [ ] Add cost guard: max audio seconds per session config
- [ ] Add graceful reconnect logic on browser WS disconnect
- [ ] Add structured logging (w/ session IDs) for debugging production issues
- [ ] Set up deployment: Dockerfile or Railway/Fly.io config for Node service
- [ ] Deploy to staging and run end-to-end smoke test
- [ ] Deploy to production

**Phase 8 done when:** Service is live, monitored, and safe for real visitors.

---

## Phase 9 — Nice to Haves (Post-MVP)

> Do these only after Phase 8 is stable.

- [ ] Swap `alloy` voice for a more personalized voice (test `echo`, `shimmer`, `nova`)
- [ ] Add on-screen transcript of conversation
- [ ] Add Redis TTL refresh job so portfolio knowledge stays up to date automatically
- [ ] Trigger slow-path Redis lookup mid-conversation for specific project deep-dives
- [ ] Explore avatar/video layer (D-ID, HeyGen, or custom)
- [ ] Analytics: track conversation length, common questions

---

## Current Phase

> Update this line as you progress.

**Currently working on: Phase 4B — Local GitHub Project Retrieval**
