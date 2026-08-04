type VideoFrameCaptureOptions = {
  intervalMs?: number;
  jpegQuality?: number;
  maxWidth?: number;
};

export class VideoFrameCapture {
  private timerId: number | null = null;
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D | null;
  private onFrame: (base64Jpeg: string) => void;
  private intervalMs: number;
  private jpegQuality: number;
  private maxWidth: number;

  constructor(
    onFrame: (base64Jpeg: string) => void,
    options: VideoFrameCaptureOptions = {}
  ) {
    this.onFrame = onFrame;
    this.intervalMs = options.intervalMs ?? 1000;
    this.jpegQuality = options.jpegQuality ?? 0.72;
    this.maxWidth = options.maxWidth ?? 1024;

    this.canvas = document.createElement("canvas");
    this.context = this.canvas.getContext("2d");
  }

  start(videoElement: HTMLVideoElement) {
    if (this.timerId) {
      return;
    }

    const capture = () => {
      if (!this.context) return;
      if (!videoElement.videoWidth || !videoElement.videoHeight) return;
      if (videoElement.readyState < 2) return;

      const originalWidth = videoElement.videoWidth;
      const originalHeight = videoElement.videoHeight;

      const scale =
        originalWidth > this.maxWidth ? this.maxWidth / originalWidth : 1;

      const width = Math.max(1, Math.round(originalWidth * scale));
      const height = Math.max(1, Math.round(originalHeight * scale));

      this.canvas.width = width;
      this.canvas.height = height;

      this.context.drawImage(videoElement, 0, 0, width, height);

      const dataUrl = this.canvas.toDataURL("image/jpeg", this.jpegQuality);
      const base64 = dataUrl.split(",")[1];

      if (base64) {
        this.onFrame(base64);
      }
    };

    capture();

    this.timerId = window.setInterval(capture, this.intervalMs);
  }

  stop() {
    if (this.timerId) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
  }
}