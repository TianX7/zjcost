export const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";
export const AUTH_TOKEN_STORAGE_KEY = "zjcost.auth.token";
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const UPLOAD_REQUEST_TIMEOUT_MS = 120000;

/** 401 时派发的事件名，AuthGate 监听此事件以切换到登录界面 */
export const AUTH_LOGOUT_EVENT = "zjcost:auth-logout";

/** 导览模式是否激活（由 TourModeProvider 设置 body.tour-mode 类驱动） */
function isTourModeActive(): boolean {
  try {
    return document.documentElement.classList.contains("tour-mode");
  } catch {
    return false;
  }
}

// 动态导入导览快照匹配器（避免非导览模式下的加载开销）
import { matchTourSnapshot, SAMPLE_UPLOAD_TASK_ID } from "./tourSnapshot";

export function getAuthToken() {
  try {
    return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function setAuthToken(token: string) {
  try {
    if (token) window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    else window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    // localStorage may be unavailable in restricted browser contexts.
  }
}

/**
 * 当后端返回 401 时清除本地 token 并派发事件，让 AuthGate 切换到登录界面
 */
function handleUnauthorized() {
  setAuthToken("");
  window.dispatchEvent(new CustomEvent(AUTH_LOGOUT_EVENT));
}

export function authHeaders(headers?: HeadersInit): HeadersInit {
  const token = getAuthToken();
  return token ? { ...(headers || {}), Authorization: `Bearer ${token}` } : (headers || {});
}

export function createTimeoutSignal(timeoutMs: number, externalSignal?: AbortSignal) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }

  return {
    signal: controller.signal,
    clear: () => window.clearTimeout(timer),
  };
}

async function parseErrorResponse(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data?.detail === "string") return data.detail;
    if (typeof data?.message === "string") return data.message;
  } catch {
    try {
      const text = await res.text();
      if (text) return text.slice(0, 300);
    } catch {
      // ignore body parse failures
    }
  }
  return `${res.status} ${res.statusText}`;
}

export async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  // 导览模式：优先返回离线快照数据
  if (isTourModeActive()) {
    try {
      const snapshot = matchTourSnapshot(path, opts?.method ?? "GET");
      if (snapshot !== null) {
        return snapshot as T;
      }
    } catch {
      // 快照匹配失败，回退到真实请求
    }
  }

  const { signal, clear } = createTimeoutSignal(DEFAULT_REQUEST_TIMEOUT_MS, opts?.signal ?? undefined);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...opts,
      headers: authHeaders({ "Content-Type": "application/json", ...(opts?.headers || {}) }),
      signal,
    });
    if (res.status === 401) handleUnauthorized();
    if (!res.ok) throw new Error(await parseErrorResponse(res));
    return res.json() as Promise<T>;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("请求超时，请确认后端服务是否正常运行");
    }
    throw err;
  } finally {
    clear();
  }
}

export async function upload<T>(path: string, formData: FormData): Promise<T> {
  // 导览模式：图纸识别上传返回模拟 taskId
  if (isTourModeActive() && path.startsWith("/drawing-recognition")) {
    return SAMPLE_UPLOAD_TASK_ID as T;
  }

  const { signal, clear } = createTimeoutSignal(UPLOAD_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, { method: "POST", body: formData, signal, headers: authHeaders() });
    if (res.status === 401) handleUnauthorized();
    if (!res.ok) throw new Error(await parseErrorResponse(res));
    return res.json() as Promise<T>;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("上传请求超时，请确认后端服务是否正常运行");
    }
    throw err;
  } finally {
    clear();
  }
}
