import asyncio
import getpass
import json
import os
import socket
from datetime import datetime, timezone
import decky

DEFAULT_MGMT_URL = "https://api.netbird.io:443"
SOCKET_PATH = "/var/run/netbird-http.sock"
RPC_BASE = "/daemon.DaemonService"
SOCKET_MISSING_MSG = "NetBird JSON socket not found. Requires NetBird v0.75+ with the JSON socket enabled (re-run netbird.sh)."


class DaemonClient:
    def __init__(self, socket_path=SOCKET_PATH):
        self._socket_path = socket_path
        self._reader = None
        self._writer = None
        self._call_lock = asyncio.Lock()
        self._login_seq = 0

    @staticmethod
    def _build_request(method, body):
        head = (
            f"POST {RPC_BASE}/{method} HTTP/1.1\r\n"
            "Host: localhost\r\n"
            "Content-Type: application/json\r\n"
            f"Content-Length: {len(body)}\r\n"
            "Connection: keep-alive\r\n"
            "\r\n"
        )
        return head.encode("ascii") + body

    async def _ensure_conn(self):
        if self._writer is not None and not self._writer.is_closing():
            return
        self._reader, self._writer = await asyncio.open_unix_connection(self._socket_path)

    async def _close_conn(self):
        writer, self._writer = self._writer, None
        self._reader = None
        if writer is not None:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass

    async def _read_headers(self, reader):
        status_line = await reader.readline()
        parts = status_line.decode("utf-8", errors="replace").split(" ", 2)
        code = int(parts[1]) if len(parts) > 1 else 0
        headers = {}
        while True:
            line = await reader.readline()
            if line in (b"\r\n", b"\n", b""):
                break
            key, _, value = line.partition(b":")
            headers[key.strip().lower()] = value.strip()
        return code, headers

    async def _read_unary_body(self, reader):
        code, headers = await self._read_headers(reader)
        if code != 200:
            return code, await self._read_error_body(reader, headers)
        cl = headers.get(b"content-length")
        if cl:
            body = await reader.readexactly(int(cl))
        else:
            body = await reader.read(4096)
        return code, body

    async def _read_error_body(self, reader, headers):
        cl = headers.get(b"content-length")
        if cl:
            try:
                return await reader.readexactly(int(cl))
            except asyncio.IncompleteReadError:
                pass
        return await reader.read(4096)

    async def call(self, method, request=None, timeout=15):
        decky.logger.info(f"Daemon RPC: {method} {json.dumps(request or {})}")
        if not os.path.exists(self._socket_path):
            return {"success": False, "data": None, "error": SOCKET_MISSING_MSG}
        body = json.dumps(request or {}).encode("utf-8")
        async with self._call_lock:
            try:
                await self._ensure_conn()
                self._writer.write(self._build_request(method, body))
                await self._writer.drain()
                code, body_bytes = await asyncio.wait_for(self._read_unary_body(self._reader), timeout=timeout)
            except asyncio.TimeoutError:
                await self._close_conn()
                decky.logger.error(f"{method} timed out after {timeout}s")
                return {"success": False, "data": None, "error": f"Timed out after {timeout}s"}
            except (OSError, EOFError, ValueError) as e:
                await self._close_conn()
                decky.logger.error(f"{method} failed: {e}")
                return {"success": False, "data": None, "error": str(e)}
        if code != 200:
            return {"success": False, "data": None, "error": self._error_text(code, body_bytes)}
        try:
            data = json.loads(body_bytes.decode("utf-8", errors="replace")) if body_bytes else {}
        except ValueError:
            return {"success": False, "data": None, "error": "Invalid JSON response from daemon"}
        return {"success": True, "data": data, "error": ""}

    @staticmethod
    def _error_text(code, body_bytes):
        text = body_bytes.decode("utf-8", errors="replace").strip()
        try:
            err = json.loads(text)
            if isinstance(err, dict) and err.get("message"):
                return f"HTTP {code}: {err['message']}"
        except ValueError:
            pass
        return f"HTTP {code}: {text[:200]}"

    async def call_isolated(self, method, request=None, timeout=15):
        decky.logger.info(f"Daemon RPC (isolated): {method} {json.dumps(request or {})}")
        if not os.path.exists(self._socket_path):
            return {"success": False, "data": None, "error": SOCKET_MISSING_MSG}
        body = json.dumps(request or {}).encode("utf-8")
        reader, writer = await asyncio.open_unix_connection(self._socket_path)
        try:
            writer.write(self._build_request(method, body))
            await writer.drain()
            code, body_bytes = await asyncio.wait_for(self._read_unary_body(reader), timeout=timeout)
        except asyncio.CancelledError:
            raise
        except asyncio.TimeoutError:
            decky.logger.error(f"{method} timed out after {timeout}s")
            return {"success": False, "data": None, "error": f"Timed out after {timeout}s"}
        except (OSError, EOFError, ValueError) as e:
            decky.logger.error(f"{method} failed: {e}")
            return {"success": False, "data": None, "error": str(e)}
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
        if code != 200:
            return {"success": False, "data": None, "error": self._error_text(code, body_bytes)}
        try:
            data = json.loads(body_bytes.decode("utf-8", errors="replace")) if body_bytes else {}
        except ValueError:
            return {"success": False, "data": None, "error": "Invalid JSON response from daemon"}
        return {"success": True, "data": data, "error": ""}

    async def stream_lines(self, method, request=None):
        if not os.path.exists(self._socket_path):
            raise ConnectionError(SOCKET_MISSING_MSG)
        body = json.dumps(request or {}).encode("utf-8")
        reader, writer = await asyncio.open_unix_connection(self._socket_path)
        try:
            writer.write(self._build_request(method, body))
            await writer.drain()
            code, headers = await self._read_headers(reader)
            if code != 200:
                err = await self._read_error_body(reader, headers)
                raise RuntimeError(self._error_text(code, err))
            if headers.get(b"transfer-encoding") == b"chunked":
                async for line in self._chunked_lines(reader):
                    yield line
            else:
                async for line in self._read_until_eof_lines(reader):
                    yield line
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass

    async def _chunked_lines(self, reader):
        buf = bytearray()
        while True:
            size_line = await reader.readline()
            if not size_line:
                break
            try:
                size = int(size_line.strip().split(b";")[0], 16)
            except ValueError:
                break
            if size == 0:
                await reader.readline()
                break
            chunk = await reader.readexactly(size)
            await reader.readline()
            buf.extend(chunk)
            while True:
                nl = buf.find(b"\n")
                if nl == -1:
                    break
                line = bytes(buf[:nl]).rstrip(b"\r")
                del buf[:nl + 1]
                if line.strip():
                    yield line
        if buf:
            line = bytes(buf).rstrip(b"\r")
            if line.strip():
                yield line

    async def _read_until_eof_lines(self, reader):
        buf = bytearray()
        while True:
            chunk = await reader.read(4096)
            if not chunk:
                break
            buf.extend(chunk)
            while True:
                nl = buf.find(b"\n")
                if nl == -1:
                    break
                line = bytes(buf[:nl]).rstrip(b"\r")
                del buf[:nl + 1]
                if line.strip():
                    yield line
        if buf:
            line = bytes(buf).rstrip(b"\r")
            if line.strip():
                yield line

    @staticmethod
    def _unwrap(line_data):
        result = line_data.get("result")
        return result if isinstance(result, dict) else line_data

    def bump_login_seq(self):
        self._login_seq += 1
        return self._login_seq

    async def login(self, mgmt_url=None, setup_key=None, profile=None, block_inbound=False):
        req = {"hostname": socket.gethostname()}
        if setup_key:
            req["setupKey"] = setup_key
        if mgmt_url:
            req["managementUrl"] = mgmt_url
        if block_inbound:
            req["blockInbound"] = True
        if profile:
            req["profileName"] = profile
        r = await self.call("Login", req, timeout=30)
        if not r["success"]:
            return {"success": False, "stdout": "", "stderr": r["error"], "auth_url": None}
        data = r["data"]
        if data.get("needsSSOLogin"):
            return {
                "success": True,
                "stdout": "",
                "stderr": "",
                "auth_url": data.get("verificationURIComplete") or data.get("verificationURI") or "",
                "user_code": data.get("userCode", ""),
            }
        return {"success": True, "stdout": "Logged in", "stderr": "", "auth_url": None}


