import {
  ButtonItem,
  PanelSection,
  PanelSectionRow,
  ToggleField,
  TextField,
  Spinner,
  staticClasses,
  ConfirmModal,
  showModal,
  DropdownItem,
  ModalRoot,
  DialogButton,
  DialogButtonPrimary,
  Focusable,
} from "@decky/ui";
import { callable, definePlugin, useQuickAccessVisible } from "@decky/api";
import { FC, useState, useEffect, useCallback, useRef, ReactNode, CSSProperties } from "react";

interface SystemInfo {
  netbird_installed: boolean;
  connected: boolean;
}

interface PeerDetail {
  ip: string;
  fqdn: string;
  status: string;
  latency: string;
  connection_type: string;
}

interface NetworkResource {
  name: string;
  network?: string;
  status: string;
}

interface ForwardingRule {
  raw: string;
}

interface ProfilesInfo {
  profiles: string[];
  current: string;
}

interface StatusInfo {
  connected: boolean;
  daemon_status?: string;
  netbird_ip?: string;
  peers?: { total: number; connected: number };
  status: { raw?: string; error?: string };
  version: string;
  session_expires_at?: string;
}

interface ActionResult {
  success: boolean;
  stdout?: string;
  stderr?: string;
  auth_url?: string;
}

interface RenewalInfo extends ActionResult {
  user_code?: string;
  device_code?: string;
}

interface DaemonConfig {
  [key: string]: unknown;
  mDMManagedFields?: string[];
}

interface SettingsInfo {
  config: DaemonConfig;
  features: { disable_profiles?: boolean; disable_update_settings?: boolean; disable_networks?: boolean };
  error?: string;
}

const getSystemInfo = callable<[], SystemInfo>("get_system_info");
const getStatus = callable<[], StatusInfo>("get_status");
const getPeers = callable<[], PeerDetail[]>("get_peers");
const getNetworks = callable<[], NetworkResource[]>("get_networks");
const getForwardingRules = callable<[], ForwardingRule[]>("get_forwarding_rules");
const getProfiles = callable<[], ProfilesInfo>("get_profiles");
const selectProfile = callable<[name: string], ActionResult>("select_profile");
const addProfile = callable<[name: string], ActionResult>("add_profile");
const removeProfile = callable<[name: string], ActionResult>("remove_profile");
const networkUp = callable<[name: string], ActionResult>("network_up");
const networkDown = callable<[name: string], ActionResult>("network_down");
const getManagementUrl = callable<[], string>("get_management_url");
const exposePort = callable<[port: number, protocol: string, password?: string, name_prefix?: string], ActionResult>("expose_port");
const connect = callable<[mgmt_url: string, setup_key?: string, block_inbound?: boolean], ActionResult>("connect");
const disconnect = callable<[], ActionResult>("disconnect");
const deregister = callable<[], ActionResult>("deregister");
const saveManagementUrl = callable<[url: string], ActionResult>("set_management_url");
const getSettings = callable<[], SettingsInfo>("get_settings");
const applySettings = callable<[updates: Record<string, unknown>], ActionResult>("set_settings");
const renameProfile = callable<[newName: string], ActionResult>("rename_profile");
const requestSessionRenewal = callable<[], RenewalInfo>("request_session_renewal");
const waitSessionRenewal = callable<[userCode: string, deviceCode: string], ActionResult>("wait_session_renewal");

const pillStyle = (color: string) => ({
  display: "inline-block", padding: "2px 8px", borderRadius: "10px",
  fontSize: "11px", fontWeight: "bold" as const, color: "#fff", backgroundColor: color,
});

function Pill({ label, color }: { label: string; color: string }) {
  return <span style={pillStyle(color)}>{label}</span>;
}

function CardFocusable({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  // Steam's Focusable only becomes a gamepad focus stop when `focusable` is
  // explicitly set (it defaults to not focusable when the card has no
  // interactive children); the prop is missing from the published d.ts.
  return (
    <Focusable {...({ focusable: true } as { focusable: boolean })} style={style}>
      {children}
    </Focusable>
  );
}

function LoadingSpinner() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "20px 0" }}>
      <Spinner width={32} height={32} />
    </div>
  );
}

const INSTALL_INSTRUCTIONS = `# Install NetBird on SteamOS
Run this in Konsole (Terminal):
# 1. Run installer (select "Install NetBird" from the menu)
bash netbird.sh
# 2. After installation completes, restart Decky Loader:
#    - Open Decky Loader settings
#    - Click "Restart Decky Loader"`;

