import { memo, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  buildDeviceScene,
  buildPvScene,
  buildWaterScene,
  type BuiltScene,
  type DeviceSceneData,
  type PvSceneData,
  type WaterSceneData,
} from "./ops3d/builders";

/**
 * 运营专题页（光伏 / 水处理 / 设备运维）共用 3D 厂区引擎。
 * - 场景几何由 ops3d/builders.ts 按业务建模，这里只负责渲染循环、相机与 HTML 标签投影；
 * - 标签逐帧跟随投影并按屏幕做防重叠排布，避免窄舞台下互相压字；
 * - 默认不自动旋转，用户拖拽后即时停转，可复位视角。
 */

export type OpsSceneKind = "pv" | "water" | "device";
export type OpsTone = "ok" | "warn" | "alarm";

export interface OpsSceneTag {
  key: string;
  label: string;
  value: string;
  anchor: [number, number, number];
  /** 标签相对锚点的屏幕像素偏移（默认向上） */
  offset?: [number, number];
  tone?: OpsTone;
}

export type OpsSceneData = PvSceneData | WaterSceneData | DeviceSceneData;

export interface OpsScene3DProps {
  kind: OpsSceneKind;
  tags: OpsSceneTag[];
  data: OpsSceneData;
  ariaLabel: string;
}

const BUILDER: Record<OpsSceneKind, (root: THREE.Group) => BuiltScene> = {
  pv: buildPvScene,
  water: buildWaterScene,
  device: buildDeviceScene,
};

const CAMERA: Record<OpsSceneKind, { home: [number, number, number]; target: [number, number, number] }> = {
  pv: { home: [630, 530, 675], target: [0, 28, 10] },
  water: { home: [610, 520, 655], target: [0, 26, 30] },
  device: { home: [625, 530, 670], target: [0, 30, 20] },
};

const TAG_FALLBACK = { w: 116, h: 34 };

interface TagRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((item) => {
    const mesh = item as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = (mesh as THREE.Mesh).material;
    const list = Array.isArray(material) ? material : material ? [material] : [];
    for (const mat of list) {
      const textured = mat as THREE.MeshStandardMaterial;
      if (textured.map) textured.map.dispose();
      if (textured.alphaMap) textured.alphaMap.dispose();
      mat.dispose();
    }
  });
}

