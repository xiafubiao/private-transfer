// 用户地址扫描 + handle 同步
import { ethers } from 'ethers';
import { loadUserStore, saveUserStore, UserBalanceData } from './user-store';
import { CONTRACTS } from './contracts';

const RPC_URL = 'https://atlantic.dplabs-internal.com';
const BLOCK_CHUNK_SIZE = 1000; // Pharos RPC limit (1000 blocks)

const DEPLOY_BLOCK = 19078000; // Pharos eUSDC deploy block

const EMPTY_HANDLE = '0x0000000000000000000000000000000000000000000000000000000000000000';

// Transfer 事件 topic hash
// 标准 ERC20: Transfer(address,address,uint256) -> 0xddf252ad...
const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
// FHE 实际链上签名: Transfer(address,address,bytes32) -> 0x8d61cf26...
// 注意: ZKPreprocessor 编译时会改变事件签名，与 Solidity 源码不同
const FHE_TRANSFER_TOPIC = '0x8d61cf26ce654b1352bb60df9f3d4056b9e85a63977debf8fc9cd727aeda767e';

export async function scanTransferEvents(fromBlock?: number, toBlock?: number): Promise<string[]> {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  
  const startBlock = fromBlock || DEPLOY_BLOCK;
  const endBlock = toBlock || await provider.getBlockNumber();
  
  console.log(`[user-sync] Scanning Transfer events from block ${startBlock} to ${endBlock}`);
  
  const users = new Set<string>();
  
  for (let chunkStart = startBlock; chunkStart <= endBlock; chunkStart += BLOCK_CHUNK_SIZE) {
    const chunkEnd = Math.min(chunkStart + BLOCK_CHUNK_SIZE - 1, endBlock);
    
    const filter = {
      address: CONTRACTS.EUSDC,
      fromBlock: chunkStart,
      toBlock: chunkEnd,
      topics: [
        [ERC20_TRANSFER_TOPIC, FHE_TRANSFER_TOPIC],
        null,
        null,
      ],
    };
    
    try {
      const logs = await provider.getLogs(filter);
      
      for (const log of logs) {
        const fromTopic = log.topics[1];
        const toTopic = log.topics[2];
        
        if (fromTopic) {
          const from = '0x' + fromTopic.slice(26);
          if (from !== ethers.ZeroAddress) {
            users.add(from.toLowerCase());
          }
        }
        
        if (toTopic) {
          const to = '0x' + toTopic.slice(26);
          if (to !== ethers.ZeroAddress) {
            users.add(to.toLowerCase());
          }
        }
      }
      
      console.log(`[user-sync] Blocks ${chunkStart}-${chunkEnd}: ${logs.length} events`);
    } catch (error) {
      console.error(`[user-sync] Error in blocks ${chunkStart}-${chunkEnd}:`, error);
    }
  }
  
  console.log(`[user-sync] Total: ${users.size} unique addresses`);
  
  return Array.from(users);
}

export async function syncUserHandles(users: string[]): Promise<Record<string, string>> {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  
  const EUSDC_ABI = ['function balanceOf(address account) view returns (bytes32)'];
  const contract = new ethers.Contract(CONTRACTS.EUSDC, EUSDC_ABI, provider);
  
  const handles: Record<string, string> = {};
  
  console.log(`[user-sync] Querying balanceOf for ${users.length} users`);
  
  for (const addr of users) {
    try {
      const handle = await contract.balanceOf(addr);
      const handleHex = ethers.hexlify(handle);
      
      if (handleHex !== EMPTY_HANDLE) {
        handles[addr] = handleHex;
        console.log(`[user-sync] ${addr} -> ${handleHex.slice(0, 20)}...`);
      } else {
        console.log(`[user-sync] ${addr} -> empty (balance=0)`);
      }
    } catch (error) {
      console.error(`[user-sync] Error querying ${addr}:`, error);
    }
  }
  
  return handles;
}

export async function syncAllUsers(forceFullSync: boolean = false): Promise<UserBalanceData> {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const currentBlock = await provider.getBlockNumber();
  
  const existingData = loadUserStore();
  
  let fromBlock: number;
  if (forceFullSync || existingData.lastSyncBlock === 0) {
    fromBlock = DEPLOY_BLOCK;
  } else {
    fromBlock = existingData.lastSyncBlock + 1;
  }
  
  const newUsers = await scanTransferEvents(fromBlock, currentBlock);
  
  const allUsers = new Set([...existingData.users.map(u => u.toLowerCase()), ...newUsers]);
  
  const handles = await syncUserHandles(Array.from(allUsers));
  
  const data: UserBalanceData = {
    users: Array.from(allUsers),
    handles,
    lastSyncBlock: currentBlock,
    updatedAt: Date.now(),
  };
  
  saveUserStore(data);
  
  console.log(`[user-sync] Sync complete: ${data.users.length} users, ${Object.keys(handles).length} handles`);
  
  return data;
}