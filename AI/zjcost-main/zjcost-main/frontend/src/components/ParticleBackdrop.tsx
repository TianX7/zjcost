import { useEffect, useRef } from "react";

/**
 * 全局蓝色动态粒子透视背景
 * - 透视网格向灭点收拢，体现空间纵深
 * - 蓝色粒子沿纵深缓慢漂浮
 */
export default function ParticleBackdrop({ density = 1 }: { density?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

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

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // 透视网格：地面射线 + 环线
      ctx.strokeStyle = "rgba(96, 165, 250, 0.05)";
      ctx.lineWidth = 1;
      const hx = width / 2;
      const hy = height * 0.38;
      for (let i = -8; i <= 8; i++) {
        ctx.beginPath();
        ctx.moveTo(hx + i * 18, hy);
        ctx.lineTo(hx + i * width * 0.16, height * 1.15);
        ctx.stroke();
      }
      for (let i = 1; i <= 10; i++) {
        const t = i / 10;
        const y = hy + (height * 1.15 - hy) * t * t;
        const half = width * 0.62 * t;
        ctx.beginPath();
        ctx.moveTo(hx - half - 10, y);
        ctx.lineTo(hx + half + 10, y);
        ctx.stroke();
      }

      const pts = particles.map((p) => {
        p.z -= p.speed;
        if (p.z <= 0.02) {
          p.z = 1;
          p.x = Math.random() * 2 - 1;
          p.y = Math.random() * 2 - 1;
        }
        const { px, py, s } = project(p.x, p.y, p.z);
        return { px, py, s, p };
      });
      ctx.lineWidth = 0.6;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i];
          const b = pts[j];
          const dx = a.px - b.px;
          const dy = a.py - b.py;
          const d2 = dx * dx + dy * dy;
          if (d2 < 5200) {
            const alpha = (1 - d2 / 5200) * 0.14 * Math.min(a.s, b.s);
            ctx.strokeStyle = `rgba(96, 165, 250, ${alpha})`;
            ctx.beginPath();
            ctx.moveTo(a.px, a.py);
            ctx.lineTo(b.px, b.py);
            ctx.stroke();
          }
        }
      }
      for (const { px, py, s, p } of pts) {
        ctx.beginPath();
        ctx.fillStyle = `hsla(${p.hue}, 90%, 68%, ${0.18 + 0.5 * s * 0.45})`;
        ctx.arc(px, py, p.size * s, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [density]);

  return <canvas ref={canvasRef} className="particle-backdrop" aria-hidden="true" />;
}
