import { memo, useEffect, useState } from "react";
import { AlertCircle, Check, Loader2, RefreshCw, X } from "lucide-react";
import { api, ApiError, errorMessage } from "../services/api";
import type {
  AuthTestResult,
  BrowserProfileInfo,
  DependencyInfo,
  DependencyReport,
  ProviderStatus,
  Settings,
  UpdateInfo,
} from "../types";
import type { ToastTone } from "./Toasts";
import { NAMING_TEMPLATES } from "../utils/format";

interface SettingsPanelProps {
  open: boolean;
  settings: Settings;
  dependencies: DependencyReport | null;
  version: string;
  isMobile?: boolean;
  onClose: () => void;
  onSave: (next: Settings) => Promise<void>;
  onRefreshDependencies: () => Promise<DependencyReport | null>;
  onToast: (message: string, tone?: ToastTone) => void;
  testVideoUrl?: string | null;
}

const QUALITY_CHOICES = ["best", "2160p", "1440p", "1080p", "720p", "480p", "360p"];
const BROWSER_CHOICES = [
  { value: "chrome", label: "Google Chrome" },
  { value: "edge", label: "Microsoft Edge" },
  { value: "firefox", label: "Mozilla Firefox" },
  { value: "brave", label: "Brave" },
  { value: "chromium", label: "Chromium" },
];

function ToolField({
  label,
  hint,
  info,
  value,
  onBrowse,
  onReset,
}: {
  label: string;
  hint: string;
  info: DependencyInfo | undefined;
  value: string | null;
  onBrowse: () => void;
  onReset: () => void;
}) {
  const tone = info?.ready ? "ok" : info?.found ? "warn" : "error";
  const statusText = !info
    ? "Checking…"
    : info.ready
      ? `Ready${info.version ? ` · ${info.version}` : ""}`
      : info.found
        ? "Found, but could not run"
        : "Not found";

  return (
    <div className="field tool-field">
      <div className="tool-head">
        <span className="field-label">{label}</span>
        <span className={`tool-status tool-status-${tone}`}>
          <span className={`dot dot-${tone}`} aria-hidden="true" />
          {statusText}
        </span>
      </div>
      <div className="path-row">
        <span className="path-value" title={value ?? info?.path ?? ""}>
          {value ?? info?.path ?? "Auto-detect from PATH"}
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBrowse}>
          Browse
        </button>
      </div>
      <div className="tool-foot">
        <span className="field-hint">{hint}</span>
        {value ? (
          <button type="button" className="link-btn" onClick={onReset}>
            Use auto-detect
          </button>
        ) : null}
      </div>
    </div>
  );
}

