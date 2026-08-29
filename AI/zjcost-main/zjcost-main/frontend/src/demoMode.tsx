/**
 * 筑衡 — 演示模式全局开关
 *
 * 开启后：
 * - 显示 DemoGuide（7 步演示脚本面板）
 * - body 添加 .demo-mode 类（放大字体、隐藏调试元素）
 * - 演示者可一键进入"演示就绪"状态
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

const STORAGE_KEY = "zhuheng.demo-mode";

interface DemoModeContextValue {
  demoMode: boolean;
  toggleDemoMode: () => void;
  setDemoMode: (v: boolean) => void;
}

const DemoModeContext = createContext<DemoModeContextValue>({
  demoMode: false,
  toggleDemoMode: () => {},
  setDemoMode: () => {},
});

export function DemoModeProvider({ children }: { children: ReactNode }) {
  const [demoMode, setDemoModeState] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const setDemoMode = useCallback((v: boolean) => {
    setDemoModeState(v);
    try {
      sessionStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleDemoMode = useCallback(() => {
    setDemoMode(!demoMode);
  }, [demoMode, setDemoMode]);

  useEffect(() => {
    const root = document.documentElement;
    if (demoMode) {
      root.classList.add("demo-mode");
    } else {
      root.classList.remove("demo-mode");
    }
    return () => root.classList.remove("demo-mode");
  }, [demoMode]);

  return (
    <DemoModeContext.Provider value={{ demoMode, toggleDemoMode, setDemoMode }}>
      {children}
    </DemoModeContext.Provider>
  );
}

// This module intentionally exports a hook alongside its provider.
// eslint-disable-next-line react-refresh/only-export-components
export function useDemoMode() {
  return useContext(DemoModeContext);
}
