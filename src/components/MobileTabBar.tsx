import { memo } from "react";
import { Download, Home, Scissors, Settings2 } from "lucide-react";

export type MobileTab = "home" | "studio" | "exports" | "settings";

interface MobileTabBarProps {
  activeTab: MobileTab;
  hasVideo: boolean;
  clipCount: number;
  activeDownloads: number;
  onSelect: (tab: MobileTab) => void;
}

export const MobileTabBar = memo(function MobileTabBar({
  activeTab,
  hasVideo,
  clipCount,
  activeDownloads,
  onSelect,
}: MobileTabBarProps) {
  return (
    <nav className="mobile-tabbar" aria-label="iOS navigation">
      <button
        type="button"
        className={`mobile-tab${activeTab === "home" ? " is-active" : ""}`}
        onClick={() => onSelect("home")}
      >
        <Home size={18} strokeWidth={1.9} />
        <span>Home</span>
      </button>

      <button
        type="button"
        className={`mobile-tab${activeTab === "studio" ? " is-active" : ""}`}
        onClick={() => onSelect("studio")}
        disabled={!hasVideo}
      >
        <Scissors size={18} strokeWidth={1.9} />
        <span>Studio{clipCount > 0 ? ` (${clipCount})` : ""}</span>
      </button>

      <button
        type="button"
        className={`mobile-tab${activeTab === "exports" ? " is-active" : ""}`}
        onClick={() => onSelect("exports")}
      >
        <Download size={18} strokeWidth={1.9} />
        <span>
          Exports{activeDownloads > 0 ? ` (${activeDownloads})` : ""}
        </span>
      </button>

      <button
        type="button"
        className={`mobile-tab${activeTab === "settings" ? " is-active" : ""}`}
        onClick={() => onSelect("settings")}
      >
        <Settings2 size={18} strokeWidth={1.9} />
        <span>Settings</span>
      </button>
    </nav>
  );
});
