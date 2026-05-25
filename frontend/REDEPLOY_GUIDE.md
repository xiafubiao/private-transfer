# FHE Privacy Transfer DApp - 完整系统重新部署指南

本文档记录 FHE 系统完整重新部署的流程、关键配置和经验教训。

---

## 最新部署记录 (2026-04-18)

### 新地址汇总

| 合约 | 地址 |
|------|------|
| ZKTLS | `0x30044178459Bf483261BE6810709AcE27BC419BB` |
| DecryptionOracle | `0x230052c85eE9fDD7d57036dFD993beF75c187c28` |
| ACL | `0x2A31833da5f072A39805111EF4E324e4E2839bb4` |
| FHEExecutor | `0x949868B3e4D244615e2c1e8D82F8A5d0078c64F9` |
| SpaceBridgeConfig | `0xE178074B3eF0aed40ea07635F62EDc8fB10C1fc8` |
| Decryption | `0xE775F89Dd00a9aab40e692A21be30e1d142bE8da` |
| CiphertextDigests | `0x18804837D8DeB9B1F2237d9Bba2e526220F0c991` |
| AlphatrionReward | `0xBfD02053Fb5c0c1B96cd665c299C2dD21221c2e4` |
| MockUSDC | `0x7a5E52C3d2E08DCd9d5e98c302dD39A4d85f4877` |
| eUSDC | `0xBeF3B940e1eB42C75d00f6f1dE2f6107F8D3091C` |

---

## 完整部署流程

### Phase 1: 服务器准备

```bash
# SSH 到服务器
ssh -i /Users/fubiaoxia/works10/FHETransform/google-test.pem ubuntu@34.84.204.187

# 停止并清空数据库
docker stop alphatrion
docker start alphatrion
sleep 10

# 清空数据库表（必须！否则会卡在 missing handle 死循环）
docker exec alphatrion mysql -u root -e '
TRUNCATE TABLE fhevm_db.computations;
TRUNCATE TABLE fhevm_db.ciphertexts_upload;
TRUNCATE TABLE fhevm_db.plaintexts;
TRUNCATE TABLE fhevm_db.allowed_handles;
TRUNCATE TABLE fhevm_db.missing_handles_upload;
TRUNCATE TABLE fhevm_db.missing_handles_compute;
'

# 验证清空成功
docker exec alphatrion mysql -u fhevm_user -p123456 fhevm_db -e '
SELECT COUNT(*) as computations FROM computations;
SELECT COUNT(*) as plaintexts FROM plaintexts;
'
# 应该都是 0
```

**关键点**：
- **必须先清空数据库再部署新合约**，否则 AlphaTrion 会卡在 "missing handle" 死循环
- computations 表存储 FHE 操作记录，plaintexts 表存储解密结果

---

### Phase 2: 系统合约部署

```bash
cd /Users/fubiaoxia/works10/FHETransform/fhe-contracts/packages/fhe-contracts

# 部署核心合约（ZKTLS, DecryptionOracle, ACL, FHEExecutor）
npx hardhat run scripts/deploy-full-system.ts --network pharos
```

部署顺序：
1. **PrimusZKTLS** - 可升级代理
2. **DecryptionOracle** - 可升级代理
3. **ACL** - 可升级代理
4. **FHEExecutor** - 可升级代理
5. 配置链接：ACL.setFheExecutorAddress(FHEExecutor地址)
6. 设置 chain keys（包含 688689）
7. 设置 op base prices

---

### Phase 3: SpaceBridge 合约部署

```bash
cd /Users/fubiaoxia/works10/FHETransform/fhe-contracts/packages/spacebridge-contracts

# 使用新 FHEExecutor 地址部署
FHE_EXECUTOR_ADDRESS=<新FHEExecutor地址> \
npx hardhat run scripts/deploy-spacebridge.ts --network pharos
```

部署顺序：
1. **SpaceBridgeConfig** - alphatrions 配置 + threshold
2. **Decryption** - 解密服务合约
3. **CiphertextVerification** - 密文验证
4. **MockERC20** - 测试支付代币
5. **Payment** - 支付合约
6. **CiphertextDigests** - 密文摘要存储
7. **AlphatrionReward** - AlphaTrion 奖励合约
8. 配置 Payment

---

### Phase 4: SpaceBridge 配置（最关键！）

```bash
cd /Users/fubiaoxia/works10/FHETransform/fhe-contracts/packages/fhe-contracts

# 更新 configure-spacebridge.ts 中的地址
# FHEExecutor 地址 = 新部署的 FHEExecutor
# spaceBridge 地址 = AlphatrionReward 地址（不是 SpaceBridgeConfig！）

npx hardhat run scripts/configure-spacebridge.ts --network pharos
```

**错误案例**：
- 设置 spaceBridge = SpaceBridgeConfig 地址
- AlphaTrion 用私钥签名交易，发送者是 Bob 地址
- FHEExecutor.onlySpaceBridge 检查失败 → `NotSpaceBridge()` 错误
- 错误码 `0x3efcde0f`

