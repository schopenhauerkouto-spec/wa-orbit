#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/wa-orbit}"
SERVICE_USER="${SERVICE_USER:-waorbit}"
REF="${WA_ORBIT_REF:-feat/group-moderation-policy-control-center}"
ENV_DIR="/etc/wa-orbit"
ENV_FILE="${ENV_DIR}/baileys.env"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Lance ce script en root (sudo)."
  exit 1
fi

echo "==> Installation des paquets système"
apt-get update
apt-get install -y ca-certificates curl git

if ! command -v node >/dev/null 2>&1; then
  echo "==> Installation de Node.js 22 LTS"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

node --version
npm --version

if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  echo "==> Création de l'utilisateur $SERVICE_USER"
  useradd --system --create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

echo "==> Récupération de WA Orbit"
mkdir -p "$(dirname "$APP_DIR")"
if [[ ! -d "$APP_DIR/.git" ]]; then
  git clone https://github.com/schopenhauerkouto-spec/wa-orbit.git "$APP_DIR"
fi
git -C "$APP_DIR" fetch --all --prune
git -C "$APP_DIR" checkout "$REF"
git -C "$APP_DIR" reset --hard "origin/$REF"

echo "==> Installation Node"
cd "$APP_DIR"
npm install

echo "==> Configuration du connecteur"
mkdir -p "$ENV_DIR"
if [[ ! -f "$ENV_FILE" ]]; then
  read -r -p "URL du dashboard/API WA Orbit (ex. https://orbit.example.com): " ORBIT_API_URL
  read -r -s -p "BAILEYS_CONNECTOR_TOKEN (même valeur que sur WA Orbit): " BAILEYS_CONNECTOR_TOKEN
  echo
  cat > "$ENV_FILE" <<EOF
ORBIT_API_URL=$ORBIT_API_URL
BAILEYS_CONNECTOR_TOKEN=$BAILEYS_CONNECTOR_TOKEN
BAILEYS_ENABLED=true
BAILEYS_AUTH_DIR=$APP_DIR/data/baileys-auth
BAILEYS_PAIRING_NUMBER=
BAILEYS_GROUP_ENFORCEMENT=false
BAILEYS_CONTROL_POLL_MS=30000
EOF
  chmod 600 "$ENV_FILE"
else
  echo "==> $ENV_FILE existe déjà, conservation des secrets."
fi

mkdir -p "$APP_DIR/data/baileys-auth"
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR/data"
chmod 700 "$APP_DIR/data/baileys-auth"

echo "==> Test syntaxique"
npm run check

echo "==> Installation systemd"
install -m 0644 deploy/wa-orbit-baileys.service /etc/systemd/system/wa-orbit-baileys.service
systemctl daemon-reload
systemctl enable --now wa-orbit-baileys.service

echo
echo "✅ WA Orbit Baileys est installé."
echo "Logs : journalctl -u wa-orbit-baileys -f"
echo "Ensuite, ouvre le dashboard WA Orbit → Groupes & modération → Connexion WhatsApp."
echo "Le mode QR est le défaut. Le mode numéro se configure directement dans le dashboard."
