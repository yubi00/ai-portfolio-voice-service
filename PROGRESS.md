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

- [ ] Send `session.update` event after upstream WS connects with:
  - `model: "gpt-4o-realtime-preview"`
  - `modalities: ["text", "audio"]`
  - `voice: "alloy"`
  - `turn_detection: { type: "server_vad", silence_duration_ms: 600 }`
  - `instructions`: placeholder persona string ("You are Yubi, a software engineer...")
- [ ] Handle `session.created` and `session.updated` events; log confirmation
- [ ] Handle `error` events from OpenAI and forward to browser with a clear error shape
- [ ] Set audio format: `input_audio_format: "pcm16"`, `output_audio_format: "pcm16"`
- [ ] Test: verify session config is accepted by OpenAI (check `session.updated` event)

**Phase 2 done when:** Session is correctly configured and confirmed by OpenAI.

---

## Phase 3 — Browser Audio Capture & Streaming

> Goal: Browser captures mic audio and streams PCM16 chunks to Node relay.

- [ ] Create minimal frontend HTML/JS test page (no React yet, keep it simple)
- [ ] Request mic via `getUserMedia({ audio: true })`
- [ ] Use `AudioContext` + `ScriptProcessorNode` (or `AudioWorkletNode`) to capture PCM16 at 24kHz
- [ ] Open WebSocket to Node relay from browser
- [ ] Send audio as `input_audio_buffer.append` events (base64 encoded PCM16 chunks)
- [ ] Receive `response.audio.delta` events from Node relay
- [ ] Decode base64 audio delta and queue for playback via `AudioContext`
- [ ] Play audio chunks in order without gaps
- [ ] Test: speak into mic → hear AI voice response played back

**Phase 3 done when:** Can have a basic voice conversation end-to-end (no persona, no knowledge yet).

---

## Phase 4 — Persona & Knowledge Injection (Redis)

> Goal: AI responds as "Yubi" using preloaded portfolio knowledge from Redis.

- [ ] Set up Redis (local Docker or Upstash for dev)
- [ ] Write a seed/populate script that loads:
  - `profile:summary` — short bio paragraph
  - `projects:top` — top 5–8 projects as JSON list
  - `profile:skills` — skills list
- [ ] On Node relay startup (or session init), fetch Redis knowledge keys
- [ ] Compose full system prompt: persona instructions + Redis knowledge snippets
- [ ] Inject into `session.update` → `instructions` field before conversation starts
- [ ] Test: ask "What projects have you worked on?" — confirm AI answers with real data
- [ ] Test: ask "Tell me about yourself" — confirm persona sounds like Yubi

**Phase 4 done when:** AI introduces itself correctly and answers portfolio questions from preloaded knowledge.

---

## Phase 5 — Interruption Handling (Barge-in)

> Goal: User can interrupt the AI mid-response and it handles it gracefully.

- [ ] Listen for `input_audio_buffer.speech_started` event from OpenAI during AI playback
- [ ] On barge-in event: send `response.cancel` to OpenAI
- [ ] On barge-in event: stop browser audio playback immediately
- [ ] Send `conversation.item.truncate` if needed to sync state
- [ ] Resume listening for next user speech after cancel
- [ ] Test: start speaking while AI is talking — confirm AI stops and listens
- [ ] Test: complete sentence after barge-in — confirm AI responds to the new input

**Phase 5 done when:** Barge-in feels natural with no audio glitches or stuck states.

---

## Phase 6 — React Integration (Frontend)

> Goal: Voice feature is integrated into the portfolio React app.

- [ ] Create `VoiceChat` React component with UI states: Idle / Listening / Speaking
- [ ] Add push-to-talk button OR auto-VAD toggle (start with button, add auto later)
- [ ] Manage WebSocket lifecycle inside the component (connect on open, disconnect on close)
- [ ] Show visual indicator (pulsing mic, waveform, or spinner) per state
- [ ] Handle connection errors with user-facing message
- [ ] Ensure voice mode and terminal mode are independent (no shared state clashes)
- [ ] Test on desktop Chrome and Firefox
- [ ] Test on mobile Safari (check AudioContext unlock requirement on iOS)

**Phase 6 done when:** Voice chat button works inside the real portfolio frontend.

---

## Phase 7 — Hardening & Production Readiness

> Goal: Safe to deploy and show to visitors.

- [ ] Add auth/rate-limit to Node WS endpoint (prevent abuse — simple token or origin check)
- [ ] Add session timeout: auto-close OpenAI WS after N minutes of silence
- [ ] Add cost guard: max audio seconds per session config
- [ ] Add graceful reconnect logic on browser WS disconnect
- [ ] Add structured logging (w/ session IDs) for debugging production issues
- [ ] Set up deployment: Dockerfile or Railway/Fly.io config for Node service
- [ ] Deploy to staging and run end-to-end smoke test
- [ ] Deploy to production

**Phase 7 done when:** Service is live, monitored, and safe for real visitors.

---

## Phase 8 — Nice to Haves (Post-MVP)

> Do these only after Phase 7 is stable.

- [ ] Swap `alloy` voice for a more personalized voice (test `echo`, `shimmer`, `nova`)
- [ ] Add on-screen transcript of conversation
- [ ] Add Redis TTL refresh job so portfolio knowledge stays up to date automatically
- [ ] Trigger slow-path Redis lookup mid-conversation for specific project deep-dives
- [ ] Explore avatar/video layer (D-ID, HeyGen, or custom)
- [ ] Analytics: track conversation length, common questions

---

## Current Phase

> Update this line as you progress.

**Currently working on: Phase 2**
