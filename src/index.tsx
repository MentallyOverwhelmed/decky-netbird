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
} from "@decky/ui";
import { callable, definePlugin } from "@decky/api";
import { FC, useState, useEffect, useCallback, useRef } from "react";

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
}

interface ActionResult {
  success: boolean;
  stdout?: string;
  stderr?: string;
  auth_url?: string;
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

const pillStyle = (color: string) => ({
  display: "inline-block", padding: "2px 8px", borderRadius: "10px",
  fontSize: "11px", fontWeight: "bold" as const, color: "#fff", backgroundColor: color,
});

function Pill({ label, color }: { label: string; color: string }) {
  return <span style={pillStyle(color)}>{label}</span>;
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
# 1. Make script executable
chmod +x netbird.sh
# 2. Run installer (select "Install NetBird" from the menu)
sudo ./netbird.sh
# 3. After installation completes, restart Decky Loader:
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
    <ConfirmModal
      strTitle="Authenticate with NetBird"
      strDescription={
        <div style={{ textAlign: "center" }}>
          <p style={{ margin: "0 0 16px 0", color: "#ccc" }}>Open this URL in your browser to authenticate:</p>
          <img src={`https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(url)}`} alt="QR Code" style={{ width: "256px", height: "256px", margin: "0 auto 8px auto", display: "block" }} />
          {showUrl && <div style={{ backgroundColor: "rgba(0,0,0,0.6)", padding: "12px", borderRadius: "4px", wordBreak: "break-all", fontSize: "12px", color: "#4FC3F7", fontFamily: "monospace", textAlign: "left" }}>{url}</div>}
        </div>
      }
      strOKButtonText={showUrl ? "Hide URL" : "Show URL"}
      onOK={() => setShowUrl(!showUrl)}
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
  const [blockInbound, setBlockInbound] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("netbird_block_inbound") === "true";
    return false;
  });
  const [setupKey, setSetupKey] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("netbird_setup_key") || "";
    return "";
  });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    try { const r = await getManagementUrl(); if (r) setManagementUrl(r); }
    catch (err) { console.error("Failed to get management URL:", err); }
  }, []);

  useEffect(() => { fetchSystemInfo(); }, [fetchSystemInfo]);
  useEffect(() => {
    if (systemInfo?.netbird_installed) { fetchStatus(); fetchManagementUrl(); }
  }, [systemInfo, fetchStatus, fetchManagementUrl]);
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (systemInfo?.netbird_installed) pollRef.current = setInterval(fetchStatus, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [systemInfo?.netbird_installed, fetchStatus]);

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
        const result = await connect(managementUrl, setupKey || undefined, blockInbound);
        if (result.auth_url) showAuthModal(result.auth_url);
      } else { await disconnect(); }
      await new Promise(r => setTimeout(r, 1500));
      await fetchStatus();
    } catch (err) { console.error("Toggle failed:", err); }
    finally { setActionLoading(false); }
  }, [managementUrl, setupKey, blockInbound, fetchStatus]);

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
      await saveManagementUrl(url);
      setManagementUrl(url);
      localStorage.setItem("netbird_mgmt_url", url);
    } catch (err) { console.error("Save URL failed:", err); }
    finally { setActionLoading(false); }
  }, []);

  const handleSaveSetupKey = useCallback((key: string) => {
    setSetupKey(key); localStorage.setItem("netbird_setup_key", key);
  }, []);

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
  const profileOptions = profiles.profiles.map((p, i) => ({ data: i, label: p }));

  return (
    <>
      {/* ── Status Card ── */}
      <PanelSection title="NetBird VPN">
        <PanelSectionRow>
          <div style={{ padding: "16px", backgroundColor: "rgba(0,0,0,0.4)", borderRadius: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <p style={{ margin: 0, fontSize: "18px", fontWeight: "bold", color: isConnected ? "#4CAF50" : needsLogin ? "#ff9800" : "#f44336" }}>
                  {isConnected ? "Connected" : needsLogin ? "Needs Login" : "Disconnected"}
                </p>
                {profiles.current && <p style={{ margin: "2px 0 0 0", fontSize: "11px", color: "#888" }}>Profile: {profiles.current}</p>}
                {statusInfo?.netbird_ip && <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: "#aaa" }}>{statusInfo.netbird_ip}</p>}
              </div>
              <Pill color={isConnected ? "#4CAF50" : needsLogin ? "#ff9800" : "#666"} label={isConnected ? "Active" : needsLogin ? "Pending" : "Offline"} />
            </div>
            {statusInfo?.peers && (
              <div style={{ marginTop: "8px", display: "flex", gap: "12px", fontSize: "12px", color: "#888" }}>
                <span>Peers: <strong style={{ color: "#ccc" }}>{statusInfo.peers.connected}/{statusInfo.peers.total}</strong></span>
              </div>
            )}
          </div>
        </PanelSectionRow>
      </PanelSection>

      {/* ── Connection Toggle ── */}
      <PanelSection title="Connection">
        <PanelSectionRow>
          <ToggleField
            label="VPN Toggle"
            description={isConnected ? "NetBird is active" : needsLogin ? "Authentication required" : "NetBird is off"}
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
          <ButtonItem layout="below" disabled={actionLoading || profiles.profiles.length <= 1} onClick={showRemoveProfileModal}>Remove Profile</ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      {/* ── Peers ── */}
      <PanelSection title={`Peers (${peers.length})`}>
        {peers.length === 0 ? (
          <PanelSectionRow><p style={{ margin: 0, fontSize: "12px", color: "#888", fontStyle: "italic" }}>No peers connected</p></PanelSectionRow>
        ) : (
          peers.map((peer, i) => (
            <PanelSectionRow key={i}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", backgroundColor: "rgba(0,0,0,0.3)", borderRadius: "6px" }}>
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
                <Pill color={peer.status === "connected" ? "#4CAF50" : peer.status === "idle" ? "#ff9800" : "#666"} label={peer.status} />
              </div>
            </PanelSectionRow>
          ))
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
          {forwardingRules.map((rule, i) => (
            <PanelSectionRow key={i}>
              <pre style={{ margin: 0, fontSize: "11px", color: "#ccc", fontFamily: "monospace", whiteSpace: "pre-wrap" }}>{rule.raw}</pre>
            </PanelSectionRow>
          ))}
        </PanelSection>
      )}

      {/* ── Expose ── */}
      <PanelSection title="Expose">
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={actionLoading || !isConnected} onClick={showExposeModal}>Expose Local Port</ButtonItem>
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
        <PanelSectionRow>
          <ToggleField label="Block Inbound" description="Block all inbound connections for extra security" checked={blockInbound} onChange={(val) => { setBlockInbound(val); localStorage.setItem("netbird_block_inbound", String(val)); }} />
        </PanelSectionRow>
      </PanelSection>

      {/* ── Actions ── */}
      <PanelSection title="Actions">
        {needsLogin && (
          <PanelSectionRow>
            <ButtonItem layout="below" disabled={actionLoading} onClick={() => handleToggleConnection(true)}>Authenticate & Connect</ButtonItem>
          </PanelSectionRow>
        )}
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={actionLoading} onClick={async () => { setActionLoading(true); await fetchStatus(); setActionLoading(false); }}>Refresh Status</ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={actionLoading} onClick={handleDeregister}>Deregister Peer</ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      {/* ── About ── */}
      <PanelSection title="About">
        <PanelSectionRow>
          <div style={{ padding: "12px", backgroundColor: "rgba(0,0,0,0.4)", borderRadius: "8px" }}>
            <p style={{ margin: 0, fontSize: "12px", color: "#888", fontStyle: "italic" }}>
              NetBird v{statusInfo?.version || "?"} &middot; {profiles.current}
            </p>
            <p style={{ margin: "6px 0 0 0", fontSize: "10px", color: "#666", fontStyle: "italic" }}>
              NetBird name and logo are trademarks of NetBird.io
            </p>
          </div>
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
