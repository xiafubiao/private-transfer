import { ethers } from "hardhat";
import * as fhe from "@primuslabs/fhe-sdk";

const PRIVATE_TOKEN_ADDRESS = process.env.PRIVATE_TOKEN_ADDRESS || "";
const ACL_ADDRESS = process.env.ACL_ADDRESS || "0xF9e8fBC3c5Fc722efc5c24855fbaD0051A31d3B5";

export class PrivateToken {
  private tokenContract: ethers.Contract;
  private aclContract: ethers.Contract;
  private signer: ethers.Signer;
  private decimals: number = 18;

  constructor(tokenAddress?: string) {
    const address = tokenAddress || PRIVATE_TOKEN_ADDRESS;
    if (!address) throw new Error("PRIVATE_TOKEN_ADDRESS not set");
    
    this.signer = ethers.provider.getSigner();
    this.tokenContract = new ethers.Contract(address, PRIVATE_TOKEN_ABI, this.signer);
    this.aclContract = new ethers.Contract(ACL_ADDRESS, ACL_ABI, this.signer);
  }

  async getDecimals(): Promise<number> {
    if (this.decimals) return this.decimals;
    this.decimals = await this.tokenContract.decimals();
    return this.decimals;
  }

  async name(): Promise<string> {
    return await this.tokenContract.name();
  }

  async symbol(): Promise<string> {
    return await this.tokenContract.symbol();
  }

  async getBalance(account?: string): Promise<{ handle: string; decrypted?: bigint }> {
    const addr = account || await this.signer.getAddress();
    const handle = await this.tokenContract.balanceOf(addr);
    return { handle };
  }

  async decryptBalance(handle: string): Promise<bigint> {
    const decrypted = await fhe.decrypt(handle);
    return decrypted;
  }

  async encryptAmount(amount: string): Promise<{ handle: Uint8Array; dataType: number; data: Uint8Array }> {
    const decimals = await this.getDecimals();
    const value = ethers.parseUnits(amount, decimals);
    const encrypted = await fhe.encryptor.u256(value);
    return encrypted;
  }

  async transfer(to: string, amount: string, feeValue?: bigint): Promise<{ txHash: string; handle: string }> {
    const encrypted = await this.encryptAmount(amount);
    const fee = feeValue || ethers.parseEther("0.001");
    
    const tx = await this.tokenContract.transfer(to, {
      handle: encrypted.handle,
      dataType: encrypted.dataType,
      data: encrypted.data,
    }, { value: fee, gasLimit: 500000 });
    
    await tx.wait();
    return { txHash: tx.hash, handle: ethers.hexlify(encrypted.handle) };
  }

  async approve(spender: string, amount: string): Promise<{ txHash: string; handle: string }> {
    const encrypted = await this.encryptAmount(amount);
    
    const tx = await this.tokenContract.approve(spender, {
      handle: encrypted.handle,
      dataType: encrypted.dataType,
      data: encrypted.data,
    });
    
    await tx.wait();
    return { txHash: tx.hash, handle: ethers.hexlify(encrypted.handle) };
  }

  async mint(to: string, amount: string, feeValue?: bigint): Promise<{ txHash: string; handle: string }> {
    const encrypted = await this.encryptAmount(amount);
    const fee = feeValue || ethers.parseEther("0.001");
    
    const tx = await this.tokenContract.mint(to, {
      handle: encrypted.handle,
      dataType: encrypted.dataType,
      data: encrypted.data,
    }, { value: fee, gasLimit: 500000 });
    
    await tx.wait();
    return { txHash: tx.hash, handle: ethers.hexlify(encrypted.handle) };
  }

  async burn(amount: string, feeValue?: bigint): Promise<{ txHash: string; handle: string }> {
    const encrypted = await this.encryptAmount(amount);
    const fee = feeValue || ethers.parseEther("0.001");
    
    const tx = await this.tokenContract.burn({
      handle: encrypted.handle,
      dataType: encrypted.dataType,
      data: encrypted.data,
    }, { value: fee, gasLimit: 500000 });
    
    await tx.wait();
    return { txHash: tx.hash, handle: ethers.hexlify(encrypted.handle) };
  }

  async allowForDecryption(handle: string, account?: string): Promise<string> {
    let tx;
    if (account) {
      tx = await this.aclContract['accessPolicy(bytes32,address,uint8)'](handle, account, 2);
    } else {
      tx = await this.aclContract.allowForDecryption([handle]);
    }
    await tx.wait();
    return tx.hash;
  }

  formatAmount(value: bigint): string {
    return ethers.formatUnits(value, this.decimals);
  }
}

const PRIVATE_TOKEN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (bytes32)",
  "function balanceOf(address) view returns (bytes32)",
  "function allowance(address, address) view returns (bytes32)",
  "function transfer(address, tuple(bytes32 handle, uint8 dataType, bytes data)) payable returns (bool)",
  "function approve(address, tuple(bytes32 handle, uint8 dataType, bytes data)) returns (bool)",
  "function transferFrom(address, address, tuple(bytes32 handle, uint8 dataType, bytes data)) payable returns (bool)",
  "function mint(address, tuple(bytes32 handle, uint8 dataType, bytes data)) payable returns (bool)",
  "function burn(tuple(bytes32 handle, uint8 dataType, bytes data)) payable returns (bool)",
];

const ACL_ABI = [
  "function isAllowed(bytes32, address) view returns (bool)",
  "function isAllowedForDecryption(bytes32) view returns (bool)",
  "function isAllowedForDecryption(bytes32, address) view returns (bool)",
  "function allowForDecryption(bytes32[]) returns ()",
  "function accessPolicy(bytes32, address, uint8) returns ()",
];