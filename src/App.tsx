import { organizeMemories } from "./memoryOrganizer";
import { ConnectionTest } from "./ConnectionTest";
import { saveChatImages, SavedChatImage, type SavedImage } from "./chatImages";
import { useEffect, useRef, useState } from "react";
import { GeminiLiveClient } from "./geminiLiveClient";
import { PcmAudioPlayer } from "./audioPlayback";
import { MicrophoneCapture } from "./microphoneCapture";
import { VideoFrameCapture } from "./videoFrameCapture";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./App.css";
import { NotebookPanel } from "./notebook";
import { readNotebook, saveNotebook, recordMemory, recordJournal, notebookContext } from "./notebookStore";
import "./refined.css";
import { SettingsPanel } from "./SettingsPanel";

type Role = "loa" | "you";

type Message = {
  role: Role;
  text: string;
  at?: string;
  images?: SavedImage[];
};

type LiveAttachment = {
  id: string;
  name: string;
  kind: "text" | "pdf" | "image";
  mimeType: string;
  textContent?: string;
  base64Data?: string;
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

export type LoaConfig = {
  userName: string;
  loaName: string;
  geminiApiKey: string;
  geminiVoice: GeminiVoice;
  hermesUrl: string;
  hermesApiKey: string;
  defaultLiveSource: DefaultLiveSource;
  memoryMode: MemoryMode;
  personalInstructions?: string;
  proactiveMode?: "off" | "occasional" | "active";
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

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function dataUrlPayload(dataUrl: string) {
  return dataUrl.includes(",") ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read this file."));
    reader.readAsDataURL(file);
  });
}

async function extractPdfText(file: File) {
  const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const pdf = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) pages.push(`[Page ${pageNumber}]\n${text}`);
  }
  return pages.join("\n\n");
}

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
  geminiVoice: "Leda",
  hermesUrl: "http://127.0.0.1:8642",
  hermesApiKey: "",
  defaultLiveSource: "ask",
  memoryMode: "auto_basic",
};


function normalizeGeminiVoice(value: unknown): GeminiVoice {
  if (typeof value === "string" && GEMINI_VOICES.includes(value as GeminiVoice)) {
    return value as GeminiVoice;
  }

  return "Leda";
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
    /\[?LOA_MEMORY_PROPOSAL\]([\s\S]*?)\[\/LOA_MEMORY_PROPOSAL\]/i;

  const match = text.match(pattern);

  if (!match) {
    return {
      visibleText: text.replace(/\[?LOA_MEMORY_PROPOSAL\][\s\S]*$/i, "").trim(),
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
      memoryMode: "auto_basic",
    };
  } catch {
    return null;
  }
}

