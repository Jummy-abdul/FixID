import { useState } from 'react';
import { BadgeCheck, CheckCircle2 } from 'lucide-react';
import { Button, Modal } from '@/components/ui';
import { useOrgData } from '@/store/AppStore';
import { CredentialDrawer } from './CredentialDrawer';

/**
 * Creating a credential configuration: the reusable drawer, then a confirmation that offers to assign it.
 * Saving never issues anything. The modal opens only after the drawer has closed (no stacking).
 */
export function CredentialSetup({ open, onClose, defaultIdentifierConfigId, onAssign, onLater }: {
  open: boolean;
  onClose: () => void;
  defaultIdentifierConfigId?: string;
  onAssign: (credentialTypeId: string) => void;
  onLater: (credentialTypeId: string) => void;
}) {
  const { credentialTypeById } = useOrgData();
  const [createdId, setCreatedId] = useState<string | null>(null);
  const created = createdId ? credentialTypeById.get(createdId) : undefined;

  const finish = (assign: boolean) => {
    const id = createdId!;
    setCreatedId(null);
    (assign ? onAssign : onLater)(id);
  };

  return (
    <>
      <CredentialDrawer open={open} onClose={onClose} defaultIdentifierConfigId={defaultIdentifierConfigId}
        onSaved={(id) => { onClose(); setCreatedId(id); }} />
      <Modal open={!!created} onClose={() => finish(false)} size="sm"
        title={<span className="flex flex-col gap-4"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500 text-white"><CheckCircle2 className="h-5 w-5" aria-hidden="true" /></span>Credential created successfully</span>}
        description={created && `${created.name} is ready to be assigned to users.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => finish(false)}>I'll do this later</Button>
            <Button icon={<BadgeCheck className="h-4 w-4" />} onClick={() => finish(true)} data-autofocus>Assign now</Button>
          </>
        }>
        <p className="text-sm font-medium text-slate-900">Would you like to assign this credential now?</p>
        <p className="mt-1 text-sm text-slate-500">Nothing is issued until you review and confirm.</p>
      </Modal>
    </>
  );
}
