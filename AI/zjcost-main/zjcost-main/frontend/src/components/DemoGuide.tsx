/**
 * 筑衡 — 演示导览控制面板
 *
 * 比赛现场演示辅助工具：
 * - 浮动控制面板（右下角），可折叠
 * - 步骤导航：上一步 / 下一步 / 跳转
 * - 讲解提示卡：当前步骤的讲解要点
 * - 计时器：已用时间 / 预计时长
 * - 键盘快捷键：← 上一步，→ 下一步，Space 暂停计时，R 重置，H 隐藏/显示
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { DEMO_STEPS } from "../demoSteps";
import DemoSummary from "./DemoSummary";

const STORAGE_KEY = "zh-demo-guide-state";

interface GuideState {
  active: boolean;
  stepIndex: number; // 0-based
  elapsed: number; // 秒
  running: boolean;
}

function loadState(): GuideState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as GuideState;
  } catch { /* ignore */ }
  return { active: false, stepIndex: 0, elapsed: 0, running: false };
}

function saveState(state: GuideState) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export default function DemoGuide() {
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState<GuideState>(loadState);
  const [collapsed, setCollapsed] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentStep = DEMO_STEPS[state.stepIndex];
  const isLast = state.stepIndex >= DEMO_STEPS.length - 1;
  const isFirst = state.stepIndex <= 0;

  // 持久化
  useEffect(() => { saveState(state); }, [state]);

  // 计时器
  useEffect(() => {
    if (!state.active || !state.running) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }
    timerRef.current = setInterval(() => {
      setState(prev => ({ ...prev, elapsed: prev.elapsed + 1 }));
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [state.active, state.running]);

  // 路由同步：激活时跳转到当前步骤的路由
  useEffect(() => {
    if (state.active && currentStep && location.pathname !== currentStep.route) {
      navigate(currentStep.route);
    }
  }, [state.active, state.stepIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const goToStep = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(DEMO_STEPS.length - 1, index));
    const step = DEMO_STEPS[clamped];
    setState(prev => ({ ...prev, stepIndex: clamped }));
    if (step && location.pathname !== step.route) {
      navigate(step.route);
    }
  }, [navigate, location.pathname]);

  const next = useCallback(() => goToStep(state.stepIndex + 1), [goToStep, state.stepIndex]);
  const prev = useCallback(() => goToStep(state.stepIndex - 1), [goToStep, state.stepIndex]);

  const toggleActive = useCallback(() => {
    setState(prev => ({ ...prev, active: !prev.active, running: !prev.active, elapsed: prev.active ? prev.elapsed : 0 }));
  }, []);

  const reset = useCallback(() => {
    setState({ active: true, stepIndex: 0, elapsed: 0, running: true });
    navigate("/dashboard");
  }, [navigate]);

  const togglePause = useCallback(() => {
    setState(prev => ({ ...prev, running: !prev.running }));
  }, []);

  // 键盘快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 在输入框中不拦截
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      if (e.key === "h" || e.key === "H") {
        e.preventDefault();
        setCollapsed(c => !c);
        return;
      }
      if (!state.active) return;

      if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
      else if (e.key === " ") { e.preventDefault(); togglePause(); }
      else if (e.key === "r" || e.key === "R") { e.preventDefault(); reset(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [state.active, next, prev, togglePause, reset]);

  // 未激活时显示一个启动按钮
  if (!state.active) {
    return (
      <button
        type="button"
        className="demo-guide-launch"
        onClick={toggleActive}
        title="启动演示导览"
      >
        <span className="material-symbols-outlined">play_circle</span>
        <span>演示导览</span>
      </button>
    );
  }

  const progressPercent = Math.round(((state.stepIndex + 1) / DEMO_STEPS.length) * 100);
  const stepElapsed = state.elapsed; // 简化：用总计时
  const overTime = stepElapsed > currentStep?.duration;

  return (
    <div className={`demo-guide${collapsed ? " demo-guide-collapsed" : ""}`}>
      {/* 折叠态：只显示一个小圆 */}
      {collapsed ? (
        <button
          type="button"
          className="demo-guide-toggle"
          onClick={() => setCollapsed(false)}
          title="展开导览面板（H）"
        >
          <span className="material-symbols-outlined">expand_less</span>
          <span className="demo-guide-toggle-badge">{state.stepIndex + 1}/{DEMO_STEPS.length}</span>
        </button>
      ) : (
        <>
          {/* 头部 */}
          <div className="demo-guide-header">
            <div className="demo-guide-header-info">
              <span className="material-symbols-outlined demo-guide-header-icon">tour</span>
              <div>
                <div className="demo-guide-header-title">演示导览</div>
                <div className="demo-guide-header-sub">步骤 {state.stepIndex + 1} / {DEMO_STEPS.length}</div>
              </div>
            </div>
            <button
              type="button"
              className="demo-guide-icon-btn"
              onClick={() => setCollapsed(true)}
              title="折叠（H）"
            >
              <span className="material-symbols-outlined">expand_more</span>
            </button>
          </div>

          {/* 进度条 */}
          <div className="demo-guide-progress">
            <div className="demo-guide-progress-bar" style={{ width: `${progressPercent}%` }} />
          </div>

          {/* 当前步骤卡片 */}
          <div className="demo-guide-step">
            <div className="demo-guide-step-head">
              <span className="material-symbols-outlined demo-guide-step-icon">{currentStep?.icon}</span>
              <div className="demo-guide-step-title">{currentStep?.title}</div>
            </div>
            <ul className="demo-guide-points">
              {currentStep?.points.map((point, i) => (
                <li key={i}>{point}</li>
              ))}
            </ul>
          </div>

          {/* 计时器 */}
          <div className="demo-guide-timer">
            <button
              type="button"
              className="demo-guide-icon-btn"
              onClick={togglePause}
              title={state.running ? "暂停（Space）" : "继续（Space）"}
            >
              <span className="material-symbols-outlined">{state.running ? "pause" : "play_arrow"}</span>
            </button>
            <span className={`demo-guide-time${overTime ? " demo-guide-time-over" : ""}`}>
              {formatTime(stepElapsed)}
            </span>
            <span className="demo-guide-time-target">/ {formatTime(currentStep?.duration || 0)}</span>
            <button
              type="button"
              className="demo-guide-icon-btn"
              onClick={reset}
              title="重置（R）"
            >
              <span className="material-symbols-outlined">restart_alt</span>
            </button>
          </div>

          {/* 导航按钮 */}
          <div className="demo-guide-nav">
            <button
              type="button"
              className="demo-guide-nav-btn"
              onClick={prev}
              disabled={isFirst}
              title="上一步（←）"
            >
              <span className="material-symbols-outlined">chevron_left</span>
              上一步
            </button>
            <button
              type="button"
              className="demo-guide-nav-btn demo-guide-nav-btn-primary"
              onClick={isLast ? () => setShowSummary(true) : next}
              title={isLast ? "完成演示" : "下一步（→）"}
            >
              {isLast ? "完成" : "下一步"}
              <span className="material-symbols-outlined">{isLast ? "check" : "chevron_right"}</span>
            </button>
          </div>

          {/* 退出演示 */}
          <button
            type="button"
            className="demo-guide-exit"
            onClick={toggleActive}
            title="退出演示导览"
          >
            <span className="material-symbols-outlined">close</span>
            退出导览
          </button>

          {/* 快捷键提示 */}
          <div className="demo-guide-shortcuts">
            ← → 切换 · Space 暂停 · R 重置 · H 折叠
          </div>
        </>
      )}

      {/* 演示结束总结页 */}
      <DemoSummary
        open={showSummary}
        elapsed={state.elapsed}
        onClose={() => {
          setShowSummary(false);
          toggleActive();
        }}
      />
    </div>
  );
}
