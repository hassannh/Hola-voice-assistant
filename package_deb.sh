#!/usr/bin/env bash
# package_deb.sh — Builds a standard Debian (.deb) package for Hola IDE
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="1.0.0"
PKG_NAME="hola-ide"
BUILD_DIR="${SCRIPT_DIR}/build/deb"
DIST_DIR="${SCRIPT_DIR}/dist"

echo "📦 Packaging Hola IDE v${VERSION} into Debian package..."

rm -rf "${BUILD_DIR}"
mkdir -p "${BUILD_DIR}/DEBIAN"
mkdir -p "${BUILD_DIR}/opt/${PKG_NAME}"
mkdir -p "${BUILD_DIR}/usr/local/bin"
mkdir -p "${BUILD_DIR}/usr/share/applications"
mkdir -p "${BUILD_DIR}/usr/share/icons/hicolor/scalable/apps"
mkdir -p "${DIST_DIR}"

# DEBIAN control file
cat > "${BUILD_DIR}/DEBIAN/control" <<EOF
Package: ${PKG_NAME}
Version: ${VERSION}
Section: devel
Priority: optional
Architecture: all
Depends: python3, python3-pip, python3-venv, git
Maintainer: Hola Team <contact@hola-ide.local>
Description: Hola IDE — AI-Powered Code Editor with Antigravity Styling
 A native desktop code editor featuring Monaco Editor, integrated bash terminal,
 git source control, ripgrep search, and context-aware AI agent with Ollama and cloud LLMs.
EOF

# Copy app files (excluding virtualenvs, caches, and git repos)
echo "📁 Copying application source..."
rsync -av --exclude='venv' --exclude='.git' --exclude='__pycache__' --exclude='build' --exclude='dist' \
  "${SCRIPT_DIR}/" "${BUILD_DIR}/opt/${PKG_NAME}/"

# Launcher wrapper
cat > "${BUILD_DIR}/usr/local/bin/${PKG_NAME}" <<'EOF'
#!/usr/bin/env bash
cd /opt/hola-ide
if [ -f "/opt/hola-ide/run.sh" ]; then
  exec /opt/hola-ide/run.sh "$@"
else
  exec python3 /opt/hola-ide/ide.py "$@"
fi
EOF
chmod +x "${BUILD_DIR}/usr/local/bin/${PKG_NAME}"

# Desktop file
cat > "${BUILD_DIR}/usr/share/applications/${PKG_NAME}.desktop" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Hola IDE
GenericName=AI Code Editor
Comment=AI-Powered Code Editor with Local Ollama & Cloud LLM support
Exec=/usr/local/bin/${PKG_NAME}
Icon=/usr/share/icons/hicolor/scalable/apps/${PKG_NAME}.svg
Terminal=false
Categories=Development;IDE;TextEditor;
Keywords=ide;editor;ai;code;python;developer;
StartupWMClass=hola-ide
StartupNotify=true
EOF

# Copy icon
cp "${SCRIPT_DIR}/voice_assistant/web/static/hola_icon.svg" "${BUILD_DIR}/usr/share/icons/hicolor/scalable/apps/${PKG_NAME}.svg"

# Build debian package
dpkg-deb --build "${BUILD_DIR}" "${DIST_DIR}/${PKG_NAME}_${VERSION}_all.deb"

echo "✨ Build complete! Generated: ${DIST_DIR}/${PKG_NAME}_${VERSION}_all.deb"
