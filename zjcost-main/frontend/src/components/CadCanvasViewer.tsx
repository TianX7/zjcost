import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";

export interface CadGeometry {
  bbox: [number, number, number, number] | null;
  /** key 为 CAD 原色 "#rrggbb"，value 为线段坐标序列 */
  groups: Record<string, number[]>;
  highlights: [number, number, number, number, string][];
  texts: [number, number, number, string, string?][];
}

export interface CadCanvasViewerHandle {
  /** 图纸复位：回到初始缩放与位置 */
  reset: () => void;
}

export interface CadRaster {
  /** ezdxf 专业绘图引擎渲染的高清 PNG 位图（黑底原色，完整原样） */
  data_url: string;
  width: number;
  height: number;
}

interface CadCanvasViewerProps {
  geometry: CadGeometry;
  /** 高清栅格图：存在时优先平铺显示（原样完整），WebGL 几何模式作回退 */
  raster?: CadRaster | null;
  /** 构件显现进度（识别到的构件逐个标识） */
  revealIndex?: number;
  /** 构件总数：把 revealIndex 等比映射到高亮框数量，完成后全部显示 */
  revealTotal?: number;
  className?: string;
}

// 底图线条配色：未分类图元用暗色，识别规则命中的图层用对应构件色
const RULE_COLORS: Record<string, number> = {
  column: 0x67e8f9,
  beam: 0x93c5fd,
  wall: 0xfbbf24,
  slab: 0xa78bfa,
  door: 0x34d399,
  window: 0x22d3ee,
  stair: 0xf472b6,
  rebar: 0xf87171,
  foundation: 0xfb923c,
  roof: 0xfde047,
};

function ruleColor(key: string): number {
  return RULE_COLORS[key] ?? 0xf1f7ff;
}

/**
 * 内置 CAD 快速看图（WebGL）：直接显示 CAD 底图。
 * 全部线条合并进单个 LineSegments 缓冲区，一次 draw call 由 GPU 渲染，
 * 数万图元缩放平移也保持流畅——与 SVG 的 CPU 逐节点绘制有本质区别。
 */