function SetupGuide() {
  return (
    <PanelSection title="Setup Required">
      <PanelSectionRow>
        <div style={{ padding: "16px", backgroundColor: "rgba(0,0,0,0.4)", borderRadius: "8px" }}>
          <p style={{ margin: "0 0 4px 0", color: "#ff9800", fontWeight: "bold" }}>NetBird is not installed</p>
          <p style={{ margin: "0 0 8px 0", color: "#ccc" }}>Run the installer script from the plugin directory:</p>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", backgroundColor: "rgba(0,0,0,0.6)", padding: "12px", borderRadius: "4px", fontSize: "12px", color: "#4FC3F7", margin: 0, fontFamily: "monospace" }}>{INSTALL_INSTRUCTIONS}</pre>
        </div>
      </PanelSectionRow>
    </PanelSection>
  );
}

function AuthModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [showUrl, setShowUrl] = useState(false);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const status = await getStatus();
        if (status.connected) { clearInterval(interval); onClose(); }
      } catch {}
    }, 2000);
    return () => clearInterval(interval);
  }, [onClose]);

  return (
    <ModalRoot closeModal={onClose} onEscKeypress={onClose}>
      <div style={{ textAlign: "center" }}>
        <p style={{ margin: "0 0 12px 0", fontSize: "18px", fontWeight: "bold" }}>Authenticate with NetBird</p>
        <p style={{ margin: "0 0 12px 0", color: "#ccc" }}>Scan the QR code to authenticate. This window closes automatically once connected.</p>
        <img src={`https://api.qrserver.com/v1/create-qr-code/?size=192x192&data=${encodeURIComponent(url)}`} alt="QR Code" style={{ width: "192px", height: "192px", margin: "0 auto 12px auto", display: "block" }} />
        {showUrl && (
          <div style={{ backgroundColor: "rgba(0,0,0,0.6)", padding: "12px", borderRadius: "4px", wordBreak: "break-all", fontSize: "12px", color: "#4FC3F7", fontFamily: "monospace", textAlign: "left" }}>{url}</div>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }}>
        <DialogButton onClick={() => setShowUrl((v) => !v)}>{showUrl ? "Hide URL" : "Show URL"}</DialogButton>
        <DialogButtonPrimary onClick={onClose}>Close</DialogButtonPrimary>
      </div>
    </ModalRoot>
  );
}

function formatDuration(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function RenewSessionModal({ url, userCode, deviceCode, onClose, onRenewed }: {
  url: string; userCode: string; deviceCode: string; onClose: () => void; onRenewed: () => void;
}) {
  const [result, setResult] = useState<string | null>(null);
  const [showUrl, setShowUrl] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await waitSessionRenewal(userCode, deviceCode);
        if (!cancelled) setResult(r.success ? "Session renewed!" : (r.stderr || "Error renewing session"));
      } catch {
        if (!cancelled) setResult("Error renewing session");
      }
    })();
    return () => { cancelled = true; };
  }, [userCode, deviceCode]);

  const handleClose = () => {
    onClose();
    onRenewed();
  };

  return (
    <ModalRoot closeModal={handleClose} onEscKeypress={handleClose}>
      <div style={{ textAlign: "center" }}>
        <p style={{ margin: "0 0 12px 0", fontSize: "18px", fontWeight: "bold" }}>Extend Session</p>
        {result ? (
          <p style={{ color: result.startsWith("Error") || result.startsWith("HTTP") ? "#f44336" : "#4CAF50", fontWeight: "bold" }}>{result}</p>
        ) : (
          <>
            <p style={{ margin: "0 0 8px 0", color: "#ccc" }}>Scan the QR code to extend your session.</p>
            <img src={`https://api.qrserver.com/v1/create-qr-code/?size=192x192&data=${encodeURIComponent(url)}`} alt="QR Code" style={{ width: "192px", height: "192px", margin: "0 auto 8px auto", display: "block" }} />
            {showUrl && (
              <div style={{ backgroundColor: "rgba(0,0,0,0.6)", padding: "12px", borderRadius: "4px", wordBreak: "break-all", fontSize: "12px", color: "#4FC3F7", fontFamily: "monospace", textAlign: "left" }}>{url}</div>
            )}
          </>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }}>
        {!result && (
          <DialogButton onClick={() => setShowUrl((v) => !v)}>{showUrl ? "Hide URL" : "Show URL"}</DialogButton>
        )}
        <DialogButtonPrimary onClick={handleClose}>Close</DialogButtonPrimary>
      </div>
    </ModalRoot>
  );
}

