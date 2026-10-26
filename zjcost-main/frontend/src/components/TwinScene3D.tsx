import { memo, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { SceneKit, additive, basic, glass, standard } from "./ops3d/kit";

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

const TREES: Array<[number, number]> = [
  [25, 78],
  [25, 196],
  [25, 306],
  [25, 372],
  [610, 108],
  [610, 226],
  [610, 338],
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
  new THREE.Vector3(-20, 306, 0),
  new THREE.Vector3(240, 34, -157.5),
  new THREE.Vector3(-237.5, 30, 180),
];

const CAMERA_HOME = new THREE.Vector3(620, 540, 620);
const CAMERA_TARGET = new THREE.Vector3(0, 84, 0);
const SITE_OFFSET_X = 310;
const SITE_OFFSET_Z = 200;

interface TagSize {
  w: number;
  h: number;
}

function disposeTree(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((item) => {
    const mesh = item as THREE.Mesh;
    if (mesh.geometry && !geometries.has(mesh.geometry)) {
      geometries.add(mesh.geometry);
      mesh.geometry.dispose();
    }
    const list = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of list) {
      if (materials.has(material)) continue;
      materials.add(material);
      const textured = material as THREE.MeshStandardMaterial;
      if (textured.map) textured.map.dispose();
      if (textured.alphaMap) textured.alphaMap.dispose();
      material.dispose();
    }
  });
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
      const scale = Math.min(1.5, Math.max(0.86, 1.2 / Math.max(aspect, 0.45)));
      homePosition = homeBase.clone().multiplyScalar(scale).add(CAMERA_TARGET);
      controls.maxDistance = Math.max(1400, baseDistance * scale * 1.35);
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
    for (let index = 0; index < 6; index++) {
      const x = 338 + index * 20;
      const z = 306;
      addRect(x, z, x + 15, z + 34, 0.9, slotMat);
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

    // ─── 精致建筑群 ─────────────────────────────────────────
    const kit = new SceneKit();
    world.add(kit.group);

    const frameMat = standard(0x274a63, { metalness: 0.62, roughness: 0.4, emissive: 0x081d2c, emissiveIntensity: 0.45 });
    const deckMat = standard(0x1a3448, { metalness: 0.5, roughness: 0.55, emissive: 0x061a26, emissiveIntensity: 0.4 });
    const coreMat = standard(0x13344c, { metalness: 0.3, roughness: 0.8, emissive: 0x0a2941, emissiveIntensity: 0.55 });
    const glassMat = glass(0x63caff, 0.22);
    const glassDeep = glass(0x2a7fc4, 0.34);
    const bandMat = basic(0xa9f2ff, { transparent: true, opacity: 0.34, depthWrite: false });
    const windowMat = basic(0x7fe0ff, { transparent: true, opacity: 0.52, depthWrite: false });
    const glowWindowMat = additive(0x79e3ff, 0.48);
    const panelMat = standard(0x21465e, { metalness: 0.55, roughness: 0.45, emissive: 0x061824, emissiveIntensity: 0.35 });
    const steelMat = standard(0x476175, { metalness: 0.72, roughness: 0.32 });
    const darkMat = standard(0x102434, { metalness: 0.4, roughness: 0.7 });

    const growing: Array<{ group: THREE.Group; delay: number }> = [];
    const beacons: Array<{ mesh: THREE.Mesh; phase: number }> = [];

    const startBuilding = (delay: number) => {
      const group = new THREE.Group();
      group.scale.y = 0.001;
      kit.group.add(group);
      growing.push({ group, delay });
      return group;
    };
    const deck = (parent: THREE.Object3D, w: number, d: number, x: number, y: number, z: number) => {
      const slab = kit.box(w, 2, d, x, y, z, deckMat, parent);
      kit.edge(slab, 0x9fe8ff, 0.32);
      return slab;
    };
    const corners = (
      parent: THREE.Object3D,
      cx: number,
      cz: number,
      w: number,
      d: number,
      y: number,
      h: number,
      size = 3.2,
    ) => {
      const dx = w / 2 - size / 2;
      const dz = d / 2 - size / 2;
      [
        [-dx, -dz],
        [dx, -dz],
        [-dx, dz],
        [dx, dz],
      ].forEach(([ox, oz]) => kit.box(size, h, size, cx + ox, y, cz + oz, frameMat, parent));
    };
    const floorBands = (
      parent: THREE.Object3D,
      cx: number,
      cz: number,
      w: number,
      d: number,
      y0: number,
      y1: number,
      step: number,
      material: THREE.Material = bandMat,
    ) => {
      for (let y = y0; y <= y1 + 0.01; y += step) {
        kit.box(w + 1.1, 0.65, d + 1.1, cx, y, cz, material, parent);
      }
    };
    const facadeFins = (
      parent: THREE.Object3D,
      cx: number,
      cz: number,
      w: number,
      d: number,
      y: number,
      h: number,
      count: number,
    ) => {
      for (let i = 1; i <= count; i++) {
        const t = -w / 2 + (w * i) / (count + 1);
        kit.box(0.7, h, 1.1, cx + t, y, cz + d / 2 + 0.15, frameMat, parent);
        kit.box(0.7, h, 1.1, cx + t, y, cz - d / 2 - 0.15, frameMat, parent);
        kit.box(1.1, h, 0.7, cx + w / 2 + 0.15, y, cz + t, frameMat, parent);
        kit.box(1.1, h, 0.7, cx - w / 2 - 0.15, y, cz + t, frameMat, parent);
      }
    };
    const brace = (parent: THREE.Object3D, a: [number, number, number], b: [number, number, number], opacity = 0.4) => {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(...a),
        new THREE.Vector3(...b),
      ]);
      parent.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity })));
    };

    // 主楼：裙房 + 三段收分塔身 + 玻璃冠厅
    const tower = startBuilding(0);
    const podium = kit.box(152, 16, 152, 290, 0, 200, deckMat, tower);
    kit.edge(podium, 0x9fe8ff, 0.55);
    kit.box(144, 0.8, 144, 290, 16, 200, panelMat, tower);
    // 幕墙与楼层灯带
    for (let i = 0; i < 4; i++) {
      kit.box(150, 1, 150, 290, 3 + i * 3.6, 200, bandMat, tower);
    }
    // 入口雨棚 / 台阶 / 门厅
    for (let i = 0; i < 3; i++) {
      kit.box(58 - i * 6, 1, 8 + i * 2, 290, i, 280 + i * 2, deckMat, tower);
    }
    const canopy = kit.box(66, 1.4, 20, 290, 13, 286, frameMat, tower);
    kit.edge(canopy, 0x9fe8ff, 0.5);
    [-26, -9, 9, 26].forEach((ox) => {
      kit.box(0.9, 13, 0.9, 290 + ox, 1, 292, steelMat, tower);
      kit.box(5, 13, 1.2, 290 + ox, 3, 275.2, glowWindowMat, tower);
    });
    kit.box(74, 1.2, 0.7, 290, 11.6, 275, bandMat, tower);
    // 塔身收分
    const segments = [
      { w: 126, d: 126, y: 16, h: 58 },
      { w: 114, d: 114, y: 76, h: 66 },
      { w: 98, d: 98, y: 144, h: 48 },
    ];
    segments.forEach((segment, index) => {
      kit.box(segment.w - 10, segment.h, segment.d - 10, 290, segment.y, 200, coreMat, tower);
      const shell = kit.box(segment.w, segment.h, segment.d, 290, segment.y, 200, glassMat, tower);
      kit.edge(shell, 0x9fe8ff, 0.5);
      floorBands(tower, 290, 200, segment.w, segment.d, segment.y + 7, segment.y + segment.h - 5, 10);
      corners(tower, 290, 200, segment.w, segment.d, segment.y, segment.h, 3.4);
      facadeFins(tower, 290, 200, segment.w, segment.d, segment.y, segment.h, 4);
      if (index < segments.length - 1) {
        deck(tower, segment.w + 8, segment.d + 8, 290, segment.y + segment.h, 200);
      }
    });
    // 冠厅与天线桅杆
    const crown = kit.box(74, 16, 74, 290, 194, 200, glassDeep, tower);
    kit.edge(crown, 0x9fe8ff, 0.55);
    corners(tower, 290, 200, 74, 74, 194, 16, 2.8);
    deck(tower, 86, 86, 290, 210, 200);
    const machineRoom = kit.box(28, 8, 20, 290, 212, 200, panelMat, tower);
    kit.edge(machineRoom, 0x9fe8ff, 0.3);
    kit.box(16, 4, 14, 306, 212, 203, steelMat, tower);
    kit.cylinder(1, 1.5, 30, 290, 220, 200, steelMat, 8, tower);
    [228, 236, 244].forEach((y) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(4, 0.32, 6, 22), bandMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(290, y, 200);
      tower.add(ring);
    });

    // 研发楼：阶梯形体 + 屋顶直升机坪 + 卫星天线
    const rnd = startBuilding(220);
    const rndPodium = kit.box(120, 12, 120, 545, 0, 200, deckMat, rnd);
    kit.edge(rndPodium, 0x9fe8ff, 0.5);
    for (let i = 0; i < 3; i++) {
      kit.box(118, 0.8, 118, 545, 3 + i * 3.2, 200, bandMat, rnd);
    }
    kit.box(96, 10, 1.4, 545, 1.5, 259.2, glowWindowMat, rnd);
    kit.box(30, 10, 1.4, 545, 1.5, 259.4, bandMat, rnd);
    const rndShaft = kit.box(88, 122, 88, 545, 12, 200, glassMat, rnd);
    kit.edge(rndShaft, 0x9fe8ff, 0.48);
    kit.box(76, 120, 76, 545, 13, 200, coreMat, rnd);
    floorBands(rnd, 545, 200, 88, 88, 20, 130, 12);
    corners(rnd, 545, 200, 88, 88, 12, 122, 3.2);
    facadeFins(rnd, 545, 200, 88, 88, 12, 122, 3);
    brace(rnd, [501, 14, 244], [589, 130, 244], 0.24);
    brace(rnd, [589, 14, 244], [501, 130, 244], 0.24);
    deck(rnd, 100, 100, 545, 134, 200);
    const rndTop = kit.box(66, 24, 66, 545, 136, 200, glassMat, rnd);
    kit.edge(rndTop, 0x9fe8ff, 0.5);
    kit.box(56, 22, 56, 545, 137, 200, coreMat, rnd);
    floorBands(rnd, 545, 200, 66, 66, 142, 156, 7);
    deck(rnd, 74, 74, 545, 160, 200);
    const helipad = kit.cylinder(27, 27, 1.4, 545, 162, 200, darkMat, 36, rnd);
    kit.edge(helipad, 0x9fe8ff, 0.25);
    const helipadRing = new THREE.Mesh(new THREE.TorusGeometry(24, 0.7, 6, 48), additive(0xfbbf24, 0.55));
    helipadRing.rotation.x = Math.PI / 2;
    helipadRing.position.set(545, 163.6, 200);
    rnd.add(helipadRing);
    [-7, 7].forEach((ox) => kit.box(2.6, 0.5, 14, 545 + ox, 163.6, 200, basic(0xdff8ff, { transparent: true, opacity: 0.55 }), rnd));
    kit.box(17, 0.5, 2.6, 545, 163.6, 200, basic(0xdff8ff, { transparent: true, opacity: 0.55 }), rnd);
    kit.cylinder(0.8, 1.1, 16, 545, 163.6, 218, steelMat, 8, rnd);
    const rndBeacon = kit.led(545, 181, 218, 0xff8a8a, 1.5, rnd);
    beacons.push({ mesh: rndBeacon, phase: 1.7 });
    const dish = new THREE.Mesh(
      new THREE.SphereGeometry(9, 18, 10, 0, Math.PI * 2, 0, Math.PI / 3),
      glassDeep,
    );
    dish.position.set(572, 170, 224);
    dish.rotation.set(-1.35, 0, 0.4);
    rnd.add(dish);
    kit.cylinder(0.5, 0.5, 8, 572, 163.6, 224, steelMat, 6, rnd);

    // 动力车间：竖向肋 + 长条采光带 + 锯齿屋面 + 屋顶排风
    const workshop = startBuilding(360);
    const shedPlinth = kit.box(116, 8, 108, 125, 0, 278, deckMat, workshop);
    kit.edge(shedPlinth, 0x9fe8ff, 0.4);
    const shed = kit.box(108, 72, 98, 125, 8, 278, panelMat, workshop);
    kit.edge(shed, 0x9fe8ff, 0.42);
    for (let i = 0; i < 8; i++) {
      kit.box(1.8, 72, 2, 80 + i * 12.5, 8, 327.4, frameMat, workshop);
    }
    kit.box(88, 11, 1.3, 125, 47, 327.8, glowWindowMat, workshop);
    kit.box(88, 1.2, 1.5, 125, 46, 328, bandMat, workshop);
    kit.box(109, 1.4, 1.4, 125, 29, 327.7, windowMat, workshop);
    kit.box(2, 72, 98, 178.6, 8, 278, frameMat, workshop);
    kit.box(1.4, 66, 96, 179.2, 10, 278, windowMat, workshop);
    deck(workshop, 112, 102, 125, 80, 278);
    for (let i = 0; i < 4; i++) {
      const rowZ = 234 + i * 23;
      const slope = new THREE.Mesh(new THREE.PlaneGeometry(104, 23), panelMat);
      slope.rotation.x = -Math.PI / 2 + 0.3;
      slope.position.set(125, 83.5, rowZ);
      workshop.add(slope);
      const skylight = new THREE.Mesh(new THREE.PlaneGeometry(104, 5.5), glowWindowMat);
      skylight.position.set(125, 86.5, rowZ + 9.5);
      workshop.add(skylight);
      kit.box(104, 0.6, 0.8, 125, 87.5, rowZ - 11.5, frameMat, workshop);
    }
    [96, 125, 154].forEach((x) => {
      kit.cylinder(3.2, 3.2, 9, x, 80, 270, steelMat, 12, workshop);
      kit.cylinder(4.6, 4.6, 0.8, x, 89, 270, frameMat, 12, workshop);
      kit.led(x, 91, 270, 0x8fefff, 0.8, workshop);
    });
    kit.cylinder(1.7, 1.7, 74, 74, 6, 232, steelMat, 8, workshop);
    kit.cylinder(1.7, 1.7, 36, 74, 44, 232, steelMat, 8, workshop);
    kit.pipe(
      [
        [74, 76, 232],
        [74, 76, 300],
        [110, 76, 300],
        [110, 80, 300],
      ],
      1.2,
      0x6c93a8,
      0.65,
    );

    // 能源站：百叶机房 + 屋顶冷机 + 排风烟囱 + 变压器
    const utility = startBuilding(480);
    const utilPlinth = kit.box(70, 4, 56, 550, 0, 42.5, deckMat, utility);
    kit.edge(utilPlinth, 0x9fe8ff, 0.35);
    const utilHall = kit.box(60, 20, 46, 550, 4, 42.5, panelMat, utility);
    kit.edge(utilHall, 0x9fe8ff, 0.38);
    for (let i = 0; i < 7; i++) {
      kit.box(44, 0.9, 1, 550, 7.5 + i * 2, 65.6, frameMat, utility);
    }
    kit.box(8, 12, 1.2, 566, 4, 65.8, windowMat, utility);
    deck(utility, 64, 50, 550, 24, 42.5);
    [532, 550, 568].forEach((x, index) => {
      const chiller = kit.box(15, 7, 12, x, 26, 40, steelMat, utility);
      kit.edge(chiller, 0x9fe8ff, 0.28);
      kit.cylinder(5, 5, 0.8, x, 33, 40, frameMat, 16, utility);
      for (let k = 0; k < 3; k++) {
        const blade = kit.box(8, 0.3, 1.4, x, 33.6, 40, darkMat, utility);
        blade.rotation.y = (k * Math.PI) / 3 + index;
      }
    });
    for (let i = 0; i < 3; i++) {
      const panel = kit.box(16, 0.8, 10, 532 + i * 18, 29.5, 54, glassDeep, utility);
      panel.rotation.x = -0.42;
    }
    kit.cylinder(2.2, 2.2, 36, 576, 0, 24, steelMat, 12, utility);
    [18, 26, 32].forEach((y) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.7, 0.35, 6, 18), bandMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(576, y, 24);
      utility.add(ring);
    });
    const stackBeacon = kit.led(576, 37, 24, 0xff8a8a, 1.4, utility);
    beacons.push({ mesh: stackBeacon, phase: 3.2 });
    // 变压器与围栏
    const transformer = kit.box(18, 14, 24, 501, 0, 44, darkMat);
    kit.edge(transformer, 0x9fe8ff, 0.3);
    for (let i = 0; i < 5; i++) {
      kit.box(1.2, 12, 24, 492.6, 1, 44 + i * 0.6, steelMat);
    }
    kit.rect(486, 28, 516, 60, 0.6, 0x60beff, 0.28, true);
    kit.line(
      [
        [501, 14, 44],
        [501, 14, 18],
        [520, 14, 18],
        [520, 14, 30],
      ],
      0x7de9ff,
      0.5,
    );

    // 门卫：玻璃岗亭 + 挑檐 + 道闸
    const gate = startBuilding(620);
    const gatePlinth = kit.box(62, 2, 38, 72.5, 0, 380, deckMat, gate);
    kit.edge(gatePlinth, 0x9fe8ff, 0.4);
    const booth = kit.box(34, 18, 24, 72, 2, 380, glassMat, gate);
    kit.edge(booth, 0x9fe8ff, 0.55);
    kit.box(26, 16, 18, 72, 3, 380, coreMat, gate);
    kit.box(28, 9, 0.8, 72, 8, 392.2, glowWindowMat, gate);
    kit.box(30, 1, 25, 72, 18, 380, bandMat, gate);
    const gateCanopy = kit.box(60, 1.4, 36, 72.5, 20, 380, frameMat, gate);
    kit.edge(gateCanopy, 0x9fe8ff, 0.45);
    [
      [-24, -14],
      [24, -14],
      [-24, 14],
      [24, 14],
    ].forEach(([ox, oz]) => kit.box(0.8, 20, 0.8, 72.5 + ox, 0, 380 + oz, steelMat, gate));
    kit.cylinder(1.6, 2, 9, 108, 0, 366, steelMat, 10, gate);
    kit.box(28, 1.2, 1.2, 94, 8, 366, frameMat, gate);
    [0, 1, 2, 3].forEach((i) => {
      kit.box(5.5, 1.3, 1.4, 82 + i * 7, 8, 366, i % 2 === 0 ? basic(0xfbbf24, { transparent: true, opacity: 0.8 }) : darkMat, gate);
    });
    kit.led(108, 9.4, 366, 0x4ade80, 1, gate);
    kit.box(18, 4, 0.8, 72, 14, 392.4, basic(0x0a1b27, { transparent: true, opacity: 0.85 }), gate);
    kit.led(64, 16, 392.8, 0x4dd4ff, 0.7, gate);

    // ─── 场地细部：围墙 / 路灯 / 广场喷泉 / 车流 ─────────────
    const wallMat = standard(0x163143, { metalness: 0.45, roughness: 0.6 });
    const addWall = (x0: number, z0: number, x1: number, z1: number) => {
      const horizontal = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      const length = horizontal ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
      if (length < 2) return;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const wall = horizontal
        ? kit.box(length, 5.5, 2, cx, 0, cz, wallMat)
        : kit.box(2, 5.5, length, cx, 0, cz, wallMat);
      kit.edge(wall, 0x60beff, 0.22);
      if (horizontal) {
        kit.box(length, 0.5, 2.6, cx, 5.5, cz, steelMat);
      } else {
        kit.box(2.6, 0.5, length, cx, 5.5, cz, steelMat);
      }
    };
    addWall(3, 3, 617, 3);
    addWall(3, 3, 3, 397);
    addWall(617, 3, 617, 397);
    addWall(3, 397, 68, 397);
    addWall(118, 397, 617, 397);
    [68, 118].forEach((x) => {
      kit.box(7, 12, 7, x, 0, 397, deckMat);
      kit.edge(kit.box(7.5, 1.2, 7.5, x, 12, 397, frameMat), 0x9fe8ff, 0.5);
      kit.led(x, 13.6, 397, 0xfbbf24, 1.1);
    });

    const lampPositions: Array<[number, number, number]> = [
      [36, 90, 1],
      [36, 180, 1],
      [36, 270, 1],
      [584, 90, -1],
      [584, 180, -1],
      [584, 270, -1],
      [150, 34, 1],
      [300, 34, 1],
      [450, 34, 1],
      [150, 366, -1],
      [450, 366, -1],
    ];
    lampPositions.forEach(([x, z, dir]) => {
      kit.cylinder(0.6, 0.9, 22, x, 0, z, steelMat, 8);
      kit.box(5, 0.5, 0.5, x + (dir > 0 ? 2.2 : -2.2), 21.5, z, steelMat);
      kit.led(x + (dir > 0 ? 4.6 : -4.6), 21.3, z, 0x9ff2ff, 1.4);
      kit.glow(9, 0x4dd4ff, x, z, 0.4, 0.18);
    });

    const plazaFloor = kit.plane(98, 58, 286, 0.45, 318, basic(0x0c2b42, { transparent: true, opacity: 0.6, depthWrite: false }));
    plazaFloor.renderOrder = -1;
    [250, 270, 290, 310, 330].forEach((x) => kit.line([[x, 0.6, 292], [x, 0.6, 344]], 0x60beff, 0.16));
    [298, 318, 338].forEach((z) => kit.line([[240, 0.6, z], [332, 0.6, z]], 0x60beff, 0.16));
    const basin = kit.cylinder(13, 14, 1.6, 286, 0.5, 318, deckMat, 28);
    kit.edge(basin, 0x9fe8ff, 0.3);
    kit.plane(24, 24, 286, 2.2, 318, basic(0x2f9fd8, { transparent: true, opacity: 0.4, depthWrite: false }));
    const fountainRing = new THREE.Mesh(new THREE.TorusGeometry(11, 0.5, 8, 40), additive(0x7de9ff, 0.5));
    fountainRing.rotation.x = Math.PI / 2;
    fountainRing.position.set(286, 2.4, 318);
    kit.group.add(fountainRing);
    const fountainJet = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.4, 9, 12, 1, true), additive(0x9ff2ff, 0.35));
    fountainJet.position.set(286, 6.6, 318);
    kit.group.add(fountainJet);
    [
      [238, 296],
      [334, 296],
      [238, 342],
      [334, 342],
    ].forEach(([x, z]) => {
      const planter = kit.box(9, 2, 9, x, 0.4, z, deckMat);
      kit.edge(planter, 0x9fe8ff, 0.25);
      kit.box(7, 1, 7, x, 2.4, z, basic(0x1f6f5e, { transparent: true, opacity: 0.55 }));
    });
    [130, 140, 150].forEach((x, index) => {
      kit.cylinder(0.4, 0.6, 24, x, 0, 372, steelMat, 8);
      const flag = kit.box(0.4, 5 + index, 9, x + 0.2, 19, 377, basic([0x38bdf8, 0xfacc15, 0xe2e8f0][index], { transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
      flag.rotation.y = index * 0.35;
    });

    // 园区数据环与流动光点
    const pulseRings: THREE.Mesh[] = [
      [290, 200, 102],
      [545, 200, 82],
      [125, 278, 74],
      [550, 42.5, 52],
    ].map(([x, z, radius]) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.7, 6, 72), additive(0x7de9ff, 0.4));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x, 1.3, z);
      kit.group.add(ring);
      return ring;
    });
    const dataPaths: Array<Array<[number, number, number]>> = [
      [
        [350, 2, 200],
        [420, 2, 200],
        [488, 2, 200],
      ],
      [
        [290, 2, 240],
        [290, 2, 268],
        [200, 2, 268],
        [180, 2, 278],
      ],
      [
        [340, 2, 176],
        [430, 2, 100],
        [496, 2, 58],
      ],
      [
        [238, 2, 258],
        [170, 2, 330],
        [112, 2, 372],
      ],
    ];
    dataPaths.forEach((path, index) => {
      kit.line(path, 0x60beff, 0.22, true);
      kit.flow(path, { count: 2, speed: 18 + index * 4, radius: 1.5, color: index % 2 ? 0x7de9ff : 0xfbbf24, opacity: 0.85 });
    });

    // 车辆（停车位与环线车流）
    const carBodyMat = standard(0x2f6f92, { metalness: 0.65, roughness: 0.32, emissive: 0x061a24, emissiveIntensity: 0.5 });
    const carGlassMat = glass(0x8fefff, 0.35);
    const tyreMat = standard(0x0b1620, { metalness: 0.2, roughness: 0.9 });
    const buildCar = (parent: THREE.Object3D, x: number, z: number, tone = 0x2f6f92) => {
      const car = new THREE.Group();
      car.position.set(x, 0, z);
      const bodyMat = tone === 0x2f6f92 ? carBodyMat : standard(tone, { metalness: 0.6, roughness: 0.36 });
      kit.box(9, 3, 18, 0, 1, 0, bodyMat, car);
      const cabin = kit.box(7.4, 2.6, 9, 0, 3.6, -1, carGlassMat, car);
      kit.edge(cabin, 0x9fe8ff, 0.3);
      [-4.2, 4.2].forEach((ox) => {
        [-5.5, 5.5].forEach((oz) => {
          const wheel = kit.cylinder(1.7, 1.7, 1.3, ox, 1.7, oz, tyreMat, 10, car);
          wheel.rotation.z = Math.PI / 2;
        });
      });
      kit.led(-2.6, 2.6, 9.2, 0xdff8ff, 0.55, car);
      kit.led(2.6, 2.6, 9.2, 0xdff8ff, 0.55, car);
      kit.led(-2.8, 2.6, -9.2, 0xff6b6b, 0.45, car);
      kit.led(2.8, 2.6, -9.2, 0xff6b6b, 0.45, car);
      parent.add(car);
      return car;
    };
    const parkedTones = [0x2f6f92, 0x9fb7c9, 0x3b8f7d, 0x2f6f92, 0xd2a54a];
    for (let index = 0; index < 6; index++) {
      if (index % 3 === 1) continue;
      buildCar(kit.group, 344 + index * 20, 323, parkedTones[index % parkedTones.length]);
    }
    const trafficRoutes: Array<{ car: THREE.Group; points: Array<[number, number]>; speed: number; offset: number }> = [
      {
        car: buildCar(kit.group, 0, 0, 0x3f8fb8),
        points: [
          [58, 58],
          [562, 58],
          [562, 342],
          [58, 342],
          [58, 58],
        ],
        speed: 26,
        offset: 0,
      },
      {
        car: buildCar(kit.group, 0, 0, 0xd2a54a),
        points: [
          [562, 342],
          [58, 342],
          [58, 58],
          [562, 58],
          [562, 342],
        ],
        speed: 21,
        offset: 0.45,
      },
    ];
    const routeLengths = trafficRoutes.map((route) => {
      const lengths = route.points.slice(0, -1).map(([x, z], index) => {
        const [nx, nz] = route.points[index + 1];
        return Math.hypot(nx - x, nz - z);
      });
      return { lengths, total: lengths.reduce((sum, value) => sum + value, 0) };
    });
    const moveCar = (route: (typeof trafficRoutes)[number], lengths: number[], total: number, elapsedMs: number) => {
      const distance = (((elapsedMs / 1000) * route.speed + route.offset * total) % total + total) % total;
      let remaining = distance;
      let index = 0;
      while (index < lengths.length && remaining > lengths[index]) {
        remaining -= lengths[index];
        index++;
      }
      const [x0, z0] = route.points[Math.min(index, route.points.length - 2)];
      const [x1, z1] = route.points[Math.min(index + 1, route.points.length - 1)];
      const ratio = Math.min(remaining / Math.max(lengths[index] ?? 1, 0.001), 1);
      route.car.position.set(x0 + (x1 - x0) * ratio, 0, z0 + (z1 - z0) * ratio);
      route.car.rotation.y = Math.atan2(x1 - x0, z1 - z0);
    };

    // 悬浮数据尘埃
    const dustCount = 240;
    const dustPositions = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      dustPositions[i * 3] = (Math.sin(i * 12.9898) * 0.5 + 0.5) * 620;
      dustPositions[i * 3 + 1] = 8 + (Math.sin(i * 4.331 + 1.2) * 0.5 + 0.5) * 150;
      dustPositions[i * 3 + 2] = (Math.sin(i * 7.879 + 2.4) * 0.5 + 0.5) * 400;
    }
    const dustGeo = dispose(new THREE.BufferGeometry());
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
    const dustMat = dispose(
      new THREE.PointsMaterial({
        color: 0x8fe6ff,
        size: 1.6,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    const dust = new THREE.Points(dustGeo, dustMat);
    world.add(dust);

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
    beam.position.set(290, 252 + 27.5, 200);
    world.add(beam);

    const antennaGeo = dispose(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(290, 250, 200), new THREE.Vector3(290, 292, 200)]),
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
    beacon.position.set(290, 294, 200);
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

      kit.update(elapsed / 1000);
      trafficRoutes.forEach((route, index) => {
        const lengths = routeLengths[index];
        if (lengths) moveCar(route, lengths.lengths, lengths.total, elapsed);
      });
      pulseRings.forEach((ring, index) => {
        const scale = 1 + Math.sin(elapsed / 900 + index * 0.8) * 0.035;
        ring.scale.set(scale, 1, scale);
      });
      beacons.forEach(({ mesh, phase }) => {
        const material = mesh.material as THREE.MeshBasicMaterial;
        material.opacity = 0.3 + Math.abs(Math.sin(elapsed / 640 + phase)) * 0.7;
      });
      dust.rotation.y = elapsed / 90000;
      dustMat.opacity = 0.26 + Math.sin(elapsed / 2100) * 0.08;
      fountainJet.scale.y = 1 + Math.sin(elapsed / 620) * 0.16;
      fountainRing.scale.setScalar(1 + Math.sin(elapsed / 900) * 0.05);

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
      disposeTree(kit.group);
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
