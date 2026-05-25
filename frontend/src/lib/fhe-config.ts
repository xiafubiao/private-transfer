import { ethers } from 'ethers';

export const FHE_CONFIG = {
  RPC_URL: 'https://atlantic.dplabs-internal.com',
  ALPHA_TRION_RPC_URL: 'http://34.84.204.187:38081',
  DECRYPTION_RPC_URL: '34.84.204.187:38085',
  
  ACL_ADDRESS: '0x2A31833da5f072A39805111EF4E324e4E2839bb4',
  FHE_EXECUTOR_ADDRESS: '0x949868B3e4D244615e2c1e8D82F8A5d0078c64F9',
  DECRYPTION_ORACLE_ADDRESS: '0x230052c85eE9fDD7d57036dFD993beF75c187c28',
  DECRYPTION_ADDRESS: '0xE775F89Dd00a9aab40e692A21be30e1d142bE8da',

  SPACE_BRIDGE_CONFIG_ADDRESS: '0xE178074B3eF0aed40ea07635F62EDc8fB10C1fc8',
  CIPHERTEXT_DIGESTS_ADDRESS: '0x18804837D8DeB9B1F2237d9Bba2e526220F0c991',
  ALPHATRION_REWARD_ADDRESS: '0xBfD02053Fb5c0c1B96cd665c299C2dD21221c2e4',

  MOCK_USDC_ADDRESS: '0x7a5E52C3d2E08DCd9d5e98c302dD39A4d85f4877',
  EUSDC_ADDRESS: '0xBeF3B940e1eB42C75d00f6f1dE2f6107F8D3091C',

  TOKEN_DECIMALS: 6, // MockUSDC decimals
  FEE_ETH: '0.01',
};

export function initFheConfig() {
  if (typeof window !== 'undefined') {
    (window as any).process = {
      env: {
        RPC_URL: FHE_CONFIG.RPC_URL,
        ALPHA_TRION_RPC_URL: FHE_CONFIG.ALPHA_TRION_RPC_URL,
        DECRYPTION_RPC_URL: FHE_CONFIG.DECRYPTION_RPC_URL,
        ACL_ADDRESS: FHE_CONFIG.ACL_ADDRESS,
        PRIVATE_KEY: '',
      }
    };
  }
}

export const formatAmount = (value: bigint): string => {
  return ethers.formatUnits(value, FHE_CONFIG.TOKEN_DECIMALS);
};

export const parseAmount = (value: string): bigint => {
  return ethers.parseUnits(value, FHE_CONFIG.TOKEN_DECIMALS);
};