function RenameProfileModal({ current, onClose }: { current: string; onClose: () => void }) {
  const [name, setName] = useState(current || "");
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  return (
    <ConfirmModal
      closeModal={working ? undefined : onClose}
      strTitle="Rename Profile"
      strDescription={
        <div>
          {result ? (
            <p style={{ color: result.startsWith("Error") || result.startsWith("HTTP") ? "#f44336" : "#4CAF50", fontWeight: "bold" }}>{result}</p>
          ) : (
            <TextField label="New Profile Name" value={name} disabled={working} onChange={(e) => setName(e.target.value)} />
          )}
        </div>
      }
      strOKButtonText={result ? "Close" : "Rename"}
      onOK={async () => {
        if (result) { onClose(); return; }
        if (!name.trim()) return;
        setWorking(true);
        try {
          const r = await renameProfile(name.trim());
          setResult(r.success ? `Profile renamed to "${name.trim()}"` : (r.stderr || "Error renaming profile"));
        } catch { setResult("Error renaming profile"); }
        setWorking(false);
      }}
    />
  );
}

const PROTOCOLS = [
  { data: 0, label: "tcp" },
  { data: 1, label: "udp" },
  { data: 2, label: "http" },
  { data: 3, label: "https" },
  { data: 4, label: "tls" },
];

function ExposeModal({ onClose }: { onClose: () => void }) {
  const [port, setPort] = useState("8080");
  const [protocol, setProtocol] = useState(0);
  const [password, setPassword] = useState("");
  const [namePrefix, setNamePrefix] = useState("");
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  return (
    <ConfirmModal
      closeModal={working ? undefined : onClose}
      strTitle="Expose Local Port"
      strDescription={
        <div>
          {result ? (
            <p style={{ color: "#4CAF50", fontWeight: "bold" }}>{result}</p>
          ) : (
            <>
              <p style={{ color: "#aaa", fontSize: "12px", marginBottom: "8px" }}>Expose a local port via NetBird's reverse proxy.</p>
              <TextField label="Port" value={port} disabled={working} onChange={(e) => setPort(e.target.value)} />
              <DropdownItem label="Protocol" menuLabel="Protocol" selectedOption={protocol} rgOptions={PROTOCOLS} onChange={(opt) => setProtocol(Number(opt.data))} />
              <TextField label="Password (optional)" value={password} disabled={working} onChange={(e) => setPassword(e.target.value)} />
              <TextField label="Name Prefix (optional)" value={namePrefix} disabled={working} onChange={(e) => setNamePrefix(e.target.value)} />
            </>
          )}
        </div>
      }
      strOKButtonText={result ? "Close" : "Expose"}
      onOK={async () => {
        if (result) { onClose(); return; }
        setWorking(true);
        try {
          const r = await exposePort(parseInt(port) || 8080, PROTOCOLS[protocol].label, password || undefined, namePrefix || undefined);
          setResult(r.success ? (r.stdout || "Port exposed!") : (r.stderr || "Failed"));
        } catch { setResult("Failed to expose port"); }
        setWorking(false);
      }}
    />
  );
}

function AddProfileModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  return (
    <ConfirmModal
      closeModal={working ? undefined : onClose}
      strTitle="Add Profile"
      strDescription={
        <div>
          {result ? (
            <p style={{ color: result.startsWith("Error") ? "#f44336" : "#4CAF50", fontWeight: "bold" }}>{result}</p>
          ) : (
            <TextField label="Profile Name" value={name} disabled={working} onChange={(e) => setName(e.target.value)} />
          )}
        </div>
      }
      strOKButtonText={result ? "Close" : "Add"}
      onOK={async () => {
        if (result) { onClose(); return; }
        if (!name.trim()) return;
        setWorking(true);
        try {
          const r = await addProfile(name.trim());
          setResult(r.success ? `Profile "${name.trim()}" added` : (r.stderr || "Error adding profile"));
        } catch { setResult("Error adding profile"); }
        setWorking(false);
      }}
    />
  );
}

function RemoveProfileModal({ profiles, current, onClose }: { profiles: string[]; current: string; onClose: () => void }) {
  const removable = profiles.filter(p => p !== current);
  const [selected, setSelected] = useState(0);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const options = removable.map((p, i) => ({ data: i, label: p }));

  if (removable.length === 0) {
    return (
      <ConfirmModal closeModal={onClose} strTitle="Remove Profile" strDescription={<p style={{ color: "#ff9800" }}>No other profiles to remove.</p>} strOKButtonText="Close" onOK={onClose} />
    );
  }

  return (
    <ConfirmModal
      closeModal={working ? undefined : onClose}
      strTitle="Remove Profile"
      strDescription={
        <div>
          {result ? (
            <p style={{ color: result.startsWith("Error") ? "#f44336" : "#4CAF50", fontWeight: "bold" }}>{result}</p>
          ) : (
            <>
              <p style={{ color: "#aaa", fontSize: "12px", marginBottom: "8px" }}>Select a profile to remove (cannot remove the active profile).</p>
              <DropdownItem label="Profile" menuLabel="Select" selectedOption={selected} rgOptions={options} onChange={(opt) => setSelected(Number(opt.data))} />
            </>
          )}
        </div>
      }
      strOKButtonText={result ? "Close" : "Remove"}
      onOK={async () => {
        if (result) { onClose(); return; }
        setWorking(true);
        try {
          const name = removable[selected];
          const r = await removeProfile(name);
          setResult(r.success ? `Profile "${name}" removed` : (r.stderr || "Error removing profile"));
        } catch { setResult("Error removing profile"); }
        setWorking(false);
      }}
    />
  );
}

