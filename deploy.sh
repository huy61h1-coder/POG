#!/bin/bash
# ============================================================
# Script deploy tự động cho POG App trên Mắt Bão / VPS
# Chạy lệnh này trên server sau mỗi lần push code mới:
#   bash deploy.sh
# ============================================================

set -e  # Dừng ngay nếu có lỗi

# Keep application state outside the Git checkout. GitHub deploys replace code,
# while this directory keeps customers, stock, orders, accounts and uploads.
if [ -z "${DATABASE_URL:-}" ] && [ -z "${DATA_DIR:-}" ]; then
  export DATA_DIR="/var/lib/pog/data"
  echo "ℹ️  DATABASE_URL chưa có; sử dụng thư mục dữ liệu bền vững: $DATA_DIR"
fi
if [ -n "${DATA_DIR:-}" ]; then
  mkdir -p "$DATA_DIR" "$DATA_DIR/master-imports"
  # Migrate an older in-checkout store only when the persistent destination is
  # still empty. Existing server data is never overwritten.
  if [ "$DATA_DIR" != "$PWD/data" ] && [ ! -f "$DATA_DIR/store.json" ] && [ -f "$PWD/data/store.json" ]; then
    cp "$PWD/data/store.json" "$DATA_DIR/store.json"
    echo "✅ Đã chuyển store.json cũ sang thư mục dữ liệu bền vững."
  fi
  if [ "$DATA_DIR" != "$PWD/data" ] && [ ! -d "$DATA_DIR/uploads" ] && [ -d "$PWD/data/uploads" ]; then
    cp -R "$PWD/data/uploads" "$DATA_DIR/uploads"
    echo "✅ Đã chuyển file upload cũ sang thư mục dữ liệu bền vững."
  fi
  mkdir -p "$DATA_DIR/uploads"
fi

echo "🔄 [1/4] Pulling code mới từ GitHub..."
git pull github codex/vibe-host-node

echo "📦 [2/4] Cài đặt dependencies..."
npm install --production=false

echo "🔨 [3/4] Build ứng dụng..."
npm run build

echo "🚀 [4/4] Restart server..."
# Nếu dùng PM2 (khuyến nghị):
if command -v pm2 &> /dev/null; then
  pm2 restart pog --update-env || pm2 start "npm start" --name pog
  echo "✅ Server đã restart qua PM2!"
else
  echo "⚠️  PM2 chưa cài. Chạy thủ công: npm start"
  echo "   Hoặc cài PM2: npm install -g pm2"
  echo "   Rồi chạy lại: bash deploy.sh"
fi

echo ""
echo "✅ Deploy hoàn tất!"
