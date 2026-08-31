#!/bin/bash
# ============================================================
# Script deploy tự động cho POG App trên Mắt Bão / VPS
# Chạy lệnh này trên server sau mỗi lần push code mới:
#   bash deploy.sh
# ============================================================

set -e  # Dừng ngay nếu có lỗi

echo "🔄 [1/4] Pulling code mới từ GitHub..."
git pull github codex/vibe-host-node

echo "📦 [2/4] Cài đặt dependencies..."
npm install --production=false

echo "🔨 [3/4] Build ứng dụng..."
npm run build

echo "🚀 [4/4] Restart server..."
# Nếu dùng PM2 (khuyến nghị):
if command -v pm2 &> /dev/null; then
  pm2 restart pog || pm2 start "npm start" --name pog
  echo "✅ Server đã restart qua PM2!"
else
  echo "⚠️  PM2 chưa cài. Chạy thủ công: npm start"
  echo "   Hoặc cài PM2: npm install -g pm2"
  echo "   Rồi chạy lại: bash deploy.sh"
fi

echo ""
echo "✅ Deploy hoàn tất!"