const GlCadViewer = forwardRef<CadCanvasViewerHandle, CadCanvasViewerProps>(
  function GlCadViewer({ geometry, revealIndex = 0, revealTotal = 0, className }, ref) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const highlightRef = useRef<THREE.LineSegments | null>(null);
    const highlightFillRef = useRef<THREE.Mesh | null>(null);
    const resetViewRef = useRef<() => void>(() => {});
    const disposedRef = useRef(false);

    useImperativeHandle(ref, () => ({ reset: () => resetViewRef.current() }), []);

    useEffect(() => {
      const host = hostRef.current;
      if (!host || !geometry?.bbox || !geometry.groups) return;
      disposedRef.current = false;

      const [minX, minY, maxX, maxY] = geometry.bbox;
      const w = Math.max(maxX - minX, 1);
      const h = Math.max(maxY - minY, 1);
      // 等比归一化：按长边缩放并居中，保持图纸真实长宽比（修复预览发扁）
      const s = Math.max(w, h);
      const offX = (s - w) / 2;
      const offY = (s - h) / 2;
      const nx = (x: number) => (x - minX + offX) / s;
      const ny = (y: number) => 1 - (y - minY + offY) / s;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      // 黑底看图，与 CAD 快速看图一致
      renderer.setClearColor(0x000000, 1);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      renderer.domElement.style.display = "block";
      renderer.domElement.style.cursor = "grab";
      host.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      // 图纸坐标 → 0..1 归一化，Y 已在后端翻转为屏幕方向
      const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 100);
      camera.position.z = 10;

      // ① 底图线条：全部合并为一个 LineSegments（一次 draw call）
      const groupEntries = Object.entries(geometry.groups);
      let totalSegs = 0;
      for (const [, arr] of groupEntries) totalSegs += Math.floor(arr.length / 4);
      const positions = new Float32Array(totalSegs * 6);
      const colors = new Float32Array(totalSegs * 6);
      let offset = 0;
      const tmpColor = new THREE.Color();
      for (const [key, arr] of groupEntries) {
        // 后端按 CAD 原色（true_color/ACI/图层色）分组，key 即 "#rrggbb"
        tmpColor.set(key);
        const segs = Math.floor(arr.length / 4);
        for (let i = 0; i < segs; i += 1) {
          const o = i * 4;
          positions[offset * 6 + 0] = nx(arr[o]);
          positions[offset * 6 + 1] = ny(arr[o + 1]);
          positions[offset * 6 + 2] = 0;
          positions[offset * 6 + 3] = nx(arr[o + 2]);
          positions[offset * 6 + 4] = ny(arr[o + 3]);
          positions[offset * 6 + 5] = 0;
          for (let v = 0; v < 2; v += 1) {
            colors[offset * 6 + v * 3 + 0] = tmpColor.r;
            colors[offset * 6 + v * 3 + 1] = tmpColor.g;
            colors[offset * 6 + v * 3 + 2] = tmpColor.b;
          }
          offset += 1;
        }
      }
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      lineGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      scene.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true })));

      // ② 解析实体标识：识别到的构件在底图上叠加高亮框（轮廓 + 半透明填充），
      // 随识别进度逐个显现，解析完成后全部显示
      const hl = geometry.highlights ?? [];
      const hlPositions = new Float32Array(hl.length * 8 * 3);
      const hlColors = new Float32Array(hl.length * 8 * 3);
      const fillPositions = new Float32Array(hl.length * 6 * 3);
      const fillColors = new Float32Array(hl.length * 6 * 3);
      const tmpBox = new THREE.Color();
      hl.forEach((r, idx) => {
        const [x1, y1, x2, y2, key] = r;
        const ax = nx(x1);
        const bx = nx(x2);
        const ay = ny(y1);
        const by = ny(y2);
        const edges = [
          [ax, ay, bx, ay], [bx, ay, bx, by], [bx, by, ax, by], [ax, by, ax, ay],
        ];
        edges.forEach(([px, py, qx, qy], seg) => {
          const base = (idx * 8 + seg * 2) * 3;
          hlPositions[base + 0] = px;
          hlPositions[base + 1] = py;
          hlPositions[base + 2] = 0.01;
          hlPositions[base + 3] = qx;
          hlPositions[base + 4] = qy;
          hlPositions[base + 5] = 0.01;
        });
        const tri = [
          [ax, ay], [bx, ay], [bx, by],
          [ax, ay], [bx, by], [ax, by],
        ];
        tri.forEach(([px, py], v) => {
          const base = (idx * 6 + v) * 3;
          fillPositions[base + 0] = px;
          fillPositions[base + 1] = py;
          fillPositions[base + 2] = 0.005;
        });
        tmpBox.setHex(ruleColor(String(key)));
        for (let v = 0; v < 8; v += 1) {
          const base = (idx * 8 + v) * 3;
          hlColors[base + 0] = tmpBox.r;
          hlColors[base + 1] = tmpBox.g;
          hlColors[base + 2] = tmpBox.b;
        }
        for (let v = 0; v < 6; v += 1) {
          const base = (idx * 6 + v) * 3;
          fillColors[base + 0] = tmpBox.r;
          fillColors[base + 1] = tmpBox.g;
          fillColors[base + 2] = tmpBox.b;
        }
      });
      const hlGeo = new THREE.BufferGeometry();
      hlGeo.setAttribute("position", new THREE.BufferAttribute(hlPositions, 3));
      hlGeo.setAttribute("color", new THREE.BufferAttribute(hlColors, 3));
      const highlights = new THREE.LineSegments(hlGeo, new THREE.LineBasicMaterial({ vertexColors: true }));
      highlights.visible = false;
      scene.add(highlights);
      highlightRef.current = highlights;

      const fillGeo = new THREE.BufferGeometry();
      fillGeo.setAttribute("position", new THREE.BufferAttribute(fillPositions, 3));
      fillGeo.setAttribute("color", new THREE.BufferAttribute(fillColors, 3));
      const highlightFill = new THREE.Mesh(
        fillGeo,
        new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.14, depthWrite: false }),
      );
      highlightFill.visible = false;
      scene.add(highlightFill);
      highlightFillRef.current = highlightFill;

      // ③ 文字标注：Canvas 纹理精灵，原样呈现图纸文字
      const sprites: THREE.Sprite[] = [];
      const texts = (geometry.texts ?? []).slice(0, 600);
      if (texts.length) {
        const canvas = document.createElement("canvas");
        canvas.width = 512;
        canvas.height = 64;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          for (const [tx, ty, size, txt, color] of texts) {
            ctx.clearRect(0, 0, 512, 64);
            ctx.font = "26px 'Microsoft YaHei', sans-serif";
            ctx.fillStyle = typeof color === "string" ? color : "#ffffff";
            ctx.textBaseline = "middle";
            ctx.fillText(String(txt).slice(0, 24), 4, 32);
            const tex = new THREE.CanvasTexture(canvas);
            const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.9 });
            const sprite = new THREE.Sprite(mat);
            // 文字按真实比例显示（与 CAD 快速看图一致）：全图时很小，放大后清晰
            const ratio = size / s; // size 与 s 同单位（原始坐标 *10）
            const scale = Math.min(0.05, Math.max(0.0006, ratio * 2.5));
            sprite.scale.set(scale * 8, scale, 1);
            sprite.position.set(nx(tx), ny(ty), 0.02);
            scene.add(sprite);
            sprites.push(sprite);
          }
        }
      }

      // 视图控制：滚轮缩放（光标中心）、拖拽平移、双击复位
      const view = { scale: 1, panX: 0, panY: 0 };
      const applyCamera = () => {
        const cw = host.clientWidth || 1;
        const ch = host.clientHeight || 1;
        const viewW = 1 / view.scale;
        const viewH = viewW * (ch / cw);
        const cx = 0.5 + view.panX;
        const cy = 0.5 + view.panY;
        camera.left = cx - viewW / 2;
        camera.right = cx + viewW / 2;
        camera.top = cy + viewH / 2;
        camera.bottom = cy - viewH / 2;
        camera.updateProjectionMatrix();
      };
      const resetView = () => {
        view.scale = 1;
        view.panX = 0;
        view.panY = 0;
        applyCamera();
      };
      resetViewRef.current = resetView;
      const resize = () => {
        renderer.setSize(host.clientWidth || 1, host.clientHeight || 1, false);
        applyCamera();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(host);

      let dragging = false;
      let lastX = 0;
      let lastY = 0;
      const onWheel = (ev: WheelEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        const cw = host.clientWidth || 1;
        const ch = host.clientHeight || 1;
        const rect = host.getBoundingClientRect();
        const wx = (ev.clientX - rect.left) / cw;
        const wy = 1 - (ev.clientY - rect.top) / ch;
        const factor = ev.deltaY > 0 ? 1 / 1.18 : 1.18;
        const newScale = Math.min(500, Math.max(0.5, view.scale * factor));
        const k = newScale / view.scale;
        view.panX = wx - 0.5 - (wx - 0.5 - view.panX) / k;
        view.panY = wy - 0.5 - (wy - 0.5 - view.panY) / k;
        view.scale = newScale;
        applyCamera();
      };
      const onDown = (ev: PointerEvent) => {
        ev.stopPropagation();
        dragging = true;
        lastX = ev.clientX;
        lastY = ev.clientY;
        renderer.domElement.setPointerCapture(ev.pointerId);
      };
      const onMove = (ev: PointerEvent) => {
        if (!dragging) return;
        const cw = host.clientWidth || 1;
        const ch = host.clientHeight || 1;
        const viewW = 1 / view.scale;
        const viewH = viewW * (ch / cw);
        view.panX -= ((ev.clientX - lastX) / cw) * viewW;
        view.panY += ((ev.clientY - lastY) / ch) * viewH;
        lastX = ev.clientX;
        lastY = ev.clientY;
        applyCamera();
      };
      const onUp = () => { dragging = false; };
      const el = renderer.domElement;
      el.addEventListener("wheel", onWheel, { passive: false });
      el.addEventListener("pointerdown", onDown);
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
      el.addEventListener("dblclick", resetView);

      const loop = () => {
        if (disposedRef.current) return;
        renderer.render(scene, camera);
        raf = requestAnimationFrame(loop);
      };
      let raf = requestAnimationFrame(loop);

      return () => {
        disposedRef.current = true;
        cancelAnimationFrame(raf);
        ro.disconnect();
        el.removeEventListener("wheel", onWheel);
        el.removeEventListener("pointerdown", onDown);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
        el.removeEventListener("dblclick", resetView);
        lineGeo.dispose();
        hlGeo.dispose();
        fillGeo.dispose();
        highlightFill.material.dispose();
        sprites.forEach((sp) => {
          (sp.material as THREE.SpriteMaterial).map?.dispose();
          sp.material.dispose();
        });
        renderer.dispose();
        if (el.parentElement === host) host.removeChild(el);
      };
    }, [geometry]);

    // 解析实体标识显现：按构件进度等比显示高亮框，解析完成后全部可见
    useEffect(() => {
      const hlObj = highlightRef.current;
      const fillObj = highlightFillRef.current;
      if (!hlObj || !fillObj || !geometry?.highlights?.length) return;
      const total = geometry.highlights.length;
      const frac = revealTotal > 0 ? Math.min(1, Math.max(0, revealIndex) / revealTotal) : 0;
      const visible = Math.round(frac * total);
      hlObj.geometry.setDrawRange(0, visible * 8);
      fillObj.geometry.setDrawRange(0, visible * 6);
      hlObj.visible = visible > 0;
      fillObj.visible = visible > 0;
    }, [revealIndex, revealTotal, geometry]);

    return <div ref={hostRef} className={className} style={{ width: "100%", height: "100%" }} />;
  },
);

