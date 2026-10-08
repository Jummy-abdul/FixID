import { Button } from '@/components/ui';

export function DiscardBar({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  return (
    <div role="alert" className="mr-auto flex flex-1 flex-wrap items-center gap-3 text-sm text-slate-700">
      <span className="font-medium">Discard unsaved changes?</span>
      <Button size="sm" variant="secondary" onClick={onKeep} data-autofocus>Keep editing</Button>
      <Button size="sm" variant="danger" onClick={onDiscard}>Discard</Button>
    </div>
  );
}