export const SettingsPanel = memo(function SettingsPanel({
  open,
  settings,
  dependencies,
  version,
  isMobile = false,
  onClose,
  onSave,
  onRefreshDependencies,
  onToast,
  testVideoUrl,
}: SettingsPanelProps) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [profiles, setProfiles] = useState<BrowserProfileInfo | null>(null);
  const [testUrl, setTestUrl] = useState("");
  const [testing, setTesting] = useState(false);
  const [authResult, setAuthResult] = useState<AuthTestResult | null>(null);

  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerMessage, setProviderMessage] = useState<string | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosticOutput, setDiagnosticOutput] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    void api
      .potProviderStatus()
      .then((status) => {
        if (!disposed) setProviderStatus(status);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    setProfiles(null);
    setAuthResult(null);
    void api
      .browserProfiles(draft.authBrowser)
      .then((info) => {
        if (!disposed) setProfiles(info);
      })
      .catch(() => {
        if (!disposed) setProfiles(null);
      });
    return () => {
      disposed = true;
    };
  }, [open, draft.authBrowser]);

  useEffect(() => {
    if (open) {
      setDraft(settings);
      setError(null);
    }
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const patch = (partial: Partial<Settings>) => setDraft((prev) => ({ ...prev, ...partial }));

  const browseFolder = async () => {
    try {
      const dir = await api.pickDirectory(draft.outputDir);
      if (dir) patch({ outputDir: dir });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const browseBinary = async (field: "ytDlpPath" | "ffmpegPath" | "ffprobePath") => {
    try {
      const path = await api.pickBinary();
      if (path) patch({ [field]: path } as Partial<Settings>);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const recheck = async () => {
    setChecking(true);
    try {
      await onRefreshDependencies();
      onToast("Tool check complete.", "info");
    } finally {
      setChecking(false);
    }
  };

  const testAuth = async () => {
    setTesting(true);
    setAuthResult(null);
    try {
      const result = await api.testYouTubeAuth(draft, testUrl.trim() || testVideoUrl || undefined);
      setAuthResult(result);
    } catch (err) {
      setAuthResult({
        ok: false,
        browser: draft.authBrowser,
        source: null,
        videoTitle: null,
        code: err instanceof ApiError ? err.code : "AUTH_FAILED",
        message: errorMessage(err),
        detail: err instanceof ApiError ? err.detail : null,
      });
    } finally {
      setTesting(false);
    }
  };

  const checkUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateMessage(null);
    try {
      const info = await api.checkYtdlpUpdate();
      setUpdateInfo(info);
      setUpdateMessage(
        info.updateAvailable
          ? `yt-dlp ${info.latestVersion} is available.`
          : `yt-dlp ${info.latestVersion ?? ""} is up to date.`,
      );
    } catch (err) {
      setUpdateMessage(errorMessage(err));
    } finally {
      setCheckingUpdate(false);
    }
  };

  const doUpdate = async () => {
    setUpdating(true);
    setUpdateMessage(null);
    try {
      const result = await api.updateYtdlp();
      patch({ ytDlpPath: result.path });
      setUpdateMessage(`Installed and verified yt-dlp ${result.version}.`);
      setUpdateInfo(null);
      await onRefreshDependencies();
    } catch (err) {
      setUpdateMessage(errorMessage(err));
    } finally {
      setUpdating(false);
    }
  };

  const installProvider = async () => {
    setProviderBusy(true);
    setProviderMessage(null);
    try {
      const installed = await api.installPotProvider();
      setProviderStatus(installed.status);
      setProviderMessage(`Installed provider ${installed.version} and verified its checksum.`);
      patch({ potPluginDir: installed.pluginDir, potServerDir: installed.serverDir, potProviderEnabled: true });
      await onRefreshDependencies();
    } catch (err) {
      setProviderMessage(errorMessage(err));
    } finally {
      setProviderBusy(false);
    }
  };

  const toggleProvider = async () => {
    setProviderBusy(true);
    setProviderMessage(null);
    try {
      const status = providerStatus?.running
        ? await api.stopPotProvider()
        : await api.startPotProvider();
      setProviderStatus(status);
      patch({ potProviderEnabled: status.enabled });
      setProviderMessage(status.message);
    } catch (err) {
      setProviderMessage(errorMessage(err));
    } finally {
      setProviderBusy(false);
    }
  };

  const runDiagnose = async () => {
    setDiagnosing(true);
    setDiagnosticOutput(null);
    try {
      const output = await api.diagnoseYouTube(draft, testUrl.trim() || testVideoUrl || undefined);
      setDiagnosticOutput(output);
    } catch (err) {
      setDiagnosticOutput(errorMessage(err));
    } finally {
      setDiagnosing(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (isMobile) {
    return (
      <div className="drawer-root">
        <div className="drawer-overlay" onClick={onClose} />
        <aside className="drawer" role="dialog" aria-modal="true" aria-label="Settings">
          <header className="drawer-head">
            <div>
              <span className="eyebrow eyebrow-sm">iOS</span>
              <h2 className="drawer-title">Settings</h2>
            </div>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close settings">
              <X size={16} strokeWidth={1.9} />
            </button>
          </header>

          <div className="drawer-body">
            <section className="drawer-section">
              <h3 className="drawer-section-title">Export</h3>
              <div className="field field-inline">
                <div>
                  <span className="field-label">Default format</span>
                  <p className="field-hint">MP4 saves to Photos &amp; Files. M4A saves to Files.</p>
                </div>
                <select
                  className="input input-compact"
                  value={draft.defaultFormat}
                  onChange={(event) => patch({ defaultFormat: event.target.value })}
                >
                  <option value="mp4">MP4 Video</option>
                  <option value="mp3">M4A Audio</option>
                </select>
              </div>

              <div className="field field-inline">
                <div>
                  <span className="field-label">Merge cuts by default</span>
                  <p className="field-hint">Combine multiple clips into one file.</p>
                </div>
                <button
                  type="button"
                  className={`switch${draft.mergeCuts ? " is-on" : ""}`}
                  role="switch"
                  aria-checked={draft.mergeCuts}
                  onClick={() => patch({ mergeCuts: !draft.mergeCuts })}
                >
                  <span className="switch-thumb" />
                </button>
              </div>

              <div className="field field-inline">
                <div>
                  <span className="field-label">Interface sounds</span>
                  <p className="field-hint">Subtle feedback on mark in/out and export.</p>
                </div>
                <button
                  type="button"
                  className={`switch${draft.soundEffects ? " is-on" : ""}`}
                  role="switch"
                  aria-checked={draft.soundEffects}
                  onClick={() => patch({ soundEffects: !draft.soundEffects })}
                >
                  <span className="switch-thumb" />
                </button>
              </div>
            </section>

            <section className="drawer-section">
              <h3 className="drawer-section-title">Storage &amp; Engine</h3>
              <div className="about-row">
                <span>Saved location</span>
                <b>Photos &amp; Files → Cutline</b>
              </div>
              <div className="about-row">
                <span>Media engine</span>
                <b>AVFoundation (On-Device)</b>
              </div>
              <div className="about-row">
                <span>Version</span>
                <b>{version || "3.0.0"}</b>
              </div>
            </section>
          </div>

          <footer className="drawer-foot">
            {error ? <p className="error-text">{error}</p> : null}
            <div className="drawer-foot-actions">
              <div className="drawer-foot-buttons">
                <button type="button" className="btn btn-ghost" onClick={onClose}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
                  {saving ? <Loader2 className="spin" size={14} /> : <Check size={14} />}
                  Save
                </button>
              </div>
            </div>
          </footer>
        </aside>
      </div>
    );
  }

  return (
    <div className="drawer-root">
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Settings">
        <header className="drawer-head">
          <div>
            <span className="eyebrow eyebrow-sm">Preferences</span>
            <h2 className="drawer-title">Settings</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close settings">
            <X size={16} strokeWidth={1.9} />
          </button>
        </header>

        <div className="drawer-body">
          <section className="drawer-section">
            <h3 className="drawer-section-title">Downloads</h3>

            <div className="field">
              <span className="field-label">Output folder</span>
              <div className="path-row">
                <span className="path-value" title={draft.outputDir}>
                  {draft.outputDir || "Not set"}
                </span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={browseFolder}>
                  Change
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void api.openPath(draft.outputDir).catch(() => undefined)}
                >
                  Open
                </button>
              </div>
              <p className="field-hint">
                Existing files get a “(2)” suffix. Batch names follow the export bar setting.
              </p>
            </div>

            <div className="field field-inline">
              <div>
                <span className="field-label">Default quality</span>
                <p className="field-hint">Only resolutions the source actually has are used.</p>
              </div>
              <select
                className="input input-compact"
                value={draft.defaultQuality}
                onChange={(event) => patch({ defaultQuality: event.target.value })}
              >
                {QUALITY_CHOICES.map((choice) => (
                  <option key={choice} value={choice}>
                    {choice === "best" ? "Best available" : choice.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>

            <div className="field field-inline">
              <div>
                <span className="field-label">Default format</span>
                <p className="field-hint">MP4 keeps video and audio together.</p>
              </div>
              <select
                className="input input-compact"
                value={draft.defaultFormat}
                onChange={(event) => patch({ defaultFormat: event.target.value })}
              >
                <option value="mp4">MP4 video</option>
                <option value="mp3">MP3 audio</option>
              </select>
            </div>

            <div className="field field-inline">
              <div>
                <span className="field-label">Naming pattern</span>
                <p className="field-hint">Used for batch exports; individual cuts can still be renamed.</p>
              </div>
              <select
                className="input input-compact"
                value={draft.namingTemplate || NAMING_TEMPLATES[0]}
                onChange={(event) => patch({ namingTemplate: event.target.value })}
              >
                {NAMING_TEMPLATES.map((template) => (
                  <option key={template} value={template}>
                    {template}
                  </option>
                ))}
              </select>
            </div>

            <div className="field field-inline">
              <div>
                <span className="field-label">Precise cutting</span>
                <p className="field-hint">
                  Re-encode around cut points for frame-accurate starts. Slower than the default
                  keyframe-aligned mode.
                </p>
              </div>
              <button
                type="button"
                className={`switch${draft.preciseCutting ? " is-on" : ""}`}
                role="switch"
                aria-checked={draft.preciseCutting}
                aria-label="Precise cutting"
                onClick={() => patch({ preciseCutting: !draft.preciseCutting })}
              >
                <span className="switch-thumb" />
              </button>
            </div>

            <div className="field field-inline">
              <div>
                <span className="field-label">Simultaneous downloads</span>
                <p className="field-hint">Lower this if your connection is saturated.</p>
              </div>
              <select
                className="input input-compact"
                value={draft.maxConcurrentDownloads}
                onChange={(event) =>
                  patch({ maxConcurrentDownloads: Number(event.target.value) || 1 })
                }
              >
                {[1, 2, 3, 4].map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section className="drawer-section">
            <div className="drawer-section-head">
              <h3 className="drawer-section-title">Browser Authentication</h3>
              <span className={`auth-status${authResult ? (authResult.ok ? " is-ok" : " is-error") : ""}`}>
                <span className={`dot ${authResult ? (authResult.ok ? "dot-ok" : "dot-error") : ""}`} aria-hidden="true" />
                {authResult ? (authResult.ok ? "Verified" : "Not working") : "Not tested"}
              </span>
            </div>

            <p className="field-hint field-hint-block">
              Use your existing browser session for videos that require sign-in (YouTube bot checks,
              age-restricted videos, or subscriber-only Twitch VODs). Cookies are read only by
              yt-dlp while enabled — never uploaded, displayed, or saved by Cutline.
            </p>

            <div className="field field-inline">
              <div>
                <span className="field-label">Use browser cookies</span>
                <p className="field-hint">
                  Off by default. Turn on for sign-in gated YouTube videos or sub-only Twitch VODs.
                </p>
              </div>
              <button
                type="button"
                className={`switch${draft.authEnabled ? " is-on" : ""}`}
                role="switch"
                aria-checked={draft.authEnabled}
                aria-label="Use browser cookies"
                onClick={() => {
                  patch({ authEnabled: !draft.authEnabled });
                  setAuthResult(null);
                }}
              >
                <span className="switch-thumb" />
              </button>
            </div>

            {draft.authEnabled ? (
              <>
                <div className="field field-inline">
                  <div>
                    <span className="field-label">Browser</span>
                    <p className="field-hint">
                      {profiles && !profiles.installed
                        ? "Not found in the usual install location. You can still test access."
                        : "Chrome, Edge, Firefox, Brave or Chromium."}
                    </p>
                  </div>
                  <select
                    className="input input-compact"
                    value={draft.authBrowser}
                    onChange={(event) => patch({ authBrowser: event.target.value })}
                  >
                    {BROWSER_CHOICES.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <span className="field-label">Browser profile</span>
                  <input
                    className="input"
                    list="ytc-profiles"
                    value={draft.authProfile ?? ""}
                    placeholder="Most recently used profile (default)"
                    onChange={(event) => patch({ authProfile: event.target.value || null })}
                    spellCheck={false}
                  />
                  <datalist id="ytc-profiles">
                    {(profiles?.profiles ?? []).map((profile) => (
                      <option key={profile.value} value={profile.value}>
                        {profile.label}
                      </option>
                    ))}
                  </datalist>
                  <p className="field-hint">
                    Use yt-dlp's profile name, e.g. <code>Profile 1</code>. Firefox also accepts{" "}
                    <code>Profile::Container</code>. Leave blank for the most recently used profile.
                  </p>
                </div>

                <div className="field">
                  <span className="field-label">PO Token provider plugin (optional)</span>
                  <input
                    className="input"
                    value={draft.potPluginDir ?? ""}
                    placeholder="Folder containing yt-dlp plugins"
                    onChange={(event) => patch({ potPluginDir: event.target.value || null })}
                    spellCheck={false}
                  />
                  <p className="field-hint">
                    Some YouTube videos need a Proof of Origin Token. Cutline can install the
                    official provider for you, or you can point to an existing folder below.
                    Requires Node.js 22 or newer. No tokens are stored in Cutline.
                  </p>
                  <div className="path-row">
                    <input
                      className="input"
                      value={draft.potPluginDir ?? ""}
                      placeholder="Folder containing yt-dlp plugins"
                      onChange={(event) => patch({ potPluginDir: event.target.value || null })}
                      spellCheck={false}
                    />
                  </div>
                  <div className="update-row">
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => void installProvider()}
                      disabled={providerBusy}
                    >
                      {providerBusy ? <Loader2 className="spin" size={12} /> : null}
                      {providerStatus?.installed ? "Reinstall provider" : "Install provider"}
                    </button>
                    {providerStatus?.installed ? (
                      <button
                        type="button"
                        className="btn btn-quiet btn-xs"
                        onClick={() => void toggleProvider()}
                        disabled={providerBusy}
                      >
                        {providerStatus.running ? "Stop" : "Start"}
                      </button>
                    ) : null}
                    <span className={`auth-status${providerStatus?.running ? " is-ok" : ""}`}>
                      <span
                        className={`dot ${providerStatus?.running ? "dot-ok" : providerStatus?.installed ? "dot-warn" : "dot-error"}`}
                        aria-hidden="true"
                      />
                      {providerStatus
                        ? providerStatus.running
                          ? `Running · v${providerStatus.version ?? "?"}`
                          : providerStatus.installed
                            ? "Installed, stopped"
                            : "Not installed"
                        : "Checking…"}
                    </span>
                  </div>
                  {providerMessage ? <p className="field-hint update-message">{providerMessage}</p> : null}
                  {providerStatus ? (
                    <p className="field-hint">{providerStatus.message}</p>
                  ) : null}
                  <div className="tool-links">
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() =>
                        void api
                          .openUrl("https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide")
                          .catch(() => undefined)
                      }
                    >
                      PO Token guide ↗
                    </button>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() =>
                        void api
                          .openUrl("https://github.com/Brainicism/bgutil-ytdlp-pot-provider")
                          .catch(() => undefined)
                      }
                    >
                      Recommended provider ↗
                    </button>
                  </div>
                </div>

                <div className="field">
                  <span className="field-label">Test authentication</span>
                  <div className="path-row">
                    <input
                      className="input"
                      value={testUrl}
                      placeholder={
                        testVideoUrl
                          ? "Tests the loaded video by default"
                          : "Optional test video URL (a short public video is used)"
                      }
                      onChange={(event) => setTestUrl(event.target.value)}
                      spellCheck={false}
                    />
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void testAuth()} disabled={testing}>
                      {testing ? <Loader2 className="spin" size={12} /> : <RefreshCw size={12} strokeWidth={2} />}
                      Test
                    </button>
                  </div>
                  {authResult ? (
                    <div className={`auth-result${authResult.ok ? " is-ok" : " is-error"}`} role="status">
                      {authResult.ok ? <Check size={13} /> : <AlertCircle size={13} />}
                      <div>
                        <p>{authResult.message}</p>
                        {authResult.videoTitle ? <small>Verified with “{authResult.videoTitle}”</small> : null}
                        {authResult.code ? <small>Code: {authResult.code}</small> : null}
                        {authResult.detail ? (
                          <details className="auth-details">
                            <summary>Technical details</summary>
                            <pre>{authResult.detail}</pre>
                          </details>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  <p className="field-hint">
                    Sign in to YouTube in that browser first. If its cookie database is locked, close
                    the browser completely and retry. Save changes, then Test authentication to
                    check the browser session against YouTube — it uses the loaded video by default.
                  </p>
                </div>

                <div className="field">
                  <span className="field-label">Verbose diagnostic</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void runDiagnose()}
                    disabled={diagnosing}
                  >
                    {diagnosing ? <Loader2 className="spin" size={12} /> : <RefreshCw size={12} strokeWidth={2} />}
                    Run diagnostic
                  </button>
                  {diagnosticOutput ? (
                    <details className="auth-details" open>
                      <summary>yt-dlp verbose output</summary>
                      <pre>{diagnosticOutput}</pre>
                    </details>
                  ) : (
                    <p className="field-hint">
                      Captures yt-dlp's full verbose output (provider loading, client selection, and
                      YouTube's response) for the loaded video. Share it if you need help.
                    </p>
                  )}
                </div>
              </>
            ) : null}
          </section>

          <section className="drawer-section">
            <div className="drawer-section-head">
              <h3 className="drawer-section-title">Tools</h3>
              <button type="button" className="btn btn-quiet btn-xs" onClick={recheck} disabled={checking}>
                {checking ? (
                  <Loader2 className="spin" size={12} />
                ) : (
                  <RefreshCw size={12} strokeWidth={2} />
                )}
                Check again
              </button>
            </div>

            <ToolField
              label="yt-dlp"
              hint="Fetches video information and the selected ranges."
              info={dependencies?.ytDlp}
              value={draft.ytDlpPath}
              onBrowse={() => void browseBinary("ytDlpPath")}
              onReset={() => patch({ ytDlpPath: null })}
            />
            <div className="update-row">
              <button
                type="button"
                className="btn btn-quiet btn-xs"
                onClick={() => void checkUpdate()}
                disabled={checkingUpdate || updating}
              >
                {checkingUpdate ? <Loader2 className="spin" size={12} /> : <RefreshCw size={12} strokeWidth={2} />}
                Check for updates
              </button>
              {updateInfo?.updateAvailable ? (
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => void doUpdate()} disabled={updating}>
                  {updating ? <Loader2 className="spin" size={12} /> : null}
                  Update to {updateInfo.latestVersion}
                </button>
              ) : null}
            </div>
            {updateMessage ? <p className="field-hint update-message">{updateMessage}</p> : null}
            <p className="field-hint">
              Updates are downloaded from GitHub, checked with SHA-256, and installed in the app
              folder. A system-wide yt-dlp is left alone.
            </p>
            <ToolField
              label="FFmpeg"
              hint="Required by yt-dlp to cut and merge sections."
              info={dependencies?.ffmpeg}
              value={draft.ffmpegPath}
              onBrowse={() => void browseBinary("ffmpegPath")}
              onReset={() => patch({ ffmpegPath: null })}
            />
            <ToolField
              label="FFprobe"
              hint="Verifies each exported file is playable."
              info={dependencies?.ffprobe}
              value={draft.ffprobePath}
              onBrowse={() => void browseBinary("ffprobePath")}
              onReset={() => patch({ ffprobePath: null })}
            />

            <p className="field-hint field-hint-block">
              Install the cutting tools with{" "}
              <code>winget install yt-dlp.yt-dlp</code> and <code>winget install Gyan.FFmpeg</code>,
              or point to an existing copy above.
            </p>
            <div className="tool-links">
              <button
                type="button"
                className="link-btn"
                onClick={() => void api.openUrl("https://github.com/yt-dlp/yt-dlp").catch(() => undefined)}
              >
                yt-dlp project ↗
              </button>
              <button
                type="button"
                className="link-btn"
                onClick={() => void api.openUrl("https://ffmpeg.org/download.html").catch(() => undefined)}
              >
                FFmpeg downloads ↗
              </button>
            </div>
          </section>

          <section className="drawer-section">
            <h3 className="drawer-section-title">Appearance</h3>
            <div className="field field-inline">
              <div>
                <span className="field-label">Theme</span>
                <p className="field-hint">Light is the default.</p>
              </div>
              <select
                className="input input-compact"
                value={draft.theme}
                onChange={(event) => patch({ theme: event.target.value })}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </div>
            <div className="field field-inline">
              <div>
                <span className="field-label">Interface sounds</span>
                <p className="field-hint">
                  Short cues generated in the browser.
                </p>
              </div>
              <button
                type="button"
                className={`switch${draft.soundEffects ? " is-on" : ""}`}
                role="switch"
                aria-checked={draft.soundEffects}
                aria-label="Interface sounds"
                onClick={() => patch({ soundEffects: !draft.soundEffects })}
              >
                <span className="switch-thumb" />
              </button>
            </div>
          </section>

          <section className="drawer-section drawer-section-about">
            <h3 className="drawer-section-title">About</h3>
            <div className="about-row">
              <span>Version</span>
              <b>{version || "1.9.0"}</b>
            </div>
            <div className="about-row">
              <span>Processing</span>
              <b>On this computer</b>
            </div>
            <div className="about-row">
              <span>Account</span>
              <b>Optional browser session</b>
            </div>
            <p className="field-hint">
              Processing stays on this device. Use only videos you own or have permission to
              download.
            </p>
          </section>
        </div>

        <footer className="drawer-foot">
          {error ? <p className="form-error">{error}</p> : null}
          <div className="drawer-foot-actions">
            <span className="drawer-foot-note">
              <Check size={12} strokeWidth={2.4} /> Local settings
            </span>
            <div className="drawer-foot-buttons">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </footer>
      </aside>
    </div>
  );
});
