# 隐私转账 DApp 设计文档

> 基于 FHETransform 框架的隐私 ERC20 代币应用

## 一、项目概述

### 目标

构建一个隐私转账应用，用户可以：
- 查看自己的加密余额（只有自己能解密）
- 隐私转账（金额加密，链上不可见）
- 控制谁可以查看自己的余额

### 参考实现

| 项目 | 说明 |
|------|------|
| PUSDCTokenV2_1.sol | 加密 ERC20 代币合约模板 |
| app-demo/token.ts | SDK 封装示例 |
| eUSDC README | CLI 工具使用文档 |

---

## 二、核心功能

### 用户视角

| 功能 | 说明 | 隐私级别 |
|------|------|----------|
| **查看余额** | 加密余额，只有用户自己能解密 | 🔒 私密 |
| **转账** | 金额加密，链上不暴露 | 🔒 私密 |
| **授权** | 加密授权额度 | 🔒 私密 |
| **Deposit** | 从普通 ERC20 转入加密代币 | 🌐 公开 |
| **Claim** | 从加密代币转出普通 ERC20 | 🌐 公开 |
| **解密权限控制** | 设置谁能查看我的余额 | 🔒 私密 |

### 与普通 ERC20 的区别

| 对比项 | 普通 ERC20 | 加密 ERC20 (eERC20) |
|--------|-----------|---------------------|
| balanceOf | 返回明文数字 | 返回加密 handle |
| transfer | 金额公开可见 | 金额加密不可见 |
| 交易历史 | 可追踪资金流向 | 金额隐私，无法追踪 |
| 验证余额 | 任何人都能看 | 只有授权者能解密 |

---

## 三、技术架构

```
┌────────────────────────────────────────────────────────────────┐
│                      用户前端                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Wallet Connect │ Balance Display │ Transfer Form │ ... │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
                              ↓ SDK API
┌────────────────────────────────────────────────────────────────┐
│                        SDK Layer                               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  encrypt(amount) │ decrypt(handle) │ transfer(to, eAmt) │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
                              ↓ RPC Calls
┌────────────────────────────────────────────────────────────────┐
│                     FHE Infrastructure                         │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────────────┐  │
│  │ AlphaTrion  │   │ Decryption  │   │ Ethereum Testnet    │  │
│  │ (FHE 计算)  │   │ Server      │   │ (智能合约)          │  │
│  │ :38081      │   │ :38085      │   │                     │  │
│  └─────────────┘   └─────────────┘   └─────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

### 数据流

#### 1. 加密转账流程

```
用户输入金额 → SDK.encrypt(amount) → AlphaTrion 返回 handle + ciphertext
           → 合约.transfer(to, {handle, data}) → 链上交易
           → AlphaTrion 监听事件 → FHE 加法计算 → 更新加密余额
```

#### 2. 解密余额流程

```
合约.balanceOf(user) → 返回 handle
                   → ACL 检查权限
                   → SDK.decrypt(handle) → Decryption Server 返回明文
```

---

## 四、智能合约设计

### 合约继承

```
eERC20 Token (本项目)
    ↓ extends
PrivyTokenV2_1 (参考模板)
    ↓ extends
RegulatoryWhitelist + PrimusConfig
    ↓ uses
FHE.sol (FHE 操作库)
```

### 核心 Storage

```solidity
// 加密余额
mapping(address => ve_uint256) private _balances;

// 加密总供应量
ve_uint256 private _totalSupply;

// 加密授权额度
mapping(address => mapping(address => ve_uint256)) private _allowances;
```

### 核心 Functions

```solidity
// 查询加密余额 (返回 handle)
function balanceOf(address account) external view returns (ve_uint256);

// 隐私转账
function transfer(address to, uve_uint256 calldata value) external payable returns (bool);

// 隐私授权
function approve(address spender, uve_uint256 calldata value) external returns (bool);

// Deposit (普通 ERC20 → 加密 ERC20)
function deposit(uint256 amount) external payable returns (bool);

// Claim (加密 ERC20 → 普通 ERC20)
function claim(address to, uint256 amount) external payable returns (bool);
```

### FHE 操作示例

```solidity
function transfer(address to, uve_uint256 calldata value) external payable {
    // 1. 验证加密数据
    ve_uint256 veValue = FHE.fromUnverified(value);
    
    // 2. 检查余额充足性（加密比较）
    // FHE 内部验证，如果不足会 revert
    
    // 3. 更新余额（FHE 加法/减法）
    _balances[msg.sender] = FHE.sub(_balances[msg.sender], veValue);
    _balances[to] = FHE.add(_balances[to], veValue);
    
    // 4. 设置访问权限
    FHE.accessPolicy(_balances[msg.sender], msg.sender);
    FHE.accessPolicy(_balances[to], to);
    
    // 5. 收取 FHE 计算费用
    FHE.chargeFee(msg.sender, msg.value);
}
```

---

## 五、SDK 设计

### API 封装

```typescript
class PrivateToken {
  // 加密金额
  async encryptAmount(amount: string): Promise<EncryptedData>;
  
  // 解密 handle
  async decryptBalance(): Promise<string>;
  
  // 隐私转账
  async transfer(to: string, amount: string): Promise<string>;
  
  // 查看加密余额 (返回 handle)
  async getBalance(): Promise<string>;
  
  // 设置解密权限
  async allowDecrypt(account: string): Promise<void>;
  
