import { useEffect, useRef, useState } from "react";
import { GeminiLiveClient } from "./geminiLiveClient";
import { PcmAudioPlayer } from "./audioPlayback";
import { MicrophoneCapture } from "./microphoneCapture";
import { VideoFrameCapture } from "./videoFrameCapture";
import "./App.css";

type Role = "loa" | "you";

type Message = {
  role: Role;
  text: string;
};

type HermesRunResponse = {
  run_id?: string;
  status?: string;
  output?: string;
  error?: string;
};

type HermesStatus =
  | "idle"
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "error";

type GeminiLiveStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

type LiveSource = "none" | "screen" | "camera";

type MemoryMode = "ask" | "manual" | "auto_basic";
type DefaultLiveSource = "screen" | "obs" | "ask";

type GeminiVoice =
  | "Puck"
  | "Charon"
  | "Kore"
  | "Fenrir"
  | "Aoede"
  | "Leda"
  | "Orus"
  | "Zephyr";

type MemoryCategory = "preference" | "project" | "workStyle" | "session";

type PendingMemoryProposal = {
  id: string;
  category: MemoryCategory;
  title: string;
  text: string;
  createdAt: string;
};

type LoaCommand =
  | {
      type: "hermes_search";
      query: string;
    }
  | {
      type: "memory_list";
    }
  | {
      type: "memory_delete";
      query: string;
    }
  | {
      type: "sleep_mic";
    }
  | {
      type: "wake_mic";
    }
  | {
      type: "stop_view";
    };

type LoaConfig = {
  userName: string;
  loaName: string;
  geminiApiKey: string;
  geminiVoice: GeminiVoice;
  hermesUrl: string;
  hermesApiKey: string;
  defaultLiveSource: DefaultLiveSource;
  memoryMode: MemoryMode;
};

type LoaMemory = {
  version: 1;
  identity: {
    role: string;
    principles: string[];
    style: string[];
    boundaries: string[];
  };
  userMemory: {
    name: string;
    preferences: string[];
    projects: string[];
    workStyle: string[];
  };
  sessionMemory: {
    currentMode: string;
    currentTask: string;
    recentEvents: string[];
  };
  screenMemory: {
    source: LiveSource;
    summary: string;
    updatedAt: string | null;
  };
};

const CONFIG_KEY = "loa-hud-config-v1";
const MEMORY_KEY = "loa-hud-memory-v1";
const MESSAGES_KEY = "loa-hud-messages-v1";

const GEMINI_VOICES: GeminiVoice[] = [
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Aoede",
  "Leda",
  "Orus",
  "Zephyr",
];

const DEFAULT_CONFIG: LoaConfig = {
  userName: "",
  loaName: "Loa",
  geminiApiKey: "",
  geminiVoice: "Puck",
  hermesUrl: "http://127.0.0.1:8642",
  hermesApiKey: "",
  defaultLiveSource: "ask",
  memoryMode: "ask",
};

function normalizeMemoryMode(value: unknown): MemoryMode {
  if (value === "manual") return "manual";
  if (value === "auto_basic" || value === "auto_safe") return "auto_basic";
  return "ask";
}

function normalizeGeminiVoice(value: unknown): GeminiVoice {
  if (typeof value === "string" && GEMINI_VOICES.includes(value as GeminiVoice)) {
    return value as GeminiVoice;
  }

  return "Puck";
}

function normalizeMemoryCategory(value: unknown): MemoryCategory {
  if (value === "preference") return "preference";
  if (value === "project") return "project";
  if (value === "workStyle") return "workStyle";
  if (value === "session") return "session";
  return "session";
}

function createMemoryProposal(
  category: MemoryCategory,
  title: string,
  text: string
): PendingMemoryProposal {
  return {
    id: `memory-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    category,
    title: title.trim() || "Memory",
    text: text.trim(),
    createdAt: new Date().toISOString(),
  };
}

function extractMemoryProposalFromText(text: string): {
  visibleText: string;
  proposal: PendingMemoryProposal | null;
} {
  const pattern =
    /\[LOA_MEMORY_PROPOSAL\]([\s\S]*?)\[\/LOA_MEMORY_PROPOSAL\]/i;

  const match = text.match(pattern);

  if (!match) {
    return {
      visibleText: text.trim(),
      proposal: null,
    };
  }

  const visibleText = text.replace(pattern, "").trim();

  try {
    const parsed = JSON.parse(match[1].trim()) as {
      category?: unknown;
      title?: unknown;
      text?: unknown;
    };

    const memoryText = typeof parsed.text === "string" ? parsed.text.trim() : "";

    if (!memoryText) {
      return {
        visibleText,
        proposal: null,
      };
    }

    return {
      visibleText,
      proposal: createMemoryProposal(
        normalizeMemoryCategory(parsed.category),
        typeof parsed.title === "string" ? parsed.title : "Memory",
        memoryText
      ),
    };
  } catch {
    return {
      visibleText,
      proposal: null,
    };
  }
}

function extractLoaCommandsFromText(text: string): {
  visibleText: string;
  commands: LoaCommand[];
} {
  const pattern = /\[LOA_COMMAND\]([\s\S]*?)\[\/LOA_COMMAND\]/gi;
  const commands: LoaCommand[] = [];

  const visibleText = text
    .replace(pattern, (_fullMatch, rawJson) => {
      try {
        const parsed = JSON.parse(String(rawJson).trim()) as {
          type?: unknown;
          query?: unknown;
        };

        if (parsed.type === "hermes_search" && typeof parsed.query === "string") {
          const query = parsed.query.trim();

          if (query) {
            commands.push({
              type: "hermes_search",
              query,
            });
          }
        }

        if (parsed.type === "memory_list") {
          commands.push({
            type: "memory_list",
          });
        }

        if (parsed.type === "memory_delete" && typeof parsed.query === "string") {
          const query = parsed.query.trim();

          if (query) {
            commands.push({
              type: "memory_delete",
              query,
            });
          }
        }

        if (parsed.type === "sleep_mic") {
          commands.push({
            type: "sleep_mic",
          });
        }

        if (parsed.type === "wake_mic") {
          commands.push({
            type: "wake_mic",
          });
        }

        if (parsed.type === "stop_view") {
          commands.push({
            type: "stop_view",
          });
        }
      } catch {
        // Ignore malformed command tags.
      }

      return "";
    })
    .trim();

  return {
    visibleText,
    commands,
  };
}

function isMemoryApprovalText(text: string) {
  const normalized = text.trim().toLowerCase();

  return [
    "yes",
    "yeah",
    "yep",
    "sure",
    "save it",
    "remember it",
    "remember that",
    "please remember",
    "ok",
    "okay",
    "응",
    "어",
    "그래",
    "좋아",
    "저장해",
    "기억해",
    "기억해줘",
    "응 기억해",
    "ㅇㅇ",
  ].some((phrase) => normalized.includes(phrase));
}

function isMemoryRejectText(text: string) {
  const normalized = text.trim().toLowerCase();

  return [
    "no",
    "nope",
    "don't",
    "do not",
    "not now",
    "don't save",
    "forget it",
    "아니",
    "ㄴㄴ",
    "하지마",
    "저장하지마",
    "기억하지마",
    "나중에",
    "지금은 아니",
  ].some((phrase) => normalized.includes(phrase));
}

function loadStoredConfig(): LoaConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<LoaConfig>;

    if (!parsed.userName || !parsed.loaName) {
      return null;
    }

    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      geminiVoice: normalizeGeminiVoice(parsed.geminiVoice),
      memoryMode: normalizeMemoryMode(parsed.memoryMode),
    };
  } catch {
    return null;
  }
}

function saveStoredConfig(config: LoaConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

function createInitialMessages(config: LoaConfig): Message[] {
  return [
    {
      role: "loa",
      text: `${config.loaName} online. Hi, ${config.userName}.`,
    },
  ];
}

function loadStoredMessages(config: LoaConfig): Message[] {
  try {
    const raw = localStorage.getItem(MESSAGES_KEY);

    if (!raw) {
      return createInitialMessages(config);
    }

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return createInitialMessages(config);
    }

    const messages = parsed.filter((item) => {
      return (
        item &&
        (item.role === "loa" || item.role === "you") &&
        typeof item.text === "string"
      );
    }) as Message[];

    if (messages.length === 0) {
      return createInitialMessages(config);
    }

    return messages.slice(-300);
  } catch {
    return createInitialMessages(config);
  }
}

function saveStoredMessages(messages: Message[]) {
  localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages.slice(-300)));
}

function createDefaultMemory(config: LoaConfig): LoaMemory {
  return {
    version: 1,
    identity: {
      role:
        `${config.loaName} is a screen-aware voice HUD for the user's desktop. ` +
        `${config.loaName} connects screen sharing or OBS, realtime voice, and background task execution into one clean HUD.`,
      principles: [
        "Be useful in real time.",
        "Use screen context only when Live View or OBS is active.",
        "Do not pretend to see the screen when visual context is unavailable.",
        "Keep responses concise during live work or games.",
        "Use Hermes only for background work, tool-heavy tasks, research, coding, files, or automation.",
        "Do not invent Hermes results. Report only real status or real output.",
      ],
      style: [
        "Clear",
        "Fast",
        "Natural",
        "Friendly",
        "Casual",
        "Lightly playful when appropriate",
        "Not corporate",
        "Not assistant-like",
        "Not overly emotional by default",
      ],
      boundaries: [
        "Do not silently store sensitive information.",
        "Do not save API keys, passwords, addresses, private messages, or screen details unless explicitly approved.",
        "Ask before saving memory when memory mode is set to ask.",
        "Respect that users may use Loa for work, games, creative projects, or everyday tasks.",
      ],
    },
    userMemory: {
      name: config.userName,
      preferences: [
        "The user wants a screen-aware voice HUD.",
        "The user may use Loa for work, games, creative projects, and everyday tasks.",
      ],
      projects: ["The user is setting up Loa HUD."],
      workStyle: [
        "Prefer concise UI text.",
        "Prefer clean, minimal explanations.",
        "Prefer voice-first interaction over chat-first interaction.",
      ],
    },
    sessionMemory: {
      currentMode: "setup",
      currentTask: "initializing Loa HUD",
      recentEvents: ["Loa first launch setup completed."],
    },
    screenMemory: {
      source: "none",
      summary: "No screen source is active yet.",
      updatedAt: null,
    },
  };
}

