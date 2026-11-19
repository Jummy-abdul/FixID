import { useEffect, useRef, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/cn';
import { loadImage } from './portraits';
import { placeholderFaceUrl } from './ui';

/**
 * A simulated camera capture for the demonstration: a blank camera frame, one "Capture Face" action, a brief
 * focus and shutter, then the selected student's predefined capture portrait inside the frame. The device camera
 * is never used, so no permission prompt appears. The captured image stays in the page; nothing is stored.
 */
export function SimulatedCapture({ image, subject, instruction = 'Position student’s face within the frame', captured, status, onCaptured }: {
  /** The predefined capture portrait for the selected student. */
  image: string | undefined;
  subject: string;
  instruction?: string;
  /** The capture already taken, if any (shown in the frame). */
  captured: string | null;
  /** A line shown under the frame after capture (e.g. verifying). */
  status?: React.ReactNode;
  onCaptured: (url: string) => void;
}) {
  const [phase, setPhase] = useState<'idle' | 'focusing' | 'flash'>('idle');
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  const capture = () => {
    setPhase('focusing');
    const ready = loadImage(image, placeholderFaceUrl(subject));
    timers.current.push(window.setTimeout(() => {
      setPhase('flash');
      void ready.then((url) => {
        timers.current.push(window.setTimeout(() => { setPhase('idle'); onCaptured(url); }, 180));
      });
    }, 900));
  };
  return (
    <div className="mx-auto w-full max-w-[14rem]">
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-xl bg-slate-900 ring-1 ring-slate-800" aria-label="Camera frame" role="img">
        {captured ? (
          <img src={captured} alt="Captured face" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">
            <Camera className={cn('h-8 w-8', phase === 'focusing' && 'animate-pulse text-white')} aria-hidden="true" />
            <p className="max-w-[62%] text-center text-xs text-slate-300">{phase === 'focusing' ? 'Hold still…' : instruction}</p>
          </div>
        )}
        {!captured && <span aria-hidden="true" className={cn('pointer-events-none absolute inset-x-[16%] inset-y-[11%] rounded-[50%] border-2 border-dashed', phase === 'focusing' ? 'border-emerald-400' : 'border-white/50')} />}
        {/* Corner marks, like a camera viewfinder. */}
        {['left-2 top-2 border-l-2 border-t-2', 'right-2 top-2 border-r-2 border-t-2', 'bottom-2 left-2 border-b-2 border-l-2', 'bottom-2 right-2 border-b-2 border-r-2'].map((c) => (
          <span key={c} aria-hidden="true" className={cn('pointer-events-none absolute h-4 w-4 border-white/70', c)} />
        ))}
        <span aria-hidden="true" className={cn('pointer-events-none absolute inset-0 bg-white transition-opacity duration-150', phase === 'flash' ? 'opacity-90' : 'opacity-0')} />
      </div>
      <div className="mt-3 flex flex-col items-center gap-2" aria-live="polite">
        {captured ? status : (
          <Button className="w-full" icon={phase === 'idle' ? <Camera className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />} disabled={phase !== 'idle'} onClick={capture}>
            {phase === 'idle' ? 'Capture Face' : 'Capturing…'}
          </Button>
        )}
      </div>
    </div>
  );
}