interface SettingDef {
  key: string;
  sendKey: string;
  label: string;
  desc: string;
  mdm?: string;
}

const TOGGLE_SETTINGS: SettingDef[] = [
  { key: "disableAutoConnect", sendKey: "disableAutoConnect", mdm: "disableAutoConnect", label: "Disable Auto-Connect", desc: "Do not auto-connect when the daemon starts" },
  { key: "blockInbound", sendKey: "blockInbound", mdm: "blockInbound", label: "Block Inbound", desc: "Block all inbound connections for extra security" },
  { key: "blockLanAccess", sendKey: "blockLanAccess", label: "Block LAN Access", desc: "Block access to LAN devices" },
  { key: "disableIpv6", sendKey: "disableIpv6", label: "Disable IPv6", desc: "Disable IPv6 on the WireGuard interface" },
  { key: "disableDns", sendKey: "disableDns", label: "Disable DNS", desc: "Do not manage DNS resolution" },
  { key: "disableClientRoutes", sendKey: "disableClientRoutes", mdm: "disableClientRoutes", label: "Disable Client Routes", desc: "Ignore routes pushed by the management server" },
  { key: "disableServerRoutes", sendKey: "disableServerRoutes", mdm: "disableServerRoutes", label: "Disable Server Routes", desc: "Do not advertise routes to other peers" },
  { key: "rosenpassEnabled", sendKey: "rosenpassEnabled", mdm: "rosenpassEnabled", label: "Rosenpass", desc: "Enable post-quantum handshake encryption" },
  { key: "rosenpassPermissive", sendKey: "rosenpassPermissive", mdm: "rosenpassPermissive", label: "Rosenpass Permissive", desc: "Allow peers without rosenpass support" },
];

