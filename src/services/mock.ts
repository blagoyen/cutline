/** Mock backend used by `npm run dev` in a plain browser. */
import type {
  AuthTestResult,
  CommandError,
  DependencyReport,
  DownloadRequest,
  DownloadTask,
  Settings,
  VideoInfo,
} from "../types";

const VIDEO: VideoInfo = {
  id: "aqz-KE-bpKQ",
  source: "youtube",
  title: "Big Buck Bunny — Blender Open Movie",
  durationMs: 634_000,
  thumbnail: "https://i.ytimg.com/vi/aqz-KE-bpKQ/maxresdefault.jpg",
  uploader: "Blender",
  webpageUrl: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
  isLive: false,
  maxHeight: 2160,
  heights: [2160, 1440, 1080, 720, 480, 360],
  formats: [],
  uploadDate: "2008-05-10",
  viewCount: 18_452_110,
  chapters: [
    { startMs: 0, endMs: 62_000, title: "Opening" },
    { startMs: 62_000, endMs: 180_000, title: "Meet the characters" },
    { startMs: 180_000, endMs: 634_000, title: "The chase" },
  ],
};

const SETTINGS: Settings = {
  outputDir: "C:\\Users\\blago\\Videos\\Cutline",
  defaultQuality: "best",
  defaultFormat: "mp4",
  preciseCutting: false,
  namingTemplate: "{Title} - Clip {NN}",
  mergeCuts: false,
  maxConcurrentDownloads: 2,
  ytDlpPath: null,
  ffmpegPath: null,
  ffprobePath: null,
  potPluginDir: null,
  potServerDir: null,
  potProviderEnabled: false,
  authEnabled: false,
  authBrowser: "chrome",
  authProfile: null,
  theme: "light",
  soundEffects: true,
};

const DEPENDENCIES: DependencyReport = {
  ytDlp: {
    name: "yt-dlp",
    found: true,
    ready: true,
    path: "C:\\Users\\blago\\AppData\\Local\\Microsoft\\WinGet\\Links\\yt-dlp.exe",
    version: "2026.11.23",
    source: "system",
    error: null,
  },
  ffmpeg: {
    name: "FFmpeg",
    found: true,
    ready: true,
    path: "C:\\Users\\blago\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe",
    version: "9.1",
    source: "system",
    error: null,
  },
  ffprobe: {
    name: "FFprobe",
    found: true,
    ready: true,
    path: "C:\\Users\\blago\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffprobe.exe",
    version: "9.1",
    source: "system",
    error: null,
  },
  ready: true,
};

let settings: Settings = { ...SETTINGS };
const tasks: DownloadTask[] = [];
const listeners = new Set<(task: DownloadTask) => void>();
const timers = new Map<string, number>();

const emit = (task: DownloadTask) => {
  listeners.forEach((listener) => listener({ ...task }));
};

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function makeTask(request: DownloadRequest): DownloadTask {
  return {
    id: crypto.randomUUID(),
    clipId: request.clipId,
    clipName: request.clipName,
    fileBase: request.fileBase,
    url: request.url,
    startMs: request.startMs,
    endMs: request.endMs,
    sections: request.sections,
    quality: request.quality,
    format: request.format,
    precise: request.precise,
    status: "queued",
    progress: 0,
    downloadedBytes: null,
    totalBytes: null,
    speedBps: null,
    etaSecs: null,
    outputPath: null,
    fileSize: null,
    durationMs: null,
    hasAudio: false,
    hasVideo: false,
    error: null,
    errorCode: null,
    errorDetail: null,
    attempt: 0,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
  };
}

