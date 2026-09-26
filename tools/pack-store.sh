#!/usr/bin/env bash
# 读伴（ReadMate）上架包打包 —— 2026-09-26 定稿规则
#
# 规则（梁老师拍板，别再犯）：
#   1. 包名锁死：readmate-reader-m1-store.zip，以后每次覆盖同名文件，不换名。
#   2. manifest.version 不动，直到梁老师说「定稿 / 发布 / 提审」才由人手动升。
#   3. 打包前先跑一遍自测；打包后再对「包里的内容」跑一遍冒烟测试（pack-smoke-test.js）。
#
# 用法：bash tools/pack-store.sh
set -euo pipefail

SRC=/root/projects/readmate-ext
E2E=/root/projects/readmate-e2e-tests
NAME=readmate-reader-m1-store.zip
STAGE=/tmp/rmpack-store
WEB=/usr/share/nginx/html

cd "$SRC"

VERSION=$(node -e "console.log(require('./manifest.json').version)")
echo "▶ 打包版本：$VERSION"

# 运行期必需文件（多列一个都不能少 —— 缺一个扩展就白屏）
RUNTIME=(
  manifest.json
  background.js
  content.js content.css content-extractor.js
  number-normalizer.js reading-stats.js text-utils.js test-utils.js
  reader.html
  reader/reader.js reader/reader.css reader/importer.js
  reader/zip-reader.js reader/epub.js reader/pdf-book.js
  popup/popup.html popup/popup.css popup/popup.js
  options/options.html options/options.js options/options.css
  icons/icon16.png icons/icon48.png icons/icon128.png icons/receivecode.jpg
  _locales/de/messages.json _locales/en/messages.json _locales/es/messages.json
  _locales/fr/messages.json _locales/ja/messages.json _locales/ko/messages.json
  _locales/ru/messages.json _locales/zh_CN/messages.json
)
DOCS=(
  CHROME-STORE-SUBMISSION.md DEVELOPMENT-PROGRESS.md DEV-I18N-SPEC.md
  DEV-NOTES.md DEV-V2-SPEC.md PRIVACY-POLICY.md
  tools/add-reader-i18n.py tools/i18n-check.js
)

rm -rf "$STAGE"; mkdir -p "$STAGE"

missing=0
for f in "${RUNTIME[@]}" "${DOCS[@]}"; do
  if [ ! -f "$f" ]; then echo "  ✗ 缺文件：$f"; missing=1; fi
done
[ "$missing" = 1 ] && { echo "打包中止：有文件缺失"; exit 1; }

for f in "${RUNTIME[@]}" "${DOCS[@]}"; do
  mkdir -p "$STAGE/$(dirname "$f")"; cp "$f" "$STAGE/$f"
done

# 内置 pdf.js（含 cmaps 与标准字体：中文 PDF 靠它才不掉字）
mkdir -p "$STAGE/vendor/pdfjs"
cp -r vendor/pdfjs/. "$STAGE/vendor/pdfjs/"

# 打包：zip 内不带顶层目录，且 manifest.json 必须在根
( cd "$STAGE" && zip -qr9 "$STAGE/$NAME" . -x '.*' )

cp "$STAGE/$NAME" "$WEB/$NAME"
echo "▶ 已生成：$WEB/$NAME"
ls -l "$WEB/$NAME" | awk '{print "   大小：" $5 " 字节"}'
md5sum "$WEB/$NAME" "$STAGE/$NAME"
echo "▶ 包内条目数：$(unzip -l "$STAGE/$NAME" | tail -1 | awk '{print $2}')"

# 打包物冒烟测试：直接用「解出来的包」跑一遍真导入，确保包是自洽的
echo "▶ 包内容冒烟测试（EXT_DIR=$STAGE）"
cd "$E2E" && EXT_DIR="$STAGE" node pack-smoke-test.js
