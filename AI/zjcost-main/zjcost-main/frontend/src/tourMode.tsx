/**
 * 筑衡 — 导览模式全局开关
 *
 * 开启后：
 * - 显示 TourGuide（7 步导览脚本面板）
 * - body 添加 .tour-mode 类（放大字体、隐藏调试元素）
 * - 讲解者可一键进入"导览就绪"状态
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

const STORAGE_KEY = "zhuheng.tour-mode";

interface TourModeContextValue {
  tourMode: boolean;
  toggleTourMode: () => void;
  setTourMode: (v: boolean) => void;
}

const TourModeContext = createContext<TourModeContextValue>({
  tourMode: false,
  toggleTourMode: () => {},
  setTourMode: () => {},
});

export function TourModeProvider({ children }: { children: ReactNode }) {
  const [tourMode, setTourModeState] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const setTourMode = useCallback((v: boolean) => {
    setTourModeState(v);
    try {
      sessionStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleTourMode = useCallback(() => {
    setTourMode(!tourMode);
  }, [tourMode, setTourMode]);

  useEffect(() => {
    const root = document.documentElement;
    if (tourMode) {
      root.classList.add("tour-mode");
    } else {
      root.classList.remove("tour-mode");
    }
    return () => root.classList.remove("tour-mode");
  }, [tourMode]);

  return (
    <TourModeContext.Provider value={{ tourMode, toggleTourMode, setTourMode }}>
      {children}
    </TourModeContext.Provider>
  );
}

// This module intentionally exports a hook alongside its provider.
// eslint-disable-next-line react-refresh/only-export-components
export function useTourMode() {
  return useContext(TourModeContext);
}
