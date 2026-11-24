import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AuthTestResult,
  BrowserProfileInfo,
  CommandError,
  DependencyReport,
  DownloadRequest,
  DownloadTask,
  Settings,
  UpdateInfo,
  UpdateResult,
  ProviderInstall,
  ProviderStatus,
  VideoInfo,
} from "../types";

export class ApiError extends Error {
  code: string;
  detail: string | null;

  constructor(error: CommandError) {
    super(error.message || "Something went wrong.");
    this.name = "ApiError";
    this.code = error.code || "UNKNOWN";
    this.detail = error.detail ?? null;
  }
}

function normalize(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error && typeof error === "object" && "message" in error) {
    const candidate = error as CommandError;
    if (typeof candidate.message === "string") {
      return new ApiError({
        code: candidate.code ?? "UNKNOWN",
        message: candidate.message,
        detail: candidate.detail ?? null,
      });
    }
  }
  if (typeof error === "string") {
    return new ApiError({ code: "UNKNOWN", message: error });
  }
  return new ApiError({
    code: "UNKNOWN",
    message: "An unexpected error occurred.",
  });
}

/**
 * In `npm run dev` outside Tauri there is no Rust backend, so a small mock keeps
 * the interface usable for design work. Native builds always take the real path.
 */
const useMock = import.meta.env.DEV && !("__TAURI_INTERNALS__" in window);

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    if (useMock) {
      const mock = await import("./mock");
      return await mock.mockCall<T>(command, args);
    }
    return await invoke<T>(command, args);
  } catch (error) {
    throw normalize(error);
  }
}

export const api = {
  probeVideo: (url: string) => call<VideoInfo>("probe_video", { url }),
  validateUrl: (url: string) => call<string>("validate_url", { url }),

  getSettings: () => call<Settings>("get_settings"),
  updateSettings: (settings: Settings) => call<Settings>("update_settings", { settings }),
  checkDependencies: () => call<DependencyReport>("check_dependencies"),
  testYouTubeAuth: (settings: Settings, url?: string) =>
    call<AuthTestResult>("test_youtube_auth", { settings, url: url ?? null }),
  browserProfiles: (browser: string) =>
    call<BrowserProfileInfo>("browser_profiles", { browser }),
  checkYtdlpUpdate: () => call<UpdateInfo>("check_ytdlp_update"),
  updateYtdlp: () => call<UpdateResult>("update_ytdlp"),
  installPotProvider: () => call<ProviderInstall>("install_pot_provider"),
  startPotProvider: () => call<ProviderStatus>("start_pot_provider"),
  stopPotProvider: () => call<ProviderStatus>("stop_pot_provider"),
  potProviderStatus: () => call<ProviderStatus>("pot_provider_status"),
  diagnoseYouTube: (settings: Settings, url?: string) =>
    call<string>("diagnose_youtube", { settings, url: url ?? null }),
  pickDirectory: (defaultPath?: string | null) =>
    call<string | null>("pick_directory", { defaultPath: defaultPath ?? null }),
  pickBinary: () => call<string | null>("pick_binary"),
  appVersion: () => call<string>("app_version"),

  openUrl: (url: string) => call<void>("open_url", { url }),
  openPath: (path: string) => call<void>("open_path", { path }),
  revealPath: (path: string) => call<void>("reveal_path", { path }),
  openOutputFolder: () => call<void>("open_output_folder"),

  listDownloads: () => call<DownloadTask[]>("list_downloads"),
  startDownload: (request: DownloadRequest) =>
    call<DownloadTask>("start_download", { request }),
  startBatch: (requests: DownloadRequest[]) =>
    call<DownloadTask[]>("start_batch", { requests }),
  cancelDownload: (id: string) => call<void>("cancel_download", { id }),
  retryDownload: (id: string) => call<DownloadTask>("retry_download", { id }),
  removeDownload: (id: string) => call<void>("remove_download", { id }),
  clearFinishedDownloads: () => call<DownloadTask[]>("clear_finished_downloads"),

  onDownloadUpdate: async (handler: (task: DownloadTask) => void): Promise<UnlistenFn> => {
    if (useMock) {
      const mock = await import("./mock");
      return mock.mockListen(handler);
    }
    return listen<DownloadTask>("download:update", (event) => handler(event.payload));
  },
};

export function errorMessage(error: unknown): string {
  return normalize(error).message;
}