function Content() {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [statusInfo, setStatusInfo] = useState<StatusInfo | null>(null);
  const [peers, setPeers] = useState<PeerDetail[]>([]);
  const [networks, setNetworks] = useState<NetworkResource[]>([]);
  const [forwardingRules, setForwardingRules] = useState<ForwardingRule[]>([]);
  const [profiles, setProfiles] = useState<ProfilesInfo>({ profiles: [], current: "" });
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [managementUrl, setManagementUrl] = useState("");
  const [setupKey, setSetupKey] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("netbird_setup_key") || "";
    return "";
  });
  const [settings, setSettings] = useState<SettingsInfo | null>(null);
  const [cfg, setCfg] = useState<DaemonConfig | null>(null);
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const quickAccessVisible = useQuickAccessVisible();

  const fetchSystemInfo = useCallback(async () => {
    setLoading(true);
    try { setSystemInfo(await getSystemInfo()); }
    catch (err) { console.error("Failed to get system info:", err); }
    finally { setLoading(false); }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const [statusResult, peersResult, networksResult, fwd, prof] = await Promise.all([
        getStatus(), getPeers(), getNetworks(), getForwardingRules(), getProfiles(),
      ]);
      setStatusInfo(statusResult);
      setPeers(peersResult);
      setNetworks(networksResult);
      setForwardingRules(fwd);
      if (prof) setProfiles(prof);
    } catch (err) { console.error("Failed to fetch status:", err); }
  }, []);

  const fetchManagementUrl = useCallback(async () => {
    try {
      const [url, s] = await Promise.all([getManagementUrl(), getSettings()]);
      if (url) setManagementUrl(url);
      if (s) { setSettings(s); setCfg(s.config || {}); }
    } catch (err) { console.error("Failed to get management URL:", err); }
  }, []);

  useEffect(() => { fetchSystemInfo(); }, [fetchSystemInfo]);
  useEffect(() => {
    if (systemInfo?.netbird_installed) { fetchStatus(); fetchManagementUrl(); }
  }, [systemInfo, fetchStatus, fetchManagementUrl]);
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (systemInfo?.netbird_installed && quickAccessVisible) pollRef.current = setInterval(fetchStatus, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [systemInfo?.netbird_installed, fetchStatus, quickAccessVisible]);
  useEffect(() => {
    if (quickAccessVisible && systemInfo?.netbird_installed) fetchStatus();
  }, [quickAccessVisible, systemInfo?.netbird_installed, fetchStatus]);

  const showAuthModal = (url: string) => {
    let closeModal = () => {};
    const C: FC = () => <AuthModal url={url} onClose={closeModal} />;
    const modal = showModal(<C />, window, { strTitle: "Authenticate", popupWidth: 420, popupHeight: 520 });
    closeModal = modal.Close;
  };

  const handleToggleConnection = useCallback(async (value: boolean) => {
    setActionLoading(true);
    try {
      if (value) {
        const result = await connect(managementUrl, setupKey || undefined);
        if (result.auth_url) showAuthModal(result.auth_url);
      } else { await disconnect(); }
      await new Promise(r => setTimeout(r, 1500));
      await fetchStatus();
    } catch (err) { console.error("Toggle failed:", err); }
    finally { setActionLoading(false); }
  }, [managementUrl, setupKey, fetchStatus]);

  const handleNetworkToggle = useCallback(async (name: string, value: boolean) => {
    setActionLoading(true);
    try {
      if (value) {
        const isExitNode = (n: NetworkResource) => n.network?.includes("0.0.0.0/0") ?? false;
        const exiting = networks.filter(n => n.name !== name && isExitNode(n) && n.status === "Connected");
        for (const n of exiting) await networkDown(n.name);
        await networkUp(name);
      } else { await networkDown(name); }
      await new Promise(r => setTimeout(r, 500));
      await fetchStatus();
    } catch (err) { console.error("Network toggle failed:", err); }
    finally { setActionLoading(false); }
  }, [fetchStatus, networks]);

  const handleProfileSwitch = useCallback(async (name: string) => {
    setActionLoading(true);
    try {
      await selectProfile(name);
      await new Promise(r => setTimeout(r, 1000));
      await fetchStatus();
    } catch (err) { console.error("Profile switch failed:", err); }
    finally { setActionLoading(false); }
  }, [fetchStatus]);

  const handleSaveUrl = useCallback(async (url: string) => {
    setActionLoading(true);
    try {
      const r = await saveManagementUrl(url);
      setManagementUrl(url);
      localStorage.setItem("netbird_mgmt_url", url);
      setNotice(r.success ? (r.stdout || "Management URL saved") : (r.stderr || "Failed to save management URL"));
    } catch (err) { console.error("Save URL failed:", err); setNotice("Failed to save management URL"); }
    finally { setActionLoading(false); }
  }, []);

  const handleSettingToggle = useCallback(async (s: SettingDef, value: boolean) => {
    setCfg((prev) => ({ ...(prev || {}), [s.key]: value }));
    try {
      const r = await applySettings({ [s.sendKey]: value });
      setNotice(r.success ? (r.stdout || "Settings applied") : (r.stderr || "Failed to apply setting"));
    } catch (err) { console.error("Apply setting failed:", err); setNotice("Failed to apply setting"); }
    const fresh = await getSettings().catch(() => null);
    if (fresh) setCfg(fresh.config || {});
  }, []);

  const handleRenewSession = useCallback(async () => {
    setActionLoading(true);
    try {
      const r = await requestSessionRenewal();
      if (!r.success || !r.auth_url) {
        setNotice(r.stderr || "Cannot start session renewal");
        return;
      }
      let closeModal = () => {};
      const C: FC = () => (
        <RenewSessionModal url={r.auth_url || ""} userCode={r.user_code || ""} deviceCode={r.device_code || ""} onClose={closeModal} onRenewed={fetchStatus} />
      );
      const modal = showModal(<C />, window, { strTitle: "Extend Session", popupWidth: 420, popupHeight: 520 });
      closeModal = modal.Close;
    } catch (err) { console.error("Renew failed:", err); setNotice("Failed to start session renewal"); }
    finally { setActionLoading(false); }
  }, [fetchStatus]);

  const handleSaveSetupKey = useCallback((key: string) => {
    setSetupKey(key); localStorage.setItem("netbird_setup_key", key);
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([fetchStatus(), fetchManagementUrl()]);
    } catch (err) { console.error("Refresh failed:", err); }
    finally { setRefreshing(false); }
  }, [fetchStatus, fetchManagementUrl]);

  const handleDeregister = useCallback(async () => {
    setActionLoading(true);
    try {
      await deregister();
      await new Promise(r => setTimeout(r, 1000));
      await fetchStatus();
    } catch (err) { console.error("Deregister failed:", err); }
    finally { setActionLoading(false); }
  }, [fetchStatus]);

  const showExposeModal = useCallback(() => {
    let closeModal = () => {};
    const C: FC = () => <ExposeModal onClose={closeModal} />;
    const modal = showModal(<C />, window, { strTitle: "Expose", popupWidth: 420, popupHeight: 520 });
    closeModal = modal.Close;
  }, []);

  const showAddProfileModal = useCallback(() => {
    let closeModal = () => {};
    const C: FC = () => <AddProfileModal onClose={closeModal} />;
    const modal = showModal(<C />, window, { strTitle: "Add Profile", popupWidth: 400, popupHeight: 300 });
    closeModal = modal.Close;
  }, []);

  const showRemoveProfileModal = useCallback(() => {
    let closeModal = () => {};
    const C: FC = () => <RemoveProfileModal profiles={profiles.profiles} current={profiles.current} onClose={closeModal} />;
    const modal = showModal(<C />, window, { strTitle: "Remove Profile", popupWidth: 400, popupHeight: 350 });
    closeModal = modal.Close;
  }, [profiles]);

  const showRenameProfileModal = useCallback(() => {
    let closeModal = () => {};
    const C: FC = () => <RenameProfileModal current={profiles.current} onClose={closeModal} />;
    const modal = showModal(<C />, window, { strTitle: "Rename Profile", popupWidth: 400, popupHeight: 300 });
    closeModal = modal.Close;
  }, [profiles.current]);

  if (loading) {
    return <PanelSection title="NetBird VPN"><PanelSectionRow><LoadingSpinner /></PanelSectionRow></PanelSection>;
  }

  if (!systemInfo?.netbird_installed) {
    return (
      <>
        <PanelSection title="NetBird VPN"><PanelSectionRow><p style={{ margin: 0, color: "#ff9800" }}>NetBird is not installed on this system.</p></PanelSectionRow></PanelSection>
        <SetupGuide />
      </>
    );
  }

  const needsLogin = statusInfo?.daemon_status === "NeedsLogin";
  const isConnected = statusInfo?.connected || false;
  const authFailed = statusInfo?.daemon_status === "LoginFailed";
  const connecting = statusInfo?.daemon_status === "Connecting";
  const displayLabel = isConnected ? "Connected" : needsLogin ? "Needs Login" : authFailed ? "Auth Failed" : connecting ? "Connecting" : "Disconnected";
  const displayColor = isConnected ? "#4CAF50" : needsLogin ? "#ff9800" : authFailed ? "#f44336" : connecting ? "#4FC3F7" : "#f44336";
  const profileOptions = profiles.profiles.map((p, i) => ({ data: i, label: p }));
  const sessionMs = statusInfo?.session_expires_at ? new Date(statusInfo.session_expires_at).getTime() - Date.now() : 0;
  const sessionValid = isConnected && sessionMs > 0;
  const sessionWarning = sessionValid && sessionMs < 5 * 60 * 1000;

  if (!isConnected && (needsLogin || authFailed)) {
    return (
      <>
        <PanelSection title="NetBird VPN">
          <PanelSectionRow>
            <div style={{ padding: "16px", backgroundColor: "rgba(0,0,0,0.4)", borderRadius: "8px" }}>
              <p style={{ margin: 0, fontSize: "18px", fontWeight: "bold", color: displayColor }}>{displayLabel}</p>
              <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#aaa" }}>
                {authFailed ? "Authentication failed. Check your credentials and try again." : "Log in to connect to your NetBird network."}
              </p>
            </div>
          </PanelSectionRow>
        </PanelSection>
        <PanelSection title="Login">
          <PanelSectionRow>
            <TextField label="Management URL" description="NetBird management server address" value={managementUrl} disabled={actionLoading} onChange={(e) => setManagementUrl(e.target.value)} />
          </PanelSectionRow>
          <PanelSectionRow>
            <TextField label="Setup Key" description="Optional: pre-authentication key" value={setupKey} disabled={actionLoading} onChange={(e) => handleSaveSetupKey(e.target.value)} />
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem layout="below" disabled={actionLoading} onClick={() => handleToggleConnection(true)}>Authenticate & Connect</ButtonItem>
          </PanelSectionRow>
          {notice && (
            <PanelSectionRow>
              <p style={{ margin: 0, fontSize: "11px", color: notice.startsWith("Failed") || notice.startsWith("HTTP") ? "#f44336" : "#4CAF50" }}>{notice}</p>
            </PanelSectionRow>
          )}
        </PanelSection>
      </>
    );
  }

  return (
    <>
      {/* ── Status Card ── */}
      <PanelSection title="NetBird VPN">
        <PanelSectionRow>
          <CardFocusable style={{ width: "100%" }}>
            <div style={{ padding: "16px", backgroundColor: "rgba(0,0,0,0.4)", borderRadius: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <p style={{ margin: 0, fontSize: "18px", fontWeight: "bold", color: displayColor }}>
                  {displayLabel}
                </p>
                {profiles.current && <p style={{ margin: "2px 0 0 0", fontSize: "11px", color: "#888" }}>Profile: {profiles.current}</p>}
                {statusInfo?.netbird_ip && <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: "#aaa" }}>{statusInfo.netbird_ip}</p>}
              </div>
              <Pill color={isConnected ? "#4CAF50" : needsLogin ? "#ff9800" : authFailed ? "#f44336" : connecting ? "#4FC3F7" : "#666"} label={isConnected ? "Active" : needsLogin ? "Pending" : authFailed ? "Failed" : connecting ? "Connecting" : "Offline"} />
            </div>
            {statusInfo?.peers && (
              <div style={{ marginTop: "8px", display: "flex", gap: "12px", fontSize: "12px", color: "#888" }}>
                <span>Peers: <strong style={{ color: "#ccc" }}>{statusInfo.peers.connected}/{statusInfo.peers.total}</strong></span>
              </div>
            )}
            {sessionValid && (
              <div style={{ marginTop: "8px", fontSize: "12px", color: sessionWarning ? "#ff9800" : "#888" }}>
                {sessionWarning && <span style={{ fontWeight: "bold", marginRight: "6px" }}>Session expires soon!</span>}
                <span>Session expires in <strong style={{ color: sessionWarning ? "#ff9800" : "#ccc" }}>{formatDuration(sessionMs)}</strong></span>
              </div>
            )}
            {notice && (
              <div style={{ marginTop: "8px", fontSize: "11px", color: notice.startsWith("Failed") || notice.startsWith("HTTP") ? "#f44336" : "#4CAF50" }}>{notice}</div>
            )}
          </div>
          </CardFocusable>
        </PanelSectionRow>
        {sessionValid && (
          <PanelSectionRow>
            <ButtonItem layout="below" disabled={actionLoading} onClick={handleRenewSession}>
              {sessionWarning ? "Extend Session Now" : "Extend Session"}
            </ButtonItem>
          </PanelSectionRow>
        )}
      </PanelSection>

      {/* ── Connection Toggle ── */}
      <PanelSection title="Connection">
        <PanelSectionRow>
          <ToggleField
            label="VPN Toggle"
            description={isConnected ? "NetBird is active" : needsLogin ? "Authentication required" : authFailed ? "Authentication failed - retry" : "NetBird is off"}
            checked={isConnected}
            disabled={actionLoading}
            onChange={handleToggleConnection}
          />
        </PanelSectionRow>
      </PanelSection>

      {/* ── Profiles ── */}
      <PanelSection title="Profile">
        <PanelSectionRow>
          <DropdownItem
            label="Active Profile"
            menuLabel="Switch Profile"
            selectedOption={profileOptions.find((o) => o.label === profiles.current)?.data ?? 0}
            disabled={actionLoading || profileOptions.length === 0}
            rgOptions={profileOptions}
            onChange={(opt) => handleProfileSwitch(String(opt.label))}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={actionLoading} onClick={showAddProfileModal}>Add Profile</ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={actionLoading || !profiles.current} onClick={showRenameProfileModal}>Rename Profile</ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={actionLoading || profiles.profiles.length <= 1} onClick={showRemoveProfileModal}>Remove Profile</ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      {/* ── Peers ── */}
      <PanelSection title={`Peers (${peers.length})`}>
        {peers.length === 0 ? (
          <PanelSectionRow><p style={{ margin: 0, fontSize: "12px", color: "#888", fontStyle: "italic" }}>No peers connected</p></PanelSectionRow>
        ) : (
          <PanelSectionRow>
            <CardFocusable style={{ width: "100%" }}>
              <div style={{ backgroundColor: "rgba(0,0,0,0.3)", borderRadius: "6px", overflow: "hidden" }}>
                {peers.map((peer, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderBottom: i < peers.length - 1 ? "1px solid rgba(255,255,255,0.08)" : "none" }}>
                    <div>
                      <p style={{ margin: 0, fontSize: "13px", color: "#ddd" }}>{peer.fqdn || peer.ip}</p>
                      <div style={{ display: "flex", gap: "6px", marginTop: "2px" }}>
                        {peer.latency && <span style={{ fontSize: "11px", color: "#888" }}>{peer.latency}</span>}
                        {peer.connection_type && (
                          <span style={{ fontSize: "11px", color: peer.connection_type === "P2P" ? "#4FC3F7" : "#ff9800" }}>
                            {peer.connection_type}
                          </span>
                        )}
                      </div>
                    </div>
                    <Pill color={peer.status === "connected" ? "#4CAF50" : peer.status === "idle" ? "#ff9800" : peer.status === "connecting" ? "#4FC3F7" : "#f44336"} label={peer.status} />
                  </div>
                ))}
            </div>
          </CardFocusable>
        </PanelSectionRow>
        )}
      </PanelSection>

      {/* ── Network Resources ── */}
      {networks.length > 0 && (
        <PanelSection title="Network Resources">
          {networks.map((net, i) => {
            const netConnected = net.status === "Connected";
            return (
              <PanelSectionRow key={i}>
                <ToggleField
                  label={net.name}
                  description={net.network ? `${net.network} — ${netConnected ? "Connected" : "Disconnected"}` : netConnected ? "Connected" : "Disconnected"}
                  checked={netConnected}
                  disabled={actionLoading}
                  onChange={(val) => handleNetworkToggle(net.name, val)}
                />
              </PanelSectionRow>
            );
          })}
        </PanelSection>
      )}

      {/* ── Port Forwarding ── */}
      {forwardingRules.length > 0 && (
        <PanelSection title="Port Forwarding">
          <PanelSectionRow>
            <div style={{ backgroundColor: "rgba(0,0,0,0.3)", borderRadius: "6px", overflow: "hidden" }}>
              {forwardingRules.map((rule, i) => (
                <pre key={i} style={{ margin: 0, padding: "8px 12px", fontSize: "11px", color: "#ccc", fontFamily: "monospace", whiteSpace: "pre-wrap", borderBottom: i < forwardingRules.length - 1 ? "1px solid rgba(255,255,255,0.08)" : "none" }}>{rule.raw}</pre>
              ))}
            </div>
          </PanelSectionRow>
        </PanelSection>
      )}

      {/* ── Expose ── */}
      <PanelSection title="Expose">
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={actionLoading || !isConnected} onClick={showExposeModal}>Expose Local Port</ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <p style={{ margin: 0, fontSize: "11px", color: "#888", fontStyle: "italic" }}>
            To use this option, firstly enable &quot;Enable Peer Expose&quot; and add the group in which your Steam Deck is.
          </p>
        </PanelSectionRow>
      </PanelSection>

      {/* ── Configuration ── */}
      <PanelSection title="Configuration">
        <PanelSectionRow>
          <TextField label="Management URL" description="NetBird management server address" value={managementUrl} disabled={actionLoading} onChange={(e) => setManagementUrl(e.target.value)} />
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={actionLoading} onClick={() => handleSaveUrl(managementUrl)}>Save URL</ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <TextField label="Setup Key" description="Optional: pre-authentication key" value={setupKey} disabled={actionLoading} onChange={(e) => handleSaveSetupKey(e.target.value)} />
        </PanelSectionRow>
      </PanelSection>

      {/* ── Settings ── */}
      {settings && (
        <PanelSection title="Settings">
          {settings.error || !cfg || Object.keys(cfg).length === 0 ? (
            <PanelSectionRow>
              <p style={{ margin: 0, fontSize: "12px", color: "#ff9800" }}>Log in first to manage settings.</p>
            </PanelSectionRow>
          ) : (
            TOGGLE_SETTINGS.map((s) => {
              const managedByMdm = s.mdm ? ((cfg.mDMManagedFields || []).includes(s.mdm)) : false;
              return (
                <PanelSectionRow key={s.key}>
                  <ToggleField
                    label={s.label}
                    description={managedByMdm ? `${s.desc} — Managed by MDM` : s.desc}
                    checked={Boolean(cfg[s.key])}
                    disabled={actionLoading || managedByMdm}
                    onChange={(v) => handleSettingToggle(s, v)}
                  />
                </PanelSectionRow>
              );
            })
          )}
        </PanelSection>
      )}

      {/* ── Actions ── */}
      <PanelSection title="Actions">
        {needsLogin && (
          <PanelSectionRow>
            <ButtonItem layout="below" disabled={actionLoading} onClick={() => handleToggleConnection(true)}>Authenticate & Connect</ButtonItem>
          </PanelSectionRow>
        )}
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={refreshing} onClick={handleRefresh}>
            {refreshing ? "Refreshing…" : "Refresh Status"}
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={actionLoading} onClick={handleDeregister}>Deregister Peer</ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      {/* ── About ── */}
      <PanelSection title="About">
        <PanelSectionRow>
          <CardFocusable style={{ width: "100%" }}>
            <div style={{ padding: "12px", backgroundColor: "rgba(0,0,0,0.4)", borderRadius: "8px" }}>
              <p style={{ margin: 0, fontSize: "12px", color: "#888", fontStyle: "italic" }}>
                NetBird v{statusInfo?.version || "?"} &middot; {profiles.current}
              </p>
              <p style={{ margin: "6px 0 0 0", fontSize: "10px", color: "#666", fontStyle: "italic" }}>
                NetBird name and logo are trademarks of NetBird.io
              </p>
              </div>
            </CardFocusable>
          </PanelSectionRow>
      </PanelSection>
    </>
  );
}

export default definePlugin(() => {
  console.log("NetBird VPN plugin initializing");
  return {
    name: "NetBird VPN",
    titleView: <div className={staticClasses.Title}>NetBird VPN</div>,
    content: <Content />,
    icon: (
      <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
      </svg>
    ),
    onDismount() { console.log("NetBird VPN plugin unloading"); },
  };
});