**正确配置**：
```
FHEExecutor.spaceBridge = AlphatrionReward 地址
```

---

### Phase 5: 应用合约部署

```bash
cd /Users/fubiaoxia/works10/FHETransform/fhe-contracts/packages/fhe-contracts

# 1. 更新 PrimusConfig.sol 中的地址（chainId 688689）
# 2. 编译合约
npx hardhat compile

# 3. 部署 MockUSDC 和 eUSDC
npx hardhat run scripts/deploy-eusdc-pharos.ts --network pharos

# 4. 配置 eUSDC（添加 oracle whitelist，mint USDC）
npx hardhat run scripts/configure-eusdc.ts --network pharos
```

---

### Phase 6: 配置文件同步

需要同步的文件（共 6 个）：

#### 1. PrimusConfig.sol
```
路径: fhe-contracts/packages/fhe-contracts/contracts/config/PrimusConfig.sol
内容: chainId 688689 的 ACL/FHEExecutor/DecryptionOracle/Decryption 地址
注意: 更新后必须重新编译合约
```

#### 2. fhe-sdk config.ts
```
路径: fhe-contracts/packages/fhe-sdk/src/config.ts
内容: 同上
注意: 更新后必须运行 npm run build
```

#### 3. 前端 contracts.ts
```
路径: apps/privacy-transfer/frontend/src/lib/contracts.ts
内容: 所有合约地址（特别是 MockUSDC 和 eUSDC）
```

#### 4. 前端 fhe-config.ts
```
路径: apps/privacy-transfer/frontend/src/lib/fhe-config.ts
内容: 所有 FHE 相关地址
```

#### 5. AlphaTrion 测试配置
```
路径: AlphaTrion/scripts/tests/.env.pharos
内容: FHE_EXECUTOR_ADDRESS
```

#### 6. 服务器 AlphaTrion 配置
```bash
ssh ubuntu@34.84.204.187

# 更新配置文件
cat > /opt/alphatrion/config/.env << 'EOF'
CLIENT_SECRET_KEY="sk.bin"
SERVER_EVAL_KEY="eval.bin"
SERVER_PUBLIC_KEY="pk.bin"
SERVER_ANNIHILATE_KEY="anni.bin"
SERVER_PUBLIC_KEY_V2="pk_v2.bin"

REQUEST_TIMEOUT=30000

DATABASE_URL="mysql://fhevm_user:123456@127.0.0.1:3306/fhevm_db"
BACKUP_DATABASE_URL=""
FHEVM_ADDRESS="0.0.0.0:38081"
PROVIDER_URL=https://atlantic.dplabs-internal.com

DECRYPTION_URL=http://fhe-decryption-service:38085

PRIVATE_KEY=0x20ca71d010ea08d227302a59207bc2d88c59a257e83eebc38ec6fee2b72530f8
FHE_EXECUTOR_ADDRESS=<新地址>
ACL_ADDRESS=<新地址>
DECRYPTION_ORACLE_ADDRESS=<新地址>
SPACE_BRIDGE_CONFIG_ADDRESS=<新地址>
DECRYPTION_ADDRESS=<新地址>
CIPHERTEXT_DIGESTS_ADDRESS=<新地址>
ALPHATRION_REWARD_ADDRESS=<新地址>
EOF
```

---

### Phase 7: 服务重启

```bash
ssh ubuntu@34.84.204.187

# 重启服务
docker restart alphatrion
docker restart fhe-decryption-service

# 等待启动
sleep 10

# 验证配置
docker logs alphatrion --tail 20 | grep 'env settings'

# 验证数据库
docker exec alphatrion mysql -u fhevm_user -p123456 fhevm_db -e '
SELECT COUNT(*) FROM computations;
SELECT COUNT(*) FROM plaintexts;
'
```

---

### Phase 8: 验证测试

```bash
cd /Users/fubiaoxia/works10/FHETransform/fhe-contracts/packages/fhe-contracts

# 更新测试脚本地址
# 编辑 scripts/test-fhe-real.ts

# 运行测试（真实 WASM 加密，禁止 trivialEncrypt）
npx hardhat run scripts/test-fhe-real.ts --network pharos
```

**测试结果检查**：
```bash
ssh ubuntu@34.84.204.187

# 检查 computations
docker exec alphatrion mysql -u fhevm_user -p123456 fhevm_db -e '
SELECT block_number, output_handle, fhe_operation, is_computed 
FROM computations ORDER BY block_number DESC LIMIT 10;
'

# is_computed = 1 表示 AlphaTrion 正常处理
# ciphertexts_upload 表应该有密文（~32KB）
```

---

## 常见问题排查

### 1. AlphaTrion 卡在 "missing handle" 死循环

**症状**：
- 日志反复出现 `missing handle 0x...`
- computations 表有记录，plaintexts 表为空
- is_computed = 0

**原因**：
- 数据库有旧 computations，但对应密文已删除
- 部署新合约后，handle 地址不匹配

