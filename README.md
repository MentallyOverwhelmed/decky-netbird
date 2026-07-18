# NetBird VPN for Decky Loader

Manage [NetBird](https://netbird.io) VPN on your Steam Deck directly from the Quick Access Menu.

> NetBird name and logo are trademarks of [NetBird.io](https://netbird.io). This plugin is not affiliated with or endorsed by NetBird.

## Features

- **VPN Toggle** — connect/disconnect with one switch
- **SSO Login** — QR code + Show/Hide URL, auto-closes when connected
- **Management URL** — auto-detected from existing config; editable
- **Setup Key** — optional pre-authentication key for headless setup
- **Peer List** — view connected peers with IP, latency, and connection type
- **Network Resources** — toggle individual networks on/off; auto-excludes conflicting exit nodes
- **Profiles** — switch, add, and remove profiles with a dropdown picker
- **Expose Port** — expose local ports via NetBird reverse proxy
- **Forwarding Rules** — view active port forwarding rules
- **Block Inbound** — toggle inbound connection blocking
- **Deregister** — remove this peer from the network

## Preview

<p align="center">
  <img src="https://github.com/user-attachments/assets/cbf9877a-6aa3-484b-9edc-36fb6a8e6d00" width="230" alt="Status" />
  <img src="https://github.com/user-attachments/assets/416908f7-c1fb-43aa-8466-fa1c38625492" width="230" alt="Peers" />
  <img src="https://github.com/user-attachments/assets/9cba08dc-e688-440e-92ff-aba9b5d68e8f" width="230" alt="Resources" />
</p>
<p align="center">
  <img src="https://github.com/user-attachments/assets/4855a7a7-7df5-4ced-8b00-32ce931ccfd0" width="230" alt="Configuration" />
  <img src="https://github.com/user-attachments/assets/d6fdf376-6ed6-4fa9-ad7e-047a45f4d865" width="230" alt="About" />
</p>

## Prerequisites

- [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) installed on your Steam Deck
- **NetBird agent** installed on your system (see **Install NetBird** below)

---

## Install NetBird (one-time, required before using the plugin)

> **SteamOS users:** If you're on stock SteamOS (not Bazzite), you need to disable the immutable filesystem first. Run this once before the script below:
>
> ```bash
> sudo steamos-readonly disable
> ```
>
> After NetBird is installed, you can re-enable the immutable filesystem with:
>
> ```bash
> sudo steamos-readonly enable
> ```

Open **Konsole** (terminal emulator) on your Steam Deck in Gaming Mode, or a terminal in Desktop Mode, and run:

```bash
curl -L -o netbird.sh https://raw.githubusercontent.com/MentallyOverwhelmed/decky-netbird/main/netbird.sh
chmod +x netbird.sh
./netbird.sh
```

Then select option **1) Install NetBird** from the menu. The script will prompt for your sudo password when needed.

> **Note:** NetBird runs as a system service. The script installs it, configures systemd, and starts the daemon automatically. You only need to do this once.

---

## Install Plugin

### From Dev Mode ZIP (recommended)

1. Go to the [Releases page](https://github.com/MentallyOverwhelmed/decky-netbird/releases)
2. Download the latest `decky-netbird.zip`
3. Open Decky Loader → **Settings** → **Developer Mode** → **Install from ZIP**
4. Select the downloaded `decky-netbird.zip`
5. Restart Decky Loader

### Manual Install

Clone and build directly into Decky's plugins folder:

```bash
git clone https://github.com/MentallyOverwhelmed/decky-netbird.git ~/homebrew/plugins/decky-netbird
cd ~/homebrew/plugins/decky-netbird
pnpm install
pnpm run build
```

Or symlink if already cloned elsewhere:

```bash
ln -sf "$PWD" ~/homebrew/plugins/decky-netbird
```

Restart Decky Loader after installing.

---

## Usage

1. Open the Quick Access Menu (`...` button)
2. Select the **NetBird VPN** plugin tab
3. If prompted, enter your management URL (auto-detected if already configured)
4. Toggle **VPN Toggle** to connect
5. On first connection, scan the QR code or click **Show URL** to authenticate in your browser
6. The modal auto-closes once connected

---

## Building from Source

```bash
pnpm install
pnpm run build      # bundles to dist/
pnpm run typecheck   # TypeScript type check
```

---

## Troubleshooting

- If the plugin keeps loading indefinitely (caused by a wrong setup-key or a wrong management URL), please restart your Steam Deck and check everything is correct again.

## Acknowledgements

This plugin was built using an iterative, AI-assisted development workflow (powered by OpenCode & DeepSeek V4 Flash). Every feature was incrementally generated, reviewed, and thoroughly tested directly on physical Steam Deck hardware to ensure compatibility with SteamOS and NetBird's CLI behaviors.

## License

BSD 3-Clause
