import { useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, description, confirmLabel, tone = 'primary', onConfirm, onCancel }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={busy ? () => {} : onCancel} title={title} description={description} size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant={tone} onClick={confirm} loading={busy}>{confirmLabel}</Button>
        </>
      }
    />
  );
}