function loadStoredMemory(config: LoaConfig): LoaMemory {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);

    if (!raw) {
      const fresh = createDefaultMemory(config);
      localStorage.setItem(MEMORY_KEY, JSON.stringify(fresh));
      return fresh;
    }

    const parsed = JSON.parse(raw) as Partial<LoaMemory>;
    const fallback = createDefaultMemory(config);

    return {
      ...fallback,
      ...parsed,
      identity: {
        ...fallback.identity,
        ...parsed.identity,
      },
      userMemory: {
        ...fallback.userMemory,
        ...parsed.userMemory,
        name: config.userName,
      },
      sessionMemory: {
        ...fallback.sessionMemory,
        ...parsed.sessionMemory,
      },
      screenMemory: {
        ...fallback.screenMemory,
        ...parsed.screenMemory,
      },
    };
  } catch {
    const fresh = createDefaultMemory(config);
    localStorage.setItem(MEMORY_KEY, JSON.stringify(fresh));
    return fresh;
  }
}

function saveStoredMemory(memory: LoaMemory) {
  localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
}

function addUniqueItem(items: string[], item: string) {
  const trimmed = item.trim();

  if (!trimmed) return items;
  if (items.includes(trimmed)) return items;

  return [trimmed, ...items].slice(0, 20);
}

function buildRecentChatContext(messages: Message[]) {
  const recent = messages.slice(-24);

  if (recent.length === 0) {
    return "No recent visible chat history.";
  }

  return recent
    .map((message) => `${message.role === "you" ? "User" : "Loa"}: ${message.text}`)
    .join("\n");
}

function createTinyNoisePcm16Base64(durationMs = 160) {
  const sampleRate = 16000;
  const sampleCount = Math.floor((sampleRate * durationMs) / 1000);
  const bytes = new Uint8Array(sampleCount * 2);
  const view = new DataView(bytes.buffer);

  // Tiny non-zero PCM16 noise.
  // This is not meant to be audible. It is only meant to keep the Live input stream active.
  for (let i = 0; i < sampleCount; i += 1) {
    const sample = Math.random() > 0.5 ? 2 : -2;
    view.setInt16(i * 2, sample, true);
  }

  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return window.btoa(binary);
}

function buildLoaSystemPrompt(
  config: LoaConfig,
  memory: LoaMemory,
  messages: Message[],
  liveSource: LiveSource,
  currentState: string,
  geminiLiveStatus: GeminiLiveStatus,
  useMicInput: boolean,
  isMicListening: boolean,
  isVideoFrameStreaming: boolean
) {
  const liveSourceLabel =
    liveSource === "screen"
      ? "screen share"
      : liveSource === "camera"
      ? "OBS or camera feed"
      : "no active visual source";

  return `
You are ${config.loaName}.

${memory.identity.role}

Current user:
- Name: ${config.userName}

Current state:
- HUD state: ${currentState}
- Visual source: ${liveSourceLabel}
- Gemini Live status: ${geminiLiveStatus}
- Microphone setting: ${useMicInput ? "enabled" : "disabled"}
- Microphone currently listening: ${isMicListening ? "yes" : "no"}
- Quiet mode: ${currentState === "QUIET" ? "yes" : "no"}
- Background/system/screen audio: disabled
- Video frame streaming: ${isVideoFrameStreaming ? "yes" : "no"}
- Gemini voice: ${config.geminiVoice}
- Memory mode: ${config.memoryMode}

Core principles:
${memory.identity.principles.map((item) => `- ${item}`).join("\n")}

Style:
${memory.identity.style.map((item) => `- ${item}`).join("\n")}

Memory boundaries:
${memory.identity.boundaries.map((item) => `- ${item}`).join("\n")}

User memory:
${memory.userMemory.preferences.map((item) => `- ${item}`).join("\n")}

Projects:
${memory.userMemory.projects.map((item) => `- ${item}`).join("\n")}

Work style:
${memory.userMemory.workStyle.map((item) => `- ${item}`).join("\n")}

Session memory:
- Current mode: ${memory.sessionMemory.currentMode}
- Current task: ${memory.sessionMemory.currentTask}
${memory.sessionMemory.recentEvents.map((item) => `- ${item}`).join("\n")}

Screen memory:
- Source: ${memory.screenMemory.source}
- Summary: ${memory.screenMemory.summary}

Recent visible chat history:
${buildRecentChatContext(messages)}

Language behavior:
- Reply in the same language the user is currently using.
- If the user speaks Korean, reply naturally in Korean.
- If the user speaks English, reply naturally in English.
- If the user mixes Korean and English, follow the user's dominant language and mirror the mix lightly.
- Do not force English just because the UI is English.

Voice behavior:
- Speak like a relaxed friend watching the screen with the user.
- Keep most live responses short: 1 to 2 sentences.
- If the user is excited, match the excitement naturally.
- Do not over-explain unless the user asks.
- If you are uncertain about the screen, say it casually instead of pretending certainty.

Command behavior:
- The user should be able to control Loa mostly by conversation, not by pressing buttons.
- If the user asks you to search, look up, browse, research, verify, check latest information, or find current information, do not answer from memory.
- For search/current/research requests, say a short natural acknowledgement and append a Hermes command tag at the very end of your response.
- Do not claim that you searched unless Hermes returns a result.
- Hermes command tag format:
[LOA_COMMAND]{"type":"hermes_search","query":"what to search for"}[/LOA_COMMAND]
- If the user asks what is stored in memory, append:
[LOA_COMMAND]{"type":"memory_list"}[/LOA_COMMAND]
- If the user asks to delete a memory, append:
[LOA_COMMAND]{"type":"memory_delete","query":"memory text or title to delete"}[/LOA_COMMAND]
- If the user asks you to sleep, mute, be quiet, or stop responding, append:
[LOA_COMMAND]{"type":"sleep_mic"}[/LOA_COMMAND]
- If the user says "Hey Loa", "Loa", "wake up", "로아야", "로아 일어나", or asks you to wake/listen again, append:
[LOA_COMMAND]{"type":"wake_mic"}[/LOA_COMMAND]
- If the user asks you to stop watching, stop view, or turn off the screen/OBS view, append:
[LOA_COMMAND]{"type":"stop_view"}[/LOA_COMMAND]
- Do not mention command tags. The user should only hear the natural acknowledgement.
- Do not use command tags for ordinary conversation.
- For destructive or high-impact actions not listed above, ask for confirmation first.

Memory proposal behavior:
- If the user shares a stable preference, project detail, or work style that would help future conversations, ask naturally if they want you to remember it.
- Do not propose memory for temporary, trivial, private, sensitive, medical, address, password, API key, or secret information.
- Do not save memory by yourself. The app will save only after the user confirms.
- When you ask to remember something, append exactly one machine-readable proposal tag at the very end of your response.
- The tag must use this exact format:
[LOA_MEMORY_PROPOSAL]{"category":"preference","title":"Short title","text":"The memory to save"}[/LOA_MEMORY_PROPOSAL]
- Valid categories are: preference, project, workStyle, session.
- Do not mention the tag. The user should only hear the natural question.
- Example visible response: "게임 중엔 짧은 콜아웃 위주가 좋다는 거 기억해둘까?"
- Example tag:
[LOA_MEMORY_PROPOSAL]{"category":"workStyle","title":"Short game callouts","text":"The user prefers short callouts during games instead of long explanations."}[/LOA_MEMORY_PROPOSAL]

Important:
- If no visual source is active, do not claim to see the user's screen.
- If video frame streaming is not active, do not claim to see current screen details.
- If a visual source is active and video frames are streaming, you may discuss the visible screen.
- Background/system/screen audio is disabled. Do not claim to hear app, game, YouTube, music, or video audio.
- If microphone is sleeping, you may still respond to text/system messages, but you are not hearing the user's voice.
- If you want to remember something, propose a memory save request. Do not silently save sensitive details.
`.trim();
}

