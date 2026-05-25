# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

## Goal

开发测试隐私转账 DApp (eUSDC)，基于 FHETransform 框架实现 USDC → eUSDC (Deposit)、隐私转账、eUSDC → USDC (Withdraw) 功能。前端浏览器直接实现 FHE 加密，不需要后端 API。

## Instructions

- 参考 PUSDCTokenV2_1.sol 合约设计
- 参考 app-demo 的 token.ts SDK 封装
- 前端浏览器直接实现 FHE 加密，不需要后端 API
- 使用已部署的 FHE 系统合约
- **不要修改或重新编译 AlphaTrion 源码**
- **不要禁用 CiphertextDigest 功能**
- **SDK encryptor.u256() 必须传入 BigInt，不能传字符串**
- 清空 AlphaTrion 数据库后必须重新部署 eUSDC 合约
- **MockUSDC decimals = 6**（不是 18）
- **遇到 AlphaTrion 死循环（missing handle 日志反复出现）时**：
  1. 停止 AlphaTrion 容器
  2. 清空数据库：`computations`, `ciphertexts_upload`, `plaintexts`, `allowed_handles`, `ciphertexts_compute`, `missing_handles_upload`, `missing_handles_compute`
  3. 重启 AlphaTrion 容器
  4. 重新部署 MockUSDC 和 eUSDC 合约
  5. 同步合约地址到前端配置

- **重新部署 FHE 系统合约后，必须同步更新所有配置文件**：
  1. `PrimusConfig.sol` - 合约内硬编码的地址（ACL, FHEExecutor, DecryptionOracle, Decryption）
  2. `fhe-sdk/src/config.ts` - SDK 默认地址
  3. `fhe-contracts/.env` - 环境变量配置
  4. `frontend/src/lib/fhe-config.ts` - 前端配置
  5. `frontend/src/lib/contracts.ts` - 前端合约地址
  6. `apps/privacy-transfer/sdk/token.ts` - SDK 默认 ACL 地址
  7. AlphaTrion 配置文件 `conf.env`
  8. **然后重新编译合约并部署 eUSDC**（否则 eUSDC 会调用旧 ACL）

- **关键坑：FHEExecutor 必须配置 chainKey 和 spaceBridge**
  1. `setChainKeys([chainId], [chainKey])` - 设置链的 chain key 映射
  2. `setSpaceBridge(alphatrionRewardAddress)` - 设置 spaceBridge 为 AlphatrionReward 地址（不是 SpaceBridgeConfig）
  3. 否则 deposit 会报错 "Unsupported chain key" 或 AlphaTrion 会报错 "NotSpaceBridge"

- **前端 fhe-browser.ts chainId 必须正确**
  - 使用 `chainId = 688689` (Pharos)，不是 11155111 (Sepolia)

## Deployed Contracts (Pharos Atlantic Testnet - 2026-04-18) [Current ✅]

| Contract | Address |
|----------|---------|
| ZKTLS | `0x30044178459Bf483261BE6810709AcE27BC419BB` |
| ACL | `0x2A31833da5f072A39805111EF4E324e4E2839bb4` |
| FHEExecutor | `0x949868B3e4D244615e2c1e8D82F8A5d0078c64F9` |
| DecryptionOracle | `0x230052c85eE9fDD7d57036dFD993beF75c187c28` |
| SpaceBridgeConfig | `0xE178074B3eF0aed40ea07635F62EDc8fB10C1fc8` |
| Decryption | `0xE775F89Dd00a9aab40e692A21be30e1d142bE8da` |
| CiphertextDigests | `0x18804837D8DeB9B1F2237d9Bba2e526220F0c991` |
| AlphatrionReward | `0xBfD02053Fb5c0c1B96cd665c299C2dD21221c2e4` |
| MockUSDC | `0x7a5E52C3d2E08DCd9d5e98c302dD39A4d85f4877` ✅ |
| eUSDC | `0xBeF3B940e1eB42C75d00f6f1dE2f6107F8D3091C` ✅ |

**注意**: 2026-04-18 全量重新部署！所有地址已更新。

## Network Config (Pharos)

- Chain ID: 688689
- Chain Key: 8
- RPC URL: `https://atlantic.dplabs-internal.com`
- AlphaTrion: `http://34.84.204.187:38081`
- Decryption: `34.84.204.187:38085`
- Block Range Limit: 1000 blocks (Pharos RPC)

## Server Info

- Server: `34.84.204.187`
- AlphaTrion RPC: `http://34.84.204.187:38081`
- Decryption Service: `34.84.204.187:38085`
- SSH Key: `/Users/fubiaoxia/works10/FHETransform/google-test.pem` (username: `ubuntu`)

## Test Accounts

- Bob: `0x6Dc43F7E4B0bDe827BC852Ae364aeF964e7D92cC`
- Alice: `0xA70288A0560E7201aF1507Aef43f009A89e2De06`
- Cindy: `0x9a0717dDCA93d9c9eAdd3D4b88c444c62b947F32`

