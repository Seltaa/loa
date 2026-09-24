function floatTo16BitPcm(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);

  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    output[index] = sample < 0 ? sample * 32768 : sample * 32767;
  }

  return output;
}

function downsampleBuffer(
  input: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number
): Float32Array {
  if (outputSampleRate === inputSampleRate) {
    return input;
  }

  if (outputSampleRate > inputSampleRate) {
    throw new Error("Output sample rate must be lower than input sample rate.");
  }

  const sampleRateRatio = inputSampleRate / outputSampleRate;
  const outputLength = Math.round(input.length / sampleRateRatio);
  const output = new Float32Array(outputLength);

  let outputIndex = 0;
  let inputIndex = 0;

  while (outputIndex < outputLength) {
    const nextInputIndex = Math.round((outputIndex + 1) * sampleRateRatio);
    let accumulator = 0;
    let count = 0;

    for (
      let sampleIndex = inputIndex;
      sampleIndex < nextInputIndex && sampleIndex < input.length;
      sampleIndex += 1
    ) {
      accumulator += input[sampleIndex];
      count += 1;
    }

    output[outputIndex] = count > 0 ? accumulator / count : 0;

    outputIndex += 1;
    inputIndex = nextInputIndex;
  }

  return output;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return window.btoa(binary);
}

export class MicrophoneCapture {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private onAudioChunk: (base64Audio: string) => void;

  constructor(onAudioChunk: (base64Audio: string) => void) {
    this.onAudioChunk = onAudioChunk;
  }

  async start() {
    if (this.audioContext || this.mediaStream) {
      return;
    }

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });

    this.audioContext = new AudioContext();
    await this.audioContext.resume();

    this.sourceNode = this.audioContext.createMediaStreamSource(
      this.mediaStream
    );

    this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.processorNode.onaudioprocess = (event) => {
      if (!this.audioContext) return;

      const input = event.inputBuffer.getChannelData(0);
      const downsampled = downsampleBuffer(
        input,
        this.audioContext.sampleRate,
        16000
      );

      const pcm16 = floatTo16BitPcm(downsampled);
      const pcmBuffer = pcm16.buffer.slice(
        pcm16.byteOffset,
        pcm16.byteOffset + pcm16.byteLength
      ) as ArrayBuffer;
      const base64Audio = arrayBufferToBase64(pcmBuffer);

      this.onAudioChunk(base64Audio);
    };

    this.sourceNode.connect(this.processorNode);
    this.processorNode.connect(this.audioContext.destination);
  }

  async stop() {
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode.onaudioprocess = null;
      this.processorNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }
  }
}