function simulate(task: DownloadTask) {
  const total = 9_400_000;
  window.setTimeout(() => {
    if (task.status !== "queued") return;
    task.status = "fetching";
    task.startedAt = Date.now();
    task.totalBytes = total;
    task.attempt += 1;
    emit(task);

    const timer = window.setInterval(() => {
      if (task.status !== "fetching") {
        window.clearInterval(timer);
        return;
      }
      const step = 620_000 + Math.random() * 900_000;
      task.downloadedBytes = Math.min(total, (task.downloadedBytes ?? 0) + step);
      task.progress = Math.min(0.99, task.downloadedBytes / total);
      task.speedBps = 3_400_000 + Math.random() * 2_600_000;
      task.etaSecs = Math.max(
        1,
        Math.round((total - task.downloadedBytes) / (task.speedBps || 1)),
      );
      emit(task);

      if (task.downloadedBytes >= total) {
        window.clearInterval(timer);
        task.status = "processing";
        task.progress = 0.995;
        task.speedBps = null;
        task.etaSecs = null;
        emit(task);
        window.setTimeout(() => {
          task.status = "completed";
          task.progress = 1;
          task.downloadedBytes = total;
          task.fileSize = 8_412_560;
          task.durationMs = task.endMs - task.startMs;
          task.hasAudio = task.format !== "mp3" ? true : true;
          task.hasVideo = task.format !== "mp3";
          task.outputPath = `${settings.outputDir}\\${task.fileBase}.${task.format}`;
          task.finishedAt = Date.now();
          emit(task);
        }, 1500);
      }
    }, 420);
    timers.set(task.id, timer);
  }, 700);
}