## Key Discoveries

### 1. FHE Transfer 事件签名
链上实际的 Transfer 事件 topic hash 是：
- `Transfer(address,address,bytes32)` → `0x8d61cf26ce654b1352bb60df9f3d4056b9e85a63977debf8fc9cd727aeda767e`

**不是** Solidity 代码中定义的 `Transfer(address indexed from, address indexed to, ve_uint256 value)`。

这是 ZKPreprocessor 在编译时改变了事件签名（去掉 indexed 关键字，使用 bytes32 而不是 ve_uint256）。

### 2. RPC Block Range Limit
Pharos RPC 有区块范围限制（1000 blocks），需要分块查询：
- `BLOCK_CHUNK_SIZE = 1000`
- 循环查询每个区块范围

### 3. User Sync API
- `POST /api/sync-users` - 同步 Transfer 事件用户
- `GET /api/all-user-balances` - 获取所有用户 handles
- 参数 `{"force": true}` - 从部署区块开始完整同步

### 4. FHEExecutor 配置必须完成
Deposit 功能需要两个关键配置：
1. **Chain Key**: `FHEExecutor.setChainKeys([688689], [8])`
2. **SpaceBridge**: `FHEExecutor.setSpaceBridge(AlphatrionReward地址)`

否则会出现：
- "Unsupported chain key" - chain key 未配置
- "NotSpaceBridge" - spaceBridge 地址错误

### 5. 前端配置一致性检查
所有配置文件必须使用相同的合约地址：

| 文件 | MockUSDC | eUSDC |
|------|----------|-------|
| `contracts.ts` | `0x4e6aFEF9...` | `0xB9e043b7...` |
| `fhe-config.ts` | `0x4e6aFEF9...` | `0xB9e043b7...` |
| AlphaTrion conf.env | - | - |

### 6. Withdraw 使用 claim 函数
eUSDC 合约没有 `withdraw` 函数，使用 `claim(address to, uint256 amount)` 实现提款。
- 参数 1: `to` - 接收 USDC 的地址
- 参数 2: `amount` - 提款金额 (uint256，不是加密金额)
- 需要 ETH 手续费 (0.001 ETH)

## Troubleshooting

### Deposit 失败
1. 检查 USDC 余额是否足够
2. 检查 USDC 是否已 approve eUSDC
3. 检查 FHEExecutor chain key 是否配置
4. 检查 FHEExecutor spaceBridge 是否正确

### AlphaTrion 报错 NotSpaceBridge
- 确保 FHEExecutor.spaceBridge = AlphatrionReward 地址
- 不是 SpaceBridgeConfig 地址

### 解密失败
- 检查 ACL 地址配置是否正确
- 检查签名消息格式是否正确
- 检查 Decryption Service 是否运行

### Claim (Withdraw) 不执行 USDC Transfer
- **AlphaTrion 配置必须与部署网络一致**
  - PROVIDER_URL 必须是 Pharos RPC: `https://atlantic.dplabs-internal.com`
  - ACL_ADDRESS、DECRYPTION_ORACLE_ADDRESS 等必须是 Pharos 部署的地址
  - 否则 AlphaTrion 会监听错误的网络，密文不会上传到数据库
- **密文缺失导致 plaintext = 全零**
  - ciphertexts_upload 表需要有密文才能计算 plaintext
  - plaintext = 0 → FheGe 结果 = false → callback 不执行 transfer
- **解决方案**：
  1. 更新 `/opt/alphatrion/config/.env` 为正确网络配置
  2. 重启 AlphaTrion: `docker restart alphatrion`
  3. 清空数据库表: `computations`, `ciphertexts_upload`, `plaintexts`, `allowed_handles`, `missing_handles_upload`, `missing_handles_compute`
  4. 重新 deposit（密文会被正确上传）
  5. 再执行 claim（plaintext 会正确计算）

### AlphaTrion 配置文件位置
- 配置文件: `/opt/alphatrion/config/.env`
- 检查配置: `docker logs alphatrion --tail 20 | grep 'env settings'`
- 重启服务: `docker restart alphatrion`

## User Data Management

### 数据存储 (`data/users.json`)
用户数据持久化存储，包含：
- `users`: 用户地址列表
- `handles`: 地址 → handle 映射
- `lastSyncBlock`: 上次同步到的区块高度
- `updatedAt`: 更新时间戳

### 增量同步机制
- **默认行为**: 从 `lastSyncBlock + 1` 开始扫描新增区块
- **全量同步**: `force: true` 从部署区块 `19078000` 开始
- API: `POST /api/sync-users` with `{ force: false }`

### 部署时保留数据
**重要**: 每次部署必须保留服务器上的 `users.json`，使用部署脚本：
```bash
./scripts/deploy.sh
```

脚本会自动：
1. 备份服务器上的 `data/users.json`
2. 上传新版本
3. 解压并恢复用户数据
4. 重启服务