function SetupWizard({
  onComplete,
}: {
  onComplete: (config: LoaConfig) => void;
}) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<LoaConfig>(DEFAULT_CONFIG);
  const [testMessage, setTestMessage] = useState("");

  const canContinue =
    step === 0 ||
    (step === 1 && draft.userName.trim() && draft.loaName.trim()) ||
    step === 2 ||
    step === 3 ||
    step === 4;

  function update<K extends keyof LoaConfig>(key: K, value: LoaConfig[K]) {
    setDraft((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  async function testHermes() {
    setTestMessage("Testing Hermes...");

    try {
      const tempConfig: LoaConfig = {
        ...draft,
        userName: draft.userName.trim() || "User",
        loaName: draft.loaName.trim() || "Loa",
        geminiVoice: normalizeGeminiVoice(draft.geminiVoice),
        memoryMode: normalizeMemoryMode(draft.memoryMode),
      };

      const tempMemory = createDefaultMemory(tempConfig);
      const systemPrompt = buildLoaSystemPrompt(
        tempConfig,
        tempMemory,
        [],
        "none",
        "SETUP TEST",
        "disconnected",
        false,
        false,
        false
      );

      const res = await fetch("/hermes/v1/runs", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${draft.hermesApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: "Confirm Hermes connection in one short sentence.",
          session_id: "loa-setup-test",
          instructions: systemPrompt,
        }),
      });

      if (!res.ok) {
        const raw = await res.text();
        throw new Error(raw || `${res.status} ${res.statusText}`);
      }

      setTestMessage("Hermes request accepted.");
    } catch (error) {
      console.error(error);
      setTestMessage("Hermes test failed. You can fix it later.");
    }
  }

  function finish() {
    const finalConfig: LoaConfig = {
      ...draft,
      userName: draft.userName.trim(),
      loaName: draft.loaName.trim() || "Loa",
      hermesUrl: draft.hermesUrl.trim() || DEFAULT_CONFIG.hermesUrl,
      hermesApiKey: draft.hermesApiKey.trim(),
      geminiApiKey: draft.geminiApiKey.trim(),
      geminiVoice: normalizeGeminiVoice(draft.geminiVoice),
      memoryMode: normalizeMemoryMode(draft.memoryMode),
    };

    const freshMemory = createDefaultMemory(finalConfig);
    const existingMessagesRaw = localStorage.getItem(MESSAGES_KEY);
    const hasExistingMessages = Boolean(existingMessagesRaw);

    saveStoredConfig(finalConfig);
    saveStoredMemory(freshMemory);

    if (!hasExistingMessages) {
      saveStoredMessages(createInitialMessages(finalConfig));
    }

    onComplete(finalConfig);
  }

  return (
    <main className="setupPage">
      <section className="setupCard">
        <div className="setupHeader">
          <p className="microLabel">LOA SETUP</p>
          <h1>{step === 0 ? "Welcome to Loa" : "First launch setup"}</h1>
          <p>
            {step === 0
              ? "Set up your screen-aware voice HUD."
              : "Name, keys, live view, and memory."}
          </p>
        </div>

        <div className="setupSteps">
          {["Welcome", "Names", "Gemini", "Hermes", "Preferences"].map(
            (label, index) => (
              <button
                key={label}
                className={`setupStep ${step === index ? "active" : ""} ${
                  step > index ? "done" : ""
                }`}
                onClick={() => setStep(index)}
              >
                {index + 1}. {label}
              </button>
            )
          )}
        </div>

        <div className="setupBody">
          {step === 0 && (
            <div className="setupPanel">
              <p className="heroLabel">SCREEN-AWARE HUD</p>
              <h2>See your screen. Hear your voice. Help in real time.</h2>
              <p>Screen, voice, and tasks in one HUD.</p>
            </div>
          )}

          {step === 1 && (
            <div className="setupPanel">
              <label className="fieldLabel">
                Your name
                <input
                  value={draft.userName}
                  onChange={(event) => update("userName", event.target.value)}
                  placeholder="Your name"
                />
              </label>

              <label className="fieldLabel">
                HUD name
                <input
                  value={draft.loaName}
                  onChange={(event) => update("loaName", event.target.value)}
                  placeholder="Loa"
                />
              </label>
            </div>
          )}

          {step === 2 && (
            <div className="setupPanel">
              <label className="fieldLabel">
                Gemini API Key
                <input
                  value={draft.geminiApiKey}
                  onChange={(event) =>
                    update("geminiApiKey", event.target.value)
                  }
                  placeholder="Paste Gemini API key"
                  type="password"
                />
              </label>

              <label className="fieldLabel">
                Gemini Voice
                <select
                  value={draft.geminiVoice}
                  onChange={(event) =>
                    update("geminiVoice", event.target.value as GeminiVoice)
                  }
                >
                  {GEMINI_VOICES.map((voice) => (
                    <option key={voice} value={voice}>
                      {voice}
                    </option>
                  ))}
                </select>
              </label>

              <p className="setupHint">You can change this later.</p>
            </div>
          )}

          {step === 3 && (
            <div className="setupPanel">
              <label className="fieldLabel">
                Hermes URL
                <input
                  value={draft.hermesUrl}
                  onChange={(event) => update("hermesUrl", event.target.value)}
                  placeholder="http://127.0.0.1:8642"
                />
              </label>

              <label className="fieldLabel">
                Hermes API Key
                <input
                  value={draft.hermesApiKey}
                  onChange={(event) =>
                    update("hermesApiKey", event.target.value)
                  }
                  placeholder="Hermes API key"
                  type="password"
                />
              </label>

              <button className="secondaryButton setupTest" onClick={testHermes}>
                Test Hermes
              </button>

              {testMessage && <p className="setupHint">{testMessage}</p>}
            </div>
          )}

          {step === 4 && (
            <div className="setupPanel">
              <label className="fieldLabel">
                Default Live Source
                <select
                  value={draft.defaultLiveSource}
                  onChange={(event) =>
                    update(
                      "defaultLiveSource",
                      event.target.value as DefaultLiveSource
                    )
                  }
                >
                  <option value="ask">Ask every time</option>
                  <option value="screen">Screen Share</option>
                  <option value="obs">OBS Virtual Camera</option>
                </select>
              </label>

              <label className="fieldLabel">
                Memory Mode
                <select
                  value={draft.memoryMode}
                  onChange={(event) =>
                    update("memoryMode", event.target.value as MemoryMode)
                  }
                >
                  <option value="ask">Ask before saving</option>
                  <option value="manual">Manual only</option>
                  <option value="auto_basic">Auto-save basic preferences</option>
                </select>
              </label>

              <p className="setupHint">Recommended: Ask before saving.</p>
            </div>
          )}
        </div>

        <div className="setupActions">
          <button
            className="secondaryButton"
            onClick={() => setStep((prev) => Math.max(0, prev - 1))}
            disabled={step === 0}
          >
            Back
          </button>

          {step < 4 ? (
            <button
              className="primaryButton"
              onClick={() => setStep((prev) => Math.min(4, prev + 1))}
              disabled={!canContinue}
            >
              Continue
            </button>
          ) : (
            <button className="primaryButton" onClick={finish}>
              Enter Loa HUD
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

function LoaHud({
  config,
  onResetSetup,
}: {
  config: LoaConfig;
  onResetSetup: () => void;
}) {
  const [memory, setMemory] = useState<LoaMemory>(() =>
    loadStoredMemory(config)
  );
  const [pendingMemory, setPendingMemory] =
    useState<PendingMemoryProposal | null>(null);
  const pendingMemoryRef = useRef<PendingMemoryProposal | null>(null);
  const [showMemoryPanel, setShowMemoryPanel] = useState(false);
  const [liveViewOn, setLiveViewOn] = useState(false);
  const [liveSource, setLiveSource] = useState<LiveSource>("none");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [hermesStatus, setHermesStatus] = useState<HermesStatus>("idle");
  const [geminiLiveStatus, setGeminiLiveStatus] =
    useState<GeminiLiveStatus>("disconnected");
  const [useMicInput, setUseMicInput] = useState(true);
  const [isMicListening, setIsMicListening] = useState(false);
  const [isSoftSleeping, setIsSoftSleeping] = useState(false);
  const [isWakeListenerOn, setIsWakeListenerOn] = useState(false);
  const [isVideoFrameStreaming, setIsVideoFrameStreaming] = useState(false);
  const [viewStream, setViewStream] = useState<MediaStream | null>(null);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const speakingTimerRef = useRef<number | null>(null);
  const pollingTimerRef = useRef<number | null>(null);
  const keepAliveTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const liveWatchdogTimerRef = useRef<number | null>(null);
  const userEndedLiveRef = useRef(false);
  const shouldAutoReconnectRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const wantedMicListeningRef = useRef(false);
  const wantedVideoStreamingRef = useRef(false);
  const desiredMicOnRef = useRef(false);
  const desiredVideoOnRef = useRef(false);
  const isSoftSleepingRef = useRef(false);
  const wakeRecognitionRef = useRef<any | null>(null);
  const wakeListenerWantedRef = useRef(false);

  const geminiLiveClientRef = useRef<GeminiLiveClient | null>(null);
  const audioPlayerRef = useRef<PcmAudioPlayer | null>(null);
  const microphoneCaptureRef = useRef<MicrophoneCapture | null>(null);
  const videoFrameCaptureRef = useRef<VideoFrameCapture | null>(null);

  const geminiLoaTextBufferRef = useRef("");
  const geminiLoaTextFlushTimerRef = useRef<number | null>(null);
  const geminiUserTextBufferRef = useRef("");
  const geminiUserTextFlushTimerRef = useRef<number | null>(null);

  const messagesRef = useRef<Message[]>(loadStoredMessages(config));
  const [messages, setMessages] = useState<Message[]>(messagesRef.current);

  useEffect(() => {
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        const cameras = devices.filter((device) => device.kind === "videoinput");
        setVideoDevices(cameras);
        setSelectedVideoDeviceId((current) => {
          if (current) return current;
          return (
            cameras.find((device) => device.label.toLowerCase().includes("obs"))
              ?.deviceId || cameras[0]?.deviceId || ""
          );
        });
      })
      .catch((error) => console.error("Could not read video devices.", error));
  }, []);

  useEffect(() => {
    pendingMemoryRef.current = pendingMemory;
  }, [pendingMemory]);

  useEffect(() => {
    wantedMicListeningRef.current = isMicListening;
  }, [isMicListening]);

  useEffect(() => {
    isSoftSleepingRef.current = isSoftSleeping;
  }, [isSoftSleeping]);

  useEffect(() => {
    wantedVideoStreamingRef.current = isVideoFrameStreaming;
  }, [isVideoFrameStreaming]);

  useEffect(() => {
    messageListRef.current?.scrollTo({
      top: messageListRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  useEffect(() => {
    if (videoRef.current && viewStream) {
      videoRef.current.srcObject = viewStream;
      videoRef.current.play().catch((error) => {
        console.error("Video play failed:", error);
      });
    }
  }, [viewStream]);

  useEffect(() => {
    if (
      geminiLiveStatus === "connected" &&
      liveViewOn &&
      viewStream &&
      videoRef.current
    ) {
      const timer = window.setTimeout(() => {
        startVideoFrameStreaming(false);
      }, 700);

      return () => {
        window.clearTimeout(timer);
      };
    }

    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geminiLiveStatus, liveViewOn, viewStream]);

  useEffect(() => {
    const saveBeforeUnload = () => {
      saveStoredMessages(messagesRef.current);
    };

    window.addEventListener("beforeunload", saveBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", saveBeforeUnload);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (speakingTimerRef.current) {
        window.clearTimeout(speakingTimerRef.current);
      }

      if (pollingTimerRef.current) {
        window.clearInterval(pollingTimerRef.current);
      }

      stopWakeWordListener();
      stopGeminiKeepAlive();
      clearGeminiTextBuffers();

      geminiLiveClientRef.current?.disconnect();
      geminiLiveClientRef.current = null;

      microphoneCaptureRef.current?.stop();
      microphoneCaptureRef.current = null;

      videoFrameCaptureRef.current?.stop();
      videoFrameCaptureRef.current = null;

      audioPlayerRef.current?.close();
      audioPlayerRef.current = null;

      stopCurrentViewStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setAndSaveMessages(updater: (current: Message[]) => Message[]) {
    setMessages((current) => {
      const next = updater(current).slice(-300);
      messagesRef.current = next;
      saveStoredMessages(next);
      return next;
    });
  }

  function updateMemory(updater: (current: LoaMemory) => LoaMemory) {
    setMemory((current) => {
      const next = updater(current);
      saveStoredMemory(next);
      return next;
    });
  }

  function triggerSpeaking(duration = 2200) {
    setIsSpeaking(true);

    if (speakingTimerRef.current) {
      window.clearTimeout(speakingTimerRef.current);
    }

    speakingTimerRef.current = window.setTimeout(() => {
      setIsSpeaking(false);
    }, duration);
  }

  function pushUserMessage(text: string) {
    setAndSaveMessages((prev) => [...prev, { role: "you", text }]);
  }

  function pushLoaMessage(text: string) {
    setAndSaveMessages((prev) => [...prev, { role: "loa", text }]);
    triggerSpeaking();
  }

  function clearChatHistory() {
    const confirmed = window.confirm(
      "Clear Loa chat history? This will remove saved COMMS messages from this browser."
    );

    if (!confirmed) return;

    const freshMessages = createInitialMessages(config);

    messagesRef.current = freshMessages;
    saveStoredMessages(freshMessages);
    setMessages(freshMessages);
  }

  function clearGeminiTextBuffers() {
    geminiLoaTextBufferRef.current = "";
    geminiUserTextBufferRef.current = "";

    if (geminiLoaTextFlushTimerRef.current) {
      window.clearTimeout(geminiLoaTextFlushTimerRef.current);
      geminiLoaTextFlushTimerRef.current = null;
    }

    if (geminiUserTextFlushTimerRef.current) {
      window.clearTimeout(geminiUserTextFlushTimerRef.current);
      geminiUserTextFlushTimerRef.current = null;
    }
  }

  function pushStreamingTextChunk(role: Role, text: string) {
    const cleanText = text.trim();

    if (!cleanText) return;

    if (cleanText.startsWith("[LOA_KEEPALIVE]")) {
      return;
    }

    const bufferRef =
      role === "you" ? geminiUserTextBufferRef : geminiLoaTextBufferRef;

    const timerRef =
      role === "you" ? geminiUserTextFlushTimerRef : geminiLoaTextFlushTimerRef;

    bufferRef.current = bufferRef.current
      ? `${bufferRef.current} ${cleanText}`
      : cleanText;

    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }

    timerRef.current = window.setTimeout(() => {
      const finalText = bufferRef.current.trim();

      if (finalText && !finalText.startsWith("[LOA_KEEPALIVE]")) {
        if (role === "you") {
          setAndSaveMessages((prev) => [...prev, { role, text: finalText }]);

          if (isSoftSleepingRef.current && containsWakeWord(finalText)) {
            exitSoftSleep(true);
          }

          handleMemoryApprovalFromUser(finalText);
        }

        if (role === "loa") {
          const memoryExtraction = extractMemoryProposalFromText(finalText);
          const commandExtraction = extractLoaCommandsFromText(
            memoryExtraction.visibleText
          );

          if (memoryExtraction.proposal && config.memoryMode !== "manual") {
            pendingMemoryRef.current = memoryExtraction.proposal;
            setPendingMemory(memoryExtraction.proposal);
          }

          if (commandExtraction.visibleText) {
            setAndSaveMessages((prev) => [
              ...prev,
              { role, text: commandExtraction.visibleText },
            ]);
            triggerSpeaking();
          }

          if (commandExtraction.commands.length > 0) {
            handleLoaCommands(commandExtraction.commands);
          }
        }
      }

      bufferRef.current = "";
      timerRef.current = null;
    }, 550);
  }

  function clearPolling() {
    if (pollingTimerRef.current) {
      window.clearInterval(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
  }

  function startGeminiKeepAlive() {
    stopGeminiKeepAlive();

    keepAliveTimerRef.current = window.setInterval(() => {
      const client = geminiLiveClientRef.current;

      if (!client?.isConnected()) {
        return;
      }

      // Do not send text keepalive.
      // Text keepalive can make Gemini speak or create COMMS messages.
      // Send a tiny non-zero PCM16 packet instead.
      client.sendAudioChunk(createTinyNoisePcm16Base64(160));
    }, 20000);
  }

  function stopLiveWatchdog() {
    if (liveWatchdogTimerRef.current) {
      window.clearInterval(liveWatchdogTimerRef.current);
      liveWatchdogTimerRef.current = null;
    }
  }

  function startLiveWatchdog() {
    stopLiveWatchdog();

    liveWatchdogTimerRef.current = window.setInterval(() => {
      if (!shouldAutoReconnectRef.current || userEndedLiveRef.current) {
        return;
      }

      const client = geminiLiveClientRef.current;

      if (!client?.isConnected()) {
        setGeminiLiveStatus("connecting");
        scheduleGeminiReconnect("watchdog detected closed live connection");
        return;
      }

      if (desiredMicOnRef.current && !microphoneCaptureRef.current) {
        startMicrophoneCapture(false);
      }

      if (desiredVideoOnRef.current && viewStream && !videoFrameCaptureRef.current) {
        startVideoFrameStreaming(false);
      }
    }, 5000);
  }

  function clearGeminiReconnectTimer() {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }

  function scheduleGeminiReconnect(reason = "Gemini Live disconnected.") {
    clearGeminiReconnectTimer();

    if (!shouldAutoReconnectRef.current || userEndedLiveRef.current) {
      return;
    }

    reconnectAttemptRef.current += 1;

    const attempt = reconnectAttemptRef.current;
    const delay = Math.min(1200 + attempt * 600, 5000);

    setGeminiLiveStatus("connecting");

    if (attempt === 1) {
      pushLoaMessage("Live slipped offline. Reconnecting quietly.");
    }

    reconnectTimerRef.current = window.setTimeout(() => {
      if (!shouldAutoReconnectRef.current || userEndedLiveRef.current) {
        return;
      }

      console.info("Reconnecting Gemini Live:", reason, "attempt", attempt);
      connectGeminiLiveShell(true);
    }, delay);
  }

  function stopGeminiKeepAlive() {
    if (keepAliveTimerRef.current) {
      window.clearInterval(keepAliveTimerRef.current);
      keepAliveTimerRef.current = null;
    }
  }

  function stopCurrentViewStream() {
    setViewStream((current) => {
      if (current) {
        current.getTracks().forEach((track) => track.stop());
      }

      return null;
    });

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

  function saveMemoryProposal(proposal: PendingMemoryProposal) {
    updateMemory((current) => {
      const next: LoaMemory = {
        ...current,
        sessionMemory: {
          ...current.sessionMemory,
          recentEvents: [
            `Memory saved: ${proposal.title}`,
            ...current.sessionMemory.recentEvents.slice(0, 9),
          ],
        },
      };

      if (proposal.category === "preference") {
        next.userMemory = {
          ...next.userMemory,
          preferences: addUniqueItem(next.userMemory.preferences, proposal.text),
        };
      }

      if (proposal.category === "project") {
        next.userMemory = {
          ...next.userMemory,
          projects: addUniqueItem(next.userMemory.projects, proposal.text),
        };
      }

      if (proposal.category === "workStyle") {
        next.userMemory = {
          ...next.userMemory,
          workStyle: addUniqueItem(next.userMemory.workStyle, proposal.text),
        };
      }

      if (proposal.category === "session") {
        next.sessionMemory = {
          ...next.sessionMemory,
          recentEvents: addUniqueItem(next.sessionMemory.recentEvents, proposal.text),
        };
      }

      return next;
    });

    pendingMemoryRef.current = null;
    setPendingMemory(null);
    pushLoaMessage("기억해둘게.");
  }

  function approveMemorySave() {
    const proposal = pendingMemoryRef.current;

    if (!proposal) return;

    saveMemoryProposal(proposal);
  }

  function rejectMemorySave() {
    pendingMemoryRef.current = null;
    setPendingMemory(null);
    pushLoaMessage("알겠어. 그건 기억하지 않을게.");
  }

  function handleMemoryApprovalFromUser(text: string) {
    const proposal = pendingMemoryRef.current;

    if (!proposal) {
      return false;
    }

    if (isMemoryRejectText(text)) {
      rejectMemorySave();
      return true;
    }

    if (isMemoryApprovalText(text)) {
      saveMemoryProposal(proposal);
      return true;
    }

    return false;
  }

  function getMemoryItemsForCommand() {
    return [
      ...memory.userMemory.preferences.map((text) => ({
        category: "preference" as MemoryCategory,
        text,
      })),
      ...memory.userMemory.projects.map((text) => ({
        category: "project" as MemoryCategory,
        text,
      })),
      ...memory.userMemory.workStyle.map((text) => ({
        category: "workStyle" as MemoryCategory,
        text,
      })),
      ...memory.sessionMemory.recentEvents.map((text) => ({
        category: "session" as MemoryCategory,
        text,
      })),
    ];
  }

  function showMemoryByConversation() {
    setShowMemoryPanel(true);

    const items = getMemoryItemsForCommand();

    if (items.length === 0) {
      pushLoaMessage("아직 저장된 메모리는 없어.");
      return;
    }

    const summary = items
      .slice(0, 18)
      .map((item, index) => {
        const label =
          item.category === "preference"
            ? "Preference"
            : item.category === "project"
            ? "Project"
            : item.category === "workStyle"
            ? "Work style"
            : "Session";

        return `${index + 1}. [${label}] ${item.text}`;
      })
      .join("\\n");

    pushLoaMessage(`지금 메모리에 이런 것들이 저장돼 있어.\\n${summary}`);
  }

  function deleteMemoryByQuery(query: string) {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      pushLoaMessage("어떤 메모리를 지울지 다시 말해줘.");
      return;
    }

    let removedText = "";

    function shouldRemove(item: string) {
      const normalizedItem = item.toLowerCase();

      return (
        normalizedItem.includes(normalizedQuery) ||
        normalizedQuery.includes(normalizedItem)
      );
    }

    updateMemory((current) => {
      const next: LoaMemory = {
        ...current,
        userMemory: {
          ...current.userMemory,
          preferences: current.userMemory.preferences.filter((item) => {
            const remove = !removedText && shouldRemove(item);

            if (remove) {
              removedText = item;
            }

            return !remove;
          }),
          projects: current.userMemory.projects.filter((item) => {
            const remove = !removedText && shouldRemove(item);

            if (remove) {
              removedText = item;
            }

            return !remove;
          }),
          workStyle: current.userMemory.workStyle.filter((item) => {
            const remove = !removedText && shouldRemove(item);

            if (remove) {
              removedText = item;
            }

            return !remove;
          }),
        },
        sessionMemory: {
          ...current.sessionMemory,
          recentEvents: current.sessionMemory.recentEvents.filter((item) => {
            const remove = !removedText && shouldRemove(item);

            if (remove) {
              removedText = item;
            }

            return !remove;
          }),
        },
      };

      return next;
    });

    if (removedText) {
      pushLoaMessage(`지웠어: ${removedText}`);
      return;
    }

    pushLoaMessage("그 표현과 맞는 메모리를 못 찾았어. 메모리 목록을 열어볼게.");
    setShowMemoryPanel(true);
  }

  function handleLoaCommands(commands: LoaCommand[]) {
    commands.forEach((command) => {
      if (command.type === "hermes_search") {
        runHermesTask(command.query);
      }

      if (command.type === "memory_list") {
        showMemoryByConversation();
      }

      if (command.type === "memory_delete") {
        deleteMemoryByQuery(command.query);
      }

      if (command.type === "sleep_mic") {
        enterSoftSleep(true);
      }

      if (command.type === "wake_mic") {
        exitSoftSleep(true);
      }

      if (command.type === "stop_view") {
        stopLiveView();
      }
    });
  }

  function startVideoFrameStreaming(showMessage = true) {
    desiredVideoOnRef.current = true;

    if (!geminiLiveClientRef.current?.isConnected()) {
      if (showMessage) {
        pushLoaMessage("Voice is not connected yet.");
      }
      return;
    }

    if (!videoRef.current || !viewStream) {
      if (showMessage) {
        pushLoaMessage("No live video source is active.");
      }
      return;
    }

    if (videoFrameCaptureRef.current) {
      setIsVideoFrameStreaming(true);
      return;
    }

    videoFrameCaptureRef.current = new VideoFrameCapture(
      (base64Jpeg) => {
        geminiLiveClientRef.current?.sendVideoFrame(base64Jpeg);
      },
      {
        intervalMs: 1000,
        jpegQuality: 0.72,
        maxWidth: 1024,
      }
    );

    videoFrameCaptureRef.current.start(videoRef.current);
    setIsVideoFrameStreaming(true);

    if (showMessage) {
      pushLoaMessage("Screen frames connected.");
    }
  }

  function stopVideoFrameStreaming() {
    if (videoFrameCaptureRef.current) {
      videoFrameCaptureRef.current.stop();
      videoFrameCaptureRef.current = null;
    }

    setIsVideoFrameStreaming(false);
  }

  function getWakeWordText(text: string) {
    return text.trim().toLowerCase();
  }

  function containsWakeWord(text: string) {
    const normalized = getWakeWordText(text);

    return (
      normalized.includes("hey loa") ||
      normalized.includes("hey, loa") ||
      normalized.includes("hello loa") ||
      normalized.includes("wake up loa") ||
      normalized.includes("loa wake") ||
      normalized.includes("헤이 로아") ||
      normalized.includes("로아야") ||
      normalized.includes("로아 야") ||
      normalized.includes("로아 깨워") ||
      normalized.includes("로아 일어나")
    );
  }

  function stopWakeWordListener() {
    wakeListenerWantedRef.current = false;

    if (wakeRecognitionRef.current) {
      try {
        wakeRecognitionRef.current.onresult = null;
        wakeRecognitionRef.current.onerror = null;
        wakeRecognitionRef.current.onend = null;
        wakeRecognitionRef.current.stop();
      } catch {
        // Ignore stop errors.
      }

      wakeRecognitionRef.current = null;
    }

    setIsWakeListenerOn(false);
  }

  function startWakeWordListener(showMessage = true) {
    if (wakeRecognitionRef.current) {
      return;
    }

    if (geminiLiveStatus !== "connected") {
      return;
    }

    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      if (showMessage) {
        pushLoaMessage(
          "Sleep mode is on, but this browser does not support local wake word listening."
        );
      }
      return;
    }

    wakeListenerWantedRef.current = true;

    const recognition = new SpeechRecognitionCtor();

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      let transcript = "";

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0]?.transcript || "";
      }

      if (!containsWakeWord(transcript)) {
        return;
      }

      stopWakeWordListener();
      pushUserMessage("Hey Loa.");
      startMicrophoneCapture(true);
    };

    recognition.onerror = (event: any) => {
      console.warn("Wake listener error:", event?.error || event);
    };

    recognition.onend = () => {
      wakeRecognitionRef.current = null;
      setIsWakeListenerOn(false);

      if (
        wakeListenerWantedRef.current &&
        geminiLiveStatus === "connected" &&
        !microphoneCaptureRef.current
      ) {
        window.setTimeout(() => {
          if (
            wakeListenerWantedRef.current &&
            geminiLiveStatus === "connected" &&
            !microphoneCaptureRef.current
          ) {
            startWakeWordListener(false);
          }
        }, 600);
      }
    };

    try {
      recognition.start();
      wakeRecognitionRef.current = recognition;
      setIsWakeListenerOn(true);

      if (showMessage) {
        pushLoaMessage("Sleep. Say “Hey Loa” or “로아야” to wake me.");
      }
    } catch (error) {
      console.error("Wake listener failed:", error);
      wakeRecognitionRef.current = null;
      wakeListenerWantedRef.current = false;
      setIsWakeListenerOn(false);

      if (showMessage) {
        pushLoaMessage("Wake listener could not start.");
      }
    }
  }

  function enterSoftSleep(showMessage = true) {
    setIsSoftSleeping(true);
    isSoftSleepingRef.current = true;
    setIsWakeListenerOn(false);

    // Game-safe quiet mode:
    // keep the real Gemini Live mic stream alive.
    // Browser wake-word mode is too unreliable while a game has focus.
    if (!microphoneCaptureRef.current && geminiLiveClientRef.current?.isConnected()) {
      startMicrophoneCapture(false);
    }

    geminiLiveClientRef.current?.sendText(
      [
        "[LOA_MODE_QUIET]",
        "Enter quiet mode now.",
        "Keep listening, but stay mostly silent.",
        "Only respond when the user directly calls you, asks you a question, or says Loa/로아야/Hey Loa.",
        "If the user calls you again, resume normal conversation and append:",
        "[LOA_COMMAND]{\"type\":\"wake_mic\"}[/LOA_COMMAND]",
      ].join("\n")
    );

    if (showMessage) {
      pushLoaMessage("Quiet mode. 마이크는 유지할게. 게임 중엔 연결 안 끊기게 조용히 있을게.");
    }
  }

  function exitSoftSleep(showMessage = true) {
    setIsSoftSleeping(false);
    isSoftSleepingRef.current = false;
    setIsWakeListenerOn(false);

    geminiLiveClientRef.current?.sendText(
      [
        "[LOA_MODE_WAKE]",
        "Exit quiet mode now.",
        "Resume normal conversation.",
        "Say one very short natural wake confirmation.",
      ].join("\n")
    );

    if (showMessage) {
      pushLoaMessage("응, 다시 말할게.");
    }
  }

  async function startMicrophoneCapture(showMessage = true) {
    desiredMicOnRef.current = true;
    setIsSoftSleeping(false);
    isSoftSleepingRef.current = false;
    setIsWakeListenerOn(false);
    stopWakeWordListener();

    if (!geminiLiveClientRef.current?.isConnected()) {
      if (showMessage) {
        pushLoaMessage("Voice is not connected yet.");
      }
      return;
    }

    if (microphoneCaptureRef.current) {
      setIsMicListening(true);
      return;
    }

    microphoneCaptureRef.current = new MicrophoneCapture((base64Audio) => {
      geminiLiveClientRef.current?.sendAudioChunk(base64Audio);
    });

    try {
      await microphoneCaptureRef.current.start();
      setIsMicListening(true);

      if (showMessage) {
        pushLoaMessage("Wake. Microphone listening.");
      }
    } catch (error) {
      console.error("Microphone failed:", error);
      microphoneCaptureRef.current = null;
      setIsMicListening(false);

      if (showMessage) {
        pushLoaMessage("Microphone permission failed.");
      }
    }
  }

  async function stopMicrophoneCapture(
    showMessage = true,
    enableWakeListener = true,
    keepDesiredMic = false
  ) {
    if (!keepDesiredMic) {
      desiredMicOnRef.current = false;
    }

    if (microphoneCaptureRef.current) {
      await microphoneCaptureRef.current.stop();
      microphoneCaptureRef.current = null;
    }

    setIsMicListening(false);
    clearGeminiTextBuffers();

    if (enableWakeListener && geminiLiveStatus === "connected") {
      startWakeWordListener(showMessage);
      return;
    }

    if (showMessage) {
      pushLoaMessage("Sleep. Microphone muted.");
    }
  }

  async function refreshVideoDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter((device) => device.kind === "videoinput");

      setVideoDevices(cameras);

      const obsDevice = cameras.find((device) =>
        device.label.toLowerCase().includes("obs")
      );

      if (obsDevice) {
        setSelectedVideoDeviceId(obsDevice.deviceId);
        return;
      }

      if (!selectedVideoDeviceId && cameras[0]) {
        setSelectedVideoDeviceId(cameras[0].deviceId);
      }
    } catch (error) {
      console.error(error);
      pushLoaMessage("Could not read video devices.");
    }
  }

  async function startScreenShare() {
    try {
      stopVideoFrameStreaming();
      stopCurrentViewStream();

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: 30,
        },
        audio: false,
      });

      const videoTrack = stream.getVideoTracks()[0];

      videoTrack.addEventListener("ended", () => {
        stopVideoFrameStreaming();

        setViewStream(null);
        setLiveViewOn(false);
        setLiveSource("none");

        updateMemory((current) => ({
          ...current,
          screenMemory: {
            source: "none",
            summary: "No screen source is active.",
            updatedAt: new Date().toISOString(),
          },
        }));

        clearGeminiTextBuffers();
        pushLoaMessage("Live view stopped.");
      });

      desiredVideoOnRef.current = true;

      setViewStream(stream);
      setLiveViewOn(true);
      setLiveSource("screen");

      updateMemory((current) => ({
        ...current,
        sessionMemory: {
          ...current.sessionMemory,
          currentMode: "live view",
          currentTask: "watching screen share",
          recentEvents: [
            "Screen share connected.",
            ...current.sessionMemory.recentEvents.slice(0, 9),
          ],
        },
        screenMemory: {
          source: "screen",
          summary:
            "Screen share is active. Video frames will stream when Gemini Live is connected. Background audio is disabled.",
          updatedAt: new Date().toISOString(),
        },
      }));

      pushUserMessage(`${config.loaName}, start screen view.`);
      pushLoaMessage("Screen view connected.");

      if (geminiLiveClientRef.current?.isConnected()) {
        window.setTimeout(() => {
          startVideoFrameStreaming(true);
        }, 700);
      }
    } catch (error) {
      console.error(error);
      pushLoaMessage("Screen share permission was cancelled.");
    }
  }

  async function startCameraSource() {
    try {
      stopVideoFrameStreaming();
      stopCurrentViewStream();

      let deviceId = selectedVideoDeviceId;

      if (!deviceId) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter((device) => device.kind === "videoinput");
        const obsDevice = cameras.find((device) =>
          device.label.toLowerCase().includes("obs")
        );

        deviceId = obsDevice?.deviceId || cameras[0]?.deviceId || "";
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId
          ? {
              deviceId: { exact: deviceId },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              frameRate: { ideal: 30 },
            }
          : true,
        audio: false,
      });

      const videoTrack = stream.getVideoTracks()[0];

      videoTrack.addEventListener("ended", () => {
        stopVideoFrameStreaming();

        setViewStream(null);
        setLiveViewOn(false);
        setLiveSource("none");

        updateMemory((current) => ({
          ...current,
          screenMemory: {
            source: "none",
            summary: "No screen source is active.",
            updatedAt: new Date().toISOString(),
          },
        }));

        clearGeminiTextBuffers();
        pushLoaMessage("OBS view stopped.");
      });

      desiredVideoOnRef.current = true;

      setViewStream(stream);
      setLiveViewOn(true);
      setLiveSource("camera");

      await refreshVideoDevices();

      const label = videoTrack.label || "camera source";

      updateMemory((current) => ({
        ...current,
        sessionMemory: {
          ...current.sessionMemory,
          currentMode: "live view",
          currentTask: "watching OBS or camera source",
          recentEvents: [
            `Camera source connected: ${label}`,
            ...current.sessionMemory.recentEvents.slice(0, 9),
          ],
        },
        screenMemory: {
          source: "camera",
          summary:
            "OBS or camera source is active. Video frames will stream when Gemini Live is connected. Background audio is disabled.",
          updatedAt: new Date().toISOString(),
        },
      }));

      pushUserMessage(`${config.loaName}, connect OBS camera.`);
      pushLoaMessage(`Camera source connected: ${label}`);

      if (geminiLiveClientRef.current?.isConnected()) {
        window.setTimeout(() => {
          startVideoFrameStreaming(true);
        }, 700);
      }
    } catch (error) {
      console.error(error);
      pushLoaMessage("Camera source permission was cancelled or failed.");
    }
  }

  async function stopLiveView() {
    desiredVideoOnRef.current = false;

    stopVideoFrameStreaming();
    stopCurrentViewStream();
    clearGeminiTextBuffers();

    setLiveViewOn(false);
    setLiveSource("none");

    updateMemory((current) => ({
      ...current,
      screenMemory: {
        source: "none",
        summary: "No screen source is active.",
        updatedAt: new Date().toISOString(),
      },
    }));

    pushUserMessage(`${config.loaName}, stop live view.`);
    pushLoaMessage("Live view stopped.");
  }

  async function stopAllSharing() {
    await stopLiveView();
    await disconnectGeminiLiveShell();
    pushLoaMessage("Privacy stop complete. Camera, screen, and microphone sharing are off.");
  }

  function connectGeminiLiveShell(isReconnectArg: boolean | unknown = false) {
    const isReconnect = isReconnectArg === true;

    if (!config.geminiApiKey.trim()) {
      setGeminiLiveStatus("error");
      pushLoaMessage("Gemini API key is missing. Open Setup to add it.");
      return;
    }

    clearGeminiReconnectTimer();
    stopGeminiKeepAlive();

    userEndedLiveRef.current = false;
    shouldAutoReconnectRef.current = true;
    desiredMicOnRef.current = useMicInput;
    desiredVideoOnRef.current = Boolean(viewStream);
    startLiveWatchdog();

    geminiLiveClientRef.current?.disconnect();
    geminiLiveClientRef.current = null;

    microphoneCaptureRef.current?.stop();
    microphoneCaptureRef.current = null;
    setIsMicListening(false);

    stopVideoFrameStreaming();

    clearGeminiTextBuffers();

    if (!audioPlayerRef.current) {
      audioPlayerRef.current = new PcmAudioPlayer();
    }

    audioPlayerRef.current.resume().catch((error) => {
      console.error("Audio resume failed:", error);
    });

    const loaStateText = getLoaStateText();
    const systemPrompt = buildLoaSystemPrompt(
      config,
      memory,
      messagesRef.current,
      liveSource,
      loaStateText,
      "connecting",
      useMicInput,
      isMicListening,
      isVideoFrameStreaming
    );

    setGeminiLiveStatus("connecting");

    if (!isReconnect) {
      pushUserMessage(`${config.loaName}, connect live.`);
      pushLoaMessage("Connecting to Gemini Live.");
    }

    const client = new GeminiLiveClient({
      apiKey: config.geminiApiKey,
      voiceName: config.geminiVoice,
      systemInstruction: systemPrompt,
      onOpen: () => {
        pushLoaMessage("Gemini Live socket opened. Sending setup.");
      },
      onSetupComplete: () => {
        reconnectAttemptRef.current = 0;
        setGeminiLiveStatus("connected");
        startGeminiKeepAlive();

        updateMemory((current) => ({
          ...current,
          sessionMemory: {
            ...current.sessionMemory,
            currentMode: "voice live",
            currentTask: "Gemini Live connected",
            recentEvents: [
              "Gemini Live connected.",
              ...current.sessionMemory.recentEvents.slice(0, 9),
            ],
          },
        }));

        pushLoaMessage(isReconnect ? "Live reconnected." : "Gemini Live connected.");

        if (!isReconnect) {
          client.sendText(
            `Say one short sentence as ${config.loaName}. Confirm you are online.`
          );
        }

        const shouldRestoreMic = desiredMicOnRef.current || useMicInput;
        const shouldRestoreVideo =
          desiredVideoOnRef.current || (Boolean(viewStream) && !isReconnect);

        if (shouldRestoreMic) {
          window.setTimeout(() => {
            startMicrophoneCapture(false).then(() => {
              if (!isReconnect) {
                pushLoaMessage("Microphone connected.");
              }
            });
          }, isReconnect ? 700 : 1800);
        }

        if (shouldRestoreVideo) {
          window.setTimeout(() => {
            startVideoFrameStreaming(!isReconnect);
          }, isReconnect ? 700 : 900);
        }
      },
      onText: (text) => {
        if (text.includes("[LOA_KEEPALIVE]")) return;
        pushStreamingTextChunk("loa", text);
      },
      onInputText: (text) => {
        if (text.includes("[LOA_KEEPALIVE]")) return;
        pushStreamingTextChunk("you", text);
      },
      onOutputText: (text) => {
        if (text.includes("[LOA_KEEPALIVE]")) return;
        pushStreamingTextChunk("loa", text);
      },
      onAudioChunk: (chunk) => {
        audioPlayerRef.current?.playBase64Pcm24k(chunk).catch((error) => {
          console.error("Gemini audio playback failed:", error);
          pushLoaMessage("Gemini audio playback failed.");
        });
      },
      onError: (message) => {
        console.error(message);

        const shouldReconnect =
          shouldAutoReconnectRef.current && !userEndedLiveRef.current;

        if (shouldReconnect) {
          setGeminiLiveStatus("connecting");
          scheduleGeminiReconnect(message);
          return;
        }

        setGeminiLiveStatus("error");
        pushLoaMessage(message);
      },
      onClose: () => {
        stopWakeWordListener();
        stopGeminiKeepAlive();

        const shouldReconnect =
          shouldAutoReconnectRef.current && !userEndedLiveRef.current;

        microphoneCaptureRef.current?.stop();
        microphoneCaptureRef.current = null;
        setIsMicListening(false);

        stopVideoFrameStreaming();

        if (shouldReconnect) {
          setGeminiLiveStatus("connecting");
          scheduleGeminiReconnect("socket closed");
          return;
        }

        setGeminiLiveStatus("disconnected");
        pushLoaMessage("Gemini Live disconnected.");
      },
    });

    geminiLiveClientRef.current = client;
    client.connect();
  }

  async function disconnectGeminiLiveShell() {
    userEndedLiveRef.current = true;
    shouldAutoReconnectRef.current = false;
    reconnectAttemptRef.current = 0;
    setIsSoftSleeping(false);
    isSoftSleepingRef.current = false;
    setIsWakeListenerOn(false);
    desiredMicOnRef.current = false;
    desiredVideoOnRef.current = false;
    clearGeminiReconnectTimer();
    stopLiveWatchdog();
    stopGeminiKeepAlive();

    await stopMicrophoneCapture(false, false, false);

    geminiLiveClientRef.current?.disconnect();
    geminiLiveClientRef.current = null;

    audioPlayerRef.current?.stop();

    clearGeminiTextBuffers();
    setGeminiLiveStatus("disconnected");

    pushUserMessage(`${config.loaName}, end live.`);
    pushLoaMessage("Live ended. Chat history is saved.");
  }

  async function sleepMic() {
    enterSoftSleep(true);
  }

  async function wakeMic() {
    exitSoftSleep(true);
    await startMicrophoneCapture(true);
  }

  function announceHermesResultByVoice(output: string) {
    const cleanOutput = output.trim();

    if (!cleanOutput) return;

    const client = geminiLiveClientRef.current;

    if (!client?.isConnected()) {
      return;
    }

    client.sendText(
      [
        "Hermes returned the following result.",
        "Read it aloud naturally and concisely to the user.",
        "Do not say you personally searched unless you are referring to Hermes.",
        "Do not add unsupported details.",
        "",
        cleanOutput,
      ].join("\n")
    );
  }

  async function pollHermesRun(runId: string) {
    try {
      const res = await fetch(`/hermes/v1/runs/${encodeURIComponent(runId)}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.hermesApiKey}`,
        },
      });

      const raw = await res.text();

      if (!res.ok) {
        throw new Error(raw || `${res.status} ${res.statusText}`);
      }

      const data: HermesRunResponse = raw ? JSON.parse(raw) : {};
      const status = data.status || "running";

      if (status === "completed") {
        clearPolling();
        setHermesStatus("completed");

        const output = data.output || "Hermes completed.";

        updateMemory((current) => ({
          ...current,
          sessionMemory: {
            ...current.sessionMemory,
            currentMode: "work",
            currentTask: "Hermes task completed",
            recentEvents: [
              "Hermes task completed.",
              ...current.sessionMemory.recentEvents.slice(0, 9),
            ],
          },
        }));

        pushLoaMessage(output);
        announceHermesResultByVoice(output);
        return;
      }

      if (status === "failed" || status === "cancelled") {
        clearPolling();
        setHermesStatus(status);

        const output = data.error || data.output || `Hermes ${status}.`;
        pushLoaMessage(output);
        announceHermesResultByVoice(output);
        return;
      }

      setHermesStatus("running");
    } catch (error) {
      clearPolling();
      setHermesStatus("error");
      pushLoaMessage("Hermes polling failed.");
      console.error(error);
    }
  }

  async function runHermesTask(userTask: string) {
    const trimmedTask = userTask.trim();

    if (!trimmedTask) {
      pushLoaMessage("검색할 내용을 다시 말해줘.");
      return;
    }

    const loaStateText = getLoaStateText();
    const systemPrompt = buildLoaSystemPrompt(
      config,
      memory,
      messagesRef.current,
      liveSource,
      loaStateText,
      geminiLiveStatus,
      useMicInput,
      isMicListening,
      isVideoFrameStreaming
    );

    const task =
      "Use Hermes tools to search, browse, research, or verify the following request. " +
      "Do not answer from model memory. Use current available sources if possible. " +
      "Return a concise answer and include source names or links when available. " +
      `Request: ${trimmedTask}`;

    clearPolling();
    setHermesStatus("starting");

    pushLoaMessage("Hermes로 찾아볼게.");

    try {
      const res = await fetch("/hermes/v1/runs", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.hermesApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: task,
          session_id: "loa-hud",
          instructions: systemPrompt,
        }),
      });

      const raw = await res.text();

      if (!res.ok) {
        throw new Error(raw || `${res.status} ${res.statusText}`);
      }

      const data: HermesRunResponse = raw ? JSON.parse(raw) : {};

      if (!data.run_id) {
        throw new Error(`Hermes did not return run_id: ${raw}`);
      }

      setHermesStatus("running");
      pushLoaMessage("Hermes가 검색 중이야.");

      await pollHermesRun(data.run_id);

      pollingTimerRef.current = window.setInterval(() => {
        pollHermesRun(data.run_id as string);
      }, 1200);
    } catch (error) {
      clearPolling();
      setHermesStatus("error");
      pushLoaMessage("Hermes 검색이 막혔어. Hermes gateway/API 설정을 확인해야 해.");
      console.error(error);
    }
  }

  async function runHermesSearch() {
    const loaStateText = getLoaStateText();
    const systemPrompt = buildLoaSystemPrompt(
      config,
      memory,
      messagesRef.current,
      liveSource,
      loaStateText,
      geminiLiveStatus,
      useMicInput,
      isMicListening,
      isVideoFrameStreaming
    );

    const task =
      `Say hello as ${config.loaName}, ${config.userName}'s live HUD. ` +
      "Confirm Hermes is connected in one short sentence.";

    clearPolling();
    setHermesStatus("starting");

    pushUserMessage(`${config.loaName}, test Hermes.`);
    pushLoaMessage("Got it. I'll ask Hermes.");

    try {
      const res = await fetch("/hermes/v1/runs", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.hermesApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: task,
          session_id: "loa-hud",
          instructions: systemPrompt,
        }),
      });

      const raw = await res.text();

      if (!res.ok) {
        throw new Error(raw || `${res.status} ${res.statusText}`);
      }

      const data: HermesRunResponse = raw ? JSON.parse(raw) : {};

      if (!data.run_id) {
        throw new Error(`Hermes did not return run_id: ${raw}`);
      }

      setHermesStatus("running");
      pushLoaMessage("Hermes is running.");

      await pollHermesRun(data.run_id);

      pollingTimerRef.current = window.setInterval(() => {
        pollHermesRun(data.run_id as string);
      }, 1200);
    } catch (error) {
      clearPolling();
      setHermesStatus("error");
      pushLoaMessage("Hermes blocked.");
      console.error(error);
    }
  }

  function resetSetup() {
    userEndedLiveRef.current = true;
    shouldAutoReconnectRef.current = false;
    clearGeminiReconnectTimer();
    stopLiveWatchdog();
    stopWakeWordListener();
    setIsSoftSleeping(false);
    isSoftSleepingRef.current = false;

    localStorage.removeItem(CONFIG_KEY);
    localStorage.removeItem(MEMORY_KEY);
    localStorage.removeItem(MESSAGES_KEY);
    onResetSetup();
  }

  function getLoaStateText() {
    return isSpeaking
      ? "SPEAKING"
      : geminiLiveStatus === "connecting"
      ? "CONNECTING LIVE"
      : geminiLiveStatus === "connected" && isSoftSleeping
      ? "QUIET"
      : geminiLiveStatus === "connected" && isMicListening
      ? "VOICE LIVE"
      : geminiLiveStatus === "connected" && !isMicListening && desiredMicOnRef.current
      ? "RESTORING MIC"
      : geminiLiveStatus === "connected" && !isMicListening && isWakeListenerOn
      ? "WAKE WORD"
      : geminiLiveStatus === "connected" && !isMicListening
      ? "MIC OFF"
      : hermesStatus === "starting"
      ? "CONNECTING TO HERMES"
      : hermesStatus === "running"
      ? "HERMES RUNNING"
      : hermesStatus === "completed"
      ? "TASK COMPLETE"
      : hermesStatus === "failed"
      ? "HERMES FAILED"
      : hermesStatus === "cancelled"
      ? "HERMES CANCELLED"
      : hermesStatus === "error"
      ? "HERMES ERROR"
      : liveSource === "screen"
      ? "WATCHING SCREEN"
      : liveSource === "camera"
      ? "WATCHING OBS"
      : "STANDING BY";
  }

  const loaStateText = getLoaStateText();

  const liveBadgeText =
    liveSource === "screen" ? "SCREEN" : liveSource === "camera" ? "OBS" : "OFF";

  const hermesButtonText =
    hermesStatus === "starting"
      ? "Connecting..."
      : hermesStatus === "running"
      ? "Hermes Running"
      : "Test Hermes";

  const micButtonText =
    geminiLiveStatus === "connected"
      ? isSoftSleeping
        ? "Wake"
        : isMicListening
        ? "Quiet"
        : "Wake"
      : "Mic";

  const memoryLabel =
    config.memoryMode === "ask"
      ? "ASK"
      : config.memoryMode === "manual"
      ? "MANUAL"
      : "BASIC";

  return (
    <main className="page">
      <div className="appShell">
        <header className="topBar">
          <div className="brand">
            <p className="microLabel">LOA HUD</p>
            <h1>{config.loaName}</h1>
          </div>

          <div className="topStatus">
            <button
              className="statusPill"
              onClick={liveViewOn ? stopLiveView : startScreenShare}
            >
              <span className={`statusDot ${liveViewOn ? "on" : ""}`} />
              {liveViewOn ? loaStateText : "Live view off"}
            </button>

            <button className="settingsButton" onClick={resetSetup}>
              Setup
            </button>
          </div>
        </header>

        <section className="workspace">
          <aside className="commsPanel">
            <div className="panelHeader">
              <span>COMMS</span>
            </div>

            <div className="messageList" ref={messageListRef}>
              {messages.map((message, index) => (
                <div key={index} className={`message ${message.role}`}>
                  <span className="messageRole">
                    {message.role === "loa"
                      ? config.loaName.toUpperCase()
                      : "YOU"}
                  </span>
                  <p>{message.text}</p>
                </div>
              ))}
            </div>
          </aside>

          <section className="mainColumn">
            <div className="modeRow">
              <button className="modeChip active">WORK</button>

              <button className={`modeChip ${liveViewOn ? "active" : ""}`}>
                LIVE VIEW
              </button>

              <button
                className={`modeChip ${
                  geminiLiveStatus === "connected" ? "active" : ""
                }`}
              >
                VOICE: {config.geminiVoice}
              </button>

              <button
                className={`modeChip ${showMemoryPanel ? "active" : ""}`}
                onClick={() => setShowMemoryPanel((prev) => !prev)}
              >
                MEMORY: {memoryLabel}
              </button>

              <button
                className={`modeChip ${showMemoryPanel ? "active" : ""}`}
                onClick={() => setShowMemoryPanel((prev) => !prev)}
              >
                IDENTITY: READY
              </button>
            </div>

            {pendingMemory && (
              <section className="memoryApprovalPanel">
                <div className="memoryApprovalCopy">
                  <p className="microLabel">SAVE MEMORY?</p>
                  <h3>{pendingMemory.title}</h3>
                  <p>{pendingMemory.text}</p>
                </div>

                <div className="memoryApprovalActions">
                  <button className="primaryButton" onClick={approveMemorySave}>
                    Save Memory
                  </button>
                  <button className="secondaryButton" onClick={rejectMemorySave}>
                    Not now
                  </button>
                </div>
              </section>
            )}

            <section className="voiceLivePanel">
              <div className="voiceLiveHeader">
                <div>
                  <p className="microLabel">GEMINI LIVE</p>
                  <h3>Live Control</h3>
                </div>

                <span className={`voiceStatus ${geminiLiveStatus}`}>
                  {geminiLiveStatus === "connected" && isSoftSleeping
                    ? "QUIET"
                    : geminiLiveStatus === "connected" && !isMicListening
                    ? desiredMicOnRef.current
                      ? "RESTORING MIC"
                      : isWakeListenerOn
                      ? "WAKE WORD"
                      : "MIC OFF"
                    : geminiLiveStatus.toUpperCase()}
                </span>
              </div>

              <div className="voiceLiveGrid compact">
                <button
                  className={`voiceToggle ${isMicListening ? "on" : ""}`}
                  onClick={() => {
                    if (geminiLiveStatus !== "connected") {
                      setUseMicInput((prev) => !prev);
                    }
                  }}
                  disabled={geminiLiveStatus === "connected"}
                >
                  <span>MIC</span>
                  <strong>
                    {geminiLiveStatus === "connected"
                      ? isSoftSleeping
                        ? "QUIET"
                        : isMicListening
                        ? "LISTENING"
                        : desiredMicOnRef.current
                        ? "RESTORING"
                        : isWakeListenerOn
                        ? "WAKE WORD"
                        : "OFF"
                      : useMicInput
                      ? "ON"
                      : "OFF"}
                  </strong>
                </button>

                <button className="voiceToggle on" disabled>
                  <span>OUTPUT VOICE</span>
                  <strong>{config.geminiVoice}</strong>
                </button>
              </div>
            </section>

            <section className="loaPanel">
              <div className="loaVisualBlock">
                <div
                  className={`orbStage ${
                    isSpeaking ||
                    hermesStatus === "running" ||
                    liveViewOn ||
                    geminiLiveStatus === "connected"
                      ? "speaking"
                      : ""
                  }`}
                >
                  <div className="ambientRing ringA" />
                  <div className="ambientRing ringB" />

                  <div className="pulse pulseOne" />
                  <div className="pulse pulseTwo" />
                  <div className="pulse pulseThree" />

                  <div className="orbShell">
                    <div className="orbCore" />
                  </div>
                </div>
              </div>

              <div className="loaCopy">
                <p className="heroLabel">ASSISTANT / LIVE VIEW</p>
                <h2>{config.loaName}</h2>
                <p className="heroState">{loaStateText}</p>
              </div>
            </section>

            {showMemoryPanel && (
              <section className="memoryPanel">
                <div className="memoryPanelHeader">
                  <div>
                    <p className="microLabel">LOA MEMORY</p>
                    <h3>Identity Core</h3>
                  </div>

                  <button
                    className="tinyButton"
                    onClick={() => setShowMemoryPanel(false)}
                  >
                    Close
                  </button>
                </div>

                <div className="memoryGrid">
                  <article className="memoryCard wide">
                    <span className="memoryTitle">IDENTITY</span>
                    <p>{memory.identity.role}</p>
                  </article>

                  <article className="memoryCard">
                    <span className="memoryTitle">PRINCIPLES</span>
                    <ul>
                      {memory.identity.principles.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </article>

                  <article className="memoryCard">
                    <span className="memoryTitle">STYLE</span>
                    <ul>
                      {memory.identity.style.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </article>

                  <article className="memoryCard">
                    <span className="memoryTitle">USER MEMORY</span>
                    <p className="memorySubline">Name: {memory.userMemory.name}</p>
                    <ul>
                      {memory.userMemory.preferences.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </article>

                  <article className="memoryCard">
                    <span className="memoryTitle">PROJECTS</span>
                    <ul>
                      {memory.userMemory.projects.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </article>

                  <article className="memoryCard">
                    <span className="memoryTitle">WORK STYLE</span>
                    <ul>
                      {memory.userMemory.workStyle.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </article>

                  <article className="memoryCard">
                    <span className="memoryTitle">SESSION</span>
                    <p className="memorySubline">
                      Mode: {memory.sessionMemory.currentMode}
                    </p>
                    <p className="memorySubline">
                      Task: {memory.sessionMemory.currentTask}
                    </p>
                    <ul>
                      {memory.sessionMemory.recentEvents.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </article>

                  <article className="memoryCard">
                    <span className="memoryTitle">SCREEN MEMORY</span>
                    <p className="memorySubline">
                      Source: {memory.screenMemory.source}
                    </p>
                    <p>{memory.screenMemory.summary}</p>
                    <p className="memoryTimestamp">
                      {memory.screenMemory.updatedAt
                        ? `Updated: ${memory.screenMemory.updatedAt}`
                        : "Not updated yet"}
                    </p>
                  </article>
                </div>
              </section>
            )}

            <section className="livePanel">
              <div className="livePanelHeader">
                <span>LIVE VIEW</span>
                <span className={liveViewOn ? "liveBadge on" : "liveBadge"}>
                  {liveBadgeText}
                </span>
              </div>

              <div className="liveFrame">
                {viewStream ? (
                  <video
                    ref={videoRef}
                    className="screenVideo"
                    autoPlay
                    muted
                    playsInline
                  />
                ) : (
                  <div className="feedPlaceholder off">
                    <div className="feedGrid" />
                    <span>NO SCREEN SOURCE</span>
                  </div>
                )}
              </div>

              <div className="sourceBar">
                <select
                  className="sourceSelect"
                  value={selectedVideoDeviceId}
                  onChange={(event) =>
                    setSelectedVideoDeviceId(event.target.value)
                  }
                >
                  <option value="">Camera source</option>
                  {videoDevices.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Camera ${index + 1}`}
                    </option>
                  ))}
                </select>

                <button className="tinyButton" onClick={refreshVideoDevices}>
                  Refresh
                </button>
              </div>
            </section>

            <div className="actions">
              <div className="privacyStatus" role="status" aria-live="polite">
                <span className={liveViewOn ? "privacyDot active" : "privacyDot"} />
                {liveViewOn
                  ? `${liveSource === "screen" ? "Screen" : "Camera"} sharing on`
                  : geminiLiveStatus === "connected" && isMicListening
                  ? "Microphone sharing on"
                  : "Nothing is being shared"}
              </div>

              <button className="primaryButton" onClick={startScreenShare}>
                Share Screen
              </button>

              <button className="secondaryButton" onClick={startCameraSource}>
                OBS Camera
              </button>

              <button
                className="secondaryButton"
                onClick={stopLiveView}
                disabled={!liveViewOn}
              >
                Stop View
              </button>

              {geminiLiveStatus === "connected" ? (
                <>
                  <button
                    className="secondaryButton"
                    onClick={isSoftSleeping ? wakeMic : isMicListening ? sleepMic : wakeMic}
                  >
                    {micButtonText}
                  </button>

                  <button
                    className="secondaryButton"
                    onClick={disconnectGeminiLiveShell}
                  >
                    End Live
                  </button>
                </>
              ) : (
                <button
                  className="secondaryButton"
                  onClick={() => connectGeminiLiveShell(false)}
                  disabled={geminiLiveStatus === "connecting"}
                >
                  {geminiLiveStatus === "connecting"
                    ? "Connecting Live..."
                    : "Connect Live"}
                </button>
              )}

              <button
                className="secondaryButton"
                onClick={runHermesSearch}
                disabled={
                  hermesStatus === "starting" || hermesStatus === "running"
                }
              >
                {hermesButtonText}
              </button>

              <button className="secondaryButton dangerSoft" onClick={clearChatHistory}>
                Clear Chat
              </button>

              <button
                className="secondaryButton privacyStop"
                onClick={stopAllSharing}
                disabled={!liveViewOn && geminiLiveStatus === "disconnected"}
              >
                Stop All Sharing
              </button>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}

export default function App() {
  const [config, setConfig] = useState<LoaConfig | null>(() =>
    loadStoredConfig()
  );

  if (!config) {
    return <SetupWizard onComplete={setConfig} />;
  }

  return (
    <LoaHud
      config={config}
      onResetSetup={() => {
        setConfig(null);
      }}
    />
  );
}
