const manifest = {"name":"NetBird VPN"};
const API_VERSION = 2;
const internalAPIConnection = window.__DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit;
if (!internalAPIConnection) {
    throw new Error('[@decky/api]: Failed to connect to the loader as as the loader API was not initialized. This is likely a bug in Decky Loader.');
}
let api;
try {
    api = internalAPIConnection.connect(API_VERSION, manifest.name);
}
catch {
    api = internalAPIConnection.connect(1, manifest.name);
    console.warn(`[@decky/api] Requested API version ${API_VERSION} but the running loader only supports version 1. Some features may not work.`);
}
if (api._version != API_VERSION) {
    console.warn(`[@decky/api] Requested API version ${API_VERSION} but the running loader only supports version ${api._version}. Some features may not work.`);
}
const callable = api.callable;
const useQuickAccessVisible = api.useQuickAccessVisible;
const definePlugin = (fn) => {
    return (...args) => {
        return fn(...args);
    };
};

const getSystemInfo = callable("get_system_info");
const getStatus = callable("get_status");
const getPeers = callable("get_peers");
const getNetworks = callable("get_networks");
const getForwardingRules = callable("get_forwarding_rules");
const getProfiles = callable("get_profiles");
const selectProfile = callable("select_profile");
const addProfile = callable("add_profile");
const removeProfile = callable("remove_profile");
const networkUp = callable("network_up");
const networkDown = callable("network_down");
const getManagementUrl = callable("get_management_url");
const exposePort = callable("expose_port");
const connect = callable("connect");
const disconnect = callable("disconnect");
const deregister = callable("deregister");
const saveManagementUrl = callable("set_management_url");
const getSettings = callable("get_settings");
const applySettings = callable("set_settings");
const renameProfile = callable("rename_profile");
const requestSessionRenewal = callable("request_session_renewal");
const waitSessionRenewal = callable("wait_session_renewal");
const pillStyle = (color) => ({
    display: "inline-block", padding: "2px 8px", borderRadius: "10px",
    fontSize: "11px", fontWeight: "bold", color: "#fff", backgroundColor: color,
});
function Pill({ label, color }) {
    return SP_JSX.jsx("span", { style: pillStyle(color), children: label });
}
function CardFocusable({ children, style }) {
    // Steam's Focusable only becomes a gamepad focus stop when `focusable` is
    // explicitly set (it defaults to not focusable when the card has no
    // interactive children); the prop is missing from the published d.ts.
    return (SP_JSX.jsx(DFL.Focusable, { ...{ focusable: true }, style: style, children: children }));
}
function LoadingSpinner() {
    return (SP_JSX.jsx("div", { style: { display: "flex", justifyContent: "center", padding: "20px 0" }, children: SP_JSX.jsx(DFL.Spinner, { width: 32, height: 32 }) }));
}
const INSTALL_INSTRUCTIONS = `# Install NetBird on SteamOS
Run this in Konsole (Terminal):
# 1. Run installer (select "Install NetBird" from the menu)
bash netbird.sh
# 2. After installation completes, restart Decky Loader:
#    - Open Decky Loader settings
#    - Click "Restart Decky Loader"`;
function SetupGuide() {
    return (SP_JSX.jsx(DFL.PanelSection, { title: "Setup Required", children: SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsxs("div", { style: { padding: "16px", backgroundColor: "rgba(0,0,0,0.4)", borderRadius: "8px" }, children: [SP_JSX.jsx("p", { style: { margin: "0 0 4px 0", color: "#ff9800", fontWeight: "bold" }, children: "NetBird is not installed" }), SP_JSX.jsx("p", { style: { margin: "0 0 8px 0", color: "#ccc" }, children: "Run the installer script from the plugin directory:" }), SP_JSX.jsx("pre", { style: { whiteSpace: "pre-wrap", wordBreak: "break-all", backgroundColor: "rgba(0,0,0,0.6)", padding: "12px", borderRadius: "4px", fontSize: "12px", color: "#4FC3F7", margin: 0, fontFamily: "monospace" }, children: INSTALL_INSTRUCTIONS })] }) }) }));
}
function AuthModal({ url, onClose }) {
    const [showUrl, setShowUrl] = SP_REACT.useState(false);
    SP_REACT.useEffect(() => {
        const interval = setInterval(async () => {
            try {
                const status = await getStatus();
                if (status.connected) {
                    clearInterval(interval);
                    onClose();
                }
            }
            catch { }
        }, 2000);
        return () => clearInterval(interval);
    }, [onClose]);
    return (SP_JSX.jsxs(DFL.ModalRoot, { closeModal: onClose, onEscKeypress: onClose, children: [SP_JSX.jsxs("div", { style: { textAlign: "center" }, children: [SP_JSX.jsx("p", { style: { margin: "0 0 12px 0", fontSize: "18px", fontWeight: "bold" }, children: "Authenticate with NetBird" }), SP_JSX.jsx("p", { style: { margin: "0 0 12px 0", color: "#ccc" }, children: "Scan the QR code to authenticate. This window closes automatically once connected." }), SP_JSX.jsx("img", { src: `https://api.qrserver.com/v1/create-qr-code/?size=192x192&data=${encodeURIComponent(url)}`, alt: "QR Code", style: { width: "192px", height: "192px", margin: "0 auto 12px auto", display: "block" } }), showUrl && (SP_JSX.jsx("div", { style: { backgroundColor: "rgba(0,0,0,0.6)", padding: "12px", borderRadius: "4px", wordBreak: "break-all", fontSize: "12px", color: "#4FC3F7", fontFamily: "monospace", textAlign: "left" }, children: url }))] }), SP_JSX.jsxs("div", { style: { display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }, children: [SP_JSX.jsx(DFL.DialogButton, { onClick: () => setShowUrl((v) => !v), children: showUrl ? "Hide URL" : "Show URL" }), SP_JSX.jsx(DFL.DialogButtonPrimary, { onClick: onClose, children: "Close" })] })] }));
}
function formatDuration(ms) {
    const mins = Math.max(0, Math.floor(ms / 60000));
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function RenewSessionModal({ url, userCode, deviceCode, onClose, onRenewed }) {
    const [result, setResult] = SP_REACT.useState(null);
    const [showUrl, setShowUrl] = SP_REACT.useState(false);
    SP_REACT.useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const r = await waitSessionRenewal(userCode, deviceCode);
                if (!cancelled)
                    setResult(r.success ? "Session renewed!" : (r.stderr || "Error renewing session"));
            }
            catch {
                if (!cancelled)
                    setResult("Error renewing session");
            }
        })();
        return () => { cancelled = true; };
    }, [userCode, deviceCode]);
    const handleClose = () => {
        onClose();
        onRenewed();
    };
    return (SP_JSX.jsxs(DFL.ModalRoot, { closeModal: handleClose, onEscKeypress: handleClose, children: [SP_JSX.jsxs("div", { style: { textAlign: "center" }, children: [SP_JSX.jsx("p", { style: { margin: "0 0 12px 0", fontSize: "18px", fontWeight: "bold" }, children: "Extend Session" }), result ? (SP_JSX.jsx("p", { style: { color: result.startsWith("Error") || result.startsWith("HTTP") ? "#f44336" : "#4CAF50", fontWeight: "bold" }, children: result })) : (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx("p", { style: { margin: "0 0 8px 0", color: "#ccc" }, children: "Scan the QR code to extend your session." }), SP_JSX.jsx("img", { src: `https://api.qrserver.com/v1/create-qr-code/?size=192x192&data=${encodeURIComponent(url)}`, alt: "QR Code", style: { width: "192px", height: "192px", margin: "0 auto 8px auto", display: "block" } }), showUrl && (SP_JSX.jsx("div", { style: { backgroundColor: "rgba(0,0,0,0.6)", padding: "12px", borderRadius: "4px", wordBreak: "break-all", fontSize: "12px", color: "#4FC3F7", fontFamily: "monospace", textAlign: "left" }, children: url }))] }))] }), SP_JSX.jsxs("div", { style: { display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }, children: [!result && (SP_JSX.jsx(DFL.DialogButton, { onClick: () => setShowUrl((v) => !v), children: showUrl ? "Hide URL" : "Show URL" })), SP_JSX.jsx(DFL.DialogButtonPrimary, { onClick: handleClose, children: "Close" })] })] }));
}
function RenameProfileModal({ current, onClose }) {
    const [name, setName] = SP_REACT.useState(current || "");
    const [working, setWorking] = SP_REACT.useState(false);
    const [result, setResult] = SP_REACT.useState(null);
    return (SP_JSX.jsx(DFL.ConfirmModal, { closeModal: working ? undefined : onClose, strTitle: "Rename Profile", strDescription: SP_JSX.jsx("div", { children: result ? (SP_JSX.jsx("p", { style: { color: result.startsWith("Error") || result.startsWith("HTTP") ? "#f44336" : "#4CAF50", fontWeight: "bold" }, children: result })) : (SP_JSX.jsx(DFL.TextField, { label: "New Profile Name", value: name, disabled: working, onChange: (e) => setName(e.target.value) })) }), strOKButtonText: result ? "Close" : "Rename", onOK: async () => {
            if (result) {
                onClose();
                return;
            }
            if (!name.trim())
                return;
            setWorking(true);
            try {
                const r = await renameProfile(name.trim());
                setResult(r.success ? `Profile renamed to "${name.trim()}"` : (r.stderr || "Error renaming profile"));
            }
            catch {
                setResult("Error renaming profile");
            }
            setWorking(false);
        } }));
}
const PROTOCOLS = [
    { data: 0, label: "tcp" },
    { data: 1, label: "udp" },
    { data: 2, label: "http" },
    { data: 3, label: "https" },
    { data: 4, label: "tls" },
];
function ExposeModal({ onClose }) {
    const [port, setPort] = SP_REACT.useState("8080");
    const [protocol, setProtocol] = SP_REACT.useState(0);
    const [password, setPassword] = SP_REACT.useState("");
    const [namePrefix, setNamePrefix] = SP_REACT.useState("");
    const [working, setWorking] = SP_REACT.useState(false);
    const [result, setResult] = SP_REACT.useState(null);
    return (SP_JSX.jsx(DFL.ConfirmModal, { closeModal: working ? undefined : onClose, strTitle: "Expose Local Port", strDescription: SP_JSX.jsx("div", { children: result ? (SP_JSX.jsx("p", { style: { color: "#4CAF50", fontWeight: "bold" }, children: result })) : (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx("p", { style: { color: "#aaa", fontSize: "12px", marginBottom: "8px" }, children: "Expose a local port via NetBird's reverse proxy." }), SP_JSX.jsx(DFL.TextField, { label: "Port", value: port, disabled: working, onChange: (e) => setPort(e.target.value) }), SP_JSX.jsx(DFL.DropdownItem, { label: "Protocol", menuLabel: "Protocol", selectedOption: protocol, rgOptions: PROTOCOLS, onChange: (opt) => setProtocol(Number(opt.data)) }), SP_JSX.jsx(DFL.TextField, { label: "Password (optional)", value: password, disabled: working, onChange: (e) => setPassword(e.target.value) }), SP_JSX.jsx(DFL.TextField, { label: "Name Prefix (optional)", value: namePrefix, disabled: working, onChange: (e) => setNamePrefix(e.target.value) })] })) }), strOKButtonText: result ? "Close" : "Expose", onOK: async () => {
            if (result) {
                onClose();
                return;
            }
            setWorking(true);
            try {
                const r = await exposePort(parseInt(port) || 8080, PROTOCOLS[protocol].label, password || undefined, namePrefix || undefined);
                setResult(r.success ? (r.stdout || "Port exposed!") : (r.stderr || "Failed"));
            }
            catch {
                setResult("Failed to expose port");
            }
            setWorking(false);
        } }));
}
function AddProfileModal({ onClose }) {
    const [name, setName] = SP_REACT.useState("");
    const [working, setWorking] = SP_REACT.useState(false);
    const [result, setResult] = SP_REACT.useState(null);
    return (SP_JSX.jsx(DFL.ConfirmModal, { closeModal: working ? undefined : onClose, strTitle: "Add Profile", strDescription: SP_JSX.jsx("div", { children: result ? (SP_JSX.jsx("p", { style: { color: result.startsWith("Error") ? "#f44336" : "#4CAF50", fontWeight: "bold" }, children: result })) : (SP_JSX.jsx(DFL.TextField, { label: "Profile Name", value: name, disabled: working, onChange: (e) => setName(e.target.value) })) }), strOKButtonText: result ? "Close" : "Add", onOK: async () => {
            if (result) {
                onClose();
                return;
            }
            if (!name.trim())
                return;
            setWorking(true);
            try {
                const r = await addProfile(name.trim());
                setResult(r.success ? `Profile "${name.trim()}" added` : (r.stderr || "Error adding profile"));
            }
            catch {
                setResult("Error adding profile");
            }
            setWorking(false);
        } }));
}
function RemoveProfileModal({ profiles, current, onClose }) {
    const removable = profiles.filter(p => p !== current);
    const [selected, setSelected] = SP_REACT.useState(0);
    const [working, setWorking] = SP_REACT.useState(false);
    const [result, setResult] = SP_REACT.useState(null);
    const options = removable.map((p, i) => ({ data: i, label: p }));
    if (removable.length === 0) {
        return (SP_JSX.jsx(DFL.ConfirmModal, { closeModal: onClose, strTitle: "Remove Profile", strDescription: SP_JSX.jsx("p", { style: { color: "#ff9800" }, children: "No other profiles to remove." }), strOKButtonText: "Close", onOK: onClose }));
    }
    return (SP_JSX.jsx(DFL.ConfirmModal, { closeModal: working ? undefined : onClose, strTitle: "Remove Profile", strDescription: SP_JSX.jsx("div", { children: result ? (SP_JSX.jsx("p", { style: { color: result.startsWith("Error") ? "#f44336" : "#4CAF50", fontWeight: "bold" }, children: result })) : (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx("p", { style: { color: "#aaa", fontSize: "12px", marginBottom: "8px" }, children: "Select a profile to remove (cannot remove the active profile)." }), SP_JSX.jsx(DFL.DropdownItem, { label: "Profile", menuLabel: "Select", selectedOption: selected, rgOptions: options, onChange: (opt) => setSelected(Number(opt.data)) })] })) }), strOKButtonText: result ? "Close" : "Remove", onOK: async () => {
            if (result) {
                onClose();
                return;
            }
            setWorking(true);
            try {
                const name = removable[selected];
                const r = await removeProfile(name);
                setResult(r.success ? `Profile "${name}" removed` : (r.stderr || "Error removing profile"));
            }
            catch {
                setResult("Error removing profile");
            }
            setWorking(false);
        } }));
}
const TOGGLE_SETTINGS = [
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
    const [systemInfo, setSystemInfo] = SP_REACT.useState(null);
    const [statusInfo, setStatusInfo] = SP_REACT.useState(null);
    const [peers, setPeers] = SP_REACT.useState([]);
    const [networks, setNetworks] = SP_REACT.useState([]);
    const [forwardingRules, setForwardingRules] = SP_REACT.useState([]);
    const [profiles, setProfiles] = SP_REACT.useState({ profiles: [], current: "" });
    const [loading, setLoading] = SP_REACT.useState(true);
    const [actionLoading, setActionLoading] = SP_REACT.useState(false);
    const [managementUrl, setManagementUrl] = SP_REACT.useState("");
    const [setupKey, setSetupKey] = SP_REACT.useState(() => {
        if (typeof window !== "undefined")
            return localStorage.getItem("netbird_setup_key") || "";
        return "";
    });
    const [settings, setSettings] = SP_REACT.useState(null);
    const [cfg, setCfg] = SP_REACT.useState(null);
    const [notice, setNotice] = SP_REACT.useState("");
    const [refreshing, setRefreshing] = SP_REACT.useState(false);
    const pollRef = SP_REACT.useRef(null);
    const quickAccessVisible = useQuickAccessVisible();
    const fetchSystemInfo = SP_REACT.useCallback(async () => {
        setLoading(true);
        try {
            setSystemInfo(await getSystemInfo());
        }
        catch (err) {
            console.error("Failed to get system info:", err);
        }
        finally {
            setLoading(false);
        }
    }, []);
    const fetchStatus = SP_REACT.useCallback(async () => {
        try {
            const [statusResult, peersResult, networksResult, fwd, prof] = await Promise.all([
                getStatus(), getPeers(), getNetworks(), getForwardingRules(), getProfiles(),
            ]);
            setStatusInfo(statusResult);
            setPeers(peersResult);
            setNetworks(networksResult);
            setForwardingRules(fwd);
            if (prof)
                setProfiles(prof);
        }
        catch (err) {
            console.error("Failed to fetch status:", err);
        }
    }, []);
    const fetchManagementUrl = SP_REACT.useCallback(async () => {
        try {
            const [url, s] = await Promise.all([getManagementUrl(), getSettings()]);
            if (url)
                setManagementUrl(url);
            if (s) {
                setSettings(s);
                setCfg(s.config || {});
            }
        }
        catch (err) {
            console.error("Failed to get management URL:", err);
        }
    }, []);
    SP_REACT.useEffect(() => { fetchSystemInfo(); }, [fetchSystemInfo]);
    SP_REACT.useEffect(() => {
        if (systemInfo?.netbird_installed) {
            fetchStatus();
            fetchManagementUrl();
        }
    }, [systemInfo, fetchStatus, fetchManagementUrl]);
    SP_REACT.useEffect(() => {
        if (pollRef.current)
            clearInterval(pollRef.current);
        if (systemInfo?.netbird_installed && quickAccessVisible)
            pollRef.current = setInterval(fetchStatus, 5000);
        return () => { if (pollRef.current)
            clearInterval(pollRef.current); };
    }, [systemInfo?.netbird_installed, fetchStatus, quickAccessVisible]);
    SP_REACT.useEffect(() => {
        if (quickAccessVisible && systemInfo?.netbird_installed)
            fetchStatus();
    }, [quickAccessVisible, systemInfo?.netbird_installed, fetchStatus]);
    const showAuthModal = (url) => {
        let closeModal = () => { };
        const C = () => SP_JSX.jsx(AuthModal, { url: url, onClose: closeModal });
        const modal = DFL.showModal(SP_JSX.jsx(C, {}), window, { strTitle: "Authenticate", popupWidth: 420, popupHeight: 520 });
        closeModal = modal.Close;
    };
    const handleToggleConnection = SP_REACT.useCallback(async (value) => {
        setActionLoading(true);
        try {
            if (value) {
                const result = await connect(managementUrl, setupKey || undefined);
                if (result.auth_url)
                    showAuthModal(result.auth_url);
            }
            else {
                await disconnect();
            }
            await new Promise(r => setTimeout(r, 1500));
            await fetchStatus();
        }
        catch (err) {
            console.error("Toggle failed:", err);
        }
        finally {
            setActionLoading(false);
        }
    }, [managementUrl, setupKey, fetchStatus]);
    const handleNetworkToggle = SP_REACT.useCallback(async (name, value) => {
        setActionLoading(true);
        try {
            if (value) {
                const isExitNode = (n) => n.network?.includes("0.0.0.0/0") ?? false;
                const exiting = networks.filter(n => n.name !== name && isExitNode(n) && n.status === "Connected");
                for (const n of exiting)
                    await networkDown(n.name);
                await networkUp(name);
            }
            else {
                await networkDown(name);
            }
            await new Promise(r => setTimeout(r, 500));
            await fetchStatus();
        }
        catch (err) {
            console.error("Network toggle failed:", err);
        }
        finally {
            setActionLoading(false);
        }
    }, [fetchStatus, networks]);
    const handleProfileSwitch = SP_REACT.useCallback(async (name) => {
        setActionLoading(true);
        try {
            await selectProfile(name);
            await new Promise(r => setTimeout(r, 1000));
            await fetchStatus();
        }
        catch (err) {
            console.error("Profile switch failed:", err);
        }
        finally {
            setActionLoading(false);
        }
    }, [fetchStatus]);
    const handleSaveUrl = SP_REACT.useCallback(async (url) => {
        setActionLoading(true);
        try {
            const r = await saveManagementUrl(url);
            setManagementUrl(url);
            localStorage.setItem("netbird_mgmt_url", url);
            setNotice(r.success ? (r.stdout || "Management URL saved") : (r.stderr || "Failed to save management URL"));
        }
        catch (err) {
            console.error("Save URL failed:", err);
            setNotice("Failed to save management URL");
        }
        finally {
            setActionLoading(false);
        }
    }, []);
    const handleSettingToggle = SP_REACT.useCallback(async (s, value) => {
        setCfg((prev) => ({ ...(prev || {}), [s.key]: value }));
        try {
            const r = await applySettings({ [s.sendKey]: value });
            setNotice(r.success ? (r.stdout || "Settings applied") : (r.stderr || "Failed to apply setting"));
        }
        catch (err) {
            console.error("Apply setting failed:", err);
            setNotice("Failed to apply setting");
        }
        const fresh = await getSettings().catch(() => null);
        if (fresh)
            setCfg(fresh.config || {});
    }, []);
    const handleRenewSession = SP_REACT.useCallback(async () => {
        setActionLoading(true);
        try {
            const r = await requestSessionRenewal();
            if (!r.success || !r.auth_url) {
                setNotice(r.stderr || "Cannot start session renewal");
                return;
            }
            let closeModal = () => { };
            const C = () => (SP_JSX.jsx(RenewSessionModal, { url: r.auth_url || "", userCode: r.user_code || "", deviceCode: r.device_code || "", onClose: closeModal, onRenewed: fetchStatus }));
            const modal = DFL.showModal(SP_JSX.jsx(C, {}), window, { strTitle: "Extend Session", popupWidth: 420, popupHeight: 520 });
            closeModal = modal.Close;
        }
        catch (err) {
            console.error("Renew failed:", err);
            setNotice("Failed to start session renewal");
        }
        finally {
            setActionLoading(false);
        }
    }, [fetchStatus]);
    const handleSaveSetupKey = SP_REACT.useCallback((key) => {
        setSetupKey(key);
        localStorage.setItem("netbird_setup_key", key);
    }, []);
    const handleRefresh = SP_REACT.useCallback(async () => {
        setRefreshing(true);
        try {
            await Promise.all([fetchStatus(), fetchManagementUrl()]);
        }
        catch (err) {
            console.error("Refresh failed:", err);
        }
        finally {
            setRefreshing(false);
        }
    }, [fetchStatus, fetchManagementUrl]);
    const handleDeregister = SP_REACT.useCallback(async () => {
        setActionLoading(true);
        try {
            await deregister();
            await new Promise(r => setTimeout(r, 1000));
            await fetchStatus();
        }
        catch (err) {
            console.error("Deregister failed:", err);
        }
        finally {
            setActionLoading(false);
        }
    }, [fetchStatus]);
    const showExposeModal = SP_REACT.useCallback(() => {
        let closeModal = () => { };
        const C = () => SP_JSX.jsx(ExposeModal, { onClose: closeModal });
        const modal = DFL.showModal(SP_JSX.jsx(C, {}), window, { strTitle: "Expose", popupWidth: 420, popupHeight: 520 });
        closeModal = modal.Close;
    }, []);
    const showAddProfileModal = SP_REACT.useCallback(() => {
        let closeModal = () => { };
        const C = () => SP_JSX.jsx(AddProfileModal, { onClose: closeModal });
        const modal = DFL.showModal(SP_JSX.jsx(C, {}), window, { strTitle: "Add Profile", popupWidth: 400, popupHeight: 300 });
        closeModal = modal.Close;
    }, []);
    const showRemoveProfileModal = SP_REACT.useCallback(() => {
        let closeModal = () => { };
        const C = () => SP_JSX.jsx(RemoveProfileModal, { profiles: profiles.profiles, current: profiles.current, onClose: closeModal });
        const modal = DFL.showModal(SP_JSX.jsx(C, {}), window, { strTitle: "Remove Profile", popupWidth: 400, popupHeight: 350 });
        closeModal = modal.Close;
    }, [profiles]);
    const showRenameProfileModal = SP_REACT.useCallback(() => {
        let closeModal = () => { };
        const C = () => SP_JSX.jsx(RenameProfileModal, { current: profiles.current, onClose: closeModal });
        const modal = DFL.showModal(SP_JSX.jsx(C, {}), window, { strTitle: "Rename Profile", popupWidth: 400, popupHeight: 300 });
        closeModal = modal.Close;
    }, [profiles.current]);
    if (loading) {
        return SP_JSX.jsx(DFL.PanelSection, { title: "NetBird VPN", children: SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(LoadingSpinner, {}) }) });
    }
    if (!systemInfo?.netbird_installed) {
        return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(DFL.PanelSection, { title: "NetBird VPN", children: SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("p", { style: { margin: 0, color: "#ff9800" }, children: "NetBird is not installed on this system." }) }) }), SP_JSX.jsx(SetupGuide, {})] }));
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
        return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(DFL.PanelSection, { title: "NetBird VPN", children: SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsxs("div", { style: { padding: "16px", backgroundColor: "rgba(0,0,0,0.4)", borderRadius: "8px" }, children: [SP_JSX.jsx("p", { style: { margin: 0, fontSize: "18px", fontWeight: "bold", color: displayColor }, children: displayLabel }), SP_JSX.jsx("p", { style: { margin: "4px 0 0 0", fontSize: "12px", color: "#aaa" }, children: authFailed ? "Authentication failed. Check your credentials and try again." : "Log in to connect to your NetBird network." })] }) }) }), SP_JSX.jsxs(DFL.PanelSection, { title: "Login", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.TextField, { label: "Management URL", description: "NetBird management server address", value: managementUrl, disabled: actionLoading, onChange: (e) => setManagementUrl(e.target.value) }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.TextField, { label: "Setup Key", description: "Optional: pre-authentication key", value: setupKey, disabled: actionLoading, onChange: (e) => handleSaveSetupKey(e.target.value) }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: actionLoading, onClick: () => handleToggleConnection(true), children: "Authenticate & Connect" }) }), notice && (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("p", { style: { margin: 0, fontSize: "11px", color: notice.startsWith("Failed") || notice.startsWith("HTTP") ? "#f44336" : "#4CAF50" }, children: notice }) }))] })] }));
    }
    return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsxs(DFL.PanelSection, { title: "NetBird VPN", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(CardFocusable, { style: { width: "100%" }, children: SP_JSX.jsxs("div", { style: { padding: "16px", backgroundColor: "rgba(0,0,0,0.4)", borderRadius: "8px" }, children: [SP_JSX.jsxs("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between" }, children: [SP_JSX.jsxs("div", { children: [SP_JSX.jsx("p", { style: { margin: 0, fontSize: "18px", fontWeight: "bold", color: displayColor }, children: displayLabel }), profiles.current && SP_JSX.jsxs("p", { style: { margin: "2px 0 0 0", fontSize: "11px", color: "#888" }, children: ["Profile: ", profiles.current] }), statusInfo?.netbird_ip && SP_JSX.jsx("p", { style: { margin: "2px 0 0 0", fontSize: "12px", color: "#aaa" }, children: statusInfo.netbird_ip })] }), SP_JSX.jsx(Pill, { color: isConnected ? "#4CAF50" : needsLogin ? "#ff9800" : authFailed ? "#f44336" : connecting ? "#4FC3F7" : "#666", label: isConnected ? "Active" : needsLogin ? "Pending" : authFailed ? "Failed" : connecting ? "Connecting" : "Offline" })] }), statusInfo?.peers && (SP_JSX.jsx("div", { style: { marginTop: "8px", display: "flex", gap: "12px", fontSize: "12px", color: "#888" }, children: SP_JSX.jsxs("span", { children: ["Peers: ", SP_JSX.jsxs("strong", { style: { color: "#ccc" }, children: [statusInfo.peers.connected, "/", statusInfo.peers.total] })] }) })), sessionValid && (SP_JSX.jsxs("div", { style: { marginTop: "8px", fontSize: "12px", color: sessionWarning ? "#ff9800" : "#888" }, children: [sessionWarning && SP_JSX.jsx("span", { style: { fontWeight: "bold", marginRight: "6px" }, children: "Session expires soon!" }), SP_JSX.jsxs("span", { children: ["Session expires in ", SP_JSX.jsx("strong", { style: { color: sessionWarning ? "#ff9800" : "#ccc" }, children: formatDuration(sessionMs) })] })] })), notice && (SP_JSX.jsx("div", { style: { marginTop: "8px", fontSize: "11px", color: notice.startsWith("Failed") || notice.startsWith("HTTP") ? "#f44336" : "#4CAF50" }, children: notice }))] }) }) }), sessionValid && (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: actionLoading, onClick: handleRenewSession, children: sessionWarning ? "Extend Session Now" : "Extend Session" }) }))] }), SP_JSX.jsx(DFL.PanelSection, { title: "Connection", children: SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ToggleField, { label: "VPN Toggle", description: isConnected ? "NetBird is active" : needsLogin ? "Authentication required" : authFailed ? "Authentication failed - retry" : "NetBird is off", checked: isConnected, disabled: actionLoading, onChange: handleToggleConnection }) }) }), SP_JSX.jsxs(DFL.PanelSection, { title: "Profile", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.DropdownItem, { label: "Active Profile", menuLabel: "Switch Profile", selectedOption: profileOptions.find((o) => o.label === profiles.current)?.data ?? 0, disabled: actionLoading || profileOptions.length === 0, rgOptions: profileOptions, onChange: (opt) => handleProfileSwitch(String(opt.label)) }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: actionLoading, onClick: showAddProfileModal, children: "Add Profile" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: actionLoading || !profiles.current, onClick: showRenameProfileModal, children: "Rename Profile" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: actionLoading || profiles.profiles.length <= 1, onClick: showRemoveProfileModal, children: "Remove Profile" }) })] }), SP_JSX.jsx(DFL.PanelSection, { title: `Peers (${peers.length})`, children: peers.length === 0 ? (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("p", { style: { margin: 0, fontSize: "12px", color: "#888", fontStyle: "italic" }, children: "No peers connected" }) })) : (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(CardFocusable, { style: { width: "100%" }, children: SP_JSX.jsx("div", { style: { backgroundColor: "rgba(0,0,0,0.3)", borderRadius: "6px", overflow: "hidden" }, children: peers.map((peer, i) => (SP_JSX.jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderBottom: i < peers.length - 1 ? "1px solid rgba(255,255,255,0.08)" : "none" }, children: [SP_JSX.jsxs("div", { children: [SP_JSX.jsx("p", { style: { margin: 0, fontSize: "13px", color: "#ddd" }, children: peer.fqdn || peer.ip }), SP_JSX.jsxs("div", { style: { display: "flex", gap: "6px", marginTop: "2px" }, children: [peer.latency && SP_JSX.jsx("span", { style: { fontSize: "11px", color: "#888" }, children: peer.latency }), peer.connection_type && (SP_JSX.jsx("span", { style: { fontSize: "11px", color: peer.connection_type === "P2P" ? "#4FC3F7" : "#ff9800" }, children: peer.connection_type }))] })] }), SP_JSX.jsx(Pill, { color: peer.status === "connected" ? "#4CAF50" : peer.status === "idle" ? "#ff9800" : peer.status === "connecting" ? "#4FC3F7" : "#f44336", label: peer.status })] }, i))) }) }) })) }), networks.length > 0 && (SP_JSX.jsx(DFL.PanelSection, { title: "Network Resources", children: networks.map((net, i) => {
                    const netConnected = net.status === "Connected";
                    return (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ToggleField, { label: net.name, description: net.network ? `${net.network} — ${netConnected ? "Connected" : "Disconnected"}` : netConnected ? "Connected" : "Disconnected", checked: netConnected, disabled: actionLoading, onChange: (val) => handleNetworkToggle(net.name, val) }) }, i));
                }) })), forwardingRules.length > 0 && (SP_JSX.jsx(DFL.PanelSection, { title: "Port Forwarding", children: SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { backgroundColor: "rgba(0,0,0,0.3)", borderRadius: "6px", overflow: "hidden" }, children: forwardingRules.map((rule, i) => (SP_JSX.jsx("pre", { style: { margin: 0, padding: "8px 12px", fontSize: "11px", color: "#ccc", fontFamily: "monospace", whiteSpace: "pre-wrap", borderBottom: i < forwardingRules.length - 1 ? "1px solid rgba(255,255,255,0.08)" : "none" }, children: rule.raw }, i))) }) }) })), SP_JSX.jsxs(DFL.PanelSection, { title: "Expose", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: actionLoading || !isConnected, onClick: showExposeModal, children: "Expose Local Port" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("p", { style: { margin: 0, fontSize: "11px", color: "#888", fontStyle: "italic" }, children: "To use this option, firstly enable \"Enable Peer Expose\" and add the group in which your Steam Deck is." }) })] }), SP_JSX.jsxs(DFL.PanelSection, { title: "Configuration", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.TextField, { label: "Management URL", description: "NetBird management server address", value: managementUrl, disabled: actionLoading, onChange: (e) => setManagementUrl(e.target.value) }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: actionLoading, onClick: () => handleSaveUrl(managementUrl), children: "Save URL" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.TextField, { label: "Setup Key", description: "Optional: pre-authentication key", value: setupKey, disabled: actionLoading, onChange: (e) => handleSaveSetupKey(e.target.value) }) })] }), settings && (SP_JSX.jsx(DFL.PanelSection, { title: "Settings", children: settings.error || !cfg || Object.keys(cfg).length === 0 ? (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("p", { style: { margin: 0, fontSize: "12px", color: "#ff9800" }, children: "Log in first to manage settings." }) })) : (TOGGLE_SETTINGS.map((s) => {
                    const managedByMdm = s.mdm ? ((cfg.mDMManagedFields || []).includes(s.mdm)) : false;
                    return (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ToggleField, { label: s.label, description: managedByMdm ? `${s.desc} — Managed by MDM` : s.desc, checked: Boolean(cfg[s.key]), disabled: actionLoading || managedByMdm, onChange: (v) => handleSettingToggle(s, v) }) }, s.key));
                })) })), SP_JSX.jsxs(DFL.PanelSection, { title: "Actions", children: [needsLogin && (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: actionLoading, onClick: () => handleToggleConnection(true), children: "Authenticate & Connect" }) })), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: refreshing, onClick: handleRefresh, children: refreshing ? "Refreshing…" : "Refresh Status" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: actionLoading, onClick: handleDeregister, children: "Deregister Peer" }) })] }), SP_JSX.jsx(DFL.PanelSection, { title: "About", children: SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(CardFocusable, { style: { width: "100%" }, children: SP_JSX.jsxs("div", { style: { padding: "12px", backgroundColor: "rgba(0,0,0,0.4)", borderRadius: "8px" }, children: [SP_JSX.jsxs("p", { style: { margin: 0, fontSize: "12px", color: "#888", fontStyle: "italic" }, children: ["NetBird v", statusInfo?.version || "?", " \u00B7 ", profiles.current] }), SP_JSX.jsx("p", { style: { margin: "6px 0 0 0", fontSize: "10px", color: "#666", fontStyle: "italic" }, children: "NetBird name and logo are trademarks of NetBird.io" })] }) }) }) })] }));
}
var index = definePlugin(() => {
    console.log("NetBird VPN plugin initializing");
    return {
        name: "NetBird VPN",
        titleView: SP_JSX.jsx("div", { className: DFL.staticClasses.Title, children: "NetBird VPN" }),
        content: SP_JSX.jsx(Content, {}),
        icon: (SP_JSX.jsx("svg", { viewBox: "0 0 24 24", width: "24", height: "24", fill: "currentColor", children: SP_JSX.jsx("path", { d: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" }) })),
        onDismount() { console.log("NetBird VPN plugin unloading"); },
    };
});

export { index as default };
//# sourceMappingURL=index.js.map
