// MetaMask signer wrapper for FHE SDK

import { ethers } from 'ethers';

export class BrowserSigner {
  private provider: ethers.BrowserProvider | null = null;
  private signer: ethers.JsonRpcSigner | null = null;
  private address: string | null = null;
  
  async connect(): Promise<string> {
    if (!window.ethereum) {
      throw new Error('MetaMask not found');
    }
    
    this.provider = new ethers.BrowserProvider(window.ethereum);
    this.signer = await this.provider.getSigner();
    this.address = await this.signer.getAddress();
    
    return this.address;
  }
  
  getAddress(): string {
    if (!this.address) throw new Error('Not connected');
    return this.address;
  }
  
  // EIP-191 签名 (SDK 需要的格式)
  async signMessage(message: Uint8Array | string): Promise<string> {
    if (!this.signer) throw new Error('Not connected');
    
    // ethers.js signMessage 自动处理 EIP-191
    const signature = await this.signer.signMessage(message);
    return signature;
  }
  
  // signMessage 签名 (EIP-191，服务端验证方式)
  async signDigest(digest: string): Promise<string> {
    if (!this.signer) throw new Error('Not connected');
    
    // 服务端验证: verifyMessage(digestBytes, signature)
    // 所以我们需要 signMessage(digestBytes)
    const digestBytes = ethers.getBytes(digest);
    const signature = await this.signer.signMessage(digestBytes);
    return signature;
  }
  
  // SDK 需要的签名函数
  async getSignature(messageBytes: Uint8Array, signMode: string = 'eth_sign'): Promise<string> {
    const digest = ethers.keccak256(messageBytes);
    
    if (signMode === 'eth_sign') {
      return await this.signDigest(digest);
    } else {
      // EIP-191 模式
      const msgBytes = signMode === 'eip191' ? messageBytes : ethers.getBytes(digest);
      return await this.signMessage(msgBytes);
    }
  }
  
  isConnected(): boolean {
    return this.signer !== null && this.address !== null;
  }
  
  async disconnect(): Promise<void> {
    this.provider = null;
    this.signer = null;
    this.address = null;
  }
}

// 全局单例
let browserSigner: BrowserSigner | null = null;

export function getBrowserSigner(): BrowserSigner {
  if (!browserSigner) {
    browserSigner = new BrowserSigner();
  }
  return browserSigner;
}

// 检查钱包是否连接，每次都重新获取 signer 以确保账户同步
export async function ensureWalletConnected(): Promise<string> {
  const signer = getBrowserSigner();
  // 每次都重新 connect，确保 signer 和当前 MetaMask 账户一致
  return await signer.connect();
}