#!/bin/bash

DEFAULT_BIN="/opt/netbird/bin/netbird"
PROFILE_SCRIPT="/etc/profile.d/netbird.sh"
ATOMIC_CONF="/etc/atomic-update.conf.d/netbird.conf"
CONFIG_DIRS=("/etc/netbird" "/opt/netbird" "/var/lib/netbird" "/var/log/netbird")
NETBIRD_BIN=""

_choose_bin_path() {
    echo ""
    echo "Install options:"
    echo "1) Default path ($DEFAULT_BIN)"
    echo "2) Custom path"
    echo -n "Select [1-2]: "
    read -r path_choice
    echo ""
    if [ "$path_choice" = "2" ]; then
        echo -n "Enter full path to netbird binary (e.g., /opt/netbird/bin/netbird): "
        read -r custom_path
        NETBIRD_BIN="$custom_path"
    else
        NETBIRD_BIN="$DEFAULT_BIN"
    fi
}

_download_netbird() {
    local temp_dir="$1"
    echo "Resolving latest stable NetBird release version..." >&2
    LATEST_VERSION=$(curl -s https://api.github.com/repos/netbirdio/netbird/releases/latest | grep '"tag_name":' | sed -E 's/.*"v([^"]+)".*/\1/')
    if [ -z "$LATEST_VERSION" ]; then
        echo "Error: Failed to resolve the latest NetBird version tag." >&2
        return 1
    fi
    echo "Latest version identified: v$LATEST_VERSION" >&2
    local url="https://github.com/netbirdio/netbird/releases/download/v${LATEST_VERSION}/netbird_${LATEST_VERSION}_linux_amd64.tar.gz"
    echo "Downloading archive payload..." >&2
    if ! curl -L "$url" -o "$temp_dir/netbird.tar.gz"; then
        echo "Error: Failed to download." >&2
        return 1
    fi
    echo "Extracting binary..." >&2
    tar -xzf "$temp_dir/netbird.tar.gz" -C "$temp_dir"
    if [ ! -f "$temp_dir/netbird" ]; then
        echo "Error: netbird binary not found in archive." >&2
        ls -la "$temp_dir/" >&2
        return 1
    fi
    echo "$LATEST_VERSION"
}

_install_binary() {
    local bin_path="$1"
    local temp_dir="$2"
    local bin_dir
    bin_dir=$(dirname "$bin_path")
    echo "Installing binary to $bin_path ..."
    sudo mkdir -p "$bin_dir"
    sudo install -m 755 "$temp_dir/netbird" "$bin_path"
    if [ ! -x "$bin_path" ]; then
        echo "Error: Binary not installed at $bin_path" >&2
        return 1
    fi
    echo "Binary installed: $(ls -la "$bin_path" 2>/dev/null)"
    file "$bin_path" 2>/dev/null || true
    if command -v restorecon &> /dev/null; then
        echo "Fixing SELinux security contexts..."
        sudo restorecon -v "$bin_path" 2>/dev/null || true
        sudo chcon -t bin_t "$bin_path" 2>/dev/null || true
        echo "SELinux context: $(ls -laZ "$bin_path" 2>/dev/null || echo 'N/A')"
    fi
}

_setup_path_integration() {
    local bin_path="$1"
    local bin_dir
    bin_dir=$(dirname "$bin_path")
    echo "Setting up PATH integration at $PROFILE_SCRIPT..."
    sudo mkdir -p /etc/profile.d
    printf 'case ":${PATH}:" in\n  *:"%s":*) ;;\n  *) export PATH="%s:$PATH" ;;\nesac\n' "$bin_dir" "$bin_dir" | sudo tee "$PROFILE_SCRIPT" > /dev/null
    if [ -d /etc/atomic-update.conf.d ]; then
        echo "Detected SteamOS atomic-update, registering profile script..."
        echo "$PROFILE_SCRIPT" | sudo tee "$ATOMIC_CONF" > /dev/null
    fi
}

_install_service() {
    local bin_path="$1"
    echo "Installing systemd service via netbird service install..."
    if ! sudo "$bin_path" service install; then
        echo "Warning: netbird service install failed, trying direct service setup..." >&2
        local service_path="/etc/systemd/system/netbird.service"
        sudo bash -c "cat << EOFSVC > $service_path
[Unit]
Description=NetBird Client Daemon
After=network.target
Documentation=https://netbird.io/docs

[Service]
ExecStart=$bin_path service run
UMask=0002
Restart=always
RestartSec=5
User=root
Environment=HOME=/root

[Install]
WantedBy=multi-user.target
EOFSVC
"
        sudo systemctl daemon-reload
        sudo systemctl enable netbird
    fi
    sudo "$bin_path" service start 2>/dev/null || sudo systemctl start netbird 2>/dev/null || true
}

install_netbird() {
    _choose_bin_path
    local bin_dir
    bin_dir=$(dirname "$NETBIRD_BIN")
    echo "Target binary path: $NETBIRD_BIN"
    echo ""
    local temp_dir
    temp_dir=$(mktemp -d)
    local version
    version=$(_download_netbird "$temp_dir") || { rm -rf "$temp_dir"; return 1; }
    _install_binary "$NETBIRD_BIN" "$temp_dir" || { rm -rf "$temp_dir"; return 1; }
    rm -rf "$temp_dir"
    echo "Preparing environment directories..."
    sudo mkdir -p /etc/netbird /var/lib/netbird /var/log/netbird
    _setup_path_integration "$NETBIRD_BIN"
    _install_service "$NETBIRD_BIN"
    sleep 2
    echo ""
    echo "Deployment finalized successfully."
    echo "Binary path: $NETBIRD_BIN"
    echo "Service state: $(systemctl is-active netbird 2>/dev/null || echo 'unknown')"
    echo "To use netbird in this terminal, run:"
    echo "  source $PROFILE_SCRIPT"
}

uninstall_netbird() {
    echo "Stopping and disabling NetBird service..."
    if [ -f "$DEFAULT_BIN" ]; then
        sudo "$DEFAULT_BIN" service stop 2>/dev/null || true
        sudo "$DEFAULT_BIN" service uninstall 2>/dev/null || true
    fi
    sudo systemctl stop netbird 2>/dev/null || true
    sudo systemctl disable netbird 2>/dev/null || true
    if [ -f /etc/systemd/system/netbird.service ]; then
        echo "Removing systemd service file..."
        sudo rm -f /etc/systemd/system/netbird.service
        sudo systemctl daemon-reload
    fi
    if [ -f "$PROFILE_SCRIPT" ]; then
        echo "Removing $PROFILE_SCRIPT..."
        sudo rm -f "$PROFILE_SCRIPT"
    fi
    if [ -f "$ATOMIC_CONF" ]; then
        sudo rm -f "$ATOMIC_CONF"
    fi
    echo "Removing NetBird binary..."
    if [ -f "$DEFAULT_BIN" ]; then
        echo "Removing $DEFAULT_BIN..."
        sudo rm -f "$DEFAULT_BIN"
    elif command -v netbird &>/dev/null; then
        local which_bin
        which_bin=$(command -v netbird)
        echo "Removing $which_bin..."
        sudo rm -f "$which_bin"
    else
        echo "Binary not found at $DEFAULT_BIN or in PATH."
        echo -n "Enter custom binary path to remove (or leave empty to skip): "
        read -r custom_uninstall
        if [ -n "$custom_uninstall" ] && [ -f "$custom_uninstall" ]; then
            echo "Removing $custom_uninstall..."
            sudo rm -f "$custom_uninstall"
        fi
    fi
    echo ""
    echo "Clean up configuration and data directories? (y/N): "
    read -r cleanup
    if [[ "$cleanup" =~ ^[Yy]$ ]]; then
        for dir in "${CONFIG_DIRS[@]}"; do
            if [ -d "$dir" ]; then
                echo "Removing $dir..."
                sudo rm -rf "$dir" 2>/dev/null || true
            fi
        done
    fi
    echo ""
    echo "NetBird has been uninstalled."
}

update_netbird() {
    echo "NetBird update"
    echo "--------------"
    local bin_path=""
    if [ -x "$DEFAULT_BIN" ]; then
        bin_path="$DEFAULT_BIN"
    else
        local which_bin
        which_bin=$(command -v netbird 2>/dev/null || true)
        if [ -n "$which_bin" ] && [ -x "$which_bin" ]; then
            bin_path="$which_bin"
        fi
    fi
    if [ -z "$bin_path" ]; then
        echo "NetBird binary not found at $DEFAULT_BIN or in PATH."
        echo -n "Enter custom binary path to update (or leave empty to cancel): "
        read -r custom_update
        if [ -n "$custom_update" ] && [ -f "$custom_update" ]; then
            bin_path="$custom_update"
        else
            echo "Update cancelled."
            return 1
        fi
    fi
    echo "Existing binary: $bin_path"
    echo ""
    local temp_dir
    temp_dir=$(mktemp -d)
    local version
    version=$(_download_netbird "$temp_dir") || { rm -rf "$temp_dir"; return 1; }
    _install_binary "$bin_path" "$temp_dir" || { rm -rf "$temp_dir"; return 1; }
    rm -rf "$temp_dir"
    _setup_path_integration "$bin_path"
    if [ -x "$bin_path" ]; then
        sudo "$bin_path" service install 2>/dev/null || true
        sudo "$bin_path" service restart 2>/dev/null || sudo systemctl restart netbird 2>/dev/null || true
    fi
    sleep 2
    echo ""
    echo "NetBird updated to v$version."
    echo "Binary: $bin_path"
    echo "Service: $(systemctl is-active netbird 2>/dev/null || echo 'unknown')"
    echo "To use netbird in this terminal, run:"
    echo "  source $PROFILE_SCRIPT"
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
        1) install_netbird; echo ""; echo "Press Enter to continue..."; read -r ;;
        2) update_netbird; echo ""; echo "Press Enter to continue..."; read -r ;;
        3) uninstall_netbird; echo ""; echo "Press Enter to continue..."; read -r ;;
        4) echo "Exiting."; exit 0 ;;
        *) echo "Invalid option. Please select 1, 2, 3, or 4." ;;
    esac
done
