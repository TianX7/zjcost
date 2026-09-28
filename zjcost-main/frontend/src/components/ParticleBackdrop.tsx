import { useEffect, useRef } from "react";
import { isWeakGpuDevice } from "../utils/deviceCapability";

/**
 * 全局蓝色动态粒子透视背景
 * - 透视网格向灭点收拢，体现空间纵深
 * - 蓝色粒子沿纵深缓慢漂浮
 *
 * 性能策略（核显/低配机器上曾因 60fps O(n²) 连线导致全局卡顿）：
 * - 核显/低核数/低内存设备：只绘制一帧静态背景，不运行动画循环
 * - 正常设备：限 30fps、连线批量描边、页面隐藏时暂停
 */

export default function ParticleBackdrop({ density = 1 }: { density?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const weak = isWeakGpuDevice();

    let raf = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;

    interface Particle {
      x: number; // -1..1
      y: number; // -1..1
      z: number; // 0..1 深度（0远 1近）
      size: number;
      speed: number;
      hue: number;
    }

    let particles: Particle[] = [];

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.6);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      const count = Math.round(Math.min(150, Math.max(60, (width * height) / 18000)) * density);
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * 2 - 1,
        y: Math.random() * 2 - 1,
        z: Math.random(),
        size: 0.6 + Math.random() * 1.8,
        speed: 0.00045 + Math.random() * 0.0011,
        hue: 205 + Math.random() * 25,
      }));
    };

    // 透视投影：灭点在画面中心偏上
    const project = (x: number, y: number, z: number) => {
      const cx = width / 2;
      const cy = height * 0.38;
      const scale = 0.35 + z * 1.4;
      return { px: cx + x * width * 0.5 * scale, py: cy + y * height * 0.55 * scale, s: scale };
    };

    const drawFrame = (animate: boolean) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // 透视网格：地面射线 + 环线（批量 path，两次 stroke）
      ctx.strokeStyle = "rgba(96, 165, 250, 0.05)";
      ctx.lineWidth = 1;
      const hx = width / 2;
      const hy = height * 0.38;
      ctx.beginPath();
      for (let i = -8; i <= 8; i++) {
        ctx.moveTo(hx + i * 18, hy);
        ctx.lineTo(hx + i * width * 0.16, height * 1.15);
      }
      for (let i = 1; i <= 10; i++) {
        const t = i / 10;
        const y = hy + (height * 1.15 - hy) * t * t;
        const half = width * 0.62 * t;
        ctx.moveTo(hx - half - 10, y);
        ctx.lineTo(hx + half + 10, y);
      }
      ctx.stroke();

      const pts = particles.map((p) => {
        if (animate) {
          p.z -= p.speed;
          if (p.z <= 0.02) {
            p.z = 1;
            p.x = Math.random() * 2 - 1;
            p.y = Math.random() * 2 - 1;
          }
        }
        const { px, py, s } = project(p.x, p.y, p.z);
        return { px, py, s, p };
      });

      // 连线按透明度分桶批量描边（原先逐条 stroke，核显上开销显著）
      const buckets: string[] = ["", "", ""];
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i];
          const b = pts[j];
          const dx = a.px - b.px;
          const dy = a.py - b.py;
          const d2 = dx * dx + dy * dy;
          if (d2 < 5200) {
            const alpha = (1 - d2 / 5200) * 0.14 * Math.min(a.s, b.s);
            const tier = alpha > 0.09 ? 2 : alpha > 0.045 ? 1 : 0;
            buckets[tier] += `M${a.px.toFixed(1)} ${a.py.toFixed(1)}L${b.px.toFixed(1)} ${b.py.toFixed(1)}`;
          }
        }
      }
      ctx.lineWidth = 0.6;
      for (let tier = 0; tier < 3; tier++) {
        if (!buckets[tier]) continue;
        const alpha = tier === 2 ? 0.11 : tier === 1 ? 0.07 : 0.035;
        ctx.strokeStyle = `rgba(96, 165, 250, ${alpha})`;
        const path = new Path2D(buckets[tier]);
        ctx.stroke(path);
      }
      for (const { px, py, s, p } of pts) {
        ctx.beginPath();
        ctx.fillStyle = `hsla(${p.hue}, 90%, 68%, ${0.18 + 0.5 * s * 0.45})`;
        ctx.arc(px, py, p.size * s, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    resize();

    if (weak) {
      // 低配设备：只画一帧静态背景（无动画循环、无常驻 CPU/GPU 占用）
      const onResizeStatic = () => {
        resize();
        drawFrame(false);
      };
      drawFrame(false);
      window.addEventListener("resize", onResizeStatic);
      return () => window.removeEventListener("resize", onResizeStatic);
    }

    let last = 0;
    const FRAME_MS = 33; // 30fps 上限：装饰性背景无需 60fps
    const draw = (ts: number) => {
      raf = requestAnimationFrame(draw);
      if (ts - last < FRAME_MS) return;
      last = ts;
      drawFrame(true);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      last = 0;
      raf = requestAnimationFrame(draw);
    };
    const stop = () => cancelAnimationFrame(raf);
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    const onResize = () => {
      resize();
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", onResize);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
    };
  }, [density]);

  return <canvas ref={canvasRef} className="particle-backdrop" aria-hidden="true" />;
}