interface RasterCadViewerProps {
  dataUrl: string;
  className?: string;
}

/**
 * 栅格模式：ezdxf 专业绘图引擎渲染的高清位图平铺显示。
 * 图面原样完整（标注/块/填充/线宽/文字全都在），等效 CAD 快速看图。
 */
const RasterCadViewer = forwardRef<CadCanvasViewerHandle, RasterCadViewerProps>(
  function RasterCadViewer({ dataUrl, className }, ref) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const imgRef = useRef<HTMLImageElement | null>(null);
    const viewRef = useRef({ s: 1, tx: 0, ty: 0, fitS: 1 });

    const applyTransform = () => {
      const img = imgRef.current;
      if (!img) return;
      const v = viewRef.current;
      img.style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.s})`;
      // 放大超过位图原生分辨率后改用最近邻插值：CAD 线条保持锐利，
      // 默认的双线性会把线条糊成一团（缩小适配时仍用平滑插值抗锯齿）
      img.style.imageRendering = v.s >= 1 ? "pixelated" : "auto";
    };

    const fitToView = () => {
      const host = hostRef.current;
      const img = imgRef.current;
      if (!host || !img || !img.naturalWidth) return;
      const cw = host.clientWidth || 1;
      const ch = host.clientHeight || 1;
      const iw = img.naturalWidth || 1;
      const ih = img.naturalHeight || 1;
      const s = Math.min(cw / iw, ch / ih);
      const v = viewRef.current;
      v.fitS = s;
      v.s = s;
      v.tx = (cw - iw * s) / 2;
      v.ty = (ch - ih * s) / 2;
      applyTransform();
    };

    useImperativeHandle(ref, () => ({ reset: () => fitToView() }), []);

    useEffect(() => {
      const host = hostRef.current;
      const img = imgRef.current;
      if (!host || !img) return;

      const handleLoad = () => fitToView();
      img.addEventListener("load", handleLoad);
      if (img.complete && img.naturalWidth) fitToView();

      let dragging = false;
      let lastX = 0;
      let lastY = 0;

      const onWheel = (ev: WheelEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        const rect = host.getBoundingClientRect();
        const mx = ev.clientX - rect.left;
        const my = ev.clientY - rect.top;
        const v = viewRef.current;
        const factor = ev.deltaY > 0 ? 1 / 1.18 : 1.18;
        const next = Math.min(50, Math.max(v.fitS * 0.6, v.s * factor));
        const k = next / v.s;
        v.tx = mx - (mx - v.tx) * k;
        v.ty = my - (my - v.ty) * k;
        v.s = next;
        applyTransform();
      };
      const onDown = (ev: PointerEvent) => {
        if (ev.button !== 0) return;
        dragging = true;
        lastX = ev.clientX;
        lastY = ev.clientY;
        host.setPointerCapture(ev.pointerId);
      };
      const onMove = (ev: PointerEvent) => {
        if (!dragging) return;
        const v = viewRef.current;
        v.tx += ev.clientX - lastX;
        v.ty += ev.clientY - lastY;
        lastX = ev.clientX;
        lastY = ev.clientY;
        applyTransform();
      };
      const onUp = () => { dragging = false; };
      const onDblClick = () => fitToView();

      host.addEventListener("wheel", onWheel, { passive: false });
      host.addEventListener("pointerdown", onDown);
      host.addEventListener("pointermove", onMove);
      host.addEventListener("pointerup", onUp);
      host.addEventListener("pointercancel", onUp);
      host.addEventListener("dblclick", onDblClick);
      const ro = new ResizeObserver(() => fitToView());
      ro.observe(host);

      return () => {
        img.removeEventListener("load", handleLoad);
        host.removeEventListener("wheel", onWheel);
        host.removeEventListener("pointerdown", onDown);
        host.removeEventListener("pointermove", onMove);
        host.removeEventListener("pointerup", onUp);
        host.removeEventListener("pointercancel", onUp);
        host.removeEventListener("dblclick", onDblClick);
        ro.disconnect();
      };
    }, [dataUrl]);

    return (
      <div
        ref={hostRef}
        className={className}
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          overflow: "hidden",
          background: "#000",
          cursor: "grab",
          touchAction: "none",
        }}
      >
        <img
          ref={imgRef}
          src={dataUrl}
          alt="CAD 原图"
          draggable={false}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transformOrigin: "0 0",
            maxWidth: "none",
            maxHeight: "none",
            userSelect: "none",
            pointerEvents: "none",
            willChange: "transform",
          }}
        />
      </div>
    );
  },
);

const CadCanvasViewer = forwardRef<CadCanvasViewerHandle, CadCanvasViewerProps>(
  function CadCanvasViewer(props, ref) {
    // 栅格优先：专业绘图引擎渲染的完整原图；WebGL 几何模式作回退
    if (props.raster?.data_url) {
      return <RasterCadViewer ref={ref} dataUrl={props.raster.data_url} className={props.className} />;
    }
    return <GlCadViewer ref={ref} {...props} />;
  },
);

export default CadCanvasViewer;
