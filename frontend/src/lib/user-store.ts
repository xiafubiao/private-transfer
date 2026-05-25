// 用户地址 + handle 存储（JSON 文件）
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

export interface UserBalanceData {
  users: string[];
  handles: Record<string, string>;
  lastSyncBlock: number;
  updatedAt: number;
}

export function loadUserStore(): UserBalanceData {
  if (!fs.existsSync(USERS_FILE)) {
    return { users: [], handles: {}, lastSyncBlock: 0, updatedAt: 0 };
  }
  const content = fs.readFileSync(USERS_FILE, 'utf-8');
  return JSON.parse(content);
}

export function saveUserStore(data: UserBalanceData): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

export function addUser(address: string, handle: string): void {
  const data = loadUserStore();
  if (!data.users.includes(address)) {
    data.users.push(address);
  }
  data.handles[address] = handle;
  data.updatedAt = Date.now();
  saveUserStore(data);
}

export function getUserHandle(address: string): string | null {
  const data = loadUserStore();
  return data.handles[address] || null;
}

export function getAllUserHandles(): Record<string, string> {
  const data = loadUserStore();
  return data.handles;
}