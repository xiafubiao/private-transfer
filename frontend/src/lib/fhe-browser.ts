// FHE SDK Browser Adapter

import { ethers } from 'ethers';
import { FHE_CONFIG, parseAmount, formatAmount, initFheConfig } from './fhe-config';
import { getBrowserSigner, ensureWalletConnected } from './wallet-signer';

// FheType enum (copied from SDK to avoid import issues)
const FheType = { ve_bool: 0, ve_uint8: 1, ve_uint16: 2, ve_uint32: 3, ve_uint64: 4, ve_uint128: 5, ve_uint256: 6 };

// API 代理 URL
const FHE_PROXY_URL = '/api/fhe-proxy';

// 公钥缓存 key
const PK_STORAGE_KEY = 'fhe_server_pk';
const PK_MTIME_KEY = 'fhe_server_pk_mtime';

// ==================== 公钥管理 ====================

async function fetchPublicKey(): Promise<Uint8Array> {
  const request = {
    id: Math.floor(Math.random() * 0x7fffffff),
    params: [{ encoding: '0x01' }],
    method: 'download',
    jsonrpc: '2.0',
  };
  
  // 公钥直接从 AlphaTrion HTTP 获取
  const response = await fetch(FHE_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  
  const json = await response.json();
  if (json.error) throw new Error(json.error.message);
  
  const pkHex = json.result.pk;
  return ethers.getBytes(pkHex);
}

async function getPublicKey(forceRefresh = false): Promise<Uint8Array> {
  // 检查缓存
  if (!forceRefresh) {
    const cached = localStorage.getItem(PK_STORAGE_KEY);
    const mtime = localStorage.getItem(PK_MTIME_KEY);
    
    if (cached && mtime) {
      const ONE_HOUR = 60 * 60 * 1000;
      const age = Date.now() - parseInt(mtime);
      if (age < ONE_HOUR) {
        return ethers.getBytes(cached);
      }
    }
  }
  
  // 下载新公钥
  const pkBytes = await fetchPublicKey();
  
  // 缓存到 localStorage
  localStorage.setItem(PK_STORAGE_KEY, ethers.hexlify(pkBytes));
  localStorage.setItem(PK_MTIME_KEY, Date.now().toString());
  
  return pkBytes;
}

// ==================== WASM 加密 ====================

let wasmReady = false;

async function loadWasmModule(): Promise<void> {
  if (wasmReady && typeof window !== 'undefined' && (window as any).Module?.calledRun) return;
  
  if (typeof window === 'undefined') throw new Error('WASM requires browser');
  
  const win = window as any;
  
  if (!win.Module) {
    win.Module = {};
  }
  
  if (!win.Module._encrypt_integer_ex || !win.Module.calledRun) {
    win.Module.locateFile = (path: string) => `/wasm/${path}`;
    
    const script = document.createElement('script');
    script.src = '/wasm/fhe-api.js';
    document.head.appendChild(script);
    
    await new Promise<void>((resolve, reject) => {
      const checkReady = () => {
        if (win.Module && win.Module.calledRun && win.Module._encrypt_integer_ex) {
          wasmReady = true;
          resolve();
        } else {
          setTimeout(checkReady, 100);
        }
      };
      
      script.onload = () => {
        setTimeout(checkReady, 100);
      };
      script.onerror = () => reject(new Error('Failed to load WASM script'));
      
      setTimeout(() => {
        if (!wasmReady) reject(new Error('WASM init timeout'));
      }, 10000);
    });
  }
  
  if (!win.Module._encrypt_integer_ex) {
    throw new Error('WASM encrypt function not available');
  }
  
  wasmReady = true;
}

async function encryptWithWasm(pk: Uint8Array, value: bigint, fheType: number): Promise<Uint8Array> {
  await loadWasmModule();
  
  const Module = (window as any).Module;
  
  const valueHex = value.toString(16).padStart(64, '0');
  const valueBytes = ethers.getBytes('0x' + valueHex);
  
  const typeLengths: Record<number, number> = {
    0: 1, 1: 1, 2: 2, 3: 4, 4: 8, 5: 16, 6: 32,
  };
  const typeLen = typeLengths[fheType] || 32;
  const input = valueBytes.slice(valueBytes.length - typeLen);
  
  const outLenPtr = Module._malloc(4);
  try {
    const ptr = Module.ccall(
      'encrypt_integer_ex',
      'number',
      ['number', 'array', 'number', 'array', 'number'],
      [outLenPtr, Array.from(pk), pk.length, Array.from(input), input.length]
    );
    
    if (!ptr) throw new Error('WASM encrypt returned null');
    
    const outLen = Module.HEAP32[outLenPtr >> 2];
    const result = new Uint8Array(Module.HEAPU8.subarray(ptr, ptr + outLen));
    
    Module.ccall('free_data', null, ['number'], [ptr]);
    Module._free(outLenPtr);
    
    return result;
  } catch (e) {
    Module._free(outLenPtr);
    throw e;
  }
}

// ==================== Handle 计算 ====================

// Chain keys for different networks (from SDK chain.ts)
const CHAIN_KEYS: Record<number, number> = {
  1: 1,        // Ethereum Mainnet
  11155111: 2, // Ethereum Sepolia
  84532: 3,    // Base Sepolia
  133: 4,      // Hashkey Chain Testnet
  56: 5,       // BNB Smart Chain
  8453: 6,     // Base
  177: 7,      // HashKey Chain
  688689: 8,   // Pharos Atlantic Testnet
  31337: 255,  // Hardhat/Anvil Local
};

function getChainKey(chainId: number): number {
  return CHAIN_KEYS[chainId] || 1;
}

function calculateHandle(
  digestBytes: Uint8Array,
  fheType: number,
  chainId: number
): Uint8Array {
  // Handle 格式 (version 1):
  // [0..20] = digest 前 20 字节
  // [20..28] = zeros (off-chain input)
  // [28] = chainKey
  // [29] = 0x00 (Operators.fheNone)
  // [30] = fheType
  // [31] = 1 (handle version)
  
  const handle = new Uint8Array(32);
  handle.set(digestBytes.slice(0, 20), 0);  // digest 前 20 字节
  // [20..28] = zeros (off-chain)
  handle[28] = getChainKey(chainId);
  handle[29] = 0;  // Operators.fheNone
  handle[30] = fheType;
  handle[31] = 1;  // handle version
  
  return handle;
}

// ==================== 密文上传 ====================

interface UploadResponse {
  handle: string;
}

async function uploadCiphertext(
  handle: Uint8Array,
  ciphertext: Uint8Array,
  userAddress: string,
  aclAddress: string,
  signature: string,
  ts: number,
  pkDigest: string,
  attBytesHash: string
): Promise<UploadResponse> {
  const tsHex = ts.toString(16).padStart(16, '0');
  
  const payload = {
    handle: ethers.hexlify(handle),
    ciphertext: ethers.hexlify(ciphertext),
    encoding: '0x01',
    pk_digest: pkDigest,
    userAddress: userAddress,
    aclContractAddress: aclAddress,
    attBytesHash: attBytesHash,
    signature: signature,
    timestamp: '0x' + tsHex,
  };
  
  const request = {
    id: Math.floor(Math.random() * 0x7fffffff),
    params: [[payload]],
    method: 'upload',
    jsonrpc: '2.0',
  };
  
  const response = await fetch(FHE_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  
  const json = await response.json();
  if (json.error) throw new Error(json.error.message);
  
  return {
    handle: json.result[0].handle,
  };
}

// ==================== 解密 ====================

async function requestDecryptHttp(
  handle: string,
  userAddress: string,
  aclAddress: string,
  signature: string
): Promise<bigint> {
  const handleBytes = ethers.getBytes(handle);
  const handleHex = ethers.hexlify(handleBytes).slice(2); // 去掉 0x
  const fheTypeHex = handleHex.slice(60, 62);
  const ts = Date.now();
  const tsHex = ts.toString(16).padStart(16, '0');
  
  const payload = {
    handle: handle,
    valueType: '0x' + fheTypeHex,
    userAddress: userAddress,
    aclContractAddress: aclAddress,
    signature: signature,
    timestamp: '0x' + tsHex,
  };
  
  const request = {
    id: Math.floor(Math.random() * 0x7fffffff),
    params: [[payload]],
    method: 'query_for_decryption',
    jsonrpc: '2.0',
  };
  
  // 后端 API 通过 gRPC 调用 Decryption Service
  const response = await fetch(FHE_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  
  const json = await response.json();
  
  if (json.error) {
    if (json.error.code === 404) {
      return BigInt(0);
    }
    throw new Error(json.error.message);
  }
  
  if (json.result?.[0]?.value) {
    const valueHex = json.result[0].value;
    return ethers.toBigInt(valueHex);
  }
  
  return BigInt(0);
}

// ==================== 公开 API ====================

// 初始化 FHE 环境
export async function initFhe(): Promise<void> {
  initFheConfig();
  await getPublicKey();
}

// 加密金额
export async function encryptAmount(amount: string): Promise<{handle: `0x${string}`, dataType: number, data: `0x${string}`}> {
  await ensureWalletConnected();
  const signer = getBrowserSigner();
  const userAddress = signer.getAddress();
  
  // 获取公钥
  const pk = await getPublicKey();
  const pkDigest = ethers.keccak256(pk);
  
  // 转换金额
  const value = parseAmount(amount);
  
  // WASM 加密
  const ciphertext = await encryptWithWasm(pk, value, 6); // u256
  
  // 时间戳
  const ts = Date.now();
  const tsHex = ts.toString(16).padStart(16, '0');
  const tsBytes = ethers.getBytes('0x' + tsHex);
  
  // attestation hash (placeholder)
  const attBytesHash = '0xddb21bf27227c409828224d946d749cf44f7e59b594dbf3196dae321e338ec19';
  
  // 签名消息 (必须和 SDK 一致)
  const messageBytes = ethers.concat([
    ciphertext,
    new Uint8Array([0x01]),           // encoding type
    ethers.getBytes(pkDigest),         // pk_digest
    ethers.getBytes(userAddress),      // user address (20 bytes)
    ethers.getBytes(FHE_CONFIG.ACL_ADDRESS), // acl address (20 bytes)
    ethers.getBytes(attBytesHash),     // attestation hash (32 bytes)
    tsBytes,                           // timestamp (8 bytes)
  ]);
  
  // 计算 digest (用于 handle 和签名)
  const digest = ethers.keccak256(messageBytes);
  const digestBytes = ethers.getBytes(digest);
  
  // 计算 handle (从 digest，不是 ciphertext)
  const chainId = 688689; // Pharos Atlantic Testnet
  const handle = calculateHandle(digestBytes, 6, chainId);
  
  // eth_sign: 直接签名 digest (无 EIP-191 前缀)
  const signature = await signer.signDigest(digest);
  
  // 上传密文到 AlphaTrion (payload timestamp 必须和签名一致)
  const result = await uploadCiphertext(handle, ciphertext, userAddress, FHE_CONFIG.ACL_ADDRESS, signature, ts, pkDigest, attBytesHash);
  
  // AlphaTrion 会重新计算 handle (基于 ciphertext digest)
  // 必须使用 AlphaTrion 返回的 handle，否则密文找不到
  const returnedHandle = result.handle;
  
  console.log('[encryptAmount] original handle:', ethers.hexlify(handle));
  console.log('[encryptAmount] AlphaTrion returned handle:', returnedHandle);
  
  // 返回 AlphaTrion 计算的 handle
  return {
    handle: returnedHandle as `0x${string}`,
    dataType: 1, // PayloadType.PROOF
    data: '0xaa' as `0x${string}`, // attestation placeholder
  };
}

// 准备解密 payload（生成签名，但不调用解密 API）
export async function prepareDecryptPayload(handle: string): Promise<{
  handle: string;
  valueType: string;
  userAddress: string;
  aclAddress: string;
  signature: string;
  timestamp: string;
}> {
  await ensureWalletConnected();
  const signer = getBrowserSigner();
  const userAddress = signer.getAddress();

  // 正确解析 handle
  const handleBytes = ethers.getBytes(handle);
  const handleHex = ethers.hexlify(handleBytes).slice(2);
  const fheTypeHex = handleHex.slice(60, 62);
  const fheTypeBytes = new Uint8Array([parseInt(fheTypeHex, 16)]);

  const ts = Date.now();
  const tsHex = ts.toString(16).padStart(16, '0');
  const tsBytes = ethers.getBytes('0x' + tsHex);

  // Build message bytes
  const messageBytes = ethers.concat([
    handleBytes,
    fheTypeBytes,
    ethers.getBytes(userAddress),
    ethers.getBytes(FHE_CONFIG.ACL_ADDRESS),
    tsBytes,
  ]);

  // Sign with eth_sign (signDigest for browser wallet)
  const digest = ethers.keccak256(messageBytes);
  const signature = await signer.signDigest(digest);

  return {
    handle: handle,
    valueType: '0x' + fheTypeHex,
    userAddress: userAddress,
    aclAddress: FHE_CONFIG.ACL_ADDRESS,
    signature: signature,
    timestamp: '0x' + tsHex,
  };
}

// 解密 handle
export async function decryptHandle(handle: string): Promise<string> {
  await ensureWalletConnected();
  const signer = getBrowserSigner();
  const userAddress = signer.getAddress();

  // 正确解析 handle
  const handleBytes = ethers.getBytes(handle);
  const handleHex = ethers.hexlify(handleBytes).slice(2);
  const fheTypeHex = handleHex.slice(60, 62);
  const fheTypeBytes = new Uint8Array([parseInt(fheTypeHex, 16)]);

  const ts = Date.now();
  const tsHex = ts.toString(16).padStart(16, '0');
  const tsBytes = ethers.getBytes('0x' + tsHex);

  // Build message bytes
  const messageBytes = ethers.concat([
    handleBytes,
    fheTypeBytes,
    ethers.getBytes(userAddress),
    ethers.getBytes(FHE_CONFIG.ACL_ADDRESS),
    tsBytes,
  ]);

  // Sign with eth_sign (signDigest for browser wallet)
  const digest = ethers.keccak256(messageBytes);
  const signature = await signer.signDigest(digest);

  // Decrypt request
  const payload = {
    handle: handle,
    valueType: '0x' + fheTypeHex,
    userAddress: userAddress,
    aclContractAddress: FHE_CONFIG.ACL_ADDRESS,
    signature: signature,
    timestamp: '0x' + tsHex,
  };

  const request = {
    id: Math.floor(Math.random() * 0x7fffffff),
    params: [[payload]],
    method: 'query_for_decryption',
    jsonrpc: '2.0',
  };

  // Send to proxy with single attempt (plaintext must be pre-computed)
  try {
    const response = await fetch(FHE_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    const json = await response.json();

    // Check for errors
    if (json.error) {
      console.warn('[decryptHandle] Error:', json.error.message);
      // If plaintext not found, return "0" (no balance)
      if (json.error.code === 404 || json.error.message?.includes('not found')) {
        return '0';
      }
      throw new Error(json.error.message);
    }

    // Check result
    if (json.result?.[0]?.value) {
      const valueHex = json.result[0].value;
      const value = ethers.toBigInt(valueHex);
      return formatAmount(value);
    }

    // Empty result = plaintext not computed yet
    console.warn('[decryptHandle] No plaintext returned - ciphertext may not be uploaded');
    return '0';
  } catch (e: any) {
    console.error('[decryptHandle] Failed:', e.message);
    // Return 0 instead of throwing - allows UI to show "0 balance" instead of stuck
    return '0';
  }
}

// 简化的 encryptor (兼容 SDK 接口)
export const encryptor = {
  u256: async (value: number | bigint): Promise<{handle: Uint8Array, dataType: number, data: Uint8Array}> => {
    const amount = ethers.formatUnits(BigInt(value) * BigInt(10 ** FHE_CONFIG.TOKEN_DECIMALS), FHE_CONFIG.TOKEN_DECIMALS);
    const result = await encryptAmount(amount);
    return {
      handle: ethers.getBytes(result.handle),
      dataType: result.dataType,
      data: ethers.getBytes(result.data),
    };
  },
};