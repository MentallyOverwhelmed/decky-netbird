#!/bin/bash

set -euo pipefail

BIN_DIR="/usr/local/bin"
SERVICE_PATH="/etc/systemd/system/netbird.service"
CONFIG_DIRS=("/etc/netbird" "/var/lib/netbird" "/var/log/netbird")

install_netbird() {
    echo "Resolving latest stable NetBird release version..."
    LATEST_VERSION=$(curl -s https://api.github.com/repos/netbirdio/netbird/releases/latest | grep '"tag_name":' | sed -E 's/.*"v([^"]+)".*/\1/')

    if [ -z "$LATEST_VERSION" ]; then
        echo "Error: Failed to resolve the latest NetBird version tag." >&2
        exit 1
    fi

    echo "Latest version identified: v$LATEST_VERSION"

    URL_NETBIRD="https://github.com/netbirdio/netbird/releases/download/v${LATEST_VERSION}/netbird_${LATEST_VERSION}_linux_amd64.tar.gz"
    TEMP_DIR=$(mktemp -d)

    echo "Downloading archive payload..."
    if ! curl -L "$URL_NETBIRD" -o "$TEMP_DIR/netbird.tar.gz"; then
        echo "Error: Failed to download the asset binary from source remote upstream." >&2
        rm -rf "$TEMP_DIR"
        exit 1
    fi

    echo "Extracting binary to destination runtime environment..."
    tar -xzf "$TEMP_DIR/netbird.tar.gz" -C "$TEMP_DIR"
    sudo mv "$TEMP_DIR/netbird" "$BIN_DIR/netbird"
    sudo chmod +x "$BIN_DIR/netbird"

    rm -rf "$TEMP_DIR"

    echo "Preparing environment directories for immutable host..."
    sudo mkdir -p /etc/netbird /var/lib/netbird /var/log/netbird

    if command -v restorecon &> /dev/null; then
        echo "Fixing SELinux security contexts..."
        sudo restorecon -v "$BIN_DIR/netbird" || sudo chcon -t bin_t "$BIN_DIR/netbird"
    fi

    echo "Generating host systemd service profile..."
    sudo bash -c "cat << 'EOF' > $SERVICE_PATH
[Unit]
Description=NetBird Client Daemon
After=network.target
Documentation=https://netbird.io/docs

[Service]
ExecStart=$BIN_DIR/netbird service run
UMask=0002
Restart=always
RestartSec=5
User=root
Environment=HOME=/root

[Install]
WantedBy=multi-user.target
EOF"

    echo "Reindexing configuration layer and initializing NetBird background daemon..."
    sudo systemctl daemon-reload
    sudo systemctl enable --now netbird

    sleep 2

    echo "Deployment finalized successfully."
    echo "Binary path: $BIN_DIR/netbird"
    echo "Service state: $(systemctl is-active netbird)"
}

uninstall_netbird() {
    echo "Stopping and disabling NetBird service..."
    sudo systemctl stop netbird 2>/dev/null || true
    sudo systemctl disable netbird 2>/dev/null || true

    if [ -f "$SERVICE_PATH" ]; then
        echo "Removing systemd service file..."
        sudo rm -f "$SERVICE_PATH"
        sudo systemctl daemon-reload
    fi

    if [ -f "$BIN_DIR/netbird" ]; then
        echo "Removing NetBird binary..."
        sudo rm -f "$BIN_DIR/netbird"
    fi

    echo "Clean up configuration and data directories? (y/N): "
    read -r cleanup
    if [[ "$cleanup" =~ ^[Yy]$ ]]; then
        for dir in "${CONFIG_DIRS[@]}"; do
            if [ -d "$dir" ]; then
                echo "Removing $dir..."
                sudo rm -rf "$dir"
            fi
        done
    fi

    echo "NetBird has been uninstalled."
}

update_netbird() {
    echo "Resolving latest stable NetBird release version..."
    LATEST_VERSION=$(curl -s https://api.github.com/repos/netbirdio/netbird/releases/latest | grep '"tag_name":' | sed -E 's/.*"v([^"]+)".*/\1/')

    if [ -z "$LATEST_VERSION" ]; then
        echo "Error: Failed to resolve the latest NetBird version tag." >&2
        exit 1
    fi

    echo "Latest version identified: v$LATEST_VERSION"

    URL_NETBIRD="https://github.com/netbirdio/netbird/releases/download/v${LATEST_VERSION}/netbird_${LATEST_VERSION}_linux_amd64.tar.gz"
    TEMP_DIR=$(mktemp -d)

    echo "Downloading..."
    if ! curl -L "$URL_NETBIRD" -o "$TEMP_DIR/netbird.tar.gz"; then
        echo "Error: Failed to download." >&2
        rm -rf "$TEMP_DIR"
        exit 1
    fi

    tar -xzf "$TEMP_DIR/netbird.tar.gz" -C "$TEMP_DIR"
    sudo mv "$TEMP_DIR/netbird" "$BIN_DIR/netbird"
    sudo chmod +x "$BIN_DIR/netbird"
    rm -rf "$TEMP_DIR"

    sudo systemctl restart netbird 2>/dev/null || sudo systemctl start netbird 2>/dev/null || true
    sleep 2
    echo "NetBird updated to v$LATEST_VERSION. Service: $(systemctl is-active netbird 2>/dev/null || echo 'not started')"
}

show_menu() {
    echo ""
    echo "=== NetBird Manager ==="
    echo "1) Install NetBird"
    echo "2) Update NetBird"
    echo "3) Uninstall NetBird"
    echo "4) Exit"
    echo ""
    echo -n "Select an option [1-4]: "
}

while true; do
    show_menu
    read -r choice
    case "$choice" in
        1) install_netbird; echo ""; echo "Installation complete. Press Enter to continue..."; read -r ;;
        2) update_netbird; echo ""; echo "Update complete. Press Enter to continue..."; read -r ;;
        3) uninstall_netbird; echo ""; echo "Press Enter to continue..."; read -r ;;
        4) echo "Exiting."; exit 0 ;;
        *) echo "Invalid option. Please select 1, 2, 3, or 4." ;;
    esac
done
