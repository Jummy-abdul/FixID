export const activityPath = (id: string, tab?: 'overview' | 'checks' | 'verifiers' | 'history') =>
  `/verification-activities/${encodeURIComponent(id)}${tab && tab !== 'overview' ? `?tab=${tab}` : ''}`;
