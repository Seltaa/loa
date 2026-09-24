type VideoFrameCaptureOptions = {
  intervalMs?: number;
  jpegQuality?: number;
  maxWidth?: number;
};

export class VideoFrameCapture {
  private previous: Uint8ClampedArray | null = null;
  private sample = document.createElement("canvas");
  private timerId: number | null = null;
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D | null;
  private onFrame: (base64Jpeg: string, changed: boolean) => void;
  private intervalMs: number;
  private jpegQuality: number;
  private maxWidth: number;

  constructor(
    onFrame: (base64Jpeg: string, changed: boolean) => void,
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
        this.sample.width=32;this.sample.height=18;
        const ctx=this.sample.getContext("2d");
        let changed=false;
        if(ctx){
          ctx.drawImage(videoElement,0,0,32,18);
          const pixels=ctx.getImageData(0,0,32,18).data;
          if(this.previous){
            let difference=0;
            for(let i=0;i<pixels.length;i+=4)difference+=(Math.abs(pixels[i]-this.previous[i])+Math.abs(pixels[i+1]-this.previous[i+1])+Math.abs(pixels[i+2]-this.previous[i+2]))/3;
            changed=difference/(32*18)>18;
          }
          this.previous=pixels;
        }
        this.onFrame(base64,changed);
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