  // Deposit
  async deposit(amount: string): Promise<void>;
  
  // Claim
  async claim(to: string, amount: string): Promise<void>;
}
```

### 环境配置

```bash
# 必需环境变量
RPC_URL=<testnet-rpc>
PRIVATE_KEY=<user-private-key>
ALPHA_TRION_RPC_URL=http://<cloud-ip>:38081
DECRYPTION_RPC_URL=<cloud-ip>:38085
ACL_ADDRESS=<acl-contract-address>
TOKEN_ADDRESS=<eerc20-contract-address>
ERC20_ADDRESS=<underlying-erc20-address>
```

---

## 六、前端设计

### 页面结构

```
/
├── /                 # 首页 - 项目介绍
├── /wallet           # 钱包连接页
├── /balance          # 余额查看页
├── /transfer         # 转账页
├── /deposit          # 存款页 (ERC20 → eERC20)
├── /claim            # 提取页 (eERC20 → ERC20)
└── /permissions      # 解密权限管理页
```

### 核心组件

| 组件 | 功能 |
|------|------|
| `EncryptedBalance` | 显示加密余额，点击解密按钮显示明文 |
| `TransferForm` | 输入收款地址和金额，提交加密转账 |
| `DepositForm` | 输入金额，从 ERC20 存入 eERC20 |
| `ClaimForm` | 输入金额和地址，从 eERC20 提取 ERC20 |
| `PermissionManager` | 管理谁能查看我的加密余额 |

### 技术栈建议

| 层面 | 技术 |
|------|------|
| 框架 | Next.js / React |
| 钿包连接 | wagmi / ethers.js |
| UI | Tailwind CSS / shadcn/ui |
| 状态管理 | zustand |

---

## 七、部署流程

### 1. 部署底层 ERC20 (可选)

如果需要 deposit/claim 功能，先部署一个普通 ERC20：

```bash
cd fhe-contracts/packages/fhe-contracts
npx hardhat run scripts/deployMockERC20.ts --network sepolia
```

### 2. 部署 eERC20 合约

```bash
# 创建部署脚本
npx hardhat run scripts/deployPrivateToken.ts --network sepolia
```

合约构造参数：
- name: "Private USDC"
- symbol: "pUSDC"
- erc20_address: <underlying-erc20-address>

### 3. 配置合约地址

```bash
# 更新 .env
PRIVATE_TOKEN_ADDRESS=<deployed-address>
```

### 4. 测试验证

```bash
# 测试转账
npx tsx scripts/test-transfer.ts

# 测试解密
npx tsx scripts/test-decrypt.ts
```

---

## 八、待讨论问题

### Q1: 合约模板选择

| 选项 | 说明 |
|------|------|
| A. 直接用 PUSDCTokenV2_1 | 已有 deposit/claim，但需要 Oracle |
| B. 简化版 eERC20 | 只保留 transfer/balanceOf，更简单 |
| C. 自定义合约 | 根据需求定制 |

**建议**: 先用选项 B 快速验证，再考虑是否需要 deposit/claim

### Q2: Deposit/Claim 机制

| 机制 | 说明 |
|------|------|
| Oracle 模式 | 需要 trusted oracle 验证链下存款 |
| 直接 approve/deposit | 用户先 approve ERC20，再 deposit |

**建议**: 用直接 approve/deposit，无需 Oracle

### Q3: 前端技术栈

| 选择 | 说明 |
|------|------|
| Next.js | SSR，SEO友好 |
| Vite + React | 轻量，快速开发 |
| Vue + Vite | 如果团队熟悉 Vue |

**建议**: Next.js + Tailwind + wagmi

### Q4: 白名单机制

是否需要监管白名单？
- 需要: 合规要求
- 不需要: 纯隐私转账

**建议**: 第一版先不加，简化设计

---

## 九、下一步

1. **确认合约设计** - 选择模板或自定义
2. **编写合约代码** - eERC20.sol
3. **编写 SDK** - token.ts 封装
4. **部署测试** - Sepolia 验证
5. **前端开发** - 按页面迭代

---

## 十、文件结构

```
apps/privacy-transfer/
├── contracts/
│   └── PrivateToken.sol          # 加密 ERC20 合约
├── frontend/
│   ├── pages/                    # Next.js 页面
│   ├── components/               # React 组件
│   └── lib/                      # 前端 SDK 封装
├── sdk/
│   ├── token.ts                  # Token 操作封装
│   └── abis/                     # 合约 ABI
├── scripts/
│   ├── deploy.ts                 # 部署脚本
│   ├── test-transfer.ts          # 转账测试
│   └── test-decrypt.ts           # 解密测试
├── DESIGN.md                     # 本设计文档
├── README.md                     # 使用说明
└── .env.example                  # 环境变量模板
```

---

## 附录: FHE 系统地址 (已部署)

| 合约 | Sepolia 地址 |
|------|-------------|
| ACL | `0x620BFe43BC391611aed8b260af22e13cAF343c20` |
| FHE Executor | `0x72F6Aa6f0A89C7Dd966ab4C3F3B75a5A6b9507C9` |
| Decryption Oracle | `0x421bEB6FEAaAC0CbE0ed879D1b678BFb52FA4FB2` |

| 服务 | 地址 |
|------|------|
| AlphaTrion RPC | `http://34.84.204.187:38081` |
| Decryption gRPC | `34.84.204.187:38085` |