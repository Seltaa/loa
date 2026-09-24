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
  private playbackGeneration = 0;
  private analyser: AnalyserNode | null = null;
  private activeSources: AudioBufferSourceNode[] = [];

  private getContext() {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.connect(this.audioContext.destination);
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
    const generation=this.playbackGeneration;
    const context = this.getContext();

    if (context.state === "suspended") {
      await context.resume();
    }

    if(generation!==this.playbackGeneration || context!==this.audioContext || context.state==="closed")return;
    const arrayBuffer = base64ToArrayBuffer(base64Audio);
    const pcm = new Int16Array(arrayBuffer);
    const float32 = pcm16ToFloat32(pcm);

    const buffer = context.createBuffer(1, float32.length, 24000);
    buffer.copyToChannel(new Float32Array(float32), 0);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser!);

    const startTime = Math.max(this.nextStartTime, context.currentTime + 0.02);
    source.start(startTime);

    this.nextStartTime = startTime + buffer.duration;

    this.activeSources.push(source);

    source.onended = () => {
      this.activeSources = this.activeSources.filter((item) => item !== source);
    };
  }

  getLevel() {
    if (!this.analyser || !this.activeSources.length || this.audioContext?.state !== 'running') return 0;
    const samples = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(samples);
    return Math.min(1, Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length) * 5);
  }

  stop() {
    this.playbackGeneration++;
    for (const source of this.activeSources) {
      try {
        source.stop();
        source.disconnect();
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
      this.analyser = null;
    }

    this.nextStartTime = 0;
  }
}
