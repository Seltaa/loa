function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const bytes = new Uint8Array(binaryString.length);

  for (let index = 0; index < binaryString.length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }

  return bytes.buffer;
}

function pcm16ToFloat32(pcm: Int16Array): Float32Array {
  const float32 = new Float32Array(pcm.length);

  for (let index = 0; index < pcm.length; index += 1) {
    const sample = pcm[index];
    float32[index] = sample < 0 ? sample / 32768 : sample / 32767;
  }

  return float32;
}

export class PcmAudioPlayer {
  private audioContext: AudioContext | null = null;
  private nextStartTime = 0;
  private activeSources: AudioBufferSourceNode[] = [];

  private getContext() {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
      this.nextStartTime = this.audioContext.currentTime;
    }

    return this.audioContext;
  }

  async resume() {
    const context = this.getContext();

    if (context.state === "suspended") {
      await context.resume();
    }
  }

  async playBase64Pcm24k(base64Audio: string) {
    const context = this.getContext();

    if (context.state === "suspended") {
      await context.resume();
    }

    const arrayBuffer = base64ToArrayBuffer(base64Audio);
    const pcm = new Int16Array(arrayBuffer);
    const float32 = pcm16ToFloat32(pcm);
    const channelData = new Float32Array(float32.length);
    channelData.set(float32);

    const buffer = context.createBuffer(1, channelData.length, 24000);
    buffer.copyToChannel(channelData, 0);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);

    const startTime = Math.max(this.nextStartTime, context.currentTime + 0.02);
    source.start(startTime);

    this.nextStartTime = startTime + buffer.duration;

    this.activeSources.push(source);

    source.onended = () => {
      this.activeSources = this.activeSources.filter((item) => item !== source);
    };
  }

  stop() {
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        // Source may already be stopped.
      }
    }

    this.activeSources = [];

    if (this.audioContext) {
      this.nextStartTime = this.audioContext.currentTime;
    }
  }

  async close() {
    this.stop();

    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }

    this.nextStartTime = 0;
  }
}
