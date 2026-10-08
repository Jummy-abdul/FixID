/** Simulated network latency for mock adapters. Set to 0 in tests. */
export const latency = { min: 250, max: 700 };

export function simulateLatency(): Promise<number> {
  const ms = latency.max === 0 ? 0 : Math.round(latency.min + Math.random() * (latency.max - latency.min));
  return new Promise((resolve) => setTimeout(() => resolve(ms), ms));
}
