/** An unguessable random hex token (24 bytes), for single-use links such as administrator invitations. */
export function invitationToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
