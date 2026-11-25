export type ToastTone = "error" | "success" | "info";


export interface AppNotice {
  id: number;
  message: string;
  tone: ToastTone;
  createdAt: number;
}

export interface FormatInfo {
  formatId: string;
  ext: string;
  height: number | null;
  width: number | null;
  fps: number | null;
  vcodec: string | null;
  acodec: string | null;
  filesize: number | null;
  note: string | null;
}

export interface Chapter {
  startMs: number;
  endMs: number;
  title: string;
}

export type VideoSource = "youtube" | "twitch";

export interface VideoInfo {
  id: string;
  source: VideoSource;
  title: string;
  durationMs: number;
  thumbnail: string;
  uploader: string | null;
  webpageUrl: string;
  isLive: boolean;
  maxHeight: number;
  heights: number[];
  formats: FormatInfo[];
  uploadDate: string | null;
  viewCount: number | null;
  chapters: Chapter[];
}

export interface Clip {
  id: string;
  name: string;
  startMs: number;
  endMs: number;
}

export interface DownloadSection {
  startMs: number;
  endMs: number;
}

export type DownloadStatus =
  | "queued"
  | "fetching"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export interface DownloadTask {
  id: string;
  clipId: string;
  clipName: string;
  fileBase: string;
  url: string;
  startMs: number;
  endMs: number;
  sections: DownloadSection[];
  quality: string;
  format: string;
  precise: boolean;
  status: DownloadStatus;
  progress: number;
  downloadedBytes: number | null;
  totalBytes: number | null;
  speedBps: number | null;
  etaSecs: number | null;
  outputPath: string | null;
  fileSize: number | null;
  durationMs: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
  error: string | null;
  errorCode: string | null;
  errorDetail: string | null;
  attempt: number;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface DownloadRequest {
  clipId: string;
  clipName: string;
  fileBase: string;
  url: string;
  startMs: number;
  endMs: number;
  sections: DownloadSection[];
  quality: string;
  format: string;
  precise: boolean;
}

export interface Settings {
  outputDir: string;
  defaultQuality: string;
  defaultFormat: string;
  preciseCutting: boolean;
  namingTemplate: string;
  mergeCuts: boolean;
  maxConcurrentDownloads: number;
  ytDlpPath: string | null;
  ffmpegPath: string | null;
  ffprobePath: string | null;
  potPluginDir: string | null;
  potServerDir: string | null;
  potProviderEnabled: boolean;
  authEnabled: boolean;
  authBrowser: "chrome" | "edge" | "firefox" | "brave" | "chromium" | "none" | string;
  authProfile: string | null;
  theme: "light" | "dark" | string;
  soundEffects: boolean;
}

export interface ProviderStatus {
  installed: boolean;
  running: boolean;
  enabled: boolean;
  version: string | null;
  message: string;
}

export interface ProviderInstall {
  pluginDir: string;
  serverDir: string;
  version: string;
  status: ProviderStatus;
}

export interface AuthTestResult {
  ok: boolean;
  browser: string;
  source: string | null;
  videoTitle: string | null;
  code: string | null;
  message: string;
  detail?: string | null;
}

export interface BrowserProfile {
  value: string;
  label: string;
}

export interface BrowserProfileInfo {
  browser: string;
  installed: boolean;
  dataDir: string | null;
  profiles: BrowserProfile[];
}

export interface UpdateInfo {
  currentVersion: string | null;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
}

export interface UpdateResult {
  path: string;
  version: string;
  previousVersion: string | null;
}

export interface DependencyInfo {
  name: string;
  found: boolean;
  ready: boolean;
  path: string | null;
  version: string | null;
  source: string;
  error: string | null;
}

export interface DependencyReport {
  ytDlp: DependencyInfo;
  ffmpeg: DependencyInfo;
  ffprobe: DependencyInfo;
  ready: boolean;
}

export interface CommandError {
  code: string;
  message: string;
  detail?: string | null;
}
