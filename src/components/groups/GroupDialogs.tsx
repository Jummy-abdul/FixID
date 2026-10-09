import { useEffect, useState, type FormEvent } from 'react';
import { Button, ConfirmDialog, Field, Input, Modal, Textarea, useToast } from '@/components/ui';
import { GROUP_DESCRIPTION_MAX, GROUP_NAME_MAX, groupDependencies, groupProblems, membershipsOfGroup } from '@/domain/groups';
import type { Group } from '@/domain/types';
import { useActions, useSession, useStore } from '@/store/AppStore';

/** Create or edit a group's name and description. Editing keeps the group's ID and members. */
export function GroupFormModal({ open, group, onClose, onSaved }: {
  open: boolean; group?: Group; onClose: () => void; onSaved?: (groupId: string) => void;
}) {
  const { organization } = useSession();
  const { state } = useStore();
  const { createGroup, updateGroup } = useActions();
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<{ name?: string; description?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? '');
    setDescription(group?.description ?? '');
    setErrors({});
    setBusy(false);
  }, [open, group]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const found = groupProblems(state.data, organization.id, { name, description }, group?.id);
    setErrors(found);
    if (found.name || found.description) return;
    setBusy(true);
    await new Promise((r) => setTimeout(r, 250));
    const r = group ? { ...updateGroup(organization.id, group.id, name, description), groupId: group.id } : createGroup(organization.id, name, description);
    setBusy(false);
    if (!r.ok) {
      setErrors({ ...(r.errors ?? {}), form: r.errors ? undefined : r.error });
      return;
    }
    toast({ tone: 'success', title: group ? 'Group updated' : 'Group created', description: group ? undefined : `${name.trim()} is ready. Add members whenever you like.` });
    onSaved?.(r.groupId);
    onClose();
  };

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title={group ? 'Edit group' : 'Create group'}
      description={group ? undefined : 'Groups organize users, for example by department, team, location or cohort. You can add members after creating it.'}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form="group-form" loading={busy}>{group ? 'Save changes' : 'Create group'}</Button>
        </>
      )}>
      <form id="group-form" onSubmit={submit} noValidate className="space-y-5">
        {errors.form && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-inset ring-red-200">{errors.form}</p>}
        <Field label="Group name" required error={errors.name} hint="A clear, descriptive name. Names must be unique in your organization.">
          {(p) => <Input {...p} autoFocus maxLength={GROUP_NAME_MAX + 20} placeholder="e.g. Engineering" value={name}
            onChange={(e) => { setName(e.target.value); if (errors.name) setErrors((x) => ({ ...x, name: undefined })); }} />}
        </Field>
        <Field label="Description" error={errors.description} hint={`Optional. Explain what the group is for. ${description.trim().length}/${GROUP_DESCRIPTION_MAX}`}>
          {(p) => <Textarea {...p} rows={3} value={description} placeholder="e.g. Everyone in the engineering department."
            onChange={(e) => { setDescription(e.target.value); if (errors.description) setErrors((x) => ({ ...x, description: undefined })); }} />}
        </Field>
      </form>
    </Modal>
  );
}

/** Confirms removal. Removal is refused (with the reason) while a feature depends on the group. */
export function RemoveGroupDialog({ group, onClose, onRemoved }: { group: Group | null; onClose: () => void; onRemoved?: () => void }) {
  const { organization } = useSession();
  const { state } = useStore();
  const { removeGroup } = useActions();
  const toast = useToast();
  if (!group) return null;
  const count = membershipsOfGroup(state.data, organization.id, group.id).length;
  const deps = groupDependencies(state.data, organization.id, group.id);
  if (deps.length) {
    return (
      <Modal open onClose={onClose} size="sm" title="This group is in use"
        description={`${group.name} is used by ${deps.map((d) => d.name).join(', ')}. Remove it from ${deps.length === 1 ? 'that verification activity' : 'those verification activities'} before removing the group.`}
        footer={<Button variant="secondary" onClick={onClose}>Close</Button>} />
    );
  }
  return (
    <ConfirmDialog open title={`Remove ${group.name}?`} tone="danger" confirmLabel="Remove Group" onCancel={onClose}
      description={(
        <>
          The group and its {count === 1 ? '1 membership' : `${count} memberships`} will be removed.
          The users stay in FixID and keep their credentials. This can't be undone.
        </>
      )}
      onConfirm={() => {
        const r = removeGroup(organization.id, group.id);
        onClose();
        if (!r.ok) return toast({ tone: 'error', title: 'Nothing was changed', description: r.error });
        toast({ tone: 'success', title: 'Group removed', description: `${group.name} was removed. Its members weren't affected.` });
        onRemoved?.();
      }} />
  );
}
