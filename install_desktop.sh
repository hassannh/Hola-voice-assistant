#!/usr/bin/env bash
# install_desktop.sh — Install Hola IDE into Linux Desktop Application Launcher
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPS_DIR="${HOME}/.local/share/applications"
ICONS_DIR="${HOME}/.local/share/icons/hicolor/scalable/apps"

echo "🌌 Installing Hola IDE to Linux Application Menu..."

# Ensure executable permissions
chmod +x "${SCRIPT_DIR}/run.sh" "${SCRIPT_DIR}/ide.py"

# Create directories if they do not exist
mkdir -p "${APPS_DIR}" "${ICONS_DIR}"

# Copy icon
cp "${SCRIPT_DIR}/voice_assistant/web/static/hola_icon.svg" "${ICONS_DIR}/hola-ide.svg"

# Generate .desktop file with absolute paths
cat > "${APPS_DIR}/hola-ide.desktop" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Hola IDE
GenericName=AI Code Editor
Comment=AI-Powered Code Editor with Local Ollama & Cloud LLM support
Exec="${SCRIPT_DIR}/run.sh"
Icon=${ICONS_DIR}/hola-ide.svg
Terminal=false
Categories=Development;IDE;TextEditor;
Keywords=ide;editor;ai;code;python;developer;
StartupWMClass=hola-ide
StartupNotify=true
EOF

chmod +x "${APPS_DIR}/hola-ide.desktop"

# Update desktop database if tool is installed
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${APPS_DIR}" || true
fi

echo "✨ Successfully installed! You can now search and launch 'Hola IDE' from your system application menu."