class Plugin:
    def __init__(self):
        self._mgmt_url = DEFAULT_MGMT_URL
        self._daemon = DaemonClient()
        self._profile_username = ""
        self._cache = None
        self._cache_error = SOCKET_MISSING_MSG
        self._networks_revision = -1
        self._networks_cache = []
        self._tasks = set()
        self._sso_task = None

    def _spawn(self, coro):
        task = asyncio.get_running_loop().create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    def _spawn_sso(self, login_res, seq, connect_after_sso):
        user_code = login_res.get("user_code", "")
        self._sso_task = self._spawn(self._wait_sso(user_code, seq, connect_after_sso))

    async def _wait_sso(self, user_code, seq, connect_after_sso):
        try:
            wr = await self._daemon.call_isolated(
                "WaitSSOLogin",
                {"userCode": user_code, "hostname": socket.gethostname()},
                timeout=340,
            )
            decky.logger.info(f"SSO wait result: success={wr['success']} error={wr['error']}")
            if not wr["success"] or not connect_after_sso:
                return
            if self._daemon._login_seq != seq:
                decky.logger.info("SSO wait superseded by a newer login; ignoring")
                return
            up = await self._daemon.call("Up", {"async": True}, timeout=30)
            decky.logger.info(f"Up after SSO: success={up['success']} error={up['error']}")
        except asyncio.CancelledError:
            decky.logger.info("SSO wait cancelled")
        except Exception as e:
            decky.logger.error(f"SSO wait task failed: {e}")

    async def _main(self):
        decky.logger.info("NetBird VPN plugin loaded")
        if os.path.exists(SOCKET_PATH):
            decky.logger.info(f"NetBird JSON socket found at {SOCKET_PATH}")
        else:
            decky.logger.warning(f"NetBird JSON socket not found at {SOCKET_PATH}")
        self._spawn(self._status_stream_loop())
        detected = await self._detect_management_url()
        if detected:
            self._mgmt_url = detected
            decky.logger.info(f"Auto-detected management URL: {detected}")

    async def _unload(self):
        decky.logger.info("NetBird VPN plugin unloaded")
        for task in list(self._tasks):
            task.cancel()

    async def _uninstall(self):
        decky.logger.info("NetBird VPN plugin uninstalled")

    async def _migration(self):
        decky.migrate_logs("netbird.log")
        decky.migrate_settings("netbird.json")

    @staticmethod
    def _peer_status(peer):
        status_raw = (peer.get("connStatus") or "").lower()
        hs = peer.get("lastWireguardHandshake") or ""
        recent_hs = False
        if hs:
            try:
                handshake = datetime.fromisoformat(hs.replace("Z", "+00:00"))
                if handshake.tzinfo is not None:
                    handshake = handshake.astimezone(timezone.utc).replace(tzinfo=None)
                if (datetime.utcnow() - handshake).total_seconds() < 300:
                    recent_hs = True
            except ValueError:
                pass
        if status_raw == "connected":
            return "connected"
        if status_raw == "connecting":
            return "connected" if recent_hs else "connecting"
        if status_raw == "idle":
            return "connected" if recent_hs else "idle"
        return "disconnected"

    @staticmethod
    def _parse_snapshot(data):
        full = data.get("fullStatus") or {}
        local = full.get("localPeerState") or {}
        peers = full.get("peers") or []
        connected_peers = sum(1 for p in peers if Plugin._peer_status(p) == "connected")
        return {
            "connected": data.get("status") == "Connected",
            "daemon_status": data.get("status", "Unknown"),
            "netbird_ip": local.get("IP") or local.get("ip") or "",
            "peers": {"total": len(peers), "connected": connected_peers, "details": peers},
            "status": {"raw": json.dumps(data), "error": ""},
            "version": data.get("daemonVersion") or "Unknown",
            "networks_revision": full.get("networksRevision", 0),
            "session_expires_at": data.get("sessionExpiresAt") or "",
        }

    async def _status_stream_loop(self):
        while True:
            try:
                async for line in self._daemon.stream_lines("SubscribeStatus", {"getFullPeerStatus": True, "shouldRunProbes": True}):
                    try:
                        data = json.loads(line.decode("utf-8", errors="replace"))
                    except ValueError:
                        continue
                    self._cache = self._parse_snapshot(self._daemon._unwrap(data))
                    self._cache_error = ""
            except Exception as e:
                decky.logger.error(f"status stream stopped: {e}")
                self._cache_error = str(e)
            await asyncio.sleep(3)

    def _status_info(self):
        if self._cache is None:
            return {
                "connected": False,
                "daemon_status": "Unavailable",
                "netbird_ip": "",
                "peers": {"total": 0, "connected": 0},
                "status": {"raw": "", "error": self._cache_error},
                "version": "Unknown",
                "session_expires_at": "",
            }
        return self._cache

    async def _detect_management_url(self):
        prof = await self._active_profile()
        req = {}
        if prof:
            req = {"profileName": prof["id"], "username": await self._username_for(prof)}
        r = await self._daemon.call("GetConfig", req, timeout=10)
        if r["success"]:
            url = (r["data"] or {}).get("managementUrl", "")
            if url:
                return url
        return None

    async def get_system_info(self):
        decky.logger.info("=== get_system_info ===")
        info = self._status_info()
        return {
            "netbird_installed": info["daemon_status"] != "Unavailable",
            "connected": info["connected"],
        }

    async def get_status(self):
        decky.logger.info("=== get_status ===")
        info = self._status_info()
        if info["daemon_status"] == "Unavailable":
            info["daemon_status"] = "Not Installed"
        return info

    async def get_peers(self):
        decky.logger.info("=== get_peers ===")
        if self._cache is None:
            return []
        peers = []
        for peer in self._cache["peers"]["details"]:
            latency = peer.get("latency") or ""
            peers.append({
                "ip": peer.get("IP") or peer.get("ip") or "",
                "fqdn": peer.get("fqdn", ""),
                "status": self._peer_status(peer),
                "latency": str(latency),
                "connection_type": "Relayed" if peer.get("relayed") else "P2P",
            })
        return peers

    async def get_networks(self):
        decky.logger.info("=== get_networks ===")
        revision = self._cache.get("networks_revision", 0) if self._cache else -1
        if self._networks_cache and self._networks_revision == revision:
            return self._networks_cache
        r = await self._daemon.call("ListNetworks", {}, timeout=15)
        if not r["success"]:
            if self._networks_cache:
                return self._networks_cache
            return []
        networks = []
        for route in (r["data"] or {}).get("routes", []):
            networks.append({
                "name": route.get("ID", ""),
                "network": route.get("range", ""),
                "status": "Connected" if route.get("selected") else "Disconnected",
            })
        self._networks_cache = networks
        self._networks_revision = revision
        return networks

    async def network_up(self, name):
        decky.logger.info(f"=== network_up: {name} ===")
        r = await self._daemon.call("SelectNetworks", {"networkIDs": [name], "append": True}, timeout=15)
        return self._result(r, f"Network {name} selected")

    async def network_down(self, name):
        decky.logger.info(f"=== network_down: {name} ===")
        r = await self._daemon.call("DeselectNetworks", {"networkIDs": [name]}, timeout=15)
        return self._result(r, f"Network {name} deselected")

    @staticmethod
    def _result(r, ok_msg=""):
        if r["success"]:
            return {"success": True, "stdout": ok_msg, "stderr": ""}
        return {"success": False, "stdout": "", "stderr": r["error"]}

    async def expose_port(self, port, protocol="tcp", password="", name_prefix=""):
        decky.logger.info(f"=== expose_port: {port}/{protocol} ===")
        req = {"port": int(port), "protocol": f"EXPOSE_{protocol.upper()}"}
        if password:
            req["password"] = password
        if name_prefix:
            req["namePrefix"] = name_prefix
        fut = asyncio.get_running_loop().create_future()

        async def _run():
            try:
                async for line in self._daemon.stream_lines("ExposeService", req):
                    try:
                        data = json.loads(line.decode("utf-8", errors="replace"))
                    except ValueError:
                        continue
                    ready = self._daemon._unwrap(data).get("ready") or {}
                    if ready and not fut.done():
                        fut.set_result(ready)
            except Exception as e:
                if not fut.done():
                    fut.set_exception(e)

        self._spawn(_run())
        try:
            ready = await asyncio.wait_for(fut, timeout=30)
        except asyncio.TimeoutError:
            return {"success": False, "stdout": "", "stderr": "Timed out waiting for expose confirmation"}
        except Exception as e:
            return {"success": False, "stdout": "", "stderr": str(e)}
        url = ready.get("serviceUrl") or ready.get("serviceName") or "ready"
        return {"success": True, "stdout": f"Exposing {protocol}/{port} — {url}", "stderr": ""}

    @staticmethod
    def _fmt_port(port_info):
        if not port_info:
            return ""
        if "port" in port_info:
            return str(port_info["port"])
        rng = port_info.get("range") or {}
        return f"{rng.get('start', '')}-{rng.get('end', '')}"

    async def get_forwarding_rules(self):
        decky.logger.info("=== get_forwarding_rules ===")
        r = await self._daemon.call("ForwardingRules", {}, timeout=15)
        if not r["success"]:
            return []
        rules = []
        for rule in (r["data"] or {}).get("rules", []):
            dst = self._fmt_port(rule.get("destinationPort"))
            target = rule.get("translatedAddress") or rule.get("translatedHostname") or ""
            tr_port = self._fmt_port(rule.get("translatedPort"))
            if target and tr_port:
                target = f"{target}:{tr_port}"
            elif not target:
                target = tr_port
            rules.append({"raw": f"{rule.get('protocol', '').upper()} {dst} → {target}"})
        return rules

    async def connect(self, mgmt_url=None, setup_key=None, block_inbound=False):
        decky.logger.info(f"=== connect (url={mgmt_url}, key={'***' if setup_key else 'None'}, block_inbound={block_inbound}) ===")
        if mgmt_url:
            self._mgmt_url = mgmt_url
        url = mgmt_url if mgmt_url else self._mgmt_url
        seq = self._daemon.bump_login_seq()
        info = self._status_info()
        needs_login = info["daemon_status"] in ("Unavailable", "NeedsLogin", "LoginFailed")
        if setup_key or needs_login:
            res = await self._daemon.login(mgmt_url=url, setup_key=setup_key, block_inbound=block_inbound)
            if res.get("auth_url"):
                self._spawn_sso(res, seq, True)
                return res
            if not res["success"]:
                return res
        r = await self._daemon.call("Up", {"async": True}, timeout=30)
        if not r["success"]:
            res = await self._daemon.login(mgmt_url=url, setup_key=setup_key, block_inbound=block_inbound)
            if res.get("auth_url"):
                self._spawn_sso(res, seq, True)
                return res
            if not res["success"]:
                return res
            r = await self._daemon.call("Up", {"async": True}, timeout=30)
        if not r["success"]:
            return {"success": False, "stdout": "", "stderr": r["error"], "auth_url": None}
        return {"success": True, "stdout": "Connection requested", "stderr": "", "auth_url": None}

    async def login(self, mgmt_url=None, setup_key=None, profile=None):
        decky.logger.info(f"=== login (url={mgmt_url}, key={'***' if setup_key else 'None'}) ===")
        url = mgmt_url if mgmt_url else self._mgmt_url
        seq = self._daemon.bump_login_seq()
        res = await self._daemon.login(mgmt_url=url, setup_key=setup_key, profile=profile)
        if res.get("auth_url"):
            self._spawn_sso(res, seq, False)
        return res

    async def cancel_login(self):
        decky.logger.info("=== cancel_login ===")
        self._daemon.bump_login_seq()
        task = self._sso_task
        if task is not None and not task.done():
            decky.logger.info("Cancelling pending SSO wait")
            task.cancel()

    async def disconnect(self):
        decky.logger.info("=== disconnect ===")
        r = await self._daemon.call("Down", {}, timeout=15)
        return self._result(r, "Disconnected")

    async def deregister(self):
        decky.logger.info("=== deregister ===")
        r = await self._daemon.call("Logout", {}, timeout=30)
        return self._result(r, "Peer deregistered")

    async def _active_profile(self):
        r = await self._daemon.call("GetActiveProfile", {}, timeout=15)
        if not r["success"]:
            decky.logger.warning(f"GetActiveProfile failed: {r['error']}")
            return None
        d = r["data"] or {}
        decky.logger.info(f"Active profile: {d}")
        if not d.get("id"):
            return None
        return {
            "name": d.get("profileName", ""),
            "username": d.get("username", ""),
            "id": d.get("id", ""),
        }

    async def _ensure_profile_username(self):
        prof = await self._active_profile()
        return await self._username_for(prof)

    async def _username_for(self, prof):
        username = (prof or {}).get("username", "")
        if username:
            self._profile_username = username
            return username
        if self._profile_username:
            return self._profile_username
        try:
            return getpass.getuser()
        except Exception:
            return ""

    async def get_profiles(self):
        decky.logger.info("=== get_profiles ===")
        prof = await self._active_profile()
        if not prof:
            return {"profiles": ["default"], "current": "default"}
        current = prof["name"] or prof["id"]
        profiles = [current]
        username = await self._username_for(prof)
        if username:
            r = await self._daemon.call("ListProfiles", {"username": username}, timeout=15)
            if not r["success"]:
                decky.logger.warning(f"ListProfiles failed: {r['error']}")
            else:
                for p in (r["data"] or {}).get("profiles", []):
                    name = p.get("name") or ""
                    if name and name not in profiles:
                        profiles.append(name)
                    if p.get("isActive") and not current:
                        current = name
        return {"profiles": profiles, "current": current or profiles[0]}

    async def select_profile(self, name):
        decky.logger.info(f"=== select_profile: {name} ===")
        r = await self._daemon.call("SwitchProfile", {"profileName": name, "username": await self._ensure_profile_username()}, timeout=20)
        return self._result(r, f"Switched to profile {name}")

    async def add_profile(self, name):
        decky.logger.info(f"=== add_profile: {name} ===")
        r = await self._daemon.call("AddProfile", {"profileName": name, "username": await self._ensure_profile_username()}, timeout=20)
        return self._result(r, f"Profile {name} added")

    async def remove_profile(self, name):
        decky.logger.info(f"=== remove_profile: {name} ===")
        r = await self._daemon.call("RemoveProfile", {"profileName": name, "username": await self._ensure_profile_username()}, timeout=20)
        return self._result(r, f"Profile {name} removed")

    async def rename_profile(self, new_name):
        decky.logger.info(f"=== rename_profile: {new_name} ===")
        prof = await self._active_profile()
        if not prof:
            return {"success": False, "stdout": "", "stderr": "Could not determine the active profile"}
        r = await self._daemon.call(
            "RenameProfile",
            {"username": await self._username_for(prof), "handle": prof["id"], "newProfileName": new_name},
            timeout=20,
        )
        return self._result(r, f"Profile renamed to {new_name}")

    ALLOWED_SETTINGS_KEYS = frozenset({
        "managementUrl", "interfaceName", "wireguardPort", "mtu", "disableAutoConnect",
        "rosenpassEnabled", "rosenpassPermissive",
        "disableClientRoutes", "disableServerRoutes", "disableDns", "blockLanAccess",
        "disableNotifications", "blockInbound", "disableIpv6",
    })

    async def get_settings(self):
        decky.logger.info("=== get_settings ===")
        prof = await self._active_profile()
        cfg_req = {"profileName": "default", "username": ""}
        if prof:
            cfg_req = {"profileName": prof["id"], "username": await self._username_for(prof)}
        cfg_r = await self._daemon.call("GetConfig", cfg_req, timeout=15)
        feat_r = await self._daemon.call("GetFeatures", {}, timeout=15)
        error = cfg_r["error"] if not cfg_r["success"] else ""
        if not prof and not error:
            error = "Log in first to manage settings"
        return {
            "config": cfg_r["data"] if cfg_r["success"] else {},
            "features": feat_r["data"] if feat_r["success"] else {},
            "error": error,
        }

    async def set_settings(self, updates):
        decky.logger.info(f"=== set_settings: {updates} ===")
        prof = await self._active_profile()
        payload = {k: v for k, v in (updates or {}).items() if k in self.ALLOWED_SETTINGS_KEYS and v is not None}
        if not payload:
            return {"success": True, "stdout": "No changes", "stderr": ""}
        if prof:
            payload["profileName"] = prof["id"]
            payload["username"] = await self._username_for(prof)
        r = await self._daemon.call("SetConfig", payload, timeout=20)
        return self._result(r, "Settings applied")

    async def request_session_renewal(self):
        decky.logger.info("=== request_session_renewal ===")
        r = await self._daemon.call("RequestExtendAuthSession", {}, timeout=15)
        if not r["success"]:
            return {"success": False, "stdout": "", "stderr": r["error"], "auth_url": None, "user_code": ""}
        d = r["data"] or {}
        return {
            "success": True,
            "stdout": "",
            "stderr": "",
            "auth_url": d.get("verificationURIComplete") or d.get("verificationURI") or "",
            "user_code": d.get("userCode", ""),
            "device_code": d.get("deviceCode", ""),
        }

    async def wait_session_renewal(self, user_code, device_code):
        decky.logger.info("=== wait_session_renewal ===")
        r = await self._daemon.call_isolated(
            "WaitExtendAuthSession",
            {"userCode": user_code, "deviceCode": device_code},
            timeout=340,
        )
        return self._result(r, "Session renewed")

    async def set_management_url(self, url):
        decky.logger.info(f"=== set_management_url: {url} ===")
        if url and url != self._mgmt_url:
            prof = await self._active_profile()
            req = {"managementUrl": url}
            if prof:
                req["profileName"] = prof["id"]
                req["username"] = await self._username_for(prof)
            r = await self._daemon.call("SetConfig", req, timeout=20)
            if not r["success"]:
                return {"success": False, "stdout": "", "stderr": r["error"]}
        self._mgmt_url = url or self._mgmt_url
        return {"success": True, "stdout": "Management URL saved", "stderr": ""}

    async def get_management_url(self):
        if self._mgmt_url == DEFAULT_MGMT_URL:
            detected = await self._detect_management_url()
            if detected:
                self._mgmt_url = detected
        return self._mgmt_url

    async def get_version(self):
        decky.logger.info("=== get_version ===")
        info = self._status_info()
        if info["daemon_status"] == "Unavailable":
            return "Not installed"
        return info["version"]