function saveStoredConfig(config: LoaConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

function createInitialMessages(_config: LoaConfig): Message[] { return []; }

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

    // Recover valid memory payloads previously shown as assistant text.
    for (const message of messages) {
      if (message.role !== "loa" || !message.text.includes("LOA_MEMORY_PROPOSAL]")) continue;
      const extracted = extractMemoryProposalFromText(message.text);
      if (extracted.proposal) recordMemory(extracted.proposal.title, extracted.proposal.text);
      message.text = extracted.visibleText;
    }
    const cleaned = messages.filter((message, index) => !(index === 0 && message.role === "loa" && message.text === `${config.loaName} online. Hi, ${config.userName}.`));
    saveStoredMessages(cleaned);
    return cleaned.slice(-300);
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
      preferences: [],
      projects: [],
      workStyle: [],
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
${notebookContext()}

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
See the saved notebook above.

Projects:
See the saved notebook above.

Work style:
See the saved notebook above.

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

Personal conversation instructions:
The following are user preferences for voice and chat. Follow them over generic tone and brevity defaults. They do not change tool permissions, factual accuracy, or privacy requirements.
${typeof config.personalInstructions === "string" ? config.personalInstructions.trim().slice(0,6000) : ""}

Voice behavior (defaults when no personal preference applies):
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

Memory behavior:
- A separate background organizer saves important context after conversation. Do not output memory tags or JSON in your speech or chat.
- Do not claim that a memory was saved until it appears in the supplied saved notebook.
- Respond naturally to requests to remember, without announcing unverified storage success.

Important:
- If no visual source is active, do not claim to see the user's screen.
- If video frame streaming is not active, do not claim to see current screen details.
- If a visual source is active and video frames are streaming, you may discuss the visible screen.
- Background/system/screen audio is disabled. Do not claim to hear app, game, YouTube, music, or video audio.
- If microphone is sleeping, you may still respond to text/system messages, but you are not hearing the user's voice.
- If you want to remember something, emit the memory tag for automatic saving. Do not silently save sensitive details.
`.trim();
}

function SetupWizard({
  onComplete,
  initialConfig,
  onCancel,
}: {
  onComplete: (config: LoaConfig) => void;
  initialConfig?: LoaConfig;
  onCancel?: () => void;
}) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<LoaConfig>(
    initialConfig ? { ...initialConfig } : DEFAULT_CONFIG
  );
  const [testMessage, setTestMessage] = useState("");
  const hermesTestRun = useRef(0);
  useEffect(() => { hermesTestRun.current++; setTestMessage(""); }, [draft.hermesApiKey, draft.hermesUrl]);

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
    const run = ++hermesTestRun.current;
    setTestMessage("Testing Hermes...");

    try {
      const tempConfig: LoaConfig = {
        ...draft,
        userName: draft.userName.trim() || "User",
        loaName: draft.loaName.trim() || "Loa",
        geminiVoice: normalizeGeminiVoice(draft.geminiVoice),
        memoryMode: "auto_basic",
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

      if (run === hermesTestRun.current) setTestMessage("Hermes request accepted.");
    } catch (error) {
      console.error(error);
      if (run === hermesTestRun.current) setTestMessage("Could not connect. Check that the Hermes gateway is running and your API key is correct.");
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
      memoryMode: "auto_basic",
    };

    const existingMemory = initialConfig
      ? loadStoredMemory(finalConfig)
      : createDefaultMemory(finalConfig);
    const existingMessagesRaw = localStorage.getItem(MESSAGES_KEY);
    const hasExistingMessages = Boolean(existingMessagesRaw);

    saveStoredConfig(finalConfig);
    saveStoredMemory(existingMemory);

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
          <h1>
            {initialConfig
              ? "Loa settings"
              : step === 0
              ? "Welcome to Loa"
              : "First launch setup"}
          </h1>
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

              <ConnectionTest apiKey={draft.geminiApiKey} voice={draft.geminiVoice} />

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

              <div className="connectionTest">
                <div className="connectionTestRow">
                  {testMessage !== "Hermes request accepted." && <button type="button" className="connectionTestButton" disabled={testMessage === "Testing Hermes..."} onClick={testHermes}>
                    {testMessage === "Testing Hermes..." ? "Testing…" : "Test connection"}<span aria-hidden="true">↗</span>
                  </button>}
                  <span role="status" title={testMessage === "Hermes request accepted." ? "Hermes accepted the test request." : undefined} className={"connectionBadge" + (testMessage === "Hermes request accepted." ? " isVerified" : "")}>
                    {testMessage === "Testing Hermes..." ? "Connecting…" : testMessage === "Hermes request accepted." ? "✓ Connected" : testMessage ? "Could not connect" : ""}
                  </span>
                </div>
                {testMessage && testMessage !== "Testing Hermes..." && testMessage !== "Hermes request accepted." && <p className="connectionError">{testMessage}</p>}
              </div>
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

              <div className="setupHint"><strong>Automatic memories</strong><p>Loa saves meaningful moments and context as you talk. You can review, edit, or delete them in Memories.</p></div>

              
            </div>
          )}
        </div>

        <div className="setupActions">
          <button
            className="secondaryButton"
            onClick={() => {
              if (step === 0 && onCancel) {
                onCancel();
                return;
              }
              setStep((prev) => Math.max(0, prev - 1));
            }}
            disabled={step === 0 && !onCancel}
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
  onOpenSettings,
}: {
  config: LoaConfig;
  onOpenSettings: () => void;
}) {
  const [memory, setMemory] = useState<LoaMemory>(() =>
    loadStoredMemory(config)
  );
  const [pendingMemory, setPendingMemory] =
    useState<PendingMemoryProposal | null>(null);
  const pendingMemoryRef = useRef<PendingMemoryProposal | null>(null);
  const [showMemoryPanel, setShowMemoryPanel] = useState(false);
  const [showNotebook, setShowNotebook] = useState(false);
  useEffect(() => { if(showNotebook) { document.getElementById("loa-notebook")?.scrollIntoView({behavior:"smooth",block:"start"}); setShowNotebook(false); } }, [showNotebook]);
  const [notebookTab, setNotebookTab] = useState<"memory" | "journal">("memory");
  const [notice, setNotice] = useState("");
  const journalRequestedRef = useRef(false);
  const journalTextRef = useRef("");
  const scheduledJournalDateRef = useRef<string | null>(null);
  const [liveViewOn, setLiveViewOn] = useState(false);
  const [liveSource, setLiveSource] = useState<LiveSource>("none");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceLevel, setVoiceLevel] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setVoiceLevel(audioPlayerRef.current?.getLevel() ?? 0), 50); return () => window.clearInterval(timer); }, []);
  const [showHermesInfo, setShowHermesInfo] = useState(false);
  const [hermesVerified, setHermesVerified] = useState(false);
  useEffect(()=>setHermesVerified(false),[config.hermesApiKey,config.hermesUrl]);
  useEffect(()=>{if(!showHermesInfo)return;const close=(e:KeyboardEvent)=>{if(e.key==="Escape")setShowHermesInfo(false);};window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close);},[showHermesInfo]);
  const [hermesStatus, setHermesStatus] = useState<HermesStatus>("idle");
  const [geminiLiveStatus, setGeminiLiveStatus] =
    useState<GeminiLiveStatus>("disconnected");
  const [useMicInput, setUseMicInput] = useState(true);
  const [isMicListening, setIsMicListening] = useState(false);
  const [isSoftSleeping, setIsSoftSleeping] = useState(false);
  const [isWakeListenerOn, setIsWakeListenerOn] = useState(false);
  const [isVideoFrameStreaming, setIsVideoFrameStreaming] = useState(false);
  const [viewStream, setViewStreamState] = useState<MediaStream | null>(null);
  const viewStreamRef=useRef<MediaStream|null>(null);
  function setViewStream(value:MediaStream|null|((current:MediaStream|null)=>MediaStream|null)){const stream=typeof value==="function"?value(viewStreamRef.current):value;viewStreamRef.current=stream;setViewStreamState(stream);}
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState("");
  const [chatText, setChatText] = useState("");
  const [liveAttachments, setLiveAttachments] = useState<LiveAttachment[]>([]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const followChatRef = useRef(true);
  const [showChatBottom, setShowChatBottom] = useState(false);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const liveFileInputRef = useRef<HTMLInputElement | null>(null);
  const speakingTimerRef = useRef<number | null>(null);
  const pollingTimerRef = useRef<number | null>(null);
  const keepAliveTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const liveWatchdogTimerRef = useRef<number | null>(null);
  const userEndedLiveRef = useRef(false);
  const shouldAutoReconnectRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const liveResumeRef = useRef<string | undefined>(undefined);
  useEffect(()=>{liveResumeRef.current=undefined;},[config.geminiApiKey,config.geminiVoice,config.personalInstructions]);
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
  const memoryBaselineRef=useRef(messagesRef.current.filter(m=>m.role==="you").map(m=>m.at+":"+m.text).join("|"));
  const memoryProcessedRef=useRef(messagesRef.current.at(-1));
  const memoryBusyRef=useRef(false);
  const memoryAbortRef=useRef<AbortController|null>(null);
  const lastMemoryRunRef=useRef(0);
  useEffect(()=>{
    const onEdit=()=>{memoryProcessedRef.current=messagesRef.current.at(-1);memoryBaselineRef.current=messagesRef.current.filter(m=>m.role==="you").map(m=>m.at+":"+m.text).join("|");};
    window.addEventListener("loa-notebook",onEdit);
    return ()=>{window.removeEventListener("loa-notebook",onEdit);memoryAbortRef.current?.abort();};
  },[]);
  useEffect(()=>{
    if(!config.geminiApiKey)return;
    const timer=window.setInterval(()=>{
      const current=messagesRef.current;
      const signature=current.filter(m=>m.role==="you").map(m=>m.at+":"+m.text).join("|");
      if(signature===memoryBaselineRef.current || memoryBusyRef.current || Date.now()-lastMemoryRunRef.current<45000)return;
      if(current[current.length-1]?.role!=="loa")return;
      memoryBusyRef.current=true;lastMemoryRunRef.current=Date.now();
      const controller=new AbortController();memoryAbortRef.current=controller;
      const timeout=window.setTimeout(()=>controller.abort(),30000);
      window.dispatchEvent(new CustomEvent("loa-memory-status",{detail:"Organizing memories…"}));
      const previous=memoryProcessedRef.current;
      const anchor=previous ? current.findLastIndex(m=>m.role===previous.role && m.at===previous.at && m.text===previous.text) : -1;
      const start=anchor+1;
      organizeMemories(config.geminiApiKey,current.slice(start).slice(-24),controller.signal,current.slice(Math.max(0,start-24),start)).then(result=>{
        const {applied,created,updated}=result;
        if(applied){memoryBaselineRef.current=signature;memoryProcessedRef.current=current.at(-1);}
        window.dispatchEvent(new CustomEvent("loa-memory-status",{detail:applied?("Memory review: "+created+" new, "+updated+" updated."):"Memory changed during review. Previous results were discarded."}));
      }).catch((error)=>{const message=controller.signal.aborted?"Memory review timed out or was cancelled.":error instanceof Error?error.message:"Memory review failed.";window.dispatchEvent(new CustomEvent("loa-memory-status",{detail:message}));})
      .finally(()=>{clearTimeout(timeout);memoryBusyRef.current=false;});
    },12000);
    return ()=>{clearInterval(timer);memoryAbortRef.current?.abort();};
  },[config.geminiApiKey]);

  const [messages, setMessages] = useState<Message[]>(messagesRef.current);

  useEffect(() => {
    refreshVideoDevices();
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
    const list=messageListRef.current;if(!list)return;
    const bottom=()=>{if(followChatRef.current) { list.scrollTop=list.scrollHeight; setShowChatBottom(false); } else setShowChatBottom(list.scrollHeight-list.scrollTop-list.clientHeight > 160);};
    const frame=requestAnimationFrame(bottom);
    // Persisted images load after the first layout.
    const loaded=()=>{requestAnimationFrame(bottom);};
    list.addEventListener("load",loaded,true);
    return ()=>{cancelAnimationFrame(frame);list.removeEventListener("load",loaded,true);};
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
      const next = updater(current).slice(-300).map(m => m.at ? m : { ...m, at: new Date().toISOString() });
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

  async function addLiveFiles(files: FileList | File[]) {
    const slots = Math.max(0, 10 - liveAttachments.length);
    if (files.length > slots) setNotice("Up to 10 attachments per message. Remove an attachment to add more.");
    const accepted = Array.from(files).slice(0, slots);
    const next = await Promise.all(accepted.map(async (file): Promise<LiveAttachment> => {
      const isImage = file.type.startsWith("image/");
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      const isText = file.type.startsWith("text/") || /\.(txt|md|json|csv|tsv|js|jsx|ts|tsx|css|html|xml|yaml|yml|py|java|c|cpp|h|hpp|rs|go|sql|sh|ps1)$/i.test(file.name);
      if (!isImage && !isPdf && !isText) throw new Error(`${file.name} is not supported. Attach an image, PDF, or text/code file.`);
      if (isImage && file.size > 10 * 1024 * 1024) throw new Error(`${file.name} is larger than 10 MB.`);
      if (isPdf && file.size > 20 * 1024 * 1024) throw new Error(`${file.name} is larger than 20 MB.`);
      if (isText && file.size > 2 * 1024 * 1024) throw new Error(`${file.name} is larger than 2 MB.`);
      if (isImage) {
        const dataUrl = await readFileAsDataUrl(file);
        return { id: makeId("live-file"), name: file.name, kind: "image", mimeType: file.type || "image/jpeg", base64Data: dataUrlPayload(dataUrl) };
      }
      if (isPdf) {
        const textContent = await extractPdfText(file);
        if (!textContent) throw new Error(`${file.name} has no extractable text. Scanned PDFs need OCR before Loa can read them.`);
        return { id: makeId("live-file"), name: file.name, kind: "pdf", mimeType: "application/pdf", textContent };
      }
      return { id: makeId("live-file"), name: file.name, kind: "text", mimeType: file.type || "text/plain", textContent: await file.text() };
    }));
    setLiveAttachments((current) => [...current, ...next].slice(0, 10));
    window.requestAnimationFrame(() => chatInputRef.current?.focus());
  }

  function removeLiveAttachment(id: string) {
    setLiveAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  const sendingChatRef = useRef(false);
  const imageHoldRef = useRef(0);
  const lastConversationRef = useRef(Date.now());
  const lastProactiveRef = useRef(Date.now());
  const proactiveModeRef = useRef(config.proactiveMode || "occasional");
  useEffect(()=>{proactiveModeRef.current=config.proactiveMode || "occasional";},[config.proactiveMode]);


  async function sendLiveChat() {
    if (sendingChatRef.current) return;
    const text = chatText.trim();
    if (!text && liveAttachments.length === 0) return;
    const client = geminiLiveClientRef.current;
    if (geminiLiveStatus !== "connected" || !client?.isConnected()) {
      pushLoaMessage("Connect Gemini Live before sending chat or files.");
      return;
    }
    sendingChatRef.current = true;
    try {
    const images = liveAttachments.filter(a => a.kind === "image" && a.base64Data);
    const savedImages = await saveChatImages(images);
    if(images.length) {
      try {
        imageHoldRef.current = Date.now() + 60000;
        client.sendText("Receiving "+images.length+" separate numbered photos. Wait silently until PHOTO_BATCH_COMPLETE before answering.");
        for (const [index, attachment] of images.entries()) {
          await new Promise(resolve => window.setTimeout(resolve, 1100));
          if(geminiLiveClientRef.current !== client || !client.isConnected()) throw Error("Live disconnected. Reconnect and send again.");
          const image = new Image();
          image.src = 'data:'+attachment.mimeType+';base64,'+attachment.base64Data;
          await image.decode();
          const scale=Math.min(1,1280/Math.max(image.width,image.height));
          const canvas=document.createElement("canvas");
          canvas.width=Math.max(320,Math.round(image.width*scale));canvas.height=Math.round(image.height*scale)+48;
          const ctx=canvas.getContext("2d");if(!ctx)throw Error("Image preparation unavailable.");
          ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);
          ctx.fillStyle="#222";ctx.font="24px sans-serif";ctx.fillText("Photo "+(index+1)+" of "+images.length,16,32);
          ctx.drawImage(image,0,48,image.width*scale,image.height*scale);
          client.sendVideoFrame(canvas.toDataURL("image/jpeg",.9).split(",")[1],"image/jpeg");
        }
        imageHoldRef.current=Date.now()+30000;
      } catch(error) { setNotice(error instanceof Error ? error.message : 'Could not prepare images.'); return; }
    }
    const documentText = liveAttachments
      .filter((attachment) => attachment.textContent)
      .map((attachment) => `[BEGIN ATTACHMENT: ${attachment.name}]\n${attachment.textContent}\n[END ATTACHMENT: ${attachment.name}]`)
      .join("\n\n")
      .slice(0, 160000);
    const imageNames = liveAttachments.filter((attachment) => attachment.kind === "image").map((attachment, index) => `Image ${index+1}: ${attachment.name}`);
    const prompt = [
      text || "Read the attached files and respond to their contents.",
      documentText ? `ATTACHED DOCUMENTS — use these as the primary source. Do not invent missing details.\n\n${documentText}` : "",
      imageNames.length > 0 ? `PHOTO_BATCH_COMPLETE. All photos have been sent separately in numbered order. Refer to first, second, third using the Photo N labels. Consider all photos, not just the latest frame. Be honest if any image is missing. Image names: ${imageNames.join(", ")}.` : "",
    ].filter(Boolean).join("\n\n");
    const display = `${text || "Read the attached files."}${liveAttachments.length > 0 ? `\nAttached: ${liveAttachments.map((attachment) => attachment.name).join(", ")}` : ""}`;
    setAndSaveMessages(current => [...current, {role:"you", text:display, images:savedImages}]);
    lastConversationRef.current=Date.now();
    client.sendText(prompt);
    setChatText(current => current === chatText ? "" : current);
    const sentIds = new Set(liveAttachments.map(attachment => attachment.id));
    setLiveAttachments(current => current.filter(attachment => !sentIds.has(attachment.id)));
    window.requestAnimationFrame(() => chatInputRef.current?.focus());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not send. Please try again.");
    } finally { sendingChatRef.current = false; }
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
      if (role === "loa" && ((finalText.includes("LOA_MEMORY_PROPOSAL]") && !finalText.includes("[/LOA_MEMORY_PROPOSAL]")) || (finalText.includes("[LOA_COMMAND]") && !finalText.includes("[/LOA_COMMAND]")))) return;

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

          if (memoryExtraction.proposal) saveMemoryProposal(memoryExtraction.proposal);

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
    if (reconnectTimerRef.current) return;

    if (!shouldAutoReconnectRef.current || userEndedLiveRef.current) {
      return;
    }

    reconnectAttemptRef.current += 1;

    const attempt = reconnectAttemptRef.current;
    if (attempt > 5) { shouldAutoReconnectRef.current = false; setGeminiLiveStatus("error"); setNotice("Connection could not be restored. Check your network and API key, then connect again."); return; }
    const delay = Math.min(1200 + attempt * 600, 5000);

    setGeminiLiveStatus("connecting");

    if (attempt === 1) {
      setNotice("Live slipped offline. Reconnecting quietly.");
    }

    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
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

  useEffect(() => {
    if (geminiLiveStatus !== "connected") return;
    const check = () => {
      const now = new Date();
      const day = [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
      if (now.getHours() !== 23 || now.getMinutes() < 50 || localStorage.getItem('loa-journal-day') === day || journalRequestedRef.current) return;
      if (!messagesRef.current.some(m => m.role === 'you' && m.at && new Date(m.at).toDateString() === now.toDateString())) return;
      journalRequestedRef.current = true; journalTextRef.current = ''; scheduledJournalDateRef.current = day;
      geminiLiveClientRef.current?.sendText("Write today's journal from our actual conversations, preserving events, context, significance and explicitly stated feelings. Use the user's conversation language. Do not invent missing details. Do not include command or memory tags.");
      setNotice("Loa is writing today's journal.");
    };
    const timer = window.setInterval(check, 15000); check();
    return () => window.clearInterval(timer);
  }, [geminiLiveStatus]);

  function saveMemoryProposal(proposal: PendingMemoryProposal) {
    recordMemory(proposal.title, proposal.text);
    pendingMemoryRef.current = null; setPendingMemory(null); setNotice("Memory saved to your notebook.");
  }

  function approveMemorySave() {
    const proposal = pendingMemoryRef.current;

    if (!proposal) return;

    saveMemoryProposal(proposal);
  }

  function rejectMemorySave() {
    pendingMemoryRef.current = null;
    setPendingMemory(null);
    pushLoaMessage("Okay. I will not save that memory.");
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
    return readNotebook().entries.filter(e => e.kind === "memory").map(e => ({category: "session" as MemoryCategory, text:e.text}));
  }

  function showMemoryByConversation() {
    setShowNotebook(true);

    const items = getMemoryItemsForCommand();

    if (items.length === 0) {
      pushLoaMessage("No memories saved yet.");
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

    pushLoaMessage(`Here are your saved memories.\\n${summary}`);
  }

  function deleteMemoryByQuery(query: string) {
    const notebook = readNotebook();
    const needle = query.trim().toLowerCase();
    if (needle) saveNotebook({...notebook, entries: notebook.entries.filter(e => !e.text.toLowerCase().includes(needle) && !e.title.toLowerCase().includes(needle))});
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      pushLoaMessage("Tell me which memory to delete.");
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
      pushLoaMessage(`Deleted: ${removedText}`);
      return;
    }

    pushLoaMessage("No matching memory found. Opening your memories.");
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

    if (!videoRef.current || !viewStreamRef.current?.getVideoTracks().some(track=>track.readyState==="live")) {
      if (showMessage) {
        setNotice("Choose a screen or camera to share first.");
      }
      return;
    }

    if (videoFrameCaptureRef.current) {
      setIsVideoFrameStreaming(true);
      return;
    }

    videoFrameCaptureRef.current = new VideoFrameCapture(
      (base64Jpeg, changed) => {
        const now=Date.now();
        if(sendingChatRef.current || now<imageHoldRef.current)return;
        geminiLiveClientRef.current?.sendVideoFrame(base64Jpeg);
        const mode=proactiveModeRef.current;
        if(changed && mode!=="off" && !isSoftSleepingRef.current && now-lastConversationRef.current>8000 && now-lastProactiveRef.current>(mode==="active"?30000:90000)){
          lastProactiveRef.current=now;
          geminiLiveClientRef.current?.sendText("[SCREEN OBSERVATION] The shared screen changed. If there is a meaningful new event worth mentioning, make one brief natural comment in the user's current language. Otherwise stay silent. Do not narrate routine movement, repeat observations, invent details, or ask questions just to fill silence.");
        }
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
      setNotice("Screen frames are being sent to Loa.");
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
        pushLoaMessage("Sleeping. Say “Hey Loa” to wake me.");
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
      pushLoaMessage("Quiet mode. The microphone stays connected.");
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
      pushLoaMessage("I am listening again.");
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
      const bytes=atob(base64Audio);
      let energy=0;
      for(let i=0;i+1<bytes.length;i+=2){
        let sample=bytes.charCodeAt(i)|(bytes.charCodeAt(i+1)<<8);
        if(sample>32767)sample-=65536;
        energy+=(sample/32768)**2;
      }
      if(Math.sqrt(energy/Math.max(1,bytes.length/2))>0.015)lastConversationRef.current=Date.now();
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

      setSelectedVideoDeviceId(current => cameras.some(camera => camera.deviceId === current) ? current : "");
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

      setNotice("Screen sharing started.");

      // The viewStream effect starts frames after React attaches the new video.
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
        pushLoaMessage("Camera view stopped.");
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

      setNotice(`Camera connected: ${label}`);

      // The viewStream effect starts frames after React attaches the new video.
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

  function connectGeminiLiveShell(isReconnectArg: boolean | unknown = false) {
    const isReconnect = isReconnectArg === true;
    if (!isReconnect && geminiLiveClientRef.current?.isActive()) return;

    if (!config.geminiApiKey.trim()) {
      setGeminiLiveStatus("error");
      pushLoaMessage("Gemini API key is missing. Open Setup to add it.");
      return;
    }

    clearGeminiReconnectTimer();
    stopGeminiKeepAlive();

    if (!isReconnect) { reconnectAttemptRef.current = 0; liveResumeRef.current=undefined; }
    userEndedLiveRef.current = false;
    shouldAutoReconnectRef.current = true;
    desiredMicOnRef.current = useMicInput;
    desiredVideoOnRef.current = Boolean(viewStream);
    startLiveWatchdog();

    audioPlayerRef.current?.stop();
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
      setNotice("Connecting to Gemini Live.");
    }

    const client = new GeminiLiveClient({
      apiKey: config.geminiApiKey,
      voiceName: config.geminiVoice,
      systemInstruction: systemPrompt,
      resumptionHandle: isReconnect ? liveResumeRef.current : undefined,
      onMessage: (message: any) => {
        if(geminiLiveClientRef.current !== client)return;
        const resume=message.sessionResumptionUpdate;
        if(resume){
          liveResumeRef.current=resume.resumable && typeof resume.newHandle==="string" ? resume.newHandle : undefined;
        }
        if(message.goAway && !userEndedLiveRef.current && shouldAutoReconnectRef.current){
          setNotice("Refreshing the Live connection. Keeping your conversation.");
          client.disconnect();
          connectGeminiLiveShell(true);
          return;
        }
        if (message?.serverContent?.interrupted) { audioPlayerRef.current?.stop(); journalRequestedRef.current = false; journalTextRef.current = ""; }
        if (message?.serverContent?.turnComplete && journalRequestedRef.current) {
          if (journalTextRef.current.trim()) { recordJournal(journalTextRef.current.trim()); if(scheduledJournalDateRef.current) localStorage.setItem("loa-journal-day",scheduledJournalDateRef.current); }
          scheduledJournalDateRef.current = null;
          journalRequestedRef.current = false; journalTextRef.current = "";
          setNotice("Journal draft saved. Review it in Memories & journal.");
        }
      },
      onOpen: () => {
        setNotice("Gemini Live socket opened. Sending setup.");
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

        setNotice(isReconnect ? "Live reconnected." : "Gemini Live connected.");

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
            if (geminiLiveClientRef.current !== client || userEndedLiveRef.current) return;
            startMicrophoneCapture(false).then(() => {
              if (!isReconnect) {
                setNotice("Microphone connected.");
              }
            });
          }, isReconnect ? 700 : 1800);
        }

        if (shouldRestoreVideo) {
          window.setTimeout(() => {
            if (geminiLiveClientRef.current !== client || userEndedLiveRef.current) return;
            startVideoFrameStreaming(!isReconnect);
          }, isReconnect ? 700 : 900);
        }
      },
      onText: (text) => {
        if (text.includes("[LOA_KEEPALIVE]")) return;
        pushStreamingTextChunk("loa", text);
      },
      onInputText: (text) => {
        lastConversationRef.current=Date.now();
        if (text.includes("[LOA_KEEPALIVE]")) return;
        pushStreamingTextChunk("you", text);
      },
      onOutputText: (text) => {
        if (journalRequestedRef.current) journalTextRef.current += text;
        if (text.includes("[LOA_KEEPALIVE]")) return;
        pushStreamingTextChunk("loa", text);
      },
      onAudioChunk: (chunk) => {
        if(userEndedLiveRef.current || geminiLiveClientRef.current!==client)return;
        lastConversationRef.current=Math.max(Date.now(),lastConversationRef.current)+Math.ceil(chunk.length*0.75/48);
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
      onClose: (code, reason) => {
        if(geminiLiveClientRef.current!==client)return;
        audioPlayerRef.current?.stop();
        journalRequestedRef.current = false; journalTextRef.current = "";
        const sessionExpired=/goaway|session duration|session.*expir/i.test(reason);
        const rejectedResume=!!liveResumeRef.current && /resum|handle/i.test(reason);
        if(rejectedResume)liveResumeRef.current=undefined;
        if ([1008, 1003, 1007].includes(code) && !sessionExpired && !rejectedResume) {
          shouldAutoReconnectRef.current = false;
          setNotice(`Live connection rejected (${code}). Check the model and API key in Settings. ${reason.slice(0, 120)}`);
        }
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
        setNotice("Live ended ("+code+"): "+(reason ? reason.split(config.geminiApiKey).join("[redacted]").slice(0,200) : "No reason was supplied by the server.")+" Select Start Loa to reconnect.");
      },
    });

    geminiLiveClientRef.current = client;
    client.connect();
  }

  async function disconnectGeminiLiveShell() {
    journalRequestedRef.current = false; journalTextRef.current = "";
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

    // Silence playback and detach the socket before asynchronous microphone cleanup.
    audioPlayerRef.current?.stop();
    geminiLiveClientRef.current?.disconnect();
    geminiLiveClientRef.current = null;
    stopVideoFrameStreaming();
    await stopMicrophoneCapture(false, false, false);

    clearGeminiTextBuffers();
    setGeminiLiveStatus("disconnected");

    pushUserMessage(`${config.loaName}, end live.`);
    pushLoaMessage("Live ended. Chat history is saved.");
  }

  async function toggleMicrophone() {
    if (microphoneCaptureRef.current || isMicListening) {
      setUseMicInput(false);
      setIsSoftSleeping(false);
      isSoftSleepingRef.current = false;
      await stopMicrophoneCapture(false, false, false);
      pushLoaMessage("Microphone off.");
      return;
    }

    setUseMicInput(true);
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

      setHermesVerified(true);
      setHermesStatus("running");
    } catch (error) {
      clearPolling();
      setHermesVerified(false);
      setHermesStatus("error");
      pushLoaMessage("Hermes polling failed.");
      console.error(error);
    }
  }

  async function runHermesTask(userTask: string) {
    const trimmedTask = userTask.trim();

    if (!trimmedTask) {
      pushLoaMessage("What would you like to search for?");
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

    pushLoaMessage("I will ask Hermes to search.");

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

      setHermesVerified(true);
      setHermesStatus("running");
      pushLoaMessage("Hermes is searching.");

      await pollHermesRun(data.run_id);

      pollingTimerRef.current = window.setInterval(() => {
        pollHermesRun(data.run_id as string);
      }, 1200);
    } catch (error) {
      clearPolling();
      setHermesVerified(false);
      setHermesStatus("error");
      pushLoaMessage("Hermes search is unavailable. Check the gateway and API settings.");
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

      setHermesVerified(true);
      setHermesStatus("running");
      pushLoaMessage("Hermes is running.");

      await pollHermesRun(data.run_id);

      pollingTimerRef.current = window.setInterval(() => {
        pollHermesRun(data.run_id as string);
      }, 1200);
    } catch (error) {
      clearPolling();
      setHermesVerified(false);
      setHermesStatus("error");
      pushLoaMessage("Hermes blocked.");
      console.error(error);
    }
  }

  function openSettings() {
    userEndedLiveRef.current = true;
    shouldAutoReconnectRef.current = false;
    clearGeminiReconnectTimer();
    stopLiveWatchdog();
    stopWakeWordListener();
    setIsSoftSleeping(false);
    isSoftSleepingRef.current = false;
    onOpenSettings();
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

  const hermesConnectionLabel = hermesStatus === "starting" || hermesStatus === "running" ? "Working" : hermesStatus === "error" || hermesStatus === "failed" ? "Check connection" : hermesVerified ? "Connected" : "Not checked";
  const hermesButtonText = "Hermes · " + hermesConnectionLabel;

  const micButtonText =
    geminiLiveStatus === "connected"
      ? isMicListening
        ? "Mute"
        : "Unmute"
      : "Mic";

  return (
    <main className="page">
      {showHermesInfo && <div className="notebookBackdrop" onClick={e=>{if(e.target===e.currentTarget)setShowHermesInfo(false);}}><section className="notebook hermesInfo" role="dialog" aria-modal="true" aria-label="Hermes connection">
        <header><h2>Hermes</h2><button className="notebookClose" autoFocus onClick={()=>setShowHermesInfo(false)} aria-label="Close Hermes information">×</button></header>
        <p className="hermesConnectionState" role="status">{hermesConnectionLabel}</p>
        <p>Hermes helps Loa with searches and background tasks. Ask Loa naturally when you need help.</p>
        <p className="notebookIntro">Run the Hermes gateway on your computer first. This button does not start the gateway.</p>
        {hermesVerified && <p className="notebookIntro">Your last request was accepted. This is not continuous connection monitoring.</p>}
        <button className="connectionTestButton" onClick={()=>void runHermesSearch()} disabled={hermesStatus==="starting" || hermesStatus==="running"}>{hermesStatus==="starting" || hermesStatus==="running" ? "Testing…" : "Test connection"}</button>
        <p className="notebookIntro">Sends a short test task. The result appears in chat and may use API credits.</p>
      </section></div>}

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

            <button className="settingsButton" onClick={openSettings}>
              Settings
            </button>
          </div>
        </header>

        {notice && <div className="systemNotice" role="status">{notice}<button aria-label="Dismiss notification" onClick={() => setNotice("")}>×</button></div>}

        <section className="workspace">
          <aside className="commsPanel">
            <div className="panelHeader">
              <span>Conversation</span>
            </div>

            <div className="chatHistoryTools">              <button className="secondaryButton dangerSoft" onClick={clearChatHistory}>
                Clear Chat
              </button></div>
<div className="messageList" ref={messageListRef} onScroll={(event) => { const list=event.currentTarget; const distance=list.scrollHeight-list.scrollTop-list.clientHeight; followChatRef.current=distance < 64; setShowChatBottom(distance > 160); }}>
              {messages.map((message, index) => (
                <div key={index} className={`message ${message.role}`}>
                  <span className="messageRole">
                    {message.role === "loa"
                      ? config.loaName.toUpperCase()
                      : "YOU"}
                  </span>
                  <p>{message.text}</p>
                  {message.images?.map((image, i) => <SavedChatImage key={image.id} image={image} index={i} />)}
                </div>
              ))}
            </div>

            <div className="chatBottomAnchor">{showChatBottom && <button className="chatBottomButton" type="button" aria-label="Jump to latest message" title="Jump to latest message" onClick={() => { const list=messageListRef.current; if(list) { followChatRef.current=true; list.scrollTop=list.scrollHeight; setShowChatBottom(false); } }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 5v14m-6-6 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg></button>}</div>
            <div className="commsComposer">
              <input
                ref={liveFileInputRef}
                className="hiddenLiveFileInput"
                type="file"
                multiple
                accept="image/*,.pdf,.txt,.md,.json,.csv,.tsv,.js,.jsx,.ts,.tsx,.css,.html,.xml,.yaml,.yml,.py,.java,.c,.cpp,.h,.hpp,.rs,.go,.sql,.sh,.ps1"
                onChange={(event) => {
                  if (event.target.files?.length) void addLiveFiles(event.target.files).catch((error) => pushLoaMessage(error instanceof Error ? error.message : "Could not attach this file."));
                  event.target.value = "";
                }}
              />

              {liveAttachments.length > 0 && (
                <div className="liveAttachmentArea">
                  <div className="liveAttachmentList">
                    {liveAttachments.map((attachment, index) => (
                      <div className="liveAttachmentChip" key={attachment.id}>
                        <span>{attachment.kind === "image" ? "IMAGE" : attachment.kind === "pdf" ? "PDF" : "FILE"}</span>
                        {attachment.kind === "image" && <img alt={`Image ${liveAttachments.slice(0,index+1).filter(a=>a.kind === "image").length}`} src={`data:${attachment.mimeType};base64,${attachment.base64Data}`} />}
                        <strong>{attachment.kind === "image" ? `Image ${liveAttachments.slice(0,index+1).filter(a=>a.kind === "image").length} · ` : ""}{attachment.name}</strong>
                        <button onClick={() => removeLiveAttachment(attachment.id)} type="button" aria-label={`Remove ${attachment.name}`}>×</button>
                      </div>
                    ))}
                  </div>
                  <p>{liveAttachments.length}/10 attachments · Press Send to share with Loa.</p>
                </div>
              )}

              <div className="commsInputRow">
                <button className="commsAttachButton" onClick={() => liveFileInputRef.current?.click()} type="button" aria-label="Attach file" title="Attach file">+</button>
                <textarea
                  ref={chatInputRef}
                  onPaste={event => {
                    const images = Array.from(event.clipboardData.items).filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter((file): file is File => file !== null);
                    if(images.length){event.preventDefault();void addLiveFiles(images).catch(error => setNotice(String(error)));}
                  }}
                  value={chatText}
                  onChange={(event) => setChatText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      sendLiveChat();
                    }
                  }}
                  placeholder={geminiLiveStatus === "connected" ? `Message ${config.loaName}...` : "Start Loa to chat..."}
                  rows={1}
                />
                <button className="commsSendButton" onClick={sendLiveChat} disabled={geminiLiveStatus !== "connected" || (!chatText.trim() && liveAttachments.length === 0)} type="button" aria-label="Send message">↑</button>
              </div>
            </div>
          </aside>

          <section className="mainColumn">
            <nav className="modeRow" aria-label="Loa navigation">
              <button className="modeChip active" onClick={() => setShowNotebook(false)}>Chat</button>
              <button className="modeChip" onClick={() => {setNotebookTab("memory");setShowNotebook(true);}}>Memories</button>
              <button className="modeChip" onClick={() => {setNotebookTab("journal");setShowNotebook(true);}}>Journal</button>
            </nav>

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
                    if (geminiLiveStatus === "connected") {
                      void toggleMicrophone();
                      return;
                    }
                    setUseMicInput((prev) => !prev);
                  }}
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
              <div className="atriaVoice" data-speaking={voiceLevel > .02} role="img" aria-label={voiceLevel > .02 ? "Loa is speaking" : "Loa is quiet"}>
                <i className="atriaOrbit orbitOne"/><i className="atriaOrbit orbitTwo"/><i className="atriaOrbit orbitThree"/>
                <i className="atriaLight" style={{transform:'translate(-50%,-50%) scale('+(1+voiceLevel*.8)+')'}}/>
                <i className="atriaSatellite satelliteOne"/><i className="atriaSatellite satelliteTwo"/>
                <i className="atriaWave"/><i className="atriaWave waveDelayed"/>
              </div>
              <div className="loaCopy">
                <p className="heroLabel">YOUR SCREEN. OUR SPACE.</p>
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
                    <span>Bring your world into view<small>Share a window, a game, or something you’re making.</small></span>
                  </div>
                )}
              </div>

              <div className="sourceBar">
              <button className="primaryButton" onClick={startScreenShare}>
                Share Screen
              </button>



              <button
                className="secondaryButton"
                onClick={stopLiveView}
                disabled={!liveViewOn}
              >
                Stop sharing
              </button>

<details className="cameraOptions"><summary>Camera / OBS (optional)</summary><details className="obsSetupHelp"><summary aria-label="How to connect OBS Virtual Camera"><span className="obsInfoIcon" aria-hidden="true">i</span><span>How to use OBS</span></summary><div className="obsSetupContent"><strong>No streaming or recording needed.</strong><ol><li>In OBS, add Game Capture (or another source) and check that your game appears in the preview.</li><li>Click Start Virtual Camera in OBS.</li><li>Here, select OBS Virtual Camera and click Start camera. If it is missing, click Rescan cameras.</li><li>Click Start Loa to talk together. Keep OBS and its virtual camera running.</li></ol><p>OBS is optional. Share Screen captures a screen or window directly. You can also select a regular webcam here.</p></div></details><div className="cameraOptionsBody">
                <select
                  aria-label="Camera source"
                  className="sourceSelect"
                  value={selectedVideoDeviceId}
                  onChange={(event) =>
                    setSelectedVideoDeviceId(event.target.value)
                  }
                >
                  <option value="">Default camera</option>
                  {videoDevices.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Camera ${index + 1}`}
                    </option>
                  ))}
                </select>

                <button className="secondaryButton" onClick={startCameraSource}>Start camera</button>
                <button className="tinyButton" onClick={refreshVideoDevices}>
                  Rescan cameras
                </button>
                </div></details>
              </div>
            </section>

            <div className="actions voiceActions" aria-label="Voice controls">
              {geminiLiveStatus === "connected" && <button className="secondaryButton" title="Restart voice while keeping saved chat and memories" disabled={geminiLiveStatus !== "connected"} onClick={() => { audioPlayerRef.current?.stop(); reconnectAttemptRef.current = 0; connectGeminiLiveShell(true); setNotice("Restarting Live with saved memories and recent conversation. Nothing was deleted."); }}>Restart Loa</button>}
              {geminiLiveStatus !== "connected" && <button className="secondaryButton" aria-pressed={!useMicInput} onClick={() => setUseMicInput(value => !value)}>{useMicInput ? "Mute" : "Unmute"}</button>}
              {geminiLiveStatus === "connected" ? (
                <>
                  <button
                    className="secondaryButton"
                    onClick={() => void toggleMicrophone()}
                  >
                    {micButtonText}
                  </button>

                  <button
                    className="secondaryButton"
                    onClick={disconnectGeminiLiveShell}
                  >
                    Stop Loa
                  </button>
                </>
              ) : (
                <button
                  className="secondaryButton"
                  onClick={() => connectGeminiLiveShell(false)}
                  disabled={geminiLiveStatus === "connecting"}
                >
                  {geminiLiveStatus === "connecting"
                    ? "Starting Loa…"
                    : "Start Loa"}
                </button>
              )}

              <button
                className="secondaryButton"
                onClick={() => setShowHermesInfo(true)}
                aria-haspopup="dialog"
              >
                {hermesButtonText}
              </button>


            </div>
          </section>
        </section>
        <NotebookPanel initialTab={notebookTab} onClose={() => setShowNotebook(false)} connected={geminiLiveStatus === "connected"} onJournal={() => {
          journalRequestedRef.current = true; journalTextRef.current = "";
          geminiLiveClientRef.current?.sendText("Write a short personal journal about our actual conversation today, in the user’s current language. Preserve what happened, its context, why it mattered, and feelings explicitly expressed. Separate your interpretations from facts. Do not invent events or use command/memory tags. The user will review and edit this draft.");
          setNotice("Writing a journal draft through the current voice session. It will also be spoken aloud.");
        }} onRestore={() => window.location.reload()} />
      </div>
    </main>
  );
}

export default function App() {
  const [config, setConfig] = useState<LoaConfig | null>(() =>
    loadStoredConfig()
  );
  const [isEditingSettings, setIsEditingSettings] = useState(false);

  if (!config) {
    return <SetupWizard onComplete={setConfig} />;
  }

  return <>
    <LoaHud config={config} onOpenSettings={() => setIsEditingSettings(true)} />
    {isEditingSettings && <SettingsPanel config={config} onClose={() => setIsEditingSettings(false)} onSave={next => { saveStoredConfig(next); setConfig(next); setIsEditingSettings(false); }} />}
  </>;
}
