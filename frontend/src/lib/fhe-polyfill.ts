// Node.js polyfills for browser

// 1. process.env polyfill
if (typeof window !== 'undefined' && !window.process) {
  window.process = {
    env: {
      NODE_ENV: 'production',
      RPC_URL: '',
      ALPHA_TRION_RPC_URL: '',
      DECRYPTION_RPC_URL: '',
      PRIVATE_KEY: '',
      ACL_ADDRESS: '',
    },
    version: 'v18.0.0',
    versions: {} as any,
  } as any;
}

// 2. fs polyfill (用 localStorage 替代)
export const fsPolyfill = {
  existsSync: (path: string): boolean => {
    const key = `fs_${path}`;
    return localStorage.getItem(key) !== null;
  },
  
  readFileSync: (path: string): Buffer => {
    const key = `fs_${path}`;
    const data = localStorage.getItem(key);
    if (!data) throw new Error(`File not found: ${path}`);
    return Buffer.from(data, 'hex');
  },
  
  writeFileSync: (path: string, data: Buffer): void => {
    const key = `fs_${path}`;
    localStorage.setItem(key, data.toString('hex'));
  },
  
  statSync: (path: string): { mtime: { getTime: () => number } } => {
    const key = `fs_mtime_${path}`;
    const mtime = localStorage.getItem(key);
    return {
      mtime: {
        getTime: () => mtime ? parseInt(mtime) : 0,
      },
    };
  },
};

// 3. Buffer polyfill (浏览器已有，但确保可用)
if (typeof window !== 'undefined' && !window.Buffer) {
  window.Buffer = Buffer;
}

// 4. path polyfill
export const pathPolyfill = {
  resolve: (...paths: string[]): string => {
    return paths.join('/').replace(/\/+/g, '/');
  },
  dirname: (path: string): string => {
    return path.split('/').slice(0, -1).join('/');
  },
};

// 注入到 window
if (typeof window !== 'undefined') {
  if (!window.fs) {
    window.fs = fsPolyfill as any;
  }
  if (!window.path) {
    window.path = pathPolyfill as any;
  }
}

// 声明全局类型
declare global {
  interface Window {
    process: any;
    fs: any;
    path: any;
    Buffer: typeof Buffer;
    Module: any;
    fheApi: any;
    ethereum?: any;
  }
}

export {};