/**
 * Demonstration mailbox (prototype only). No email service is connected, so messages FixID would email
 * (password reset links) are kept here instead and shown at /demo-mailbox, labelled as simulated. It stands
 * in for the recipient's own inbox and doesn't exist in production.
 */
export interface DemoMail { id: string; to: string; subject: string; body: string; link: string; sentAt: string }

const KEY = 'fixid.demo.mailbox';

export function loadMailbox(): DemoMail[] {
  try { return JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as DemoMail[]; } catch { return []; }
}

export function deliverDemoMail(mail: Omit<DemoMail, 'id' | 'sentAt'>, now = new Date()) {
  const next = [{ ...mail, id: `mail_${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`, sentAt: now.toISOString() }, ...loadMailbox()].slice(0, 50);
  try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
}

export function clearMailbox() {
  try { window.localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}