async function mockInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  switch (command) {
    case "probe_video": {
      await sleep(900);
      const url = String(args?.url ?? "");
      if (url.includes("fail")) {
        throw {
          code: "VIDEO_UNAVAILABLE",
          message: "This video is unavailable. It may be private, removed, or region locked.",
        } satisfies CommandError;
      }
      if (url.toLowerCase().includes("twitch.tv")) {
        const match = url.match(/videos\/(\d+)/i);
        const id = match?.[1] ?? "2145678901";
        return {
          ...VIDEO,
          id,
          source: "twitch",
          title: "Late Night Ranked Session — Twitch VOD",
          uploader: "TwitchCreator",
          webpageUrl: `https://www.twitch.tv/videos/${id}`,
          streamUrl: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
          durationMs: 7_200_000,
          maxHeight: 1080,
          heights: [1080, 720, 480, 360],
          chapters: [],
        } as T;
      }
      return { ...VIDEO } as T;
    }
    case "validate_url":
      return String(args?.url ?? "") as T;
    case "get_settings":
      return { ...settings } as T;
    case "update_settings":
      settings = { ...(args?.settings as Settings) };
      return { ...settings } as T;
    case "check_dependencies":
    case "install_dependencies":
      await sleep(350);
      return { ...DEPENDENCIES } as T;
    case "browser_profiles": {
      await sleep(200);
      const browser = String(args?.browser ?? "chrome");
      const installed = browser !== "none";
      return {
        browser,
        installed,
        dataDir: installed ? `C:\\Users\\blago\\AppData\\Local\\${browser}` : null,
        profiles: [
          { value: "", label: "Most recently used profile (default)" },
          { value: "Default", label: "Default profile" },
          { value: "Profile 1", label: "Profile 1" },
        ],
      } as T;
    }
    case "test_youtube_auth": {
      await sleep(1400);
      const draft = (args?.settings as Settings) ?? settings;
      const result: AuthTestResult = draft.authEnabled
        ? {
            ok: true,
            browser: draft.authBrowser,
            source: draft.authProfile ? `${draft.authBrowser}:${draft.authProfile}` : draft.authBrowser,
            videoTitle: "Me at the zoo",
            code: null,
            message: "Browser authentication works. YouTube metadata and playable formats were retrieved with your browser session.",
            detail: null,
          }
        : {
            ok: false,
            browser: draft.authBrowser,
            source: null,
            videoTitle: null,
            code: "AUTH_NOT_ENABLED",
            message: "Enable browser authentication and choose a browser first.",
            detail: null,
          };
      return result as T;
    }
    case "check_ytdlp_update":
      await sleep(600);
      return {
        currentVersion: "2026.11.23",
        latestVersion: "2026.11.23",
        updateAvailable: false,
        releaseUrl: "https://github.com/yt-dlp/yt-dlp/releases/latest",
      } as T;
    case "update_ytdlp":
      await sleep(900);
      return {
        path: settings.ytDlpPath ?? "C:\\Tools\\yt-dlp.exe",
        version: "2026.11.23",
        previousVersion: "2026.11.23",
      } as T;
    case "pot_provider_status":
      return {
        installed: Boolean(settings.potServerDir),
        running: Boolean(settings.potProviderEnabled),
        enabled: settings.potProviderEnabled,
        version: settings.potServerDir ? "2.0.2" : null,
        message: settings.potProviderEnabled
          ? "Provider is running on 127.0.0.1:4416."
          : "No provider installed.",
      } as T;
    case "diagnose_youtube": {
      await sleep(1200);
      return `Command-line config: ...\n[debug] [youtube] [pot] PO Token Providers: bgutil:http-2.0.2 (external)\n[youtube] [pot:bgutil:http] Generating a gvs PO Token for web client via bgutil HTTP server\nERROR: [youtube] jNQXAC9IVRw: No video formats found!` as T;
    }
    case "install_pot_provider": {
      await sleep(1800);
      settings.potPluginDir = "C:\\Users\\blago\\AppData\\Roaming\\com.cutline.studio\\bin\\pot-provider\\plugins";
      settings.potServerDir = "C:\\Users\\blago\\AppData\\Roaming\\com.cutline.studio\\bin\\pot-provider\\source\\server";
      settings.potProviderEnabled = true;
      return {
        pluginDir: settings.potPluginDir,
        serverDir: settings.potServerDir,
        version: "2.0.2",
        status: {
          installed: true,
          running: true,
          enabled: true,
          version: "2.0.2",
          message: "Provider installed and running.",
        },
      } as T;
    }
    case "start_pot_provider":
      settings.potProviderEnabled = true;
      return {
        installed: true,
        running: true,
        enabled: true,
        version: "2.0.2",
        message: "Provider is running on 127.0.0.1:4416.",
      } as T;
    case "stop_pot_provider":
      settings.potProviderEnabled = false;
      return {
        installed: Boolean(settings.potServerDir),
        running: false,
        enabled: false,
        version: settings.potServerDir ? "2.0.2" : null,
        message: "Provider is stopped.",
      } as T;
    case "app_version":
      return "1.9.0" as T;
    case "pick_directory":
      await sleep(300);
      return "D:\\Exports\\Cutline" as T;
    case "pick_binary":
      await sleep(300);
      return "C:\\Tools\\yt-dlp.exe" as T;
    case "list_downloads":
      return tasks.map((task) => ({ ...task })) as T;
    case "start_download": {
      const task = makeTask(args?.request as DownloadRequest);
      tasks.push(task);
      emit(task);
      simulate(task);
      return { ...task } as T;
    }
    case "start_batch": {
      const requests = (args?.requests as DownloadRequest[]) ?? [];
      const created = requests.map((request) => makeTask(request));
      created.forEach((task) => {
        tasks.push(task);
        emit(task);
        simulate(task);
      });
      return created as T;
    }
    case "cancel_download": {
      const task = tasks.find((entry) => entry.id === args?.id);
      if (task) {
        const timer = timers.get(task.id);
        if (timer) window.clearInterval(timer);
        task.status = "cancelled";
        task.finishedAt = Date.now();
        emit(task);
      }
      return undefined as T;
    }
    case "retry_download": {
      const task = tasks.find((entry) => entry.id === args?.id);
      if (!task) throw { code: "DOWNLOAD_NOT_FOUND", message: "That download no longer exists." };
      Object.assign(task, {
        status: "queued",
        progress: 0,
        downloadedBytes: null,
        totalBytes: null,
        error: null,
        errorDetail: null,
        outputPath: null,
        finishedAt: null,
      });
      emit(task);
      simulate(task);
      return { ...task } as T;
    }
    case "remove_download": {
      const index = tasks.findIndex((entry) => entry.id === args?.id);
      if (index >= 0) tasks.splice(index, 1);
      return undefined as T;
    }
    case "clear_finished_downloads": {
      for (let index = tasks.length - 1; index >= 0; index -= 1) {
        const status = tasks[index].status;
        if (status === "completed" || status === "failed" || status === "cancelled") {
          tasks.splice(index, 1);
        }
      }
      return tasks.map((task) => ({ ...task })) as T;
    }
    case "open_url":
    case "open_path":
    case "reveal_path":
    case "open_output_folder":
      return undefined as T;
    default:
      throw { code: "MOCK_MISSING", message: `No mock for ${command}` };
  }
}

export function mockCall<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return mockInvoke<T>(command, args);
}

export function mockListen(handler: (task: DownloadTask) => void): () => void {
  listeners.add(handler);
  return () => {
    listeners.delete(handler);
  };
}
