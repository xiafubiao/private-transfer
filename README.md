# Private Token - 加密 ERC20 代币

> 基于 FHETransform 框架的隐私转账 DApp

## 功能

| 功能 | 说明 |
|------|------|
| 隐私转账 | 金额加密，链上不可见 |
| 加密余额 | 只有用户自己能解密查看 |
| 隐私授权 | 加密授权额度 |
| Mint/Burn | 加密铸造和销毁 |

## 项目结构

```
apps/privacy-transfer/
├── contracts/PrivateToken.sol     # 加密 ERC20 合约
├── sdk/token.ts                   # SDK 封装
├── scripts/
│   ├── test-mint.ts               # Mint 测试
│   └── test-transfer.ts           # Transfer 测试
├── .env.example                   # 环境变量模板
└── DESIGN.md                      # 设计文档
```

## 快速开始

### 1. 配置环境

```bash
cd apps/privacy-transfer
cp .env.example .env
# 编辑 .env，填入 PRIVATE_KEY
```

### 2. 编译合约

```bash
cd ../../fhe-contracts/packages/fhe-contracts
npm run build
```

### 3. 部署合约

```bash
# 加载环境变量
source ../../apps/privacy-transfer/.env

# 部署
PRIVATE_KEY=<key> RPC_URL=<rpc> \
  npx hardhat run scripts/deployPrivateToken.ts --network sepolia

# 记录部署地址，更新 .env
PRIVATE_TOKEN_ADDRESS=<deployed-address>
```

### 4. 测试 Mint

```bash
cd ../../apps/privacy-transfer
RPC_URL=<rpc> ALPHA_TRION_RPC_URL=http://34.84.204.187:38081 \
  DECRYPTION_RPC_URL=34.84.204.187:38085 PRIVATE_KEY=<key> \
  npx hardhat run scripts/test-mint.ts --network sepolia
```

### 5. 测试 Transfer

```bash
RPC_URL=<rpc> ALPHA_TRION_RPC_URL=http://34.84.204.187:38081 \
  DECRYPTION_RPC_URL=34.84.204.187:38085 PRIVATE_KEY=<key> \
  npx hardhat run scripts/test-transfer.ts --network sepolia
```

## 已部署的系统合约 (Sepolia)

| 合约 | 地址 |
|------|------|
| ACL | `0x620BFe43BC391611aed8b260af22e13cAF343c20` |
| FHE Executor | `0x72F6Aa6f0A89C7Dd966ab4C3F3B75a5A6b9507C9` |
| Decryption Oracle | `0x421bEB6FEAaAC0CbE0ed879D1b678BFb52FA4FB2` |

| 服务 | 地址 |
|------|------|
| AlphaTrion | `http://34.84.204.187:38081` |
| Decryption | `34.84.204.187:38085` |

## 版本说明

当前版本：**B (纯隐私版)**

- 用户完全控制谁能查看余额
- 无监管白名单机制
- 适合纯隐私场景

后续版本：**A (合规版)**

- 添加 RegulatoryWhitelist
- 监管机构可以查看所有用户余额
- 用户不能撤销监管权限