**解决**：
```bash
# 清空数据库表
docker exec alphatrion mysql -u root -e '
TRUNCATE TABLE fhevm_db.computations;
TRUNCATE TABLE fhevm_db.ciphertexts_upload;
TRUNCATE TABLE fhevm_db.plaintexts;
TRUNCATE TABLE fhevm_db.allowed_handles;
TRUNCATE TABLE fhevm_db.missing_handles_upload;
TRUNCATE TABLE fhevm_db.missing_handles_compute;
'
```

---

### 2. Transfer 报错 "NotSpaceBridge" (0x3efcde0f)

**原因**：
- FHEExecutor.spaceBridge 设置为 SpaceBridgeConfig 地址
- AlphaTrion 用私钥签名交易，发送者不是 SpaceBridge

**解决**：
```
FHEExecutor.setSpaceBridge(AlphatrionReward地址)
```

---

### 3. Deposit 报错 "Unsupported chain key"

**原因**：
- FHEExecutor 未配置 chainId 688689 → chainKey 8 映射

**解决**：
```bash
npx hardhat run scripts/configure-chain-keys.ts --network pharos
# 如果显示 AlreadyExistChainKey，说明已配置
```

---

### 4. Withdraw (Claim) 失败

**症状**：
- Claim transaction reverted
- plaintexts 表为空

**原因**（待进一步调查）：
- plaintext 解密流程未触发
- 可能需要手动请求解密

---

### 5. 配置文件不一致

**症状**：
- 合约调用错误的地址
- ACL 权限检查失败

**必须同步的文件**：
1. PrimusConfig.sol
2. fhe-sdk/src/config.ts
3. frontend/src/lib/contracts.ts
4. frontend/src/lib/fhe-config.ts
5. AlphaTrion/scripts/tests/.env.pharos
6. 服务器 /opt/alphatrion/config/.env

---

## 关键经验教训

### 1. 部署顺序很重要

正确顺序：
1. 清空 AlphaTrion 数据库
2. 部署系统合约（deploy-full-system.ts）
3. 部署 SpaceBridge 合约
4. 配置 SpaceBridge（setSpaceBridge）
5. 更新 PrimusConfig.sol 并编译
6. 部署应用合约
7. 同步所有配置文件
8. 重启服务
9. 测试验证

错误顺序会导致：
- 配置不一致
- missing handle 死循环
- 权限检查失败

### 2. 禁止使用 trivialEncrypt

trivialEncrypt 是 mock 操作，不是真实 FHE 加密：
- 只生成 handle，没有真实密文
- 会导致 ciphertexts_upload 表没有数据
- plaintext 无法正确计算

**正确做法**：
- 使用 fhe-sdk encryptor.u256() 进行 WASM 加密
- 移除所有 trivialEncrypt fallback 代码

### 3. MockUSDC decimals = 6

USDC 标准是 6 位小数，不是 18 位：
```javascript
const amount = ethers.parseUnits("100", 6); // 100 USDC
```

### 4. 测试脚本地址必须同步

每次部署后必须更新：
- scripts/test-fhe-real.ts
- scripts/configure-spacebridge.ts
- scripts/configure-eusdc.ts

---

## 快速诊断脚本

```bash
ssh -i /Users/fubiaoxia/works10/FHETransform/google-test.pem ubuntu@34.84.204.187 << 'EOF'
echo "=== Docker Status ==="
docker ps --format '{{.Names}}: {{.Status}}'

echo ""
echo "=== AlphaTrion Config ==="
docker logs alphatrion --tail 30 | grep 'env settings' | head -1 | jq .

echo ""
echo "=== Database Status ==="
docker exec alphatrion mysql -u fhevm_user -p123456 fhevm_db -e '
SELECT COUNT(*) as computations FROM computations;
SELECT COUNT(*) as plaintexts FROM plaintexts;
SELECT COUNT(*) as ciphertexts FROM ciphertexts_upload;
SELECT block_number, output_handle, is_computed FROM computations ORDER BY block_number DESC LIMIT 5;
' 2>/dev/null

echo ""
echo "=== Recent Errors ==="
docker logs alphatrion --tail 100 2>&1 | grep -E 'missing|error|Error|panic' | tail -10
EOF
```

---

## 网络配置

| 参数 | 值 |
|------|-----|
| Chain ID | `688689` (Pharos Atlantic) |
| Chain Key | `8` |
| RPC URL | `https://atlantic.dplabs-internal.com` |
| AlphaTrion RPC | `http://34.84.204.187:38081` |
| Decryption RPC | `34.84.204.187:38085` |
| Block Range Limit | 1000 blocks |

---

## 测试账户

| 账户 | 地址 | 私钥 |
|------|------|------|
| Bob | `0x6Dc43F7E4B0bDe827BC852Ae364aeF964e7D92cC` | `0x20ca71d...` |
| Alice | `0xA70288A0560E7201aF1507Aef43f009A89e2De06` | - |
| Cindy | `0x9a0717dDCA93d9c9eAdd3D4b88c444c62b947F32` | - |

---

## 相关文档

- [AGENTS.md](./AGENTS.md) - 项目开发指南
- [DESIGN.md](./DESIGN.md) - 系统设计文档
- [README.md](./README.md) - 项目概述