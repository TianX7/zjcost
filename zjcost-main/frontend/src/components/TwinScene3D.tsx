import { memo, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/**
 * 首页中央园区数字孪生 3D 场景。
 * 世界坐标沿用原等轴测图的 620 × 400 场地口径，site 组整体平移到原点居中。
 * 建筑自下而上生长入场，拖拽旋转 / 滚轮缩放，标签用 HTML+Svg 叠加层跟随投影。
 */

export interface TwinScene3DProps {
  costText: string;
  bindRate: number;
  riskCount: number;
}

type Tone = "main" | "secondary" | "minor";

interface BlockSpec {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  base?: number;
  floors?: number;
  mullions?: number;
  tone?: Tone;
  delay: number;
}

const BLOCKS: BlockSpec[] = [
  { x: 230, z: 140, w: 120, d: 120, h: 200, floors: 8, mullions: 4, tone: "main", delay: 0 },
  { x: 266, z: 176, w: 48, d: 48, h: 18, base: 200, tone: "minor", delay: 880 },
  { x: 495, z: 150, w: 100, d: 100, h: 150, floors: 6, mullions: 3, tone: "secondary", delay: 220 },
  { x: 70, z: 225, w: 110, d: 100, h: 112, floors: 4, mullions: 3, tone: "secondary", delay: 360 },
  { x: 520, z: 20, w: 60, d: 45, h: 30, tone: "minor", delay: 540 },
  { x: 45, z: 365, w: 55, d: 30, h: 26, tone: "minor", delay: 660 },
];

const TREES: Array<[number, number]> = [
  [25, 78],
  [25, 196],
  [25, 306],
  [25, 372],
  [596, 108],
  [596, 226],
  [596, 338],
  [250, 14],
  [420, 14],
  [548, 14],
  [540, 378],
  [300, 382],
];

const TAG_OFFSETS: Array<[number, number]> = [
  [64, -68],
  [70, 26],
  [-142, -18],
];

// 居中后的世界坐标（原始场地坐标减去 310 / 200）
const TAG_ANCHORS = [
  new THREE.Vector3(-20, 226, 0),
  new THREE.Vector3(240, 32, -157.5),
  new THREE.Vector3(-237.5, 28, 180),
];

const CAMERA_HOME = new THREE.Vector3(700, 600, 700);
const CAMERA_TARGET = new THREE.Vector3(0, 60, 0);
const SITE_OFFSET_X = 310;
const SITE_OFFSET_Z = 200;

interface TagSize {
  w: number;
  h: number;
}

function TwinScene3D({ costText, bindRate, riskCount }: TwinScene3DProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const tagRefs = useRef<Array<HTMLDivElement | null>>([]);
  const leaderRefs = useRef<Array<SVGPolylineElement | null>>([]);
  const haloRefs = useRef<Array<SVGCircleElement | null>>([]);
  const pinRefs = useRef<Array<SVGCircleElement | null>>([]);
  const tagSizes = useRef<TagSize[]>([]);
  const controlsRef = useRef<OrbitControls | null>(null);
  const resetViewRef = useRef<() => void>(() => undefined);
  const [autoRotate, setAutoRotate] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  const tags = [
    { key: "main", label: "主楼造价", value: costText },
    { key: "equipment", label: "设备房绑定", value: `${bindRate}%` },
    { key: "gatehouse", label: "门卫风险", value: `${riskCount} 项` },
  ];

  // 文案变化后重新量取 chip 尺寸，供逐帧定位使用
  useEffect(() => {
    tagSizes.current = tagRefs.current.map((el) =>
      el ? { w: el.offsetWidth, h: el.offsetHeight } : { w: 108, h: 28 },
    );
  }, [costText, bindRate, riskCount]);

  useEffect(() => {
    if (controlsRef.current) controlsRef.current.autoRotate = autoRotate;
  }, [autoRotate]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const disposeItems: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture> = [];
    const dispose = <T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(item: T): T => {
      disposeItems.push(item);
      return item;
    };

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 1, 4000);
    camera.position.copy(CAMERA_HOME);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(CAMERA_TARGET);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.rotateSpeed = 0.55;
    controls.zoomSpeed = 0.7;
    controls.enablePan = false;
    controls.minDistance = 480;
    controls.maxDistance = 1500;
    controls.minPolarAngle = 0.35;
    controls.maxPolarAngle = 1.32;
    controls.autoRotateSpeed = 0.35;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    controls.autoRotate = !reducedMotion;

    // 窄舞台时把相机整体后移，保证园区不被横向裁切；复位视角始终回到当前自适应机位
    const homeBase = CAMERA_HOME.clone().sub(CAMERA_TARGET);
    const baseDistance = homeBase.length();
    let homePosition = CAMERA_HOME.clone();
    let interacted = false;
    controls.addEventListener("start", () => {
      interacted = true;
      // 用户一旦手动拖拽或缩放，就停止自转，避免操作时视角持续漂移
      if (controls.autoRotate) {
        controls.autoRotate = false;
        setAutoRotate(false);
      }
    });
    const updateHome = (aspect: number) => {
      const scale = Math.min(1.75, Math.max(1, 1.42 / aspect));
      homePosition = homeBase.clone().multiplyScalar(scale).add(CAMERA_TARGET);
      controls.maxDistance = Math.max(1500, baseDistance * scale * 1.35);
    };
    updateHome(1.7);
    camera.position.copy(homePosition);
    controls.update();
    controlsRef.current = controls;

    resetViewRef.current = () => {
      // 先关闭阻尼做一次 update，清空拖拽/缩放残留的惯性偏移，再回到初始视角
      const damping = controls.enableDamping;
      controls.enableDamping = false;
      controls.update();
      camera.position.copy(homePosition);
      controls.target.copy(CAMERA_TARGET);
      controls.update();
      controls.enableDamping = damping;
    };

    scene.add(new THREE.AmbientLight(0x4a7fb5, 1.1));
    scene.add(new THREE.HemisphereLight(0x6ec8ff, 0x04101f, 0.65));
    const keyLight = new THREE.DirectionalLight(0x9fdcff, 1.6);
    keyLight.position.set(520, 900, 420);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x3d8bff, 0.8);
    rimLight.position.set(-620, 420, -520);
    scene.add(rimLight);

    const world = new THREE.Group();
    world.position.set(-SITE_OFFSET_X, 0, -SITE_OFFSET_Z);
    scene.add(world);

    // ─── 场地 ───────────────────────────────────────────────
    const groundGeo = dispose(new THREE.PlaneGeometry(760, 560));
    const groundMat = dispose(
      new THREE.MeshBasicMaterial({ color: 0x061a33, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
    );
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(310, 0, 200);
    world.add(ground);

    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = 256;
    glowCanvas.height = 256;
    const glowCtx = glowCanvas.getContext("2d");
    if (glowCtx) {
      const gradient = glowCtx.createRadialGradient(128, 128, 6, 128, 128, 128);
      gradient.addColorStop(0, "rgba(80, 180, 255, 0.5)");
      gradient.addColorStop(0.45, "rgba(45, 120, 220, 0.16)");
      gradient.addColorStop(1, "rgba(10, 40, 90, 0)");
      glowCtx.fillStyle = gradient;
      glowCtx.fillRect(0, 0, 256, 256);
    }
    const glowTexture = dispose(new THREE.CanvasTexture(glowCanvas));
    const glowGeo = dispose(new THREE.CircleGeometry(250, 64));
    const glowMat = dispose(
      new THREE.MeshBasicMaterial({
        map: glowTexture,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(310, 0.3, 200);
    world.add(glow);

    const gridPoints: THREE.Vector3[] = [];
    for (let i = 0; i <= 10; i++) {
      const x = i * 62;
      gridPoints.push(new THREE.Vector3(x, 0.8, 0), new THREE.Vector3(x, 0.8, 400));
    }
    for (let i = 0; i <= 10; i++) {
      const z = i * 40;
      gridPoints.push(new THREE.Vector3(0, 0.8, z), new THREE.Vector3(620, 0.8, z));
    }
    const gridGeo = dispose(new THREE.BufferGeometry().setFromPoints(gridPoints));
    const gridMat = dispose(new THREE.LineBasicMaterial({ color: 0x60beff, transparent: true, opacity: 0.12 }));
    world.add(new THREE.LineSegments(gridGeo, gridMat));

    const siteMat = dispose(
      new THREE.LineDashedMaterial({ color: 0x8fefff, transparent: true, opacity: 0.55, dashSize: 10, gapSize: 7 }),
    );
    const sitePoints = [
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(620, 1, 0),
      new THREE.Vector3(620, 1, 400),
      new THREE.Vector3(0, 1, 400),
      new THREE.Vector3(0, 1, 0),
    ];
    const siteGeo = dispose(new THREE.BufferGeometry().setFromPoints(sitePoints));
    const siteLine = new THREE.Line(siteGeo, siteMat);
    siteLine.computeLineDistances();
    world.add(siteLine);

    const addRect = (
      x0: number,
      z0: number,
      x1: number,
      z1: number,
      y: number,
      material: THREE.LineBasicMaterial | THREE.LineDashedMaterial,
    ) => {
      const points = [
        new THREE.Vector3(x0, y, z0),
        new THREE.Vector3(x1, y, z0),
        new THREE.Vector3(x1, y, z1),
        new THREE.Vector3(x0, y, z1),
        new THREE.Vector3(x0, y, z0),
      ];
      const geometry = dispose(new THREE.BufferGeometry().setFromPoints(points));
      const line = new THREE.Line(geometry, material);
      if (material instanceof THREE.LineDashedMaterial) line.computeLineDistances();
      world.add(line);
    };

    const roadOuterMat = dispose(new THREE.LineBasicMaterial({ color: 0x60beff, transparent: true, opacity: 0.3 }));
    const roadInnerMat = dispose(new THREE.LineBasicMaterial({ color: 0x60beff, transparent: true, opacity: 0.22 }));
    const roadCenterMat = dispose(
      new THREE.LineDashedMaterial({ color: 0x60beff, transparent: true, opacity: 0.16, dashSize: 6, gapSize: 8 }),
    );
    const dimLineMat = dispose(new THREE.LineBasicMaterial({ color: 0x7de9ff, transparent: true, opacity: 0.24 }));
    addRect(40, 40, 580, 360, 0.9, roadOuterMat);
    addRect(70, 70, 550, 330, 0.9, roadInnerMat);
    addRect(55, 55, 565, 345, 0.9, roadCenterMat);
    addRect(80, 0, 100, 70, 0.9, dimLineMat);
    addRect(52, 352, 96, 400, 0.9, dimLineMat);

    const parkingMat = dispose(
      new THREE.LineDashedMaterial({ color: 0x60beff, transparent: true, opacity: 0.18, dashSize: 4, gapSize: 4 }),
    );
    addRect(330, 300, 466, 350, 0.9, parkingMat);

    const slotMat = dispose(new THREE.LineBasicMaterial({ color: 0x7de9ff, transparent: true, opacity: 0.24 }));
    const carGeo = dispose(new THREE.BoxGeometry(10, 6, 22));
    const carMat = dispose(
      new THREE.MeshStandardMaterial({
        color: 0x4dd4ff,
        transparent: true,
        opacity: 0.22,
        metalness: 0.5,
        roughness: 0.35,
        depthWrite: false,
      }),
    );
    const carEdgeMat = dispose(new THREE.LineBasicMaterial({ color: 0x9ff2ff, transparent: true, opacity: 0.4 }));
    const carEdges = dispose(new THREE.EdgesGeometry(carGeo));
    for (let index = 0; index < 6; index++) {
      const x = 338 + index * 20;
      const z = 306;
      addRect(x, z, x + 15, z + 34, 0.9, slotMat);
      if (index % 3 !== 1) {
        const car = new THREE.Mesh(carGeo, carMat);
        car.position.set(x + 7.5, 3, z + 17);
        const wire = new THREE.LineSegments(carEdges, carEdgeMat);
        car.add(wire);
        world.add(car);
      }
    }

    const trunkGeo = dispose(new THREE.CylinderGeometry(0.9, 1.1, 8, 5));
    const trunkMat = dispose(new THREE.MeshBasicMaterial({ color: 0x2f8d7a, transparent: true, opacity: 0.45 }));
    const crownGeo = dispose(new THREE.IcosahedronGeometry(5, 0));
    const crownMat = dispose(
      new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.14, depthWrite: false }),
    );
    const crownEdgeGeo = dispose(new THREE.EdgesGeometry(crownGeo));
    const crownEdgeMat = dispose(new THREE.LineBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.36 }));
    TREES.forEach(([x, z], index) => {
      const tree = new THREE.Group();
      tree.position.set(x, 0, z);
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 4;
      const crown = new THREE.Mesh(crownGeo, crownMat);
      crown.position.y = 12 + (index % 2);
      const wire = new THREE.LineSegments(crownEdgeGeo, crownEdgeMat);
      wire.position.y = 12 + (index % 2);
      tree.add(trunk, crown, wire);
      world.add(tree);
    });

    // ─── 建筑体块 ───────────────────────────────────────────
    const growing: Array<{ group: THREE.Group; delay: number }> = [];

    BLOCKS.forEach((spec) => {
      const { x, z, w, d, h, base = 0, floors = 0, mullions = 0, tone = "secondary", delay } = spec;
      const group = new THREE.Group();
      group.position.set(x + w / 2, base, z + d / 2);

      const glassOpacity = tone === "main" ? 0.3 : tone === "secondary" ? 0.22 : 0.16;
      const edgeOpacity = tone === "main" ? 0.9 : tone === "secondary" ? 0.62 : 0.42;
      const geometry = dispose(new THREE.BoxGeometry(w, h, d));
      const material = dispose(
        new THREE.MeshStandardMaterial({
          color: 0x2f8dff,
          transparent: true,
          opacity: glassOpacity,
          metalness: 0.35,
          roughness: 0.4,
          emissive: 0x0a2a52,
          emissiveIntensity: 0.45,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.y = h / 2;
      group.add(mesh);

      const edgeGeometry = dispose(new THREE.EdgesGeometry(geometry));
      const edgeMaterial = dispose(new THREE.LineBasicMaterial({ color: 0x8fefff, transparent: true, opacity: edgeOpacity }));
      const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
      edges.position.y = h / 2;
      group.add(edges);

      if (floors > 1) {
        const floorMaterial = dispose(new THREE.LineBasicMaterial({ color: 0x7de9ff, transparent: true, opacity: 0.2 }));
        const halfW = w / 2;
        const halfD = d / 2;
        for (let index = 1; index < floors; index++) {
          const level = (h * index) / floors;
          const floorGeo = dispose(
            new THREE.BufferGeometry().setFromPoints([
              new THREE.Vector3(-halfW, level, -halfD),
              new THREE.Vector3(halfW, level, -halfD),
              new THREE.Vector3(halfW, level, halfD),
              new THREE.Vector3(-halfW, level, halfD),
              new THREE.Vector3(-halfW, level, -halfD),
            ]),
          );
          group.add(new THREE.Line(floorGeo, floorMaterial));
        }
      }

      if (mullions > 0) {
        const mullionMaterial = dispose(
          new THREE.LineBasicMaterial({ color: 0x7de9ff, transparent: true, opacity: 0.13 }),
        );
        const halfW = w / 2;
        const halfD = d / 2;
        for (let index = 0; index < mullions; index++) {
          const t = (index + 1) / (mullions + 1);
          const rightGeo = dispose(
            new THREE.BufferGeometry().setFromPoints([
              new THREE.Vector3(halfW, 0, -halfD + d * t),
              new THREE.Vector3(halfW, h, -halfD + d * t),
            ]),
          );
          const frontGeo = dispose(
            new THREE.BufferGeometry().setFromPoints([
              new THREE.Vector3(-halfW + w * t, 0, halfD),
              new THREE.Vector3(-halfW + w * t, h, halfD),
            ]),
          );
          group.add(new THREE.Line(rightGeo, mullionMaterial), new THREE.Line(frontGeo, mullionMaterial));
        }
      }

      const roofGeo = dispose(new THREE.PlaneGeometry(w - 4, d - 4));
      const roofMat = dispose(
        new THREE.MeshBasicMaterial({
          color: 0x7de9ff,
          transparent: true,
          opacity: tone === "main" ? 0.12 : 0.07,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      const roof = new THREE.Mesh(roofGeo, roofMat);
      roof.rotation.x = -Math.PI / 2;
      roof.position.y = h + 0.35;
      group.add(roof);

      group.scale.y = 0.001;
      world.add(group);
      growing.push({ group, delay });
    });

    // ─── 数据光柱 / 天线 ───────────────────────────────────
    // 光柱用竖向渐变贴图，顶部自然淡出，避免出现生硬的锥形白块
    const beamCanvas = document.createElement("canvas");
    beamCanvas.width = 2;
    beamCanvas.height = 128;
    const beamCtx = beamCanvas.getContext("2d");
    if (beamCtx) {
      const beamGradient = beamCtx.createLinearGradient(0, 128, 0, 0);
      beamGradient.addColorStop(0, "rgba(255, 255, 255, 0.7)");
      beamGradient.addColorStop(0.55, "rgba(255, 255, 255, 0.22)");
      beamGradient.addColorStop(1, "rgba(255, 255, 255, 0)");
      beamCtx.fillStyle = beamGradient;
      beamCtx.fillRect(0, 0, 2, 128);
    }
    const beamTexture = dispose(new THREE.CanvasTexture(beamCanvas));
    const beamGeo = dispose(new THREE.CylinderGeometry(17, 9, 55, 24, 1, true));
    const beamMat = dispose(
      new THREE.MeshBasicMaterial({
        color: 0x7de9ff,
        map: beamTexture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(290, 218 + 27.5, 200);
    world.add(beam);

    const antennaGeo = dispose(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(290, 200, 200), new THREE.Vector3(290, 244, 200)]),
    );
    const antennaMat = dispose(
      new THREE.LineDashedMaterial({ color: 0x8fefff, transparent: true, opacity: 0.5, dashSize: 2, gapSize: 4 }),
    );
    const antenna = new THREE.Line(antennaGeo, antennaMat);
    antenna.computeLineDistances();
    world.add(antenna);

    const beaconGeo = dispose(new THREE.SphereGeometry(2.6, 10, 10));
    const beaconMat = dispose(
      new THREE.MeshBasicMaterial({ color: 0x9ff2ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending }),
    );
    const beacon = new THREE.Mesh(beaconGeo, beaconMat);
    beacon.position.set(290, 278, 200);
    world.add(beacon);

    // ─── 尺寸与标签联动 ───────────────────────────────────
    const projected = new THREE.Vector3();
    const headEl = host.parentElement?.querySelector<HTMLElement>(".twin-stage-head") ?? null;
    const measureTag = (index: number): TagSize => {
      const cached = tagSizes.current[index];
      if (cached) return cached;
      const el = tagRefs.current[index];
      if (el) {
        const size = { w: el.offsetWidth, h: el.offsetHeight };
        tagSizes.current[index] = size;
        return size;
      }
      return { w: 108, h: 28 };
    };

    const updateTags = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!width || !height) return;

      // 信息条内容变化（如空态 CTA）会改变高度，标签下限随之动态调整
      const minTop = Math.max(96, headEl ? headEl.offsetTop + headEl.offsetHeight + 10 : 96);

      TAG_ANCHORS.forEach((anchor, index) => {
        const chip = tagRefs.current[index];
        const leader = leaderRefs.current[index];
        const halo = haloRefs.current[index];
        const pin = pinRefs.current[index];
        if (!chip || !leader || !halo || !pin) return;

        projected.copy(anchor).project(camera);
        const anchorX = (projected.x * 0.5 + 0.5) * width;
        const anchorY = (-projected.y * 0.5 + 0.5) * height;
        if (projected.z > 1) {
          chip.style.opacity = "0";
          leader.style.opacity = "0";
          halo.style.opacity = "0";
          pin.style.opacity = "0";
          return;
        }
        chip.style.opacity = "1";
        leader.style.opacity = "1";
        halo.style.opacity = "1";
        pin.style.opacity = "1";

        const size = measureTag(index);
        const [offsetX, offsetY] = TAG_OFFSETS[index];
        const chipX = Math.min(Math.max(anchorX + offsetX, 12), Math.max(12, width - size.w - 12));
        const chipY = Math.min(Math.max(anchorY + offsetY, minTop), Math.max(minTop, height - size.h - 40));

        chip.style.transform = `translate3d(${chipX.toFixed(1)}px, ${chipY.toFixed(1)}px, 0)`;

        const attachX = chipX > anchorX ? chipX : chipX + size.w;
        const attachY = chipY + size.h / 2;
        leader.setAttribute(
          "points",
          `${anchorX.toFixed(1)},${anchorY.toFixed(1)} ${attachX.toFixed(1)},${anchorY.toFixed(1)} ${attachX.toFixed(1)},${attachY.toFixed(1)}`,
        );
        halo.setAttribute("cx", anchorX.toFixed(1));
        halo.setAttribute("cy", anchorY.toFixed(1));
        pin.setAttribute("cx", anchorX.toFixed(1));
        pin.setAttribute("cy", anchorY.toFixed(1));
      });
    };

    const resize = () => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      updateHome(camera.aspect);
      if (!interacted) {
        camera.position.copy(homePosition);
        controls.update();
      }
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const startedAt = performance.now();
    const easeOutCubic = (value: number) => 1 - Math.pow(1 - value, 3);
    const animate = () => {
      const elapsed = performance.now() - startedAt;

      growing.forEach(({ group, delay }) => {
        const progress = reducedMotion ? 1 : Math.min(Math.max((elapsed - delay) / 820, 0), 1);
        group.scale.y = Math.max(0.001, easeOutCubic(progress));
      });

      const beamIn = reducedMotion ? 1 : Math.min(Math.max((elapsed - 1200) / 600, 0), 1);
      beamMat.opacity = beamIn * (0.42 + Math.sin(elapsed / 620) * 0.08);
      beaconMat.opacity = beamIn * (0.55 + Math.sin(elapsed / 460) * 0.25);

      controls.update();
      renderer.render(scene, camera);
      updateTags();
    };

    renderer.setAnimationLoop(animate);

    return () => {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      controls.dispose();
      disposeItems.forEach((item) => item.dispose());
      scene.clear();
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
      renderer.dispose();
      renderer.forceContextLoss();
      controlsRef.current = null;
      resetViewRef.current = () => undefined;
    };
  }, []);

  return (
    <>
      <div className="twin-3d-canvas" ref={hostRef} aria-hidden="true" />
      <div className="twin-3d-layer" aria-hidden="true">
        <svg className="twin-3d-leaders">
          {tags.map((tag, index) => (
            <g key={tag.key}>
              <polyline
                ref={(el) => {
                  leaderRefs.current[index] = el;
                }}
                className="twin-3d-leader"
              />
              <circle
                ref={(el) => {
                  haloRefs.current[index] = el;
                }}
                className="twin-3d-pin-halo"
                r={5.5}
              />
              <circle
                ref={(el) => {
                  pinRefs.current[index] = el;
                }}
                className="twin-3d-pin"
                r={2.6}
              />
            </g>
          ))}
        </svg>
        {tags.map((tag, index) => (
          <div
            key={tag.key}
            ref={(el) => {
              tagRefs.current[index] = el;
            }}
            className="twin-3d-tag"
          >
            <em>{tag.label}</em>
            <b>{tag.value}</b>
          </div>
        ))}
      </div>
      <div className="twin-3d-tools">
        <button
          type="button"
          className={`twin-3d-tool${autoRotate ? " is-on" : ""}`}
          onClick={() => setAutoRotate((value) => !value)}
          title={autoRotate ? "暂停自动旋转" : "开启自动旋转"}
        >
          <span className="material-symbols-outlined">sync</span>
          {autoRotate ? "自动旋转" : "已暂停"}
        </button>
        <button type="button" className="twin-3d-tool" onClick={() => resetViewRef.current()} title="复位视角">
          <span className="material-symbols-outlined">center_focus_strong</span>
          复位视角
        </button>
      </div>
      <div className="twin-3d-hint">拖拽旋转 · 滚轮缩放</div>
    </>
  );
}

export default memo(TwinScene3D);
