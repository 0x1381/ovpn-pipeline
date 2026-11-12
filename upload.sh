#!/usr/bin/env bash
# upload.sh — آپلود تمیز پروژه روی GitHub
# استفاده:  bash upload.sh
# پیش‌فرض: داخل ~/Desktop/ovpn-pipeline اجرا کن

set -euo pipefail

# ---------- تنظیمات ----------
GITHUB_USER="0x1381"
REPO_NAME="ovpn-pipeline"
REMOTE_URL="https://github.com/${GITHUB_USER}/${REPO_NAME}.git"
BRANCH="main"

# رنگ‌ها
G='\033[92m'; R='\033[91m'; Y='\033[93m'; C='\033[96m'; D='\033[2m'; N='\033[0m'
ok()   { echo -e "${G}[OK]${N} $*"; }
warn() { echo -e "${Y}[WARN]${N} $*"; }
info() { echo -e "${C}[INFO]${N} $*"; }
die()  { echo -e "${R}[FATAL]${N} $*" >&2; exit 1; }

# ---------- ۰) چک پیش‌نیازها ----------
info "checking prerequisites..."

command -v git >/dev/null || die "git not found"
ok "git: $(git --version)"

if ! command -v gh >/dev/null; then
  die "gh not found. Install GitHub CLI first (https://cli.github.com/)"
fi

GH_VER=$(gh --version | head -1)
if ! echo "$GH_VER" | grep -qE 'gh version 2\.'; then
  die "wrong 'gh' binary ($GH_VER). Need GitHub CLI 2.x, not the 0.0.4 browser tool."
fi
ok "$GH_VER"

if ! gh auth status >/dev/null 2>&1; then
  die "not logged in to gh. Run: gh auth login  (choose 'Paste an authentication token')"
fi
ok "gh authenticated as: $(gh api user --jq .login)"

# ---------- ۱) چک داخل پوشه‌ی پروژه ----------
[ -f package.json ] || die "package.json not found. Run this from the project root."
[ -d src ]          || die "src/ not found."
[ -f .gitignore ]   || die ".gitignore not found."
ok "project structure looks good ($(pwd))"

# ---------- ۲) پاک‌سازی کش و خروجی‌های موقت ----------
info "cleaning cache and temp artifacts..."

# اگه git وجود داره، اول هر چی stage شده رو unstage کن
if [ -d .git ]; then
  git reset >/dev/null 2>&1 || true
fi

# حذف کش و خروجی‌های تست محلی
rm -rf .cache/ configs/ json/ node_modules/ 2>/dev/null || true

# حذف فایل‌های موقت
find . -maxdepth 2 -type f \( -name '*.log' -o -name '*.part' -o -name '*.tmp' \) -delete 2>/dev/null || true

# حذف README قدیمی (بازسازی می‌شه)
rm -f README.md

ok "cache and temp files removed"

# ---------- ۳) ساخت README اولیه ----------
info "creating initial README..."
cat > README.md <<'EOF'
# OpenVPN Configs (auto-generated)

Auto-refreshed by GitHub Actions. **Only reachable servers are listed.**

This README will be regenerated after the first successful pipeline run.
EOF
ok "README.md created"

# ---------- ۴) git init + branch ----------
info "initializing git..."

if [ ! -d .git ]; then
  git init -q
  ok "git repository initialized"
else
  info "git repository already exists"
fi

git branch -M "$BRANCH" 2>/dev/null || true
ok "branch: $BRANCH"

# ---------- ۵) هویت git ----------
# اگه قبلاً ست نشده، از gh می‌گیریم
if ! git config user.name >/dev/null 2>&1; then
  GH_NAME=$(gh api user --jq .name 2>/dev/null || gh api user --jq .login)
  git config user.name "$GH_NAME"
  ok "user.name set to: $GH_NAME"
fi

if ! git config user.email >/dev/null 2>&1; then
  GH_EMAIL=$(gh api user --jq '.email // empty' 2>/dev/null || true)
  if [ -z "$GH_EMAIL" ]; then
    GH_EMAIL="${GITHUB_USER}@users.noreply.github.com"
  fi
  git config user.email "$GH_EMAIL"
  ok "user.email set to: $GH_EMAIL"
fi

# ---------- ۶) credential helper ----------
info "configuring git credential helper..."

gh auth setup-git 2>/dev/null || true
HELPER=$(git config --global credential.helper || true)
if [ -z "$HELPER" ]; then
  GH_PATH=$(command -v gh)
  git config --global credential.helper "!${GH_PATH} auth git-credential"
  warn "credential.helper was empty; set manually to: !${GH_PATH} auth git-credential"
