import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCheck, Copy, Eye, Pause, Pencil, Play, Power, Trash2 } from 'lucide-react';
import { ConfirmDialog, useToast, type OverflowMenuItem } from '@/components/ui';
import { useAuthorization } from '@/auth/authorization';
import { displayStatus } from '@/domain/activityLifecycle';
import type { ActivityConfig } from '@/domain/types';
import { formatDate } from '@/lib/dates';
import { activationProblems } from '@/store/activityOps';
import { useActions, useSession, useStore } from '@/store/AppStore';
import { activityPath } from './paths';

export type LifecycleAction = 'activate' | 'pause' | 'resume' | 'complete' | 'remove';

/**
 * Lifecycle changes for an activity, each confirmed first: activate a draft, pause and resume, mark as
 * completed (final) and remove a draft that was never activated. Records and configuration are always kept.
 */
export function useActivityLifecycle(opts: { afterRemove?: () => void } = {}) {
  const { state } = useStore();
  const { organization } = useSession();
  const { can } = useAuthorization();
  const actions = useActions();
  const toast = useToast();
  const navigate = useNavigate();
  const [pending, setPending] = useState<{ kind: LifecycleAction; activity: ActivityConfig } | null>(null);
  const canManage = can('verification.activities.activate');
  const canEdit = can('verification.activities.edit');
  const canCreate = can('verification.activities.create');

  /** The lifecycle actions available for an activity in its current status. */
  const available = (a: ActivityConfig): LifecycleAction[] => {
    const st = displayStatus(a);
    if (st === 'completed') return [];
    const out: LifecycleAction[] = [];
    if (canManage && st === 'draft') out.push('activate');
    if (canManage && (st === 'active' || st === 'scheduled')) out.push('pause');
    if (canManage && st === 'paused') out.push('resume');
    if (canManage && st !== 'draft') out.push('complete');
    if (canEdit && st === 'draft' && !a.activeVersionId) out.push('remove');
    return out;
  };

  const duplicate = (a: ActivityConfig) => {
    const r = actions.duplicateActivity(organization.id, a.id);
    if (!r.ok) return toast({ tone: 'error', title: 'Nothing was changed', description: r.error });
    toast({ tone: 'success', title: 'Activity duplicated', description: 'The copy is a draft.' });
    navigate(activityPath((r as { activityId: string }).activityId));
  };

  const LABEL: Record<LifecycleAction, string> = { activate: 'Activate', pause: 'Pause', resume: 'Resume', complete: 'Mark as completed', remove: 'Remove draft' };
  const ICON: Record<LifecycleAction, ReactNode> = {
    activate: <Power className="h-4 w-4" />, pause: <Pause className="h-4 w-4" />, resume: <Play className="h-4 w-4" />,
    complete: <CheckCheck className="h-4 w-4" />, remove: <Trash2 className="h-4 w-4" />,
  };

  /** Menu items for an activity: view, edit, lifecycle and duplicate. */
  const menu = (a: ActivityConfig, { includeView = true }: { includeView?: boolean } = {}): OverflowMenuItem[] => {
    const st = displayStatus(a);
    return [
      ...(includeView ? [{ key: 'view', label: 'View details', icon: <Eye className="h-4 w-4" />, onSelect: () => navigate(activityPath(a.id)) }] : []),
      ...(canEdit && st !== 'completed' ? [{ key: 'edit', label: st === 'draft' ? 'Continue editing' : 'Edit activity', icon: <Pencil className="h-4 w-4" />, onSelect: () => navigate(`${activityPath(a.id)}/edit`) }] : []),
      ...available(a).map((kind) => ({ key: kind, label: LABEL[kind], icon: ICON[kind], tone: kind === 'remove' || kind === 'complete' ? 'danger' as const : undefined, onSelect: () => request(kind, a) })),
      ...(canCreate ? [{ key: 'duplicate', label: 'Duplicate activity', icon: <Copy className="h-4 w-4" />, onSelect: () => duplicate(a) }] : []),
    ];
  };

  const request = (kind: LifecycleAction, activity: ActivityConfig) => {
    // An activity that isn't ready opens on its review step, where what's missing is listed.
    if (kind === 'activate' && activationProblems(state, organization.id, activity).blockers.length) {
      toast({ tone: 'error', title: 'This activity isn’t ready yet', description: 'Complete the highlighted items, then create it.' });
      navigate(`${activityPath(activity.id)}/edit?step=review`);
      return;
    }
    setPending({ kind, activity });
  };

  const run = () => {
    if (!pending) return;
    const { kind, activity } = pending;
    setPending(null);
    const r = kind === 'activate' || kind === 'resume' ? actions.activateActivity(organization.id, activity.id)
      : kind === 'pause' ? actions.deactivateActivity(organization.id, activity.id)
        : kind === 'complete' ? actions.completeActivity(organization.id, activity.id)
          : actions.removeDraftActivity(organization.id, activity.id);
    if (!r.ok) return toast({ tone: 'error', title: 'Nothing was changed', description: r.problems?.join(' ') ?? r.error });
    toast({ tone: 'success', title: { activate: 'Activity activated', pause: 'Activity paused', resume: 'Activity resumed', complete: 'Activity completed', remove: 'Draft removed' }[kind], description: activity.name });
    if (kind === 'remove') opts.afterRemove?.();
  };

  const confirm = pending && (() => {
    const a = pending.activity;
    const starts = a.schedule?.kind && a.schedule.startsAt && new Date(a.schedule.startsAt) > new Date() ? a.schedule.startsAt : undefined;
    const warnings = pending.kind === 'activate' || pending.kind === 'resume' ? activationProblems(state, organization.id, a).warnings : [];
    const body = {
      activate: starts ? `It’s scheduled to start on ${formatDate(starts)}. Assigned verifiers can verify from then.` : 'Assigned verifiers can start verifying straight away.',
      pause: 'No new verifications can start while it’s paused. Earlier verification records and the configuration are kept, and you can resume it at any time.',
      resume: a.draftVersionId ? 'Assigned verifiers can verify again, using the changes saved while it was paused.' : 'Assigned verifiers can verify again.',
      complete: 'No new verifications can start, and it can’t be resumed or edited afterwards. Every verification record is kept. To run it again, duplicate it.',
      remove: 'This draft was never activated. It will be removed. This can’t be undone.',
    }[pending.kind];
    return {
      title: { activate: `Activate ${a.name}?`, pause: `Pause ${a.name}?`, resume: `Resume ${a.name}?`, complete: `Mark ${a.name} as completed?`, remove: `Remove ${a.name}?` }[pending.kind],
      body: <><span className="block">{body}</span>{warnings.length > 0 && <ul className="mt-2 list-disc pl-5 text-amber-800">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}</>,
      cta: LABEL[pending.kind], tone: pending.kind === 'activate' || pending.kind === 'resume' ? 'primary' as const : 'danger' as const,
    };
  })();

  const dialog = confirm ? (
    <ConfirmDialog open title={confirm.title} description={confirm.body} confirmLabel={confirm.cta} tone={confirm.tone} onCancel={() => setPending(null)} onConfirm={run} />
  ) : null;

  return { menu, available, request, dialog, LABEL, ICON };
}
