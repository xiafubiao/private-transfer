#!/bin/bash
# 部署脚本：保留服务器上的用户数据

SERVER="ubuntu@34.84.204.187"
SSH_KEY="/Users/fubiaoxia/works10/FHETransform/google-test.pem"
REMOTE_PATH="/home/ubuntu/privacy-transfer"
STANDALONE_PATH="$REMOTE_PATH/.next/standalone"

echo "=== 开始部署 ==="

# 1. 备份服务器上的用户数据
echo "[1] 备份 users.json..."
ssh -i "$SSH_KEY" "$SERVER" "
  if [ -f $STANDALONE_PATH/data/users.json ]; then
    cp $STANDALONE_PATH/data/users.json /tmp/users.json.bak
    echo '已备份到 /tmp/users.json.bak'
    cat $STANDALONE_PATH/data/users.json | head -20
  else
    echo 'users.json 不存在，跳过备份'
  fi
"

# 2. 本地打包 standalone（处理 Next.js 嵌套目录）
echo "[2] 打包 standalone..."
# Next.js 16 的 standalone 输出在嵌套目录：works10/FHETransform/apps/privacy-transfer/frontend/
STANDALONE_DIR=".next/standalone/works10/FHETransform/apps/privacy-transfer/frontend"
if [ -d "$STANDALONE_DIR" ]; then
  # 复制 static 文件到 standalone（CSS/JS 等运行时需要的文件）
  cp -r .next/static "$STANDALONE_DIR/.next/"
  # 复制 public 文件（logo、wasm 等）
  cp -r public "$STANDALONE_DIR/"
  tar czf standalone.tar.gz -C "$STANDALONE_DIR" .
else
  # 兼旧版本：standalone 直接在 .next/standalone/
  cp -r .next/static .next/standalone/.next/
  cp -r public .next/standalone/
  tar czf standalone.tar.gz -C .next/standalone .
fi
ls -lh standalone.tar.gz

# 3. 上传新版本
echo "[3] 上传 standalone.tar.gz..."
scp -i "$SSH_KEY" standalone.tar.gz "$SERVER:/tmp/"

# 4. 解压并恢复数据
echo "[4] 解压并恢复数据..."
ssh -i "$SSH_KEY" "$SERVER" "
  # 删除旧 standalone
  rm -rf $STANDALONE_PATH

  # 创建并解压
  mkdir -p $STANDALONE_PATH
  cd $STANDALONE_PATH
  tar xzf /tmp/standalone.tar.gz 2>/dev/null

  # 恢复用户数据
  mkdir -p data
  if [ -f /tmp/users.json.bak ]; then
    cp /tmp/users.json.bak data/users.json
    echo '已恢复 users.json'
  fi

  # 复制其他必要文件
  mkdir -p .next/static
  if [ -d .next/chunks ]; then
    mv .next/chunks .next/static/
  fi
  if [ -d .next/media ]; then
    mv .next/media .next/static/
  fi

  # 验证 server.js
  echo 'server.js:'
  ls -la server.js
  echo ''
  echo 'users.json:'
  cat data/users.json | head -5
"

# 5. 重启服务
echo "[5] 重启 PM2..."
ssh -i "$SSH_KEY" "$SERVER" "pm2 restart frontend && sleep 2 && pm2 list"

# 6. 验证服务
echo "[6] 验证服务..."
curl -s -o /dev/null -w "%{http_code}" http://34.84.204.187:3000/ --max-time 10
echo ""

echo "=== 部署完成 ==="