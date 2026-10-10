import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, RefreshCw, RotateCcw, SwitchCamera } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/cn';

type CameraState =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'live' }
  | { kind: 'denied' }
  | { kind: 'unavailable'; message: string };

/** Longest side of the capture sent for verification. Enough for face comparison; nothing larger is kept. */
const MAX_SIDE = 960;

function cameraProblem(e: unknown): CameraState {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return { kind: 'denied' };
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return { kind: 'unavailable', message: 'No camera was found on this device.' };
  if (name === 'NotReadableError' || name === 'TrackStartError') return { kind: 'unavailable', message: 'The camera is being used by another app. Close it and try again.' };
  return { kind: 'unavailable', message: 'The camera couldn’t be started on this device.' };
}

/**
 * Live selfie capture with the device camera (phone, tablet or laptop webcam), through the browser's
 * camera API. Only a live camera frame can be captured: there's no file upload. The capture stays in
 * memory and is handed to `onCapture`; this component never stores it.
 */
export function CameraCapture({ captured, onCapture, onRetake, disabled }: {
  captured: string | null; onCapture: (dataUrl: string) => void; onRetake: () => void; disabled?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>({ kind: 'idle' });
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [canSwitch, setCanSwitch] = useState(false);

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const start = async (mode = facing) => {
    stop();
    if (!navigator.mediaDevices?.getUserMedia) {
      setState({ kind: 'unavailable', message: window.isSecureContext === false
        ? 'The camera needs a secure (HTTPS) connection. Open FixID over HTTPS to capture a selfie.'
        : 'This browser doesn’t support camera capture. Use a current version of Chrome, Safari, Edge or Firefox.' });
      return;
    }
    setState({ kind: 'starting' });
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      stream.current = s;
      setFacing(mode);
      setState({ kind: 'live' });
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setCanSwitch(devices.filter((d) => d.kind === 'videoinput').length > 1);
      } catch { setCanSwitch(false); }
    } catch (e) {
      setState(cameraProblem(e));
    }
  };

  // Attach the stream once the video element is on screen.
  useEffect(() => {
    if (state.kind === 'live' && video.current && stream.current) {
      video.current.srcObject = stream.current;
      // Older browsers return nothing from play(); newer ones a promise that may reject (autoplay rules).
      const playing = video.current.play?.() as Promise<void> | undefined;
      playing?.catch?.(() => undefined);
    }
  }, [state.kind]);

  const capture = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const scale = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext('2d')?.drawImage(v, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', 0.85);
    stop();
    setState({ kind: 'idle' });
    onCapture(data);
  };

  if (captured) {
    return (
      <div className="space-y-3">
        <img src={captured} alt="Captured selfie" className="mx-auto aspect-[3/4] w-full max-w-xs rounded-2xl object-cover ring-1 ring-slate-200 sm:aspect-video sm:max-w-md" />
        <div className="flex justify-center">
          <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} disabled={disabled} onClick={() => { onRetake(); void start(); }}>Retake</Button>
        </div>
      </div>
    );
  }

  if (state.kind === 'live' || state.kind === 'starting') {
    return (
      <div className="space-y-3">
        <div className="relative mx-auto aspect-[3/4] w-full max-w-xs overflow-hidden rounded-2xl bg-slate-900 sm:aspect-video sm:max-w-md">
          {state.kind === 'live'
            ? <video ref={video} aria-label="Camera preview" playsInline muted autoPlay className={cn('h-full w-full object-cover', facing === 'user' && '-scale-x-100')} />
            : <p role="status" className="absolute inset-0 flex items-center justify-center text-sm text-white/80">Starting camera… Allow camera access if your browser asks.</p>}
          <span aria-hidden="true" className="pointer-events-none absolute inset-x-[18%] inset-y-[12%] rounded-[50%] border-2 border-dashed border-white/60" />
        </div>
        <p className="text-center text-xs text-slate-500">Hold the device in front of the person so their face fills the oval, in good light.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="lg" icon={<Camera className="h-5 w-5" />} disabled={state.kind !== 'live' || disabled} onClick={capture}>Capture</Button>
          {canSwitch && <Button variant="secondary" icon={<SwitchCamera className="h-4 w-4" />} onClick={() => void start(facing === 'user' ? 'environment' : 'user')}>Switch camera</Button>}
          <Button variant="ghost" onClick={() => { stop(); setState({ kind: 'idle' }); }}>Stop camera</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-center">
      {state.kind === 'denied' && (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-left text-sm text-red-800 ring-1 ring-inset ring-red-200">
          <CameraOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Camera permission was denied. Allow camera access for this site in your browser or device settings, then try again.
        </p>
      )}
      {state.kind === 'unavailable' && (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-left text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
          <CameraOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />Camera unavailable: {state.message}
        </p>
      )}
      <Button size="lg" icon={state.kind === 'idle' ? <Camera className="h-5 w-5" /> : <RefreshCw className="h-4 w-4" />} disabled={disabled} onClick={() => void start()}>
        {state.kind === 'idle' ? 'Capture Selfie' : 'Try again'}
      </Button>
    </div>
  );
}
