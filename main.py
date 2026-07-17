import subprocess
import json
import decky
import re
import threading

DEFAULT_MGMT_URL = "https://api.netbird.io:443"


class Plugin:
    def __init__(self):
        self._mgmt_url = DEFAULT_MGMT_URL
        self._running_process = None
        self._process_lock = threading.Lock()

    async def _main(self):
        decky.logger.info("NetBird VPN plugin loaded")
        detected = self._detect_management_url()
        if detected:
            self._mgmt_url = detected
            decky.logger.info(f"Auto-detected management URL: {detected}")

    async def _unload(self):
        self._kill_running_process()
        decky.logger.info("NetBird VPN plugin unloaded")

    async def _uninstall(self):
        self._kill_running_process()
        decky.logger.info("NetBird VPN plugin uninstalled")

    async def _migration(self):
        decky.migrate_logs("netbird.log")
        decky.migrate_settings("netbird.json")

    def _kill_running_process(self):
        with self._process_lock:
            if self._running_process:
                try:
                    self._running_process.kill()
                except Exception as e:
                    decky.logger.error(f"Error killing process: {e}")
                finally:
                    self._running_process = None

    @staticmethod
    def _extract_auth_url(output):
        if not output:
            return None
        patterns = [
            r"(https://[^\s]+/login\?[^\s]+)",
            r"(https://[^\s]+/device-authorization\?[^\s]+)",
            r"(https://[^\s]+/oauth/authorize\?[^\s]+)",
            r"(https://[^\s]+/oauth2/device\?[^\s]+)",
            r"(https://[^\s]+/auth\?[^\s]+)",
            r"(https://[^\s]+/activate\?[^\s]+)",
            r"(https://login\.netbird\.io/[^\s]+)",
        ]
        for pattern in patterns:
            match = re.search(pattern, output)
            if match:
                return match.group(1)
        return None

    def _run_simple(self, args):
        cmd = ["netbird"] + args
        decky.logger.info(f"Running simple: {' '.join(cmd)}")
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=15,
            )
            decky.logger.info(f"Exit: {result.returncode}")
            if result.stdout:
                decky.logger.info(f"stdout: {result.stdout.strip()[:500]}")
            if result.stderr:
                decky.logger.info(f"stderr: {result.stderr.strip()[:500]}")
            return {
                "success": result.returncode == 0,
                "stdout": result.stdout.strip(),
                "stderr": result.stderr.strip(),
            }
        except subprocess.TimeoutExpired:
            decky.logger.error(f"Timeout: {' '.join(cmd)}")
            return {"success": False, "stdout": "", "stderr": "Command timed out"}
        except FileNotFoundError:
            decky.logger.error("netbird command not found in PATH")
            return {"success": False, "stdout": "", "stderr": "netbird not found in PATH"}

    def _run_auth(self, args):
        cmd = ["netbird"] + args
        decky.logger.info(f"Running auth: {' '.join(cmd)}")

        auth_holder = {"url": None}
        auth_found_event = threading.Event()
        cancelled = threading.Event()

        with self._process_lock:
            if self._running_process:
                decky.logger.warning("Another netbird command is already running")
                return {"success": False, "stdout": "", "stderr": "Another command in progress", "auth_url": None}

            try:
                process = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    bufsize=1,
                )
                self._running_process = process
            except FileNotFoundError:
                return {"success": False, "stdout": "", "stderr": "netbird not found in PATH", "auth_url": None}

        stdout_lines = []
        stderr_lines = []

        def read_stream(stream, lines_list):
            for line in iter(stream.readline, ''):
                if not line or cancelled.is_set():
                    break
                line = line.rstrip('\n')
                lines_list.append(line)

                if "Already connected" in line or ("Connected" in line and "not" not in line.lower()):
                    decky.logger.info("*** CONNECTED: Early return ***")
                    auth_found_event.set()

                if auth_holder["url"] is None:
                    auth_url = self._extract_auth_url(line)
                    if auth_url:
                        decky.logger.info(f"*** AUTH URL FOUND: {auth_url} ***")
                        auth_holder["url"] = auth_url
                        auth_found_event.set()

        stdout_thread = threading.Thread(target=read_stream, args=(process.stdout, stdout_lines))
        stderr_thread = threading.Thread(target=read_stream, args=(process.stderr, stderr_lines))

        stdout_thread.start()
        stderr_thread.start()

        auth_found = auth_found_event.wait(timeout=300)

        if auth_found and auth_holder["url"]:
            auth_url = auth_holder["url"]
            decky.logger.info(f"Auth URL found: {auth_url}, spawning background wait for SSO")

            def _background_auth_wait():
                auth_found_event.clear()
                connected = auth_found_event.wait(timeout=120)
                cancelled.set()
                try:
                    process.kill()
                except Exception:
                    pass
                stdout_thread.join(timeout=2)
                stderr_thread.join(timeout=2)
                with self._process_lock:
                    self._running_process = None
                decky.logger.info(f"Background auth wait complete. Connected: {connected}")

            threading.Thread(target=_background_auth_wait, daemon=True).start()

            return {
                "success": True,
                "stdout": "\n".join(stdout_lines),
                "stderr": "\n".join(stderr_lines),
                "auth_url": auth_url,
            }

        cancelled.set()
        try:
            process.kill()
        except Exception:
            pass

        stdout_thread.join(timeout=2)
        stderr_thread.join(timeout=2)

        with self._process_lock:
            self._running_process = None

        try:
            returncode = process.wait(timeout=300)
        except subprocess.TimeoutExpired:
            process.kill()
            decky.logger.error(f"Timeout: {' '.join(cmd)}")
            return {"success": False, "stdout": "\n".join(stdout_lines), "stderr": "\n".join(stderr_lines), "auth_url": None}

        decky.logger.info(f"Exit: {returncode}")
        return {"success": returncode == 0, "stdout": "\n".join(stdout_lines), "stderr": "\n".join(stderr_lines), "auth_url": None}

    def _is_installed(self):
        result = self._run_simple(["version"])
        return result["success"]

    def _detect_management_url(self):
        result = self._run_simple(["status", "--json"])
        if result["success"] and result["stdout"]:
            try:
                data = json.loads(result["stdout"])
                url = data.get("management", {}).get("url", "")
                if url:
                    return url
            except json.JSONDecodeError:
                pass
        return None

    def _is_connected(self):
        result = self._run_simple(["status", "--json"])
        if result["success"] and result["stdout"]:
            try:
                data = json.loads(result["stdout"])
                return data.get("daemonStatus") == "Connected"
            except json.JSONDecodeError:
                decky.logger.error(f"Failed to parse JSON status: {result['stdout'][:200]}")
        result = self._run_simple(["status"])
        return result["success"] and "Connected" in result["stdout"]

    async def get_system_info(self):
        decky.logger.info("=== get_system_info ===")
        installed = self._is_installed()
        return {
            "netbird_installed": installed,
            "connected": self._is_connected() if installed else False,
        }

    async def get_status(self):
        decky.logger.info("=== get_status ===")
        if not self._is_installed():
            return {"connected": False, "daemon_status": "Not Installed", "netbird_ip": "", "peers": {"total": 0, "connected": 0}, "version": "Unknown"}

        version_result = self._run_simple(["version"])
        status_json = self._run_simple(["status", "--json"])
        connected = False
        daemon_status = "Disconnected"
        netbird_ip = ""
        peers = {"total": 0, "connected": 0}
        raw_status = ""
        error = ""

        if status_json["success"] and status_json["stdout"]:
            try:
                data = json.loads(status_json["stdout"])
                daemon_status = data.get("daemonStatus", "Unknown")
                connected = daemon_status == "Connected"
                netbird_ip = data.get("netbirdIp", "")
                peers = data.get("peers", {"total": 0, "connected": 0})
                raw_status = json.dumps(data, indent=2)
            except json.JSONDecodeError:
                decky.logger.error(f"Failed to parse JSON status")

        if not raw_status:
            text_result = self._run_simple(["status"])
            raw_status = text_result["stdout"]
            error = text_result["stderr"]
            connected = "Connected" in raw_status

        return {
            "connected": connected,
            "daemon_status": daemon_status,
            "netbird_ip": netbird_ip,
            "peers": peers,
            "status": {"raw": raw_status, "error": error},
            "version": version_result["stdout"] if version_result["success"] else "Unknown",
        }

    async def get_peers(self):
        decky.logger.info("=== get_peers ===")
        result = self._run_simple(["status", "--json"])
        if not result["success"] or not result["stdout"]:
            return []
        try:
            data = json.loads(result["stdout"])
            details = data.get("peers", {}).get("details")
            if not details:
                return []
            peers = []
            for peer in details:
                peers.append({
                    "ip": peer.get("ip", ""),
                    "fqdn": peer.get("fqdn", ""),
                    "status": peer.get("status", "unknown"),
                    "latency": peer.get("latency", ""),
                    "connection_type": peer.get("connectionType", ""),
                })
            return peers
        except (json.JSONDecodeError, TypeError) as e:
            decky.logger.error(f"Failed to parse peers: {e}")
            return []

    async def get_networks(self):
        decky.logger.info("=== get_networks ===")
        result = self._run_simple(["networks", "list"])
        if not result["success"]:
            return []
        networks = []
        current = {}
        for line in result["stdout"].splitlines():
            stripped = line.strip()
            if stripped.startswith("- ID:"):
                if current:
                    networks.append(current)
                current = {"name": stripped[5:].strip(), "status": "Unknown"}
            elif stripped.startswith("Network:") and current:
                current["network"] = stripped[8:].strip()
            elif stripped.startswith("Status:") and current:
                raw = stripped[7:].strip()
                current["status"] = "Connected" if raw == "Selected" else "Disconnected"
        if current:
            networks.append(current)
        return networks

    async def network_up(self, name):
        decky.logger.info(f"=== network_up: {name} ===")
        return self._run_simple(["networks", "select", "-a", name])

    async def network_down(self, name):
        decky.logger.info(f"=== network_down: {name} ===")
        return self._run_simple(["networks", "deselect", name])

    async def expose_port(self, port, protocol="tcp", password="", name_prefix=""):
        decky.logger.info(f"=== expose_port: {port}/{protocol} ===")
        args = ["expose", str(port), "--protocol", protocol]
        if password:
            args.extend(["--with-password", password])
        if name_prefix:
            args.extend(["--with-name-prefix", name_prefix])
        return self._run_auth(args)

    async def get_forwarding_rules(self):
        decky.logger.info("=== get_forwarding_rules ===")
        result = self._run_simple(["forwarding", "list"])
        if not result["success"] or not result["stdout"]:
            return []
        rules = []
        for line in result["stdout"].splitlines():
            line = line.strip()
            if not line or line.startswith("Forwarding") or line.startswith("---"):
                continue
            rules.append({"raw": line})
        return rules

    async def connect(self, mgmt_url=None, setup_key=None, block_inbound=False):
        decky.logger.info(f"=== connect (url={mgmt_url}, key={'***' if setup_key else 'None'}, block_inbound={block_inbound}) ===")
        url = mgmt_url if mgmt_url else self._mgmt_url
        if mgmt_url:
            self._mgmt_url = mgmt_url
        args = ["up"]
        if url and url.strip():
            args.extend(["--management-url", url.strip()])
        if setup_key and setup_key.strip():
            args.extend(["--setup-key", setup_key.strip()])
        if block_inbound:
            args.append("--block-inbound")
        return self._run_auth(args)

    async def login(self, mgmt_url=None, setup_key=None, profile=None):
        decky.logger.info(f"=== login (url={mgmt_url}, key={'***' if setup_key else 'None'}) ===")
        url = mgmt_url if mgmt_url else self._mgmt_url
        args = ["login"]
        if url and url.strip():
            args.extend(["--management-url", url.strip()])
        if setup_key and setup_key.strip():
            args.extend(["--setup-key", setup_key.strip()])
        if profile and profile.strip():
            args.extend(["--profile", profile.strip()])
        return self._run_auth(args)

    async def disconnect(self):
        decky.logger.info("=== disconnect ===")
        return self._run_simple(["down"])

    async def deregister(self):
        decky.logger.info("=== deregister ===")
        return self._run_simple(["deregister"])

    async def get_profiles(self):
        decky.logger.info("=== get_profiles ===")
        result = self._run_simple(["profile", "list"])
        if not result["success"] or not result["stdout"]:
            return {"profiles": [], "current": ""}
        profiles = []
        current = None
        for line in result["stdout"].splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("+") or stripped.startswith("|"):
                continue
            parts = stripped.split()
            if len(parts) == 0:
                continue
            header_lower = stripped.lower()
            if "name" in header_lower and "active" in header_lower:
                continue
            name = parts[0]
            is_current = len(parts) > 1 and parts[1] in ("*", "✓", "✔")
            if is_current:
                current = name
            if name not in profiles:
                profiles.append(name)
        if current and current not in profiles:
            profiles.insert(0, current)
        return {"profiles": profiles, "current": current or (profiles[0] if profiles else "")}

    async def select_profile(self, name):
        decky.logger.info(f"=== select_profile: {name} ===")
        return self._run_simple(["profile", "select", name])

    async def add_profile(self, name):
        decky.logger.info(f"=== add_profile: {name} ===")
        return self._run_simple(["profile", "add", name])

    async def remove_profile(self, name):
        decky.logger.info(f"=== remove_profile: {name} ===")
        return self._run_simple(["profile", "remove", name])

    async def set_management_url(self, url):
        decky.logger.info(f"=== set_management_url: {url} ===")
        self._mgmt_url = url
        return {"success": True, "stdout": "", "stderr": ""}

    async def get_management_url(self):
        if self._mgmt_url == DEFAULT_MGMT_URL:
            detected = self._detect_management_url()
            if detected:
                self._mgmt_url = detected
        return self._mgmt_url

    async def get_version(self):
        decky.logger.info("=== get_version ===")
        if not self._is_installed():
            return "Not installed"
        result = self._run_simple(["version"])
        return result["stdout"] if result["success"] else "Unknown"
