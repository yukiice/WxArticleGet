#!/bin/bash
# API 层并发压力与边界测试（真实 HTTP，默认打本地容器 http://localhost:3001）
# 用法：bash tests/api-stress.sh [BASE_URL]
# 兼容 macOS 自带 bash 3.2：不用 declare -A、不用 mapfile。

BASE="${1:-http://localhost:3001}"
COOKIE=/tmp/wx-cookie.txt
PASS=0
FAIL=0
rm -f $COOKIE

# 从仓库 .env 读管理员口令，避免把口令写进命令行参数（会进 shell history / ps）
if [ -z "$ADMIN_PASSWORD" ] && [ -f .env ]; then
  ADMIN_PASSWORD=$(grep -E '^ADMIN_PASSWORD=' .env | head -1 | cut -d= -f2-)
fi
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"

check() {
  local desc="$1" expected="$2" code="$3"
  if [ "$code" = "$expected" ]; then
    echo "  ✓ $desc"
    PASS=$((PASS+1))
  else
    echo "  ✗ $desc: 期望 $expected，实际 $code"
    FAIL=$((FAIL+1))
  fi
}

echo "== 0. 健康检查 =="
check "health 无需登录" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health")"

echo "== 1. 登录拿 cookie =="
LOGIN_CODE=$(curl -s -o /dev/null -w '%{http_code}' -c $COOKIE -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$ADMIN_USERNAME\",\"password\":\"$ADMIN_PASSWORD\"}")
case "$LOGIN_CODE" in
  200|201) echo "  ✓ 登录成功（$LOGIN_CODE）"; PASS=$((PASS+1)) ;;
  *) echo "  ! 登录失败（$LOGIN_CODE）：后续需登录用例会按 401 判定，请检查 .env 的 ADMIN_PASSWORD"; FAIL=$((FAIL+1)) ;;
esac

echo "== 2. 并发读（50 列表 / 30 统计 / 20 详情）=="
START=$(date +%s)
for i in $(seq 1 50); do
  curl -s -o /dev/null -b $COOKIE -w '%{http_code}\n' "$BASE/api/articles?page=1&pageSize=20" &
done | sort | uniq -c | sed 's/^/  列表: /'
wait
echo "  50 个列表请求耗时 $(( $(date +%s) - START ))s"
for i in $(seq 1 30); do
  curl -s -o /dev/null -b $COOKIE -w '%{http_code}\n' "$BASE/api/stats/overview" &
done | sort | uniq -c | sed 's/^/  统计: /'
wait

# 用 python 解析 JSON 取文章 id：sed 的正则会贪婪匹配到 account.id 等字段，不可靠
ID=$(curl -s -b $COOKIE "$BASE/api/articles?page=1&pageSize=1" | python3 -c "
import json, sys
data = json.load(sys.stdin).get('data') or {}
items = data.get('items') or []
print(items[0]['id'] if items else '')
" 2>/dev/null)
if [ -n "$ID" ]; then
  for i in $(seq 1 20); do
    curl -s -o /dev/null -b $COOKIE -w '%{http_code}\n' "$BASE/api/articles/$ID" &
  done | sort | uniq -c | sed 's/^/  详情: /'
  wait
else
  echo "  (跳过详情：库内无文章)"
fi

echo "== 3. 并发写（20 次并发标记已读同一文章）=="
if [ -n "$ID" ]; then
  for i in $(seq 1 20); do
    curl -s -o /dev/null -b $COOKIE -X PATCH "$BASE/api/articles/$ID" \
      -H 'Content-Type: application/json' -d '{"isRead":true}' -w '%{http_code}\n' &
  done | sort | uniq -c | sed 's/^/  已读: /'
  wait
else
  echo "  (跳过：库内无文章)"
fi

echo "== 4. 边界与非法输入（不含登录：登录失败会计入限流，放第 5 节）=="
LONG=$(python3 -c 'print("a"*10000)')
check "不存在的文章"        404 "$(curl -s -o /dev/null -w '%{http_code}' -b $COOKIE "$BASE/api/articles/not-exist")"
check "超长 q 参数"         200 "$(curl -s -o /dev/null -w '%{http_code}' -b $COOKIE "$BASE/api/articles?q=$LONG")"
check "负 page"             400 "$(curl -s -o /dev/null -w '%{http_code}' -b $COOKIE "$BASE/api/articles?page=-1")"
check "pageSize 超大"       400 "$(curl -s -o /dev/null -w '%{http_code}' -b $COOKIE "$BASE/api/articles?pageSize=100000")"
check "未登录访问设置"      401 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/settings")"
check "files 路径穿越"      404 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/files/../../../etc/passwd")"
check "files 非图片扩展名"  404 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/files/images/a/aaaaaaaaaaaaaaaaaaaaaaaa.html")"
check "合法图片路径带 CSP"  404 "$(curl -s -D /tmp/wx-hdr.txt -o /dev/null -w '%{http_code}' "$BASE/files/images/abc/0123456789abcdef01234567.png")"
if grep -qi 'content-security-policy' /tmp/wx-hdr.txt 2>/dev/null; then
  echo "  ✓ 图片响应带 CSP 头"; PASS=$((PASS+1))
else
  echo "  ✗ 图片响应缺少 CSP 头"; FAIL=$((FAIL+1))
fi

echo "== 5. 登录相关（放最后：失败会计入限流，会锁 IP 5 分钟）=="
check "空 body 登录"        400 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{}')"
check "注入样式用户名"      401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"username":"admin OR 1=1 --","password":"x"}')"
check "错误密码不泄密"      "0" "$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"username":"admin","password":"definitely-wrong"}' | grep -c -i -E 'password|hash|scrypt|salt' || true)"
LIMITED=0
for i in $(seq 1 12); do
  curl -s -o /dev/null -X POST "$BASE/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"admin\",\"password\":\"wrong-$i\"}" &
done
wait
for i in 1 2 3; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d '{"username":"admin","password":"wrong-after-lock"}')
  [ "$CODE" = "429" ] && LIMITED=$((LIMITED+1))
done
check "锁定后拒绝继续尝试（429）" "yes" "$([ "$LIMITED" -ge 1 ] && echo yes || echo no)"

echo ""
echo "== 结果：通过 $PASS / $((PASS+FAIL)) =="
[ "$FAIL" -gt 0 ] && echo "失败 $FAIL 项"
exit $([ "$FAIL" -gt 0 ] && echo 1 || echo 0)
