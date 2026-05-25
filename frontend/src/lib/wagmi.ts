import { createConfig, http, injected } from 'wagmi'
import { defineChain } from 'viem'

export const pharos = defineChain({
  id: 688689,
  name: 'Pharos Atlantic Testnet',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://atlantic.dplabs-internal.com'] },
  },
  blockExplorers: {
    default: { name: 'Pharos Explorer', url: 'https://atlantic.pharosscan.xyz/' },
  },
})

export const config = createConfig({
  chains: [pharos],
  connectors: [
    injected(),
  ],
  ssr: true,
  transports: {
    [pharos.id]: http('https://atlantic.dplabs-internal.com'),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}