else
  ok "credential.helper: $HELPER"
fi

# پاک‌سازی credential قدیمی
rm -f ~/.git-credentials 2>/dev/null || true

# ---------- ۷) remote ----------
info "configuring remote..."

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE_URL"
  ok "remote 'origin' updated"
else
  git remote add origin "$REMOTE_URL"
  ok "remote 'origin' added"
fi
echo -e "${D}    $(git remote get-url origin)${N}"

# ---------- ۸) stage + commit ----------
info "staging files..."

git add -A

# چک: cache و node_modules نباید stage شده باشن
if git diff --cached --name-only | grep -qE '^(\.cache|node_modules)/'; then
  die ".cache/ or node_modules/ is staged. Check .gitignore."
fi

STAGED=$(git diff --cached --name-only | wc -l)
ok "$STAGED file(s) staged"

if [ "$STAGED" -eq 0 ]; then
  die "nothing to commit. Is this the right directory?"
fi

# اگه commit قبلی هست، تاریخچه رو reset کن (commit تمیز)
if git rev-parse HEAD >/dev/null 2>&1; then
  warn "existing commits found; creating a fresh initial commit"
  git update-ref -d HEAD || true
fi

git commit -q -m "initial: ovpn pipeline"
ok "commit created: $(git log --oneline -1)"

# ---------- ۹) چک مخزن روی GitHub ----------
info "checking remote repository..."

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: token $(gh auth token)" \
  "https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}")

if [ "$HTTP_CODE" = "404" ]; then
  warn "repository ${GITHUB_USER}/${REPO_NAME} not found on GitHub"
  info "creating it now..."
  gh repo create "${GITHUB_USER}/${REPO_NAME}" --public --description "Auto-refreshed OpenVPN configs" || \
    die "failed to create repo"
  ok "repository created"
elif [ "$HTTP_CODE" = "200" ]; then
  ok "repository exists on GitHub"
else
  die "unexpected GitHub API status: $HTTP_CODE"
fi

# ---------- ۱۰) push ----------
info "pushing to origin/$BRANCH..."

if git push -u origin "$BRANCH" 2>&1 | tee /tmp/push.log; then
  ok "push succeeded"
else
  echo
  die "push failed. See /tmp/push.log"
fi

# ---------- ۱۱) فعال‌سازی Actions write permission ----------
info "enabling GitHub Actions write permission..."

gh api -X PUT "repos/${GITHUB_USER}/${REPO_NAME}/actions/permissions/workflow" \
  -f default_workflow_permissions=write >/dev/null 2>&1 && \
  ok "Actions: default_workflow_permissions=write" || \
  warn "could not set Actions permissions (do it manually: Settings → Actions → General → Read and write)"

# ---------- ۱۲) اجرای دستی workflow ----------
info "triggering first workflow run..."

if gh workflow list --repo "${GITHUB_USER}/${REPO_NAME}" 2>/dev/null | grep -q refresh-ovpn; then
  gh workflow run refresh-ovpn --repo "${GITHUB_USER}/${REPO_NAME}" && \
    ok "workflow 'refresh-ovpn' triggered" || \
    warn "failed to trigger workflow (run it manually from Actions tab)"
  sleep 3
  gh run list --repo "${GITHUB_USER}/${REPO_NAME}" --workflow=refresh-ovpn -L 1 || true
else
  warn "workflow 'refresh-ovpn' not found on remote (may need a few seconds to register)"
  info "after 30s, run: gh workflow run refresh-ovpn"
fi

# ---------- خلاصه ----------
echo
echo -e "${G}========================================${N}"
echo -e "${G}  DONE${N}"
echo -e "${G}========================================${N}"
echo
echo "  Repo:     https://github.com/${GITHUB_USER}/${REPO_NAME}"
echo "  Actions:  https://github.com/${GITHUB_USER}/${REPO_NAME}/actions"
echo
echo "  Next:"
echo "    1. Wait ~2-3 min for the first pipeline run"
echo "    2. git pull origin main"
echo "    3. ls configs/ | wc -l   # should be 150"
echo
echo "  If push failed, check:"
echo "    - Fine-grained PAT has 'Contents: Read and write'"
echo "    - Fine-grained PAT has 'Workflows: Read and write'"
echo "    - Repo access: 'Only select repositories' → ${GITHUB_USER}/${REPO_NAME}"
echo
