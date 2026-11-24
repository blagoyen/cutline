import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../services/api";
import type { DownloadRequest, DownloadTask } from "../types";

function upsert(list: DownloadTask[], task: DownloadTask): DownloadTask[] {
  const index = list.findIndex((entry) => entry.id === task.id);
  if (index === -1) return [...list, task];
  const next = list.slice();
  next[index] = task;
  return next;
}

export function useDownloads() {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let unlisten: (() => void) | undefined;
    let disposed = false;

    (async () => {
      try {
        const existing = await api.listDownloads();
        if (!disposed) setTasks(existing);
        const stop = await api.onDownloadUpdate((task) => {
          if (!disposed) setTasks((prev) => upsert(prev, task));
        });
        if (disposed) stop();
        else unlisten = stop;
      } catch {
        /* The manager is best-effort; the UI keeps working without it. */
      }
    })();

    return () => {
      disposed = true;
      mounted.current = false;
      unlisten?.();
    };
  }, []);

  const start = useCallback(async (request: DownloadRequest) => {
    const task = await api.startDownload(request);
    setTasks((prev) => upsert(prev, task));
    return task;
  }, []);

  const startBatch = useCallback(async (requests: DownloadRequest[]) => {
    const created = await api.startBatch(requests);
    setTasks((prev) => created.reduce(upsert, prev));
    return created;
  }, []);

  const cancel = useCallback(async (id: string) => {
    await api.cancelDownload(id);
  }, []);

  const retry = useCallback(async (id: string) => {
    const task = await api.retryDownload(id);
    setTasks((prev) => upsert(prev, task));
    return task;
  }, []);

  const remove = useCallback(async (id: string) => {
    await api.removeDownload(id);
    setTasks((prev) => prev.filter((task) => task.id !== id));
  }, []);

  const clearFinished = useCallback(async () => {
    const remaining = await api.clearFinishedDownloads();
    setTasks(remaining);
  }, []);

  const active = tasks.filter(
    (task) => task.status === "queued" || task.status === "fetching" || task.status === "processing",
  );

  const byClip = new Map<string, DownloadTask>();
  for (const task of tasks) {
    const current = byClip.get(task.clipId);
    if (!current || task.createdAt >= current.createdAt) {
      byClip.set(task.clipId, task);
    }
  }

  return { tasks, active, byClip, start, startBatch, cancel, retry, remove, clearFinished };
}
