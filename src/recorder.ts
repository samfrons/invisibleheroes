/** Records the canvas (and the band's audio) to a video file in the browser. */

export interface VideoRecorder {
  /** Start capturing the canvas (and the audio stream if given). */
  start(): void;
  /** Stop and resolve with the file, or null if nothing was captured. */
  stop(): Promise<{ blob: Blob; extension: 'webm' | 'mp4' } | null>;
}

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

export function canRecordVideo(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
  );
}

function pickMime(): string | null {
  for (const m of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* try the next */
    }
  }
  return null;
}

/** Null when this browser cannot record a canvas (no MediaRecorder or no captureStream). */
export function createVideoRecorder(
  canvas: HTMLCanvasElement,
  audio: MediaStream | null
): VideoRecorder | null {
  if (!canRecordVideo()) return null;

  let recorder: MediaRecorder | null = null;
  let videoStream: MediaStream | null = null;
  let chunks: Blob[] = [];

  function releaseVideo(): void {
    // Only the video tracks are ours; the audio tracks belong to the synth.
    videoStream?.getVideoTracks().forEach((t) => t.stop());
    videoStream = null;
  }

  return {
    start() {
      if (recorder && recorder.state !== 'inactive') return;
      chunks = [];
      try {
        videoStream = canvas.captureStream(30);
        const tracks = [...videoStream.getVideoTracks(), ...(audio ? audio.getAudioTracks() : [])];
        const mixed = new MediaStream(tracks);
        const mime = pickMime();
        recorder = mime ? new MediaRecorder(mixed, { mimeType: mime }) : new MediaRecorder(mixed);
        recorder.ondataavailable = (e: BlobEvent) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };
        recorder.start(1000);
      } catch {
        releaseVideo();
        recorder = null;
      }
    },
    stop() {
      const rec = recorder;
      recorder = null;
      if (!rec) {
        releaseVideo();
        return Promise.resolve(null);
      }
      return new Promise((resolve) => {
        const finish = (): void => {
          releaseVideo();
          const type = rec.mimeType || 'video/webm';
          const blob = new Blob(chunks, { type });
          chunks = [];
          if (blob.size === 0) resolve(null);
          else resolve({ blob, extension: type.startsWith('video/mp4') ? 'mp4' : 'webm' });
        };
        if (rec.state === 'inactive') {
          finish();
          return;
        }
        rec.onstop = finish;
        rec.onerror = finish;
        try {
          rec.stop();
        } catch {
          finish();
        }
      });
    },
  };
}

/** Trigger a browser download of a blob under a file name. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