function OpsScene3D({ kind, tags, data, ariaLabel }: OpsScene3DProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const tagRefs = useRef<Array<HTMLDivElement | null>>([]);
  const leaderRefs = useRef<Array<SVGLineElement | null>>([]);
  const anchorRefs = useRef<Array<SVGCircleElement | null>>([]);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const resetRef = useRef<() => void>(() => undefined);
  const tagsRef = useRef(tags);
  const dataRef = useRef(data);
  const dirtyRef = useRef(true);
  const sizesRef = useRef<TagRect[]>([]);
  const [autoRotate, setAutoRotate] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    tagsRef.current = tags;
    dirtyRef.current = true;
  }, [tags]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    if (controlsRef.current) controlsRef.current.autoRotate = autoRotate;
  }, [autoRotate]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x06101a, 0.00032);

    const camera = new THREE.PerspectiveCamera(34, 1, 1, 6000);
    const baseHome = new THREE.Vector3(...CAMERA[kind].home);
    const target = new THREE.Vector3(...CAMERA[kind].target);
    camera.position.copy(baseHome);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    renderer.domElement.className = "ops-3d-canvas";
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(target);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.enablePan = false;
    controls.rotateSpeed = 0.52;
    controls.zoomSpeed = 0.68;
    controls.minDistance = 420;
    controls.maxDistance = 1800;
    controls.minPolarAngle = 0.24;
    controls.maxPolarAngle = 1.34;
    controls.autoRotateSpeed = 0.5;
    controls.autoRotate = false;
    controlsRef.current = controls;

    let interacted = false;
    const baseOffset = baseHome.clone().sub(target);
    const baseDistance = baseOffset.length();
    const homePosition = baseHome.clone();

    const fitHome = (aspect: number) => {
      // 宽舞台直接贴近场景，窄舞台适度后退；避免把一整块场地缩成小模型
      const scale = Math.min(1.42, Math.max(0.82, 1.18 / Math.max(aspect, 0.45)));
      homePosition.copy(baseOffset).multiplyScalar(scale).add(target);
      controls.maxDistance = Math.max(1600, baseDistance * scale * 1.4);
    };

    const resetView = () => {
      const damping = controls.enableDamping;
      controls.enableDamping = false;
      controls.update();
      camera.position.copy(homePosition);
      controls.target.copy(target);
      controls.update();
      controls.enableDamping = damping;
    };
    resetRef.current = resetView;

    controls.addEventListener("start", () => {
      interacted = true;
      setAutoRotate((value) => {
        if (value) controls.autoRotate = false;
        return false;
      });
    });

    scene.add(new THREE.AmbientLight(0x5b8dbb, 1.45));
    scene.add(new THREE.HemisphereLight(0x7fd7ff, 0x04131f, 0.9));
    const key = new THREE.DirectionalLight(0xb4e4ff, 2.1);
    key.position.set(520, 820, 460);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x4a9dff, 1.15);
    rim.position.set(-640, 380, -540);
    scene.add(rim);
    const fill = new THREE.PointLight(0x4dd4ff, 0.9, 1800, 2);
    fill.position.set(0, 210, 0);
    scene.add(fill);

    const stage = new THREE.Group();
    stage.scale.y = 0.02;
    scene.add(stage);
    const built = BUILDER[kind](stage);

    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      fitHome(camera.aspect);
      if (!interacted) {
        camera.position.copy(homePosition);
        controls.update();
      }
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const projected = new THREE.Vector3();
    const measureTags = () => {
      sizesRef.current = tagsRef.current.map((_, index) => {
        const el = tagRefs.current[index];
        if (!el) return { x: 0, y: 0, w: TAG_FALLBACK.w, h: TAG_FALLBACK.h };
        return { x: 0, y: 0, w: el.offsetWidth || TAG_FALLBACK.w, h: el.offsetHeight || TAG_FALLBACK.h };
      });
      dirtyRef.current = false;
    };

    const layoutTags = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!width || !height) return;
      if (dirtyRef.current) measureTags();
      const sizes = sizesRef.current;
      const pad = 6;
      const gap = 5;
      const items = tagsRef.current.map((tag, index) => {
        projected.set(tag.anchor[0], tag.anchor[1], tag.anchor[2]).project(camera);
        const behind = projected.z > 1 || projected.z < -1;
        const ax = (projected.x * 0.5 + 0.5) * width;
        const ay = (-projected.y * 0.5 + 0.5) * height;
        const size = sizes[index] ?? { x: 0, y: 0, ...TAG_FALLBACK };
        const offsetX = tag.offset?.[0] ?? 0;
        const offsetY = tag.offset?.[1] ?? -46;
        const desiredX = ax + offsetX - size.w / 2;
        const desiredY = ay + offsetY - size.h / 2;
        return { tag, index, ax, ay, behind, size, desiredX, desiredY };
      });

      const visible = items.filter((item) => !item.behind);
      visible.sort((a, b) => a.desiredY - b.desiredY);
      const placed: TagRect[] = [];
      const results = new Map<number, TagRect>();

      for (const item of visible) {
        const { w, h } = item.size;
        const maxX = Math.max(pad, width - pad - w);
        const maxY = Math.max(pad, height - pad - h);
        let x = Math.min(Math.max(item.desiredX, pad), maxX);
        let y = Math.min(Math.max(item.desiredY, pad), maxY);
        const collides = (rect: TagRect) =>
          !(rect.x + rect.w + gap < x || x + w + gap < rect.x || rect.y + rect.h + gap < y || y + h + gap < rect.y);
        let attempts = 0;
        while (placed.some(collides) && attempts < 26) {
          y += h + gap;
          if (y > maxY) {
            y = pad;
            if (attempts % 2 === 1) x = Math.min(maxX, x + w * 0.55);
          }
          attempts++;
        }
        const rect = { x, y, w, h };
        results.set(item.index, rect);
        placed.push(rect);
      }

      items.forEach((item, index) => {
        const el = tagRefs.current[index];
        const leader = leaderRefs.current[index];
        const anchor = anchorRefs.current[index];
        const rect = results.get(index);
        const isVisible = !!rect;
        if (el) {
          el.style.visibility = isVisible ? "visible" : "hidden";
          if (rect) el.style.transform = `translate3d(${rect.x.toFixed(1)}px, ${rect.y.toFixed(1)}px, 0)`;
        }
        if (leader) {
          leader.style.visibility = isVisible ? "visible" : "hidden";
          if (rect) {
            leader.setAttribute("x1", item.ax.toFixed(1));
            leader.setAttribute("y1", item.ay.toFixed(1));
            leader.setAttribute("x2", (rect.x + rect.w / 2).toFixed(1));
            leader.setAttribute("y2", (rect.y + rect.h / 2).toFixed(1));
          }
        }
        if (anchor) {
          anchor.style.visibility = isVisible ? "visible" : "hidden";
          if (rect) {
            anchor.setAttribute("cx", item.ax.toFixed(1));
            anchor.setAttribute("cy", item.ay.toFixed(1));
          }
        }
      });
    };

    let raf = 0;
    let last = performance.now();
    let elapsed = 0;
    let growth = 0;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    const frame = (now: number) => {
      const delta = Math.min(Math.max(now - last, 0), 60);
      last = now;
      elapsed += delta / 1000;
      growth = reduced ? 1 : Math.min(1, growth + delta / 1200);
      stage.scale.y = 0.02 + 0.98 * easeOutCubic(growth);

      built.update?.(elapsed, dataRef.current);
      controls.update();
      renderer.render(scene, camera);

      if (layerRef.current) {
        const fade = Math.min(1, Math.max(0, (growth - 0.45) / 0.35));
        layerRef.current.style.opacity = fade.toFixed(2);
      }
      if (growth > 0.55) layoutTags();
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    setReady(true);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      controlsRef.current = null;
      resetRef.current = () => undefined;
      disposeObject(scene);
      renderer.dispose();
      renderer.domElement.remove();
      setReady(false);
    };
  }, [kind]);

  return (
    <div className={`ops-3d-root ops-3d-${kind}`} ref={hostRef} role="img" aria-label={ariaLabel}>
      <svg className="ops-3d-leaders" aria-hidden="true">
        {tags.map((tag, index) => (
          <g key={tag.key}>
            <line
              ref={(el) => {
                leaderRefs.current[index] = el;
              }}
              className={`ops-3d-leader${tag.tone ? ` ${tag.tone}` : ""}`}
            />
            <circle
              ref={(el) => {
                anchorRefs.current[index] = el;
              }}
              className={`ops-3d-anchor${tag.tone ? ` ${tag.tone}` : ""}`}
              r="3"
            />
          </g>
        ))}
      </svg>
      <div className="ops-3d-layer" ref={layerRef}>
        {tags.map((tag, index) => (
          <div
            key={tag.key}
            ref={(el) => {
              tagRefs.current[index] = el;
            }}
            className={`ops-3d-tag${tag.tone ? ` ${tag.tone}` : ""}`}
          >
            <em>{tag.label}</em>
            <strong>{tag.value}</strong>
          </div>
        ))}
      </div>
      <div className={`ops-3d-toolbar${ready ? " ready" : ""}`}>
        <button
          type="button"
          className="ops-3d-tool"
          title="复位视角"
          aria-label="复位视角"
          onClick={() => resetRef.current()}
        >
          <span className="material-symbols-outlined">my_location</span>
        </button>
        <button
          type="button"
          className={`ops-3d-tool${autoRotate ? " active" : ""}`}
          title={autoRotate ? "暂停自动旋转" : "自动旋转"}
          aria-label={autoRotate ? "暂停自动旋转" : "自动旋转"}
          aria-pressed={autoRotate}
          onClick={() => setAutoRotate((value) => !value)}
        >
          <span className="material-symbols-outlined">3d_rotation</span>
        </button>
      </div>
      <div className="ops-3d-legend" aria-hidden="true">
        <span><i className="ok" />正常</span>
        <span><i className="warn" />预警</span>
        <span><i className="alarm" />告警</span>
      </div>
      <div className="ops-3d-hint" aria-hidden="true">拖拽旋转 · 滚轮缩放</div>
    </div>
  );
}

export default memo(OpsScene3D);
