import { simulateLatency } from './latency';
import type { WalletService } from './types';

/** Mock Seamfix Wallet adapter. FixID does not own a wallet; it only delivers to one. */
export function createMockWallet(): WalletService {
  return {
    async checkHealth(org) {
      const latencyMs = await simulateLatency();
      const { connected, issuerDid } = org.integrations.seamfixWallet;
      return {
        ok: connected,
        latencyMs,
        message: connected
          ? `Issuer ${issuerDid} is registered with Seamfix Wallet (simulated).`
          : 'This organization has not been registered as a Seamfix Wallet issuer.',
        checkedAt: new Date().toISOString(),
      };
    },
    async deliver(org, credential) {
      await simulateLatency();
      if (!org.integrations.seamfixWallet.connected || credential.status !== 'active') return 'not-sent';
      return 'delivered';
    },
    getHolderLink(credential) {
      return `https://wallet.seamfix.example/credentials/${encodeURIComponent(credential.identifier)}`;
    },
  };
}
