export type GeminiLiveClientStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

type GeminiLiveClientOptions = {
  apiKey: string;
  model?: string;
  systemInstruction: string;
  voiceName: string;
  onOpen?: () => void;
  onSetupComplete?: () => void;
  onMessage?: (message: unknown) => void;
  onText?: (text: string) => void;
  onInputText?: (text: string) => void;
  onOutputText?: (text: string) => void;
  onAudioChunk?: (base64Audio: string) => void;
  onError?: (message: string) => void;
  onClose?: () => void;
};

const DEFAULT_MODEL = "gemini-3.1-flash-live-preview";

async function readWebSocketData(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof Blob) return await data.text();
  if (data instanceof ArrayBuffer) return new TextDecoder("utf-8").decode(data);
  return String(data);
}

function extractFallbackTextFromServerMessage(message: any): string | null {
  const parts = message?.serverContent?.modelTurn?.parts;
  if (!Array.isArray(parts)) return null;

  const textParts = parts
    .map((part) => part?.text)
    .filter((text) => typeof text === "string" && text.trim());

  if (textParts.length > 0) {
    return textParts.join("\n");
  }

  return null;
}

function extractAudioChunksFromServerMessage(message: any): string[] {
  const parts = message?.serverContent?.modelTurn?.parts;
  if (!Array.isArray(parts)) return [];

  return parts
    .map((part) => part?.inlineData?.data)
    .filter((data) => typeof data === "string" && data.length > 0);
}

export class GeminiLiveClient {
  private websocket: WebSocket | null = null;
  private options: GeminiLiveClientOptions;

  constructor(options: GeminiLiveClientOptions) {
    this.options = options;
  }

  connect() {
    const apiKey = this.options.apiKey.trim();

    if (!apiKey) {
      this.options.onError?.("Gemini API key is missing.");
      return;
    }

    const model = this.options.model || DEFAULT_MODEL;
    const encodedKey = encodeURIComponent(apiKey);

    const url =
      "wss://generativelanguage.googleapis.com/ws/" +
      "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent" +
      `?key=${encodedKey}`;

    this.websocket = new WebSocket(url);
    this.websocket.binaryType = "arraybuffer";

    this.websocket.onopen = () => {
      this.options.onOpen?.();

      const setupMessage = {
        setup: {
          model: `models/${model}`,
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: this.options.voiceName,
                },
              },
            },
          },
          systemInstruction: {
            parts: [
              {
                text: this.options.systemInstruction,
              },
            ],
          },
        },
      };

      console.log("Gemini Live setup:", setupMessage);
      this.websocket?.send(JSON.stringify(setupMessage));
    };

    this.websocket.onmessage = async (event) => {
      try {
        const raw = await readWebSocketData(event.data);

        if (!raw.trim()) return;

        const message = JSON.parse(raw);

        console.log("Gemini Live message:", message);
        this.options.onMessage?.(message);

        if (message.setupComplete) {
          this.options.onSetupComplete?.();
          return;
        }

        const inputText = message?.serverContent?.inputTranscription?.text;
        if (typeof inputText === "string" && inputText.trim()) {
          this.options.onInputText?.(inputText);
        }

        const outputText = message?.serverContent?.outputTranscription?.text;
        if (typeof outputText === "string" && outputText.trim()) {
          this.options.onOutputText?.(outputText);
        }

        const fallbackText = extractFallbackTextFromServerMessage(message);
        if (
          fallbackText &&
          !message?.serverContent?.inputTranscription?.text &&
          !message?.serverContent?.outputTranscription?.text
        ) {
          this.options.onText?.(fallbackText);
        }

        const audioChunks = extractAudioChunksFromServerMessage(message);
        for (const chunk of audioChunks) {
          this.options.onAudioChunk?.(chunk);
        }
      } catch (error) {
        console.error("Gemini Live parse failed:", error, event.data);
        this.options.onError?.("Failed to parse Gemini Live message.");
      }
    };

    this.websocket.onerror = (event) => {
      console.error("Gemini Live WebSocket error:", event);
      this.options.onError?.("Gemini Live WebSocket error.");
    };

    this.websocket.onclose = (event) => {
      console.log("Gemini Live closed:", {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });

      this.websocket = null;
      this.options.onClose?.();
    };
  }

  sendText(text: string) {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      this.options.onError?.("Gemini Live is not connected.");
      return;
    }

    this.websocket.send(
      JSON.stringify({
        clientContent: {
          turns: [
            {
              role: "user",
              parts: [
                {
                  text,
                },
              ],
            },
          ],
          turnComplete: true,
        },
      })
    );
  }

  sendAudioChunk(base64Audio: string) {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.websocket.send(
      JSON.stringify({
        realtimeInput: {
          audio: {
            mimeType: "audio/pcm;rate=16000",
            data: base64Audio,
          },
        },
      })
    );
  }

  sendVideoFrame(base64Jpeg: string) {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.websocket.send(
      JSON.stringify({
        realtimeInput: {
          video: {
            mimeType: "image/jpeg",
            data: base64Jpeg,
          },
        },
      })
    );
  }

  disconnect() {
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }
  }

  isConnected() {
    return this.websocket?.readyState === WebSocket.OPEN;
  }
}