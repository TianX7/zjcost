import * as THREE from "three";
import { SceneKit, additive, basic, floorLabel, glass, lineMaterial, signBoard, standard, type Vec3 } from "./kit";

/** 三种厂区场景共用的动态数据接口 */
export interface SceneDataMap {
  pv: PvSceneData;
  water: WaterSceneData;
  device: DeviceSceneData;
}

export interface PvSceneData {
  power: number;
  gridExport: number;
  inverters: Array<{ id: string; level: "ok" | "warn" | "alarm"; power: number }>;
}

export interface WaterSceneData {
  basins: Array<{ key: string; level: number }>;
  supply: number;
  reuseDaily: number;
}

export interface DeviceSceneData {
  nodes: Array<{ key: string; name: string; level: "ok" | "warn" | "alarm"; health: number }>;
}

export interface BuiltScene {
  update?: (elapsed: number, data: unknown) => void;
}

const LEVEL_HEX = { ok: 0x4dd4ff, warn: 0xfbbf24, alarm: 0xf87171 } as const;

const C = {
  ground: 0x07121d,
  pad: 0x0e1b27,
  wall: 0x243647,
  wallDark: 0x172433,
  steel: 0x53687a,
  metal: 0x2b3d4d,
  cyan: 0x4dd4ff,
  pale: 0x8fefff,
  amber: 0xfbbf24,
  green: 0x34d399,
  red: 0xf87171,
  panel: 0x173d5c,
  water: 0x2fa8d8,
};

function ground(kit: SceneKit, width = 1060, depth = 660) {
  kit.plane(width + 120, depth + 120, 0, -0.4, 0, basic(0x040b13, { opacity: 0.9, transparent: true }));
  kit.plane(width, depth, 0, 0, 0, basic(C.ground, { opacity: 0.96, transparent: true }));
  kit.grid(width - 40, depth - 40, 40, 0.25, C.steel, 0.09);
  kit.rect(-width / 2 + 20, -depth / 2 + 20, width / 2 - 20, depth / 2 - 20, 0.3, C.pale, 0.18, true);
  kit.glow(width * 0.64, 0x2f8dff, 0, 0, 0.1, 0.35);
}

function road(kit: SceneKit, z: number, length = 960) {
  kit.plane(length, 38, 0, 0.2, z, basic(0x0d1a27, { opacity: 0.95, transparent: true }));
  kit.line(
    [
      [-length / 2, 0.4, z],
      [length / 2, 0.4, z],
    ],
    0x8fb6cc,
    0.28,
    true,
  );
  kit.rect(-length / 2, z - 19, length / 2, z + 19, 0.4, C.steel, 0.28);
}

function tree(kit: SceneKit, x: number, z: number, scale = 1, conifer = false) {
  const trunkMat = basic(0x2f8d7a, { transparent: true, opacity: 0.55 });
  kit.cylinder(0.9 * scale, 1.2 * scale, 9 * scale, x, 0, z, trunkMat, 6);
  if (conifer) {
    for (let i = 0; i < 3; i++) {
      const crown = new THREE.Mesh(
        new THREE.ConeGeometry((7 - i * 1.6) * scale, 9 * scale, 7),
        basic(C.green, { transparent: true, opacity: 0.2, depthWrite: false }),
      );
      crown.position.set(x, (10 + i * 6) * scale, z);
      kit.group.add(crown);
      const wire = new THREE.LineSegments(
        new THREE.EdgesGeometry(crown.geometry),
        new THREE.LineBasicMaterial({ color: C.green, transparent: true, opacity: 0.28 }),
      );
      crown.add(wire);
    }
  } else {
    const crown = new THREE.Mesh(
      new THREE.IcosahedronGeometry(6 * scale, 1),
      basic(C.green, { transparent: true, opacity: 0.16, depthWrite: false }),
    );
    crown.position.set(x, 12 * scale, z);
    kit.group.add(crown);
    const wire = new THREE.LineSegments(
      new THREE.EdgesGeometry(crown.geometry),
      new THREE.LineBasicMaterial({ color: C.green, transparent: true, opacity: 0.3 }),
    );
    crown.add(wire);
  }
}

function fence(kit: SceneKit, x: number, z: number, w: number, d: number) {
  const mat = lineMaterial(C.steel, 0.35);
  kit.rect(x - w / 2, z - d / 2, x + w / 2, z + d / 2, 1.2, C.steel, 0.35);
  const posts: Vec3[] = [];
  for (let i = 0; i <= 4; i++) {
    const px = x - w / 2 + (w * i) / 4;
    posts.push([px, 0, z - d / 2], [px, 6, z - d / 2]);
    posts.push([px, 0, z + d / 2], [px, 6, z + d / 2]);
  }
  for (let i = 0; i <= 2; i++) {
    const pz = z - d / 2 + (d * i) / 2;
    posts.push([x - w / 2, 0, pz], [x - w / 2, 6, pz]);
    posts.push([x + w / 2, 0, pz], [x + w / 2, 6, pz]);
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(posts.map((p) => new THREE.Vector3(...p)));
  kit.group.add(new THREE.LineSegments(geometry, mat));
}

function hazardStripes(kit: SceneKit, x: number, z: number, w: number, d: number) {
  const mat = basic(C.amber, { transparent: true, opacity: 0.5 });
  for (let i = 0; i < 6; i++) {
    kit.box(w / 14, 0.4, d * 0.55, x - w / 2 + (w * (i * 2 + 0.5)) / 12, 0.3, z, mat);
  }
}

/* ═══════════════════════ 屋面光伏厂区 ═══════════════════════ */

export function buildPvScene(root: THREE.Group): BuiltScene {
  const kit = new SceneKit();
  root.add(kit.group);
  ground(kit, 1000, 600);
  road(kit, 262, 980);

  // 绿化带与设备平台
  kit.box(808, 1.4, 12, 0, 0.3, 236, basic(0x14382f, { transparent: true, opacity: 0.9 }));
  kit.box(840, 1.2, 80, 0, 0.2, 168, basic(C.pad, { transparent: true, opacity: 0.92 }));
  kit.rect(-420, 128, 420, 208, 0.85, C.steel, 0.22);
  kit.rect(-420, 128, 420, 208, 0.85, C.pale, 0.12, true);

  // ─── 主厂房 ────────────────────────────────────────────
  const wallMat = standard(C.wall, { metalness: 0.45, roughness: 0.6 });
  const plinthMat = standard(0x18242f, { metalness: 0.2, roughness: 0.85 });
  const towerGroup = new THREE.Group();
  kit.group.add(towerGroup);

  const body = kit.box(470, 52, 130, -195, 4, 55, wallMat, towerGroup);
  kit.edge(body, C.pale, 0.42);
  kit.box(472, 4, 132, -195, 0, 55, plinthMat, towerGroup);
  kit.box(472, 1.4, 132, -195, 52.6, 55, basic(C.steel, { transparent: true, opacity: 0.72 }), towerGroup);

  // 山墙竖向板缝与牛腿柱
  for (let i = 0; i < 6; i++) {
    const x = -430 + i * 94;
    kit.box(2.2, 52, 2.2, x, 4, 120.4, standard(C.steel), towerGroup);
  }
  const windowMat = basic(0x7dd3fc, { transparent: true, opacity: 0.2 });
  for (let i = 0; i < 6; i++) {
    kit.box(50, 13, 1, -430 + 34 + i * 76, 24, 120.6, windowMat, towerGroup);
  }
  // 厂房大门与雨棚
  kit.box(78, 32, 1.2, -276, 4, 120.8, basic(0x0b1620, { opacity: 0.95, transparent: true }), towerGroup);
  for (let i = 0; i < 5; i++) {
    kit.box(76, 0.5, 0.6, -276, 8 + i * 6, 121.4, basic(C.steel, { opacity: 0.8, transparent: true }), towerGroup);
  }
  kit.box(96, 1.6, 12, -276, 34, 126, standard(0x2d4353), towerGroup);
  kit.box(96, 0.4, 12, -276, 35.6, 126, basic(C.cyan, { transparent: true, opacity: 0.35 }), towerGroup);

  // 锯齿屋面 + 光伏组串
  const roofMat = standard(0x1b2b3a, { metalness: 0.35, roughness: 0.65 });
  const panelMat = new THREE.MeshStandardMaterial({
    color: C.panel,
    metalness: 0.55,
    roughness: 0.35,
    emissive: 0x0e3550,
    emissiveIntensity: 0.35,
  });
  const panelEdgeMat = new THREE.LineBasicMaterial({ color: C.pale, transparent: true, opacity: 0.35 });
  const rows = 4;
  const cols = 9;
  for (let r = 0; r < rows; r++) {
    const z = 55 - 65 + 8 + (r * 114) / rows;
    const slope = new THREE.Mesh(
      new THREE.PlaneGeometry(458, 30),
      roofMat,
    );
    slope.rotation.x = -Math.PI / 2 + 0.18;
    slope.position.set(-195, 57.5, z + 14);
    towerGroup.add(slope);

    // 采光带
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(458, 6), additive(C.pale, 0.18));
    strip.position.set(-195, 54, z - 2.4);
    towerGroup.add(strip);

    for (let c = 0; c < cols; c++) {
      const x = -420 + 22 + c * 48;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(43, 0.7, 25), panelMat);
      panel.rotation.x = -0.18;
      panel.position.set(x, 60.5, z + 14);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(panel.geometry), panelEdgeMat);
      panel.add(edges);
      towerGroup.add(panel);
    }
  }
  // 屋顶检修栏杆
  const railMat = lineMaterial(C.steel, 0.4);
  const railPoints: THREE.Vector3[] = [];
  for (let i = 0; i <= 10; i++) {
    const x = -430 + i * 47;
    railPoints.push(new THREE.Vector3(x, 58, -10), new THREE.Vector3(x, 64, -10));
  }
  railPoints.push(new THREE.Vector3(-430, 64, -10), new THREE.Vector3(40, 64, -10));
  towerGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(railPoints), railMat));

  // 侧面百叶与排水管
  for (let i = 0; i < 5; i++) {
    kit.box(1, 3, 90, 40.6, 16 + i * 8, 55, basic(C.steel, { transparent: true, opacity: 0.55 }), towerGroup);
  }
  kit.cylinder(1.1, 1.1, 52, 41, 4, 112, standard(C.steel), 8, towerGroup);

  // 正立面竖肋、金属檐带与厂牌
  const ribMat = standard(0x3c5366, { metalness: 0.6, roughness: 0.4 });
  for (let i = 0; i < 15; i++) {
    const x = -420 + i * 31.5;
    if (x > -322 && x < -230) continue;
    kit.box(2.2, 54, 1.2, x, 2, 120.8, ribMat, towerGroup);
  }
  kit.box(468, 1.6, 1.8, -195, 50.5, 121.2, basic(C.steel, { transparent: true, opacity: 0.65 }), towerGroup);
  kit.box(468, 0.7, 1.4, -195, 51.4, 121.6, basic(C.amber, { transparent: true, opacity: 0.45 }), towerGroup);
  kit.box(468, 0.5, 1.2, -195, 3.2, 121.5, basic(C.pale, { transparent: true, opacity: 0.35 }), towerGroup);
  signBoard(kit, "光伏组件车间", -300, 43, 121.9, 118, 17, C.cyan);
  // 屋面检修走道与女儿墙
  kit.line(
    [
      [-430, 58.6, -8],
      [40, 58.6, -8],
    ],
    C.pale,
    0.45,
    true,
  );
  for (let i = 0; i <= 9; i++) {
    const x = -430 + i * 52;
    kit.box(0.6, 5, 0.6, x, 58, 118.5, basic(C.steel, { transparent: true, opacity: 0.5 }), towerGroup);
    kit.box(0.6, 5, 0.6, x, 58, -8.5, basic(C.steel, { transparent: true, opacity: 0.5 }), towerGroup);
  }
  kit.line(
    [
      [-430, 63, 118.5],
      [40, 63, 118.5],
    ],
    C.steel,
    0.5,
  );
  kit.line(
    [
      [-430, 63, -8.5],
      [40, 63, -8.5],
    ],
    C.steel,
    0.5,
  );
  // 屋面汇流电缆桥架
  [-80, -280].forEach((x) => {
    kit.box(3, 0.8, 118, x, 60.4, 52, basic(0x394d5e, { transparent: true, opacity: 0.75 }));
    kit.box(1.6, 0.4, 116, x, 61.2, 52, basic(C.cyan, { transparent: true, opacity: 0.45 }));
  });

  // ─── 辅房 ──────────────────────────────────────────────
  const aux = kit.box(210, 34, 76, 195, 2, 88, wallMat);
  kit.edge(aux, C.pale, 0.38);
  kit.box(212, 2, 78, 195, 0, 88, plinthMat);
  kit.box(214, 1.2, 80, 195, 36, 88, basic(C.steel, { transparent: true, opacity: 0.6 }));
  for (let i = 0; i < 3; i++) {
    kit.box(44, 12, 1, 133 + i * 64, 18, 126.6, windowMat);
    const panel = kit.box(38, 0.8, 22, 150 + i * 52, 37.2, 80, panelMat);
    panel.rotation.x = -0.16;
  }
  kit.box(38, 30, 1.2, 245, 2, 126.8, basic(0x0b1620));
  kit.box(220, 1.8, 86, 195, 38, 88, basic(C.cyan, { transparent: true, opacity: 0.08 }));
  // 辅房立面细部
  for (let i = 0; i < 8; i++) {
    const x = 105 + i * 24;
    kit.box(1.3, 30, 1, x, 2, 126.4, standard(0x344b5c, { metalness: 0.5, roughness: 0.45 }));
  }
  kit.box(210, 1, 1.2, 195, 34.5, 126.5, basic(C.pale, { transparent: true, opacity: 0.45 }));
  kit.box(32, 12, 13, 152, 37.4, 68, standard(0x3c5366, { metalness: 0.5, roughness: 0.5 }));
  kit.cylinder(5, 5, 1, 152, 49.4, 68, basic(C.steel, { opacity: 0.6, transparent: true }), 14);
  kit.box(24, 9, 12, 226, 37.4, 100, standard(0x3c5366, { metalness: 0.5, roughness: 0.5 }));
  kit.cylinder(4, 4, 1, 226, 46.4, 100, basic(C.steel, { opacity: 0.6, transparent: true }), 12);
  signBoard(kit, "并网控制室", 195, 30, 127.1, 72, 11, C.pale);
  [-1, 1].forEach((dir) => {
    kit.cylinder(0.7, 0.7, 34, 195 + dir * 104, 2, 126, standard(C.steel), 8);
  });

  // ─── 逆变器站配套：雨棚 / 电缆沟 / 检修围栏 ──────────
  const canopySteel = standard(0x4a6375, { metalness: 0.65, roughness: 0.35 });
  [-274, -96].forEach((x) => {
    kit.box(5, 66, 5, x, 1.5, 164, canopySteel);
    kit.box(5, 66, 5, x, 1.5, 196, canopySteel);
    kit.box(9, 1.4, 9, x, 0, 164, basic(C.steel, { opacity: 0.55, transparent: true }));
    kit.box(9, 1.4, 9, x, 0, 196, basic(C.steel, { opacity: 0.55, transparent: true }));
  });
  kit.box(188, 2.4, 44, -185, 67.5, 180, standard(0x334b5e, { metalness: 0.55, roughness: 0.45 }));
  kit.box(190, 0.5, 46, -185, 69.9, 180, basic(C.cyan, { transparent: true, opacity: 0.3 }));
  signBoard(kit, "逆变器站 INV-01~03", -185, 63.5, 202.3, 118, 14, C.pale);
  for (let i = 0; i < 3; i++) {
    kit.box(6, 1, 96, -240 + i * 55, 0.5, 148, basic(0x233442, { transparent: true, opacity: 0.9 }));
    kit.box(2, 0.4, 94, -240 + i * 55, 1.1, 148, basic(C.cyan, { transparent: true, opacity: 0.35 }));
  }
  for (const x of [-292, -78]) {
    kit.box(3, 12, 3, x, 0, 202, basic(C.amber, { transparent: true, opacity: 0.55 }));
    kit.led(x, 12.4, 202, C.amber, 0.9);
  }

  // ─── 10kV 配电房细部 ──────────────────────────────────
  for (let i = 0; i < 4; i++) {
    const x = -62 + i * 24;
    kit.box(20, 30, 1, x, 2, 202.6, basic(0x183143, { transparent: true, opacity: 0.95 }));
    kit.box(16, 22, 0.6, x, 6, 203.2, standard(0x28475b, { metalness: 0.45, roughness: 0.5 }));
    kit.led(x - 6, 25, 203.5, i === 2 ? C.amber : C.green, 0.8);
  }
  for (let i = 0; i < 4; i++) {
    kit.box(22, 0.7, 1.2, -25, 7 + i * 7, 203, basic(C.steel, { transparent: true, opacity: 0.4 }));
  }
  kit.box(24, 8, 18, -70, 44, 154, standard(0x3c5366));
  kit.cylinder(4.4, 4.4, 1, -70, 52, 154, basic(C.steel, { opacity: 0.6, transparent: true }), 12);
  signBoard(kit, "10kV 配电房", -25, 33.5, 203.4, 62, 10, C.amber);
  kit.line(
    [
      [-70, 47, 154],
      [-70, 47, 172],
      [-25, 47, 172],
      [-25, 47, 186],
    ],
    C.pale,
    0.4,
    true,
  );

  // ─── 箱变高压套管 / 散热片 / 电缆 ─────────────────────
  for (let i = 0; i < 3; i++) {
    kit.cylinder(1.4, 1.8, 12, 26 + i * 9, 27, 166, standard(0x546d80, { metalness: 0.55, roughness: 0.4 }), 8);
    kit.cylinder(2.4, 2.4, 1.2, 26 + i * 9, 38.6, 166, basic(0xd8e8f2, { transparent: true, opacity: 0.75 }), 8);
    kit.led(26 + i * 9, 39.6, 166, C.amber, 0.6);
  }
  for (let i = 0; i < 8; i++) {
    kit.box(1, 20, 24, 17.4, 3, 160 + i * 2.1, basic(C.steel, { transparent: true, opacity: 0.45 }));
    kit.box(1, 20, 24, 52.6, 3, 160 + i * 2.1, basic(C.steel, { transparent: true, opacity: 0.45 }));
  }
  kit.pipe(
    [
      [-70, 10, 186],
      [-25, 10, 186],
      [-25, 10, 174],
      [18, 10, 174],
      [18, 10, 166],
    ],
    1.3,
    C.pale,
    0.7,
  );
  kit.rect(12, 148, 58, 184, 0.5, C.amber, 0.35, true);

  // ─── 并网柜与计量 ─────────────────────────────────────
  kit.box(46, 1, 1, 377, 32, 202.2, basic(C.cyan, { transparent: true, opacity: 0.35 }));
  for (let i = 0; i < 5; i++) {
    kit.box(36, 1.1, 1, 377, 9 + i * 5, 202.4, basic(C.steel, { transparent: true, opacity: 0.5 }));
  }
  signBoard(kit, "并网计量", 377, 43, 202.7, 46, 9, C.green);
  kit.cylinder(4.4, 4.4, 6, 395, 0, 210, standard(0x546d80), 12);
  kit.led(395, 6.4, 210, C.green, 0.8);

  // ─── 排风塔 ────────────────────────────────────────────
  const stackMat = standard(0x263645, { metalness: 0.5, roughness: 0.55 });
  kit.cylinder(13, 16, 118, 339, 0, -42, stackMat, 24);
  kit.cylinder(15, 15, 6, 339, 118, -42, standard(0x3b4e5e), 24);
  for (const y of [26, 52, 78, 104]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(13.4, 0.7, 6, 28), additive(C.pale, 0.4));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(339, y, -42);
    kit.group.add(ring);
  }
  const beaconMat = additive(C.red, 0.9);
  const beacon = kit.led(339, 126, -42, C.red, 2.4);

  // ─── 电气设备 ─────────────────────────────────────────
  const cabinetMat = standard(0x1d2f40, { metalness: 0.5, roughness: 0.5 });
  const louverMat = basic(0x41586b, { transparent: true, opacity: 0.8 });

  // 汇流箱
  const combiner = kit.box(46, 30, 30, -373, 1.2, 153, cabinetMat);
  kit.edge(combiner, C.pale, 0.3);
  for (let i = 0; i < 4; i++) {
    kit.box(18, 1, 0.8, -382, 8 + i * 5, 168.1, louverMat);
  }
  kit.led(-357, 26, 168.4, C.cyan, 1.1);
  kit.box(52, 1, 36, -373, 31.2, 153, basic(C.steel, { transparent: true, opacity: 0.55 }));

  // 逆变器站（三柜）
  const inverterLeds: Array<{ material: THREE.MeshBasicMaterial; glow: THREE.MeshBasicMaterial }> = [];
  const inverterFans: THREE.Object3D[] = [];
  const inverterX = [-240, -185, -130];
  inverterX.forEach((x, index) => {
    const cabinet = kit.box(50, 52, 34, x, 1.2, 180, cabinetMat);
    kit.edge(cabinet, C.pale, 0.32);
    for (let i = 0; i < 6; i++) {
      kit.box(40, 1, 0.8, x, 10 + i * 6.4, 197.2, louverMat);
    }
    kit.box(14, 9, 0.8, x + 12, 42, 197.3, basic(0x0d1a25, { opacity: 0.9, transparent: true }));
    const ledMaterial = additive(C.cyan, 0.95);
    const led = new THREE.Mesh(new THREE.SphereGeometry(1.3, 8, 8), ledMaterial);
    led.position.set(x - 14, 46, 197.6);
    kit.group.add(led);
    const fanMaterial = standard(0x2f4352, { metalness: 0.5, roughness: 0.5 });
    const fan = kit.cylinder(9, 9, 2, x, 53.2, 180, fanMaterial, 18);
    fan.rotation.y = index * 0.4;
    inverterFans.push(fan);
    const glowMesh = kit.glow(16, C.cyan, x, 180, 0.6, 0.25);
    inverterLeds.push({ material: ledMaterial, glow: glowMesh.material as THREE.MeshBasicMaterial });
  });

  // 10kV 配电房
  const substation = kit.box(110, 42, 72, -25, 1.5, 166, standard(0x223344, { metalness: 0.4, roughness: 0.6 }));
  kit.edge(substation, C.pale, 0.4);
  kit.box(112, 1.5, 74, -25, 43.5, 166, basic(C.steel, { transparent: true, opacity: 0.65 }));
  kit.box(30, 34, 1, -70, 2, 202.5, basic(0x0b1620));
  for (let i = 0; i < 4; i++) {
    kit.box(40, 1.2, 0.8, 15, 14 + i * 7, 202.4, louverMat);
  }
  kit.box(52, 1, 1, -25, 45.2, 166, basic(C.amber, { transparent: true, opacity: 0.5 }));
  kit.led(-8, 40, 203, C.amber, 1.1);

  // 箱式变压器
  const transformer = kit.box(34, 26, 26, 35, 1.3, 166, standard(0x2a3b49, { metalness: 0.5, roughness: 0.55 }));
  kit.edge(transformer, C.pale, 0.28);
  kit.box(38, 1.2, 30, 35, 27.3, 166, basic(C.steel, { transparent: true, opacity: 0.55 }));
  kit.box(20, 4, 20, 35, 28.5, 166, standard(0x33495a));

  // 并网柜
  const gridBox = kit.box(54, 38, 66, 377, 1.2, 169, cabinetMat);
  kit.edge(gridBox, C.pale, 0.35);
  const meterRing = new THREE.Mesh(new THREE.TorusGeometry(10, 0.7, 6, 28), additive(C.pale, 0.6));
  meterRing.position.set(377, 26, 202.3);
  kit.group.add(meterRing);
  kit.line(
    [
      [377, 160, 202.4],
      [377, 26, 202.4],
    ],
    C.cyan,
    0.45,
  );

  // ─── 门式起重机（黄色安全涂装） ────────────────────────
  const craneMat = standard(0xb8892a, { metalness: 0.55, roughness: 0.45, emissive: 0x2a1c02, emissiveIntensity: 0.5 });
  const legMat = standard(0x8f6d21, { metalness: 0.55, roughness: 0.48 });
  const craneDark = standard(0x2e414f, { metalness: 0.6, roughness: 0.4 });
  const legs: Array<[number, number]> = [
    [100, 146],
    [260, 146],
    [100, 214],
    [260, 214],
  ];
  legs.forEach(([x, z]) => {
    kit.box(6, 80, 6, x, 0, z, legMat);
    kit.box(12, 1.4, 12, x, 0, z, craneDark);
    kit.box(9, 3, 9, x, 77, z, craneMat);
    kit.led(x, 80.6, z, C.amber, 0.9);
    for (let i = 0; i < 3; i++) {
      kit.box(1.2, 8, 1.2, x + 0.2, 10 + i * 24, z + 5, basic(C.amber, { transparent: true, opacity: 0.6 }));
    }
  });
  // 轨道与端梁
  kit.box(280, 0.8, 3.2, 180, 0.4, 146, basic(C.steel, { transparent: true, opacity: 0.65 }));
  kit.box(280, 0.8, 3.2, 180, 0.4, 214, basic(C.steel, { transparent: true, opacity: 0.65 }));
  for (const z of [146, 214]) {
    kit.box(196, 6.4, 6.4, 180, 79, z, craneMat);
    kit.box(188, 0.7, 0.8, 180, 83, z, basic(C.amber, { transparent: true, opacity: 0.75 }));
    kit.box(16, 5, 10, 100, 79, z, craneDark);
    kit.box(16, 5, 10, 260, 79, z, craneDark);
  }
  for (const x of [100, 260]) {
    kit.box(6.4, 5.4, 74, x, 80.4, 180, craneMat);
    kit.box(10, 4, 12, x, 79.4, 180, craneDark);
  }
  // 小车、司机室、吊钩
  const trolley = kit.box(30, 8, 20, 180, 86, 180, craneDark);
  kit.edge(trolley, C.amber, 0.4);
  kit.cylinder(6, 6, 9, 190, 88, 180, standard(0x5a6f80), 12);
  const cab = kit.box(14, 12, 14, 205, 72, 180, glass(0x6fd4ff, 0.32));
  kit.edge(cab, C.amber, 0.4);
  kit.led(205, 85, 180, C.amber, 0.9);
  kit.box(5, 1.2, 5, 180, 84, 180, craneDark);
  kit.line(
    [
      [180, 86, 180],
      [180, 48, 180],
    ],
    C.steel,
    0.65,
  );
  const hookBlock = kit.box(11, 8, 11, 180, 40, 180, standard(0x617687));
  kit.edge(hookBlock, C.amber, 0.35);
  kit.cylinder(1, 1.2, 8, 180, 32, 180, standard(0x8b9baa), 8);
  kit.box(2, 4, 2, 180, 28, 180, basic(C.steel, { opacity: 0.8, transparent: true }));
  hazardStripes(kit, 180, 221, 44, 9);
  hazardStripes(kit, 180, 139, 44, 9);
  // 检修爬梯与限位灯
  for (let i = 0; i < 10; i++) {
    kit.box(5, 0.7, 0.7, 100, 4 + i * 8, 151, basic(C.steel, { transparent: true, opacity: 0.5 }));
  }
  kit.box(0.7, 82, 0.7, 97, 0, 151, basic(C.steel, { transparent: true, opacity: 0.45 }));
  kit.box(0.7, 82, 0.7, 103, 0, 151, basic(C.steel, { transparent: true, opacity: 0.45 }));

  // ─── 并网点电塔与线路 ─────────────────────────────────
  const pylonMat = lineMaterial(C.pale, 0.45);
  const pylonPoints: THREE.Vector3[] = [];
  const pylonBase = 452;
  for (const [dx, dz] of [
    [-10, -10],
    [10, -10],
    [10, 10],
    [-10, 10],
  ] as Array<[number, number]>) {
    pylonPoints.push(new THREE.Vector3(pylonBase + dx * 0.4, 0, 169 + dz * 0.4), new THREE.Vector3(pylonBase + dx, 86, 169 + dz));
  }
  for (let i = 1; i <= 4; i++) {
    const t = i / 4;
    const y = 86 * t;
    const r = 4 + 6 * t;
    pylonPoints.push(
      new THREE.Vector3(pylonBase - r, y, 169 - r),
      new THREE.Vector3(pylonBase + r, y, 169 - r),
      new THREE.Vector3(pylonBase + r, y, 169 - r),
      new THREE.Vector3(pylonBase + r, y, 169 + r),
      new THREE.Vector3(pylonBase + r, y, 169 + r),
      new THREE.Vector3(pylonBase - r, y, 169 + r),
      new THREE.Vector3(pylonBase - r, y, 169 + r),
      new THREE.Vector3(pylonBase - r, y, 169 - r),
    );
  }
  for (const y of [64, 76]) {
    kit.box(44, 1.2, 1.2, pylonBase, y, 169, basic(C.steel, { transparent: true, opacity: 0.7 }));
  }
  const pylonGeometry = new THREE.BufferGeometry().setFromPoints(pylonPoints);
  kit.group.add(new THREE.LineSegments(pylonGeometry, pylonMat));
  // 电塔实体塔腿 / 横担 / 绝缘子
  const pylonSteel = standard(0x536a7c, { metalness: 0.65, roughness: 0.4 });
  for (const [dx, dz] of [
    [-10, -10],
    [10, -10],
    [10, 10],
    [-10, 10],
  ] as Array<[number, number]>) {
    kit.pipe(
      [
        [pylonBase + dx, 0, 169 + dz],
        [pylonBase + dx * 0.42, 86, 169 + dz * 0.42],
      ],
      0.7,
      0x536a7c,
      0.85,
    );
    kit.box(7, 1, 7, pylonBase + dx, 0, 169 + dz, basic(C.steel, { opacity: 0.55, transparent: true }));
    kit.led(pylonBase + dx, 1.4, 169 + dz, C.amber, 0.6);
  }
  for (const y of [58, 68, 78]) {
    kit.box(58, 1.6, 2.2, pylonBase, y, 169, pylonSteel);
    kit.box(2.2, 1.6, 58, pylonBase, y, 169, pylonSteel);
    for (const ox of [-22, 22]) {
      kit.cylinder(1.4, 1.4, 6, pylonBase + ox, y - 6.6, 169, basic(0xd8e8f2, { transparent: true, opacity: 0.7 }), 8);
      kit.cylinder(1.4, 1.4, 6, pylonBase, y - 6.6, 169 + ox, basic(0xd8e8f2, { transparent: true, opacity: 0.7 }), 8);
    }
  }
  kit.line(
    [
      [pylonBase - 22, 71, 169],
      [pylonBase - 60, 64, 150],
      [pylonBase - 120, 58, 140],
    ],
    C.pale,
    0.55,
  );
  kit.line(
    [
      [pylonBase, 56, 191],
      [pylonBase + 60, 58, 220],
      [pylonBase + 120, 54, 240],
    ],
    C.pale,
    0.45,
    true,
  );
  kit.cylinder(2, 2, 8, pylonBase, 86, 169, pylonSteel, 10);
  kit.led(pylonBase, 95, 169, C.red, 1.6);
  kit.line(
    [
      [452, 76, 155],
      [500, 76, 155],
      [560, 90, 155],
    ],
    C.steel,
    0.4,
  );
  kit.box(76, 1, 76, 452, 0.2, 169, basic(0x2c3f50, { opacity: 0.55, transparent: true }));
  signBoard(kit, "公共电网", 452, 26, 210, 54, 9, C.pale);
  signBoard(kit, "10kV 并网线路", 452, 106, 169, 76, 9, C.amber, Math.PI / 2);

  // ─── 电力路径 + 流动光点 ───────────────────────────────
  const powerPaths: Vec3[][] = [
    [
      [-195, 64, 40],
      [-195, 64, 132],
      [-373, 64, 132],
      [-373, 8, 132],
      [-373, 8, 146],
    ],
    [
      [-373, 8, 170],
      [-330, 8, 170],
      [-330, 8, 180],
      [-240, 8, 180],
    ],
    [
      [-130, 8, 180],
      [-25, 8, 180],
      [-25, 8, 168],
    ],
    [
      [-25, 8, 174],
      [377, 8, 174],
    ],
    [
      [377, 8, 169],
      [452, 8, 169],
      [452, 40, 169],
    ],
  ];
  powerPaths.forEach((points, index) => {
    kit.line(points, 0x4dd4ff, 0.5);
    kit.flow(points, {
      count: index === 3 ? 3 : 2,
      speed: 34,
      radius: 1.8,
      color: index === 4 ? C.amber : C.pale,
      opacity: 0.85,
    });
  });

  // ─── 场地配景 ─────────────────────────────────────────
  fence(kit, 377, 169, 72, 80);
  const bollards: Array<[number, number]> = [
    [-400, 208],
    [-330, 208],
    [-60, 208],
    [90, 208],
    [250, 208],
    [420, 208],
    [450, 250],
    [-450, 250],
  ];
  bollards.forEach(([x, z]) => {
    kit.cylinder(0.9, 0.9, 7, x, 0, z, standard(C.steel), 6);
    kit.led(x, 7.4, z, C.pale, 0.8);
  });
  for (const [x, z, conifer] of [
    [-470, -240, true],
    [-470, -160, false],
    [-470, 40, false],
    [-470, 220, true],
    [470, -220, true],
    [470, -120, false],
    [470, 60, true],
    [470, 230, false],
    [60, -260, true],
    [240, -260, false],
    [-280, -260, false],
  ] as Array<[number, number, boolean]>) {
    tree(kit, x, z, 1, conifer);
  }
  // 厂房前绿化与检修步道
  kit.box(808, 0.4, 16, 0, 0.2, 222, basic(0x1c2c2b, { transparent: true, opacity: 0.8 }));
  const lawn = basic(0x1d4a3e, { transparent: true, opacity: 0.5 });
  kit.plane(370, 12, -190, 0.32, 134, lawn);
  kit.plane(210, 12, 300, 0.32, 138, lawn);
  for (let i = 0; i < 9; i++) {
    kit.box(7, 4, 3.4, -350 + i * 38, 0.3, 130, basic(0x2f8d7a, { transparent: true, opacity: 0.55 }));
  }
  // 路灯
  for (let i = 0; i < 7; i++) {
    const x = -420 + i * 140;
    kit.cylinder(0.8, 1.1, 24, x, 0, 240, standard(C.steel), 8);
    kit.box(6, 0.6, 0.6, x + 2.6, 23.4, 240, standard(C.steel));
    kit.led(x + 5.2, 23, 240, C.pale, 1.3);
    kit.glow(12, C.pale, x + 5.2, 240, 0.4, 0.2);
  }
  // 道路车流
  const vanBody = standard(0x2e6f8f, { metalness: 0.6, roughness: 0.35 });
  const vanGlass = glass(0x7fe0ff, 0.35);
  const tyre = standard(0x0d1822, { metalness: 0.2, roughness: 0.85 });
  const buildVan = (x: number, z: number, tone: number, scale = 1) => {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const bodyMat = tone === 0x2e6f8f ? vanBody : standard(tone, { metalness: 0.55, roughness: 0.4 });
    kit.box(28, 9, 12, 0, 2.4, 0, bodyMat, group);
    kit.box(10, 7, 11, 15, 3, 0, bodyMat, group);
    kit.box(8, 4.4, 10.4, 15.6, 4.6, 0, vanGlass, group);
    kit.box(18, 5, 1, 1, 11, 0, basic(0xd7e8f4, { transparent: true, opacity: 0.18 }), group);
    [-9, 9].forEach((ox) => {
      [-6.4, 6.4].forEach((oz) => {
        const wheel = kit.cylinder(2.2, 2.2, 1.6, ox, 2.2, oz, tyre, 10, group);
        wheel.rotation.x = Math.PI / 2;
      });
    });
    kit.led(20.2, 3.4, 4, 0xdff8ff, 0.7, group);
    kit.led(20.2, 3.4, -4, 0xdff8ff, 0.7, group);
    kit.led(-14.2, 3.4, 4, 0xff6b6b, 0.6, group);
    kit.led(-14.2, 3.4, -4, 0xff6b6b, 0.6, group);
    group.scale.setScalar(scale);
    kit.group.add(group);
    return group;
  };
  const movingVans = [
    { group: buildVan(-460, 272, 0x2e6f8f), speed: 22, z: 272, dir: 1, offset: 0 },
    { group: buildVan(460, 252, 0xc08a3a, 0.85), speed: 16, z: 252, dir: -1, offset: 320 },
  ];
  buildVan(430, 190, 0x3f8f7d, 0.9);
  buildVan(395, 190, 0x567a92, 0.9);
  // 园区围墙与出入口
  fence(kit, 0, 0, 1000, 600);
  const gateHouse = kit.box(66, 22, 40, -420, 0, 278, standard(C.wallDark, { metalness: 0.35, roughness: 0.65 }));
  kit.edge(gateHouse, C.pale, 0.35);
  kit.box(54, 15, 0.8, -420, 3, 298.2, glass(0x6ad4ff, 0.28));
  kit.box(72, 1.4, 46, -420, 22, 278, basic(C.steel, { opacity: 0.65, transparent: true }));
  signBoard(kit, "光伏电站", -420, 27, 298.7, 48, 8, C.cyan);
  for (let i = 0; i < 4; i++) {
    kit.box(10, 1.2, 1.2, -360 + i * 10, 7, 300, i % 2 === 0 ? basic(C.amber, { opacity: 0.8, transparent: true }) : basic(0x24323f));
  }
  kit.cylinder(1.4, 1.8, 8, -370, 0, 300, standard(C.steel), 8);

  return {
    update(elapsed, data) {
      const pv = data as PvSceneData | null;
      kit.update(elapsed);
      beaconMat.opacity = 0.45 + Math.sin(elapsed * 3) * 0.45;
      beacon.scale.setScalar(1 + Math.sin(elapsed * 3) * 0.12);
      inverterFans.forEach((fan, index) => {
        fan.rotation.y = elapsed * (5.5 + index * 0.4) + index;
      });
      inverterLeds.forEach((item, index) => {
        const level = pv?.inverters?.[index]?.level ?? "ok";
        const color = LEVEL_HEX[level];
        item.material.color.setHex(color);
        item.glow.opacity = level === "ok" ? 0.18 : 0.35 + Math.sin(elapsed * 4 + index) * 0.18;
      });
      movingVans.forEach((van) => {
        const span = 940;
        const travel = ((elapsed * van.speed + van.offset) % span + span) % span;
        const x = van.dir > 0 ? -470 + travel : 470 - travel;
        van.group.position.set(x, 0, van.z);
        van.group.rotation.y = van.dir > 0 ? 0 : Math.PI;
      });
    },
  };
}

/* ═══════════════════════ 水处理站 ═══════════════════════ */

interface BasinRuntime {
  water: THREE.Mesh;
  surface: THREE.Mesh;
  surfaceY: number;
  innerHeight: number;
  level: number;
}

export function buildWaterScene(root: THREE.Group): BuiltScene {
  const kit = new SceneKit();
  root.add(kit.group);
  ground(kit, 1000, 620);
  road(kit, 268, 980);

  const concrete = standard(0x364b5c, { metalness: 0.15, roughness: 0.85 });
  const concreteDark = standard(0x243646, { metalness: 0.2, roughness: 0.8 });
  const steel = standard(0x4c6274, { metalness: 0.6, roughness: 0.4 });
  const pipeMat = standard(0x56788f, { metalness: 0.65, roughness: 0.35 });
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x07506f,
    transparent: true,
    opacity: 0.97,
    metalness: 0.1,
    roughness: 0.52,
    emissive: 0x042433,
    emissiveIntensity: 0.28,
    depthWrite: false,
  });
  const waterMatGreen = new THREE.MeshStandardMaterial({
    color: 0x0b5a49,
    transparent: true,
    opacity: 0.95,
    metalness: 0.1,
    roughness: 0.52,
    emissive: 0x043a2e,
    emissiveIntensity: 0.24,
    depthWrite: false,
  });

  const basins: BasinRuntime[] = [];
  const ripples: THREE.Mesh[] = [];
  const basinSpecs: Array<{
    key: string;
    name: string;
    x: number;
    z: number;
    w: number;
    d: number;
    level: number;
    green?: boolean;
  }> = [
    { key: "raw", name: "调节池", x: -358, z: -55, w: 164, d: 118, level: 68 },
    { key: "ana", name: "厌氧池", x: -170, z: -55, w: 140, d: 118, level: 62 },
    { key: "aer", name: "好氧池", x: 18, z: -55, w: 164, d: 118, level: 62 },
    { key: "mid", name: "中水池", x: -370, z: 135, w: 140, d: 118, level: 33, green: true },
    { key: "clr", name: "清水池", x: 15, z: 135, w: 170, d: 118, level: 76 },
  ];

  basinSpecs.forEach((spec, index) => {
    const wallH = 42;
    const wallT = 5;
    const group = new THREE.Group();
    kit.group.add(group);
    // 池壁：四边 + 底
    kit.box(spec.w, wallH, wallT, spec.x, 0, spec.z - spec.d / 2 + wallT / 2, concrete, group);
    kit.box(spec.w, wallH, wallT, spec.x, 0, spec.z + spec.d / 2 - wallT / 2, concrete, group);
    kit.box(wallT, wallH, spec.d - wallT * 2, spec.x - spec.w / 2 + wallT / 2, 0, spec.z, concrete, group);
    kit.box(wallT, wallH, spec.d - wallT * 2, spec.x + spec.w / 2 - wallT / 2, 0, spec.z, concrete, group);
    kit.box(spec.w - wallT * 2, 1.2, spec.d - wallT * 2, spec.x, 0.4, spec.z, concreteDark, group);
    // 池壁顶圈梁（沿池口四周，不能覆盖液面）+ 栏杆
    const rimMat = basic(C.steel, { transparent: true, opacity: 0.55 });
    kit.box(spec.w + 4, 1.8, 4, spec.x, wallH, spec.z - spec.d / 2 - 2, rimMat, group);
    kit.box(spec.w + 4, 1.8, 4, spec.x, wallH, spec.z + spec.d / 2 + 2, rimMat, group);
    kit.box(4, 1.8, spec.d, spec.x - spec.w / 2 - 2, wallH, spec.z, rimMat, group);
    kit.box(4, 1.8, spec.d, spec.x + spec.w / 2 + 2, wallH, spec.z, rimMat, group);
    const railPoints: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) {
      const x = spec.x - spec.w / 2 + (spec.w * i) / 6;
      railPoints.push(new THREE.Vector3(x, wallH + 2, spec.z - spec.d / 2), new THREE.Vector3(x, wallH + 9, spec.z - spec.d / 2));
      railPoints.push(new THREE.Vector3(x, wallH + 2, spec.z + spec.d / 2), new THREE.Vector3(x, wallH + 9, spec.z + spec.d / 2));
    }
    railPoints.push(
      new THREE.Vector3(spec.x - spec.w / 2, wallH + 9, spec.z - spec.d / 2),
      new THREE.Vector3(spec.x + spec.w / 2, wallH + 9, spec.z - spec.d / 2),
      new THREE.Vector3(spec.x - spec.w / 2, wallH + 9, spec.z + spec.d / 2),
      new THREE.Vector3(spec.x + spec.w / 2, wallH + 9, spec.z + spec.d / 2),
    );
    group.add(
      new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(railPoints),
        new THREE.LineBasicMaterial({ color: C.steel, transparent: true, opacity: 0.55 }),
      ),
    );

    const innerWidth = spec.w - wallT * 2.4;
    const innerDepth = spec.d - wallT * 2.4;
    const innerHeight = wallH - 3;
    // 内壁水线以下的深色挂壁，让水面与混凝土池壁形成对比
    const stainMat = basic(0x0a2f41, { transparent: true, opacity: 0.62 });
    kit.box(innerWidth, 28, 0.6, spec.x, 3, spec.z - spec.d / 2 + wallT + 0.4, stainMat, group);
    kit.box(innerWidth, 28, 0.6, spec.x, 3, spec.z + spec.d / 2 - wallT - 0.4, stainMat, group);
    kit.box(0.6, 28, innerDepth, spec.x - spec.w / 2 + wallT + 0.4, 3, spec.z, stainMat, group);
    kit.box(0.6, 28, innerDepth, spec.x + spec.w / 2 - wallT - 0.4, 3, spec.z, stainMat, group);
    // 水体先做单位高度，运行时按液位缩放，避免液位变化导致高度被反复平方
    const water = kit.box(innerWidth, 1, innerDepth, spec.x, 1.6, spec.z, spec.green ? waterMatGreen : waterMat, group);
    const initialFill = (innerHeight * spec.level) / 100;
    water.scale.y = initialFill;
    water.position.y = 1.6 + initialFill / 2;
    // 液面高光层：叠加在体水之上，液位下降时仍然贴面显示
    const surface = kit.plane(
      innerWidth - 2,
      innerDepth - 2,
      spec.x,
      1.6 + initialFill + 0.22,
      spec.z,
      additive(spec.green ? 0x1b8f78 : 0x1e82a6, 0.08),
      group,
    );
    surface.renderOrder = 2;
    basins.push({ water, surface, surfaceY: 1.6, innerHeight, level: spec.level });

    // 液面波纹
    const rippleMat = additive(spec.green ? C.green : C.pale, 0.28);
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(6 + i * 9, 0.35, 4, 24), rippleMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(spec.x - 20 + i * 18, 1.6 + innerHeight * (spec.level / 100), spec.z + (i - 1) * 14);
      group.add(ring);
      ripples.push(ring);
    }

    // 低液位标线
    kit.rect(
      spec.x - innerWidth / 2,
      spec.z - innerDepth / 2,
      spec.x + innerWidth / 2,
      spec.z + innerDepth / 2,
      1.6 + innerHeight * 0.3,
      C.amber,
      0.26,
      true,
    );

    // 走道与爬梯
    if (index < 3) {
      kit.box(6, 0.4, spec.d + 10, spec.x - spec.w / 2 - 6, 0.2, spec.z, basic(0x1a2a36, { transparent: true, opacity: 0.9 }), group);
      for (let i = 0; i < 5; i++) {
        kit.box(14, 0.6, 1, spec.x - spec.w / 2 - 4, 1 + i * 7, spec.z + spec.d / 2 + 1, steel, group);
      }
    }
  });

  // 厌氧池混合器 + 好氧池曝气
  const mixerBlades: THREE.Object3D[] = [];
  [-230, -170, -110].forEach((x) => {
    kit.cylinder(1.2, 1.2, 54, x, 10, -55, pipeMat, 8);
    const blade = kit.box(26, 1.2, 4, x, 10, -55, steel);
    const crossBlade = kit.box(4, 1.2, 26, x, 10.4, -55, steel);
    mixerBlades.push(blade, crossBlade);
    kit.cylinder(5, 5, 4, x, 64, -55, steel, 12);
    kit.led(x, 68, -55, C.cyan, 1.1);
  });
  const bubbleMat = additive(0x9fdcf2, 0.55);
  const bubbles: THREE.Mesh[] = [];
  for (let i = 0; i < 18; i++) {
    const x = -60 + (i % 6) * 22;
    const z = -90 + Math.floor(i / 6) * 28;
    const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.9, 6, 6), bubbleMat);
    bubble.position.set(x, 8, z);
    kit.group.add(bubble);
    bubbles.push(bubble);
  }

  // 加药间
  const dosing = kit.box(220, 40, 138, 290, 1.5, -85, standard(C.wall, { metalness: 0.4, roughness: 0.6 }));
  kit.edge(dosing, C.pale, 0.4);
  kit.box(222, 1.4, 140, 290, 42, -85, basic(C.steel, { transparent: true, opacity: 0.6 }));
  kit.box(90, 28, 0.8, 240, 2, -15.2, basic(0x0b1620));
  [250, 320].forEach((x, i) => {
    const tankMat = standard(i === 0 ? 0x2a5a74 : 0x4a5a3a, { metalness: 0.45, roughness: 0.4 });
    kit.cylinder(16, 16, 42, x, 2, -85, tankMat, 20);
    kit.cylinder(17, 17, 1.4, x, 44, -85, basic(C.steel, { transparent: true, opacity: 0.7 }), 20);
    kit.line(
      [
        [x, 12, -85],
        [x + 36, 12, -60],
      ],
      C.amber,
      0.45,
    );
    const gauge = new THREE.Mesh(new THREE.TorusGeometry(6, 0.5, 5, 20), additive(C.amber, 0.5));
    gauge.position.set(x, 26, -66.5);
    kit.group.add(gauge);
  });

  // 泵房
  const pumpRoom = kit.box(140, 30, 132, -190, 1.2, 128, standard(C.wallDark, { metalness: 0.35, roughness: 0.65 }));
  kit.edge(pumpRoom, C.pale, 0.32);
  kit.box(142, 1.2, 134, -190, 31.2, 128, basic(C.steel, { transparent: true, opacity: 0.55 }));
  const pumpRotors: THREE.Object3D[] = [];
  [0, 1, 2].forEach((i) => {
    const x = -232 + i * 48;
    kit.box(26, 4, 22, x, 1.8, 128, steel);
    kit.cylinder(10, 10, 10, x + 10, 6, 128, standard(0x3a5568), 16);
    kit.cylinder(6, 6, 12, x - 10, 6, 128, pipeMat, 12);
    const rotor = kit.cylinder(7, 7, 2, x + 10, 16.2, 128, steel, 16);
    pumpRotors.push(rotor);
  });
  kit.pipe(
    [
      [-250, 20, 100],
      [20, 20, 100],
      [20, 20, 190],
    ],
    2.2,
    0x56788f,
  );

  // MBR 膜车间
  const mbr = kit.box(280, 42, 156, 300, 1.5, 116, standard(C.wallDark, { metalness: 0.35, roughness: 0.65 }));
  kit.edge(mbr, C.pale, 0.36);
  kit.box(282, 1.4, 158, 300, 43.5, 116, basic(C.steel, { transparent: true, opacity: 0.6 }));
  const trussMat = lineMaterial(C.steel, 0.5);
  const trussPoints: THREE.Vector3[] = [];
  for (let i = 0; i < 5; i++) {
    const x = 186 + i * 57;
    trussPoints.push(new THREE.Vector3(x, 44, 42), new THREE.Vector3(x, 56, 42));
    trussPoints.push(new THREE.Vector3(x, 56, 42), new THREE.Vector3(x, 56, 190));
  }
  trussPoints.push(new THREE.Vector3(186, 56, 42), new THREE.Vector3(414, 56, 42));
  trussPoints.push(new THREE.Vector3(186, 56, 190), new THREE.Vector3(414, 56, 190));
  kit.group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(trussPoints), trussMat));
  const membraneMat = standard(0x2b4355, { metalness: 0.5, roughness: 0.45 });
  [0, 1, 2].forEach((i) => {
    const x = 225 + i * 84;
    const rack = kit.box(70, 34, 80, x, 3, 110, membraneMat);
    kit.edge(rack, C.pale, 0.35);
    for (let k = 0; k < 7; k++) {
      kit.box(0.8, 30, 0.8, x - 30 + k * 10, 5, 150.1, basic(0x6fa8c8, { transparent: true, opacity: 0.5 }));
    }
    kit.led(x, 38, 150, C.cyan, 1.1);
  });
  kit.pipe(
    [
      [300, 20, 40],
      [300, 20, 190],
      [440, 20, 190],
      [440, 20, 135],
    ],
    2,
    0x56788f,
  );

  // 工艺管线与阀门
  const process: Vec3[][] = [
    [
      [-440, 14, -55],
      [-276, 14, -55],
    ],
    [
      [-240, 14, -55],
      [-100, 14, -55],
    ],
    [
      [100, 14, -55],
      [240, 14, -55],
      [240, 14, -16],
      [300, 14, -16],
      [300, 14, 40],
    ],
    [
      [440, 14, 135],
      [400, 14, 135],
      [400, 14, 62],
      [186, 14, 62],
      [186, 14, 60],
    ],
    [
      [100, 14, -55],
      [100, 14, -170],
      [450, 14, -170],
    ],
  ];
  // 阀门
  process.forEach((points, index) => {
    const point = points[0];
    const valve = new THREE.Mesh(new THREE.TorusGeometry(4, 1, 6, 18), additive(C.amber, 0.6));
    valve.position.set(point[0] + 18, point[1] + 5, point[2]);
    kit.group.add(valve);
    kit.line(
      [
        [point[0] + 18, point[1] + 2, point[2]],
        [point[0] + 18, point[1] + 10, point[2]],
      ],
      C.steel,
      0.4,
    );
    if (index === 0) return;
    kit.led(point[0] + 18, point[1] + 11, point[2], C.amber, 1);
  });

  // 回用管网（沿道路）
  const reusePoints: Vec3[] = [
    [-560, 8, 232],
    [440, 8, 232],
    [440, 8, 270],
  ];
  kit.pipe(reusePoints, 1.6, 0x2f9c7c, 0.85);
  kit.flow(reusePoints, { count: 5, speed: 38, radius: 1.6, color: C.green, opacity: 0.9 });
  [-440, -220, 0, 220].forEach((x) => {
    kit.line(
      [
        [x, 8, 232],
        [x, 8, 218],
      ],
      C.green,
      0.4,
    );
    kit.led(x, 9, 218, C.green, 1.2);
  });

  // ─── 池体细部：扶壁 / 爬梯 / 刮泥桥 ───────────────────
  basinSpecs.forEach((spec) => {
    const wallH = 42;
    for (let i = 0; i < 4; i++) {
      const z = spec.z - spec.d / 2 + 16 + i * ((spec.d - 32) / 3);
      kit.box(3.4, wallH - 4, 3.4, spec.x - spec.w / 2 - 1.4, 0, z, concreteDark);
      kit.box(3.4, wallH - 4, 3.4, spec.x + spec.w / 2 + 1.4, 0, z, concreteDark);
    }
    for (let i = 0; i < 3; i++) {
      const x = spec.x - spec.w / 2 + 24 + i * ((spec.w - 48) / 2);
      kit.box(3.4, wallH - 4, 3.4, x, 0, spec.z - spec.d / 2 - 1.4, concreteDark);
      kit.box(3.4, wallH - 4, 3.4, x, 0, spec.z + spec.d / 2 + 1.4, concreteDark);
    }
    kit.box(spec.w + 5, 1.4, spec.d + 5, spec.x, wallH - 0.6, spec.z, basic(0x6d8ca3, { transparent: true, opacity: 0.42 }));
    // 不锈钢爬梯
    const ladderX = spec.x + spec.w / 2 - 16;
    for (let i = 0; i < 8; i++) {
      kit.box(8, 0.5, 0.5, ladderX, 2 + i * 4.6, spec.z + spec.d / 2 + 1.8, steel);
    }
    [-3.6, 3.6].forEach((ox) => {
      kit.box(0.5, 38, 0.5, ladderX + ox, 0, spec.z + spec.d / 2 + 1.8, steel);
    });
  });

  const scrapers: Array<{ group: THREE.Group; speed: number; phase: number }> = [];
  [0, 3, 4].forEach((specIndex, order) => {
    const spec = basinSpecs[specIndex];
    const group = new THREE.Group();
    group.position.set(spec.x, 44.5, spec.z);
    kit.group.add(group);
    const deckW = spec.w - 10;
    kit.box(deckW, 1.8, 8, 0, 0, 0, steel, group);
    kit.box(deckW, 0.5, 0.8, 0, 3.2, 3.6, basic(C.amber, { transparent: true, opacity: 0.65 }), group);
    kit.box(deckW, 0.5, 0.8, 0, 3.2, -3.6, basic(C.amber, { transparent: true, opacity: 0.65 }), group);
    for (let i = 0; i <= 6; i++) {
      const x = -deckW / 2 + (deckW * i) / 6;
      kit.box(0.5, 3.2, 0.5, x, 0, 3.6, steel, group);
      kit.box(0.5, 3.2, 0.5, x, 0, -3.6, steel, group);
    }
    kit.cylinder(4.4, 4.4, 5, 0, 2, 0, standard(0x5c7488), 14, group);
    kit.cylinder(1.2, 1.2, 3, 0, 7, 0, pipeMat, 8, group);
    kit.led(0, 8.4, 0, C.amber, 1, group);
    const bladeSpan = deckW - 12;
    [-bladeSpan / 2, 0, bladeSpan / 2].forEach((x) => {
      kit.box(4.6, 26, 7, x, -26, 0, steel, group);
      kit.box(2.4, 0.6, 7.4, x, -26, 0, basic(C.pale, { transparent: true, opacity: 0.4 }), group);
    });
    scrapers.push({ group, speed: (order % 2 === 0 ? 1 : -1) * (0.09 + order * 0.012), phase: order * 1.4 });
  });

  // 好氧池曝气水花
  const sprayJets: THREE.Mesh[] = [];
  const sprayMat = additive(0xc8f2ff, 0.34);
  for (let i = 0; i < 6; i++) {
    const jet = new THREE.Mesh(new THREE.ConeGeometry(2.4, 9, 10, 1, true), sprayMat);
    jet.position.set(-45 + (i % 3) * 34, 49, -84 + Math.floor(i / 3) * 30);
    jet.rotation.x = Math.PI;
    kit.group.add(jet);
    sprayJets.push(jet);
  }

  // 加药间立面与设备
  const dosingGlass = glass(0x5ac8ff, 0.26);
  for (let i = 0; i < 4; i++) {
    kit.box(1.2, 32, 0.8, 196 + i * 54, 3, -15.6, basic(C.steel, { transparent: true, opacity: 0.5 }));
  }
  kit.box(196, 0.9, 1, 290, 33, -15.8, basic(C.pale, { transparent: true, opacity: 0.4 }));
  kit.box(40, 18, 0.9, 212, 9, -15.4, dosingGlass);
  kit.box(40, 18, 0.9, 368, 9, -15.4, dosingGlass);
  signBoard(kit, "加药间 · DOSING", 290, 36.5, -14.9, 100, 15, C.amber);
  [210, 366].forEach((x, index) => {
    kit.box(26, 9, 22, x, 44, -60 - index * 26, steel);
    kit.cylinder(6, 6, 0.8, x, 53, -60 - index * 26, basic(C.steel, { opacity: 0.6, transparent: true }), 14);
    kit.led(x, 54, -60 - index * 26, C.pale, 0.9);
  });
  [250, 320].forEach((x, index) => {
    kit.box(6, 40, 3, x - 15, 2, -66.4, basic(C.steel, { transparent: true, opacity: 0.5 }));
    for (let i = 0; i < 9; i++) {
      kit.box(6, 0.7, 2.4, x - 15, 6 + i * 4, -65.2, steel);
    }
    kit.cylinder(7, 7, 8, x, 42, -85, pipeMat, 14);
    kit.cylinder(9, 9, 2, x, 50, -85, steel, 14);
    kit.led(x, 52, -85, index === 0 ? C.cyan : C.amber, 0.9);
    kit.pipe(
      [
        [x, 45, -85],
        [x, 45, -30],
        [x + 40, 20, -30],
      ],
      1.1,
      index === 0 ? 0x4b7d99 : 0x9b8236,
      0.75,
    );
  });

  // 泵房立面、阀门组与屋顶风机
  const pumpGlass = glass(0x6ad4ff, 0.3);
  for (let i = 0; i < 3; i++) {
    kit.box(34, 16, 0.9, -222 + i * 34, 8, 194.4, pumpGlass);
    kit.box(28, 0.8, 1, -222 + i * 34, 24.6, 194.6, basic(C.cyan, { transparent: true, opacity: 0.35 }));
  }
  signBoard(kit, "泵房 · 供水", -190, 26.5, 194.9, 76, 12, C.pale);
  [-232, -184, -136].forEach((x, index) => {
    kit.cylinder(4.4, 4.4, 6, x, 32, 128, steel, 12);
    kit.cylinder(5.2, 5.2, 0.8, x, 38, 128, basic(C.steel, { transparent: true, opacity: 0.55 }), 12);
    kit.led(x, 39.2, 128, index === 1 ? C.amber : C.green, 0.8);
  });
  kit.box(150, 1.4, 1.4, -190, 26, 205, basic(C.pale, { transparent: true, opacity: 0.45 }));
  kit.pipe(
    [
      [-262, 18, 205],
      [-118, 18, 205],
      [-118, 25, 205],
    ],
    1.4,
    0x56788f,
    0.7,
  );

  // MBR 车间玻璃幕墙、膜架歧管与屋顶
  const mbrGlass = glass(0x4fc4ff, 0.24);
  for (let i = 0; i < 5; i++) {
    kit.box(48, 26, 0.9, 185 + i * 58, 9, 194.4, mbrGlass);
  }
  signBoard(kit, "MBR 膜车间", 300, 34.5, 194.9, 92, 13, C.green);
  [225, 309, 393].forEach((x) => {
    kit.box(74, 0.8, 2, x, 22, 151.4, basic(C.pale, { transparent: true, opacity: 0.45 }));
    for (let k = 0; k < 4; k++) {
      const valve = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.55, 5, 16), additive(C.amber, 0.55));
      valve.position.set(x - 25 + k * 17, 23, 152.6);
      kit.group.add(valve);
    }
  });
  kit.pipe(
    [
      [186, 20, 152],
      [414, 20, 152],
      [414, 24, 152],
    ],
    1.6,
    0x5fa0c0,
    0.75,
  );
  [70, 102, 134].forEach((z, row) => {
    for (let i = 0; i < 6; i++) {
      const x = 192 + i * 42;
      kit.box(38, 0.6, 12, x, 44.3, z, additive(0x7fe7ff, 0.34 + row * 0.04));
      kit.box(40, 0.4, 1.4, x, 44.9, z - 6.6, basic(C.pale, { transparent: true, opacity: 0.4 }));
      kit.box(40, 0.4, 1.4, x, 44.9, z + 6.6, basic(C.pale, { transparent: true, opacity: 0.4 }));
    }
    kit.box(240, 0.4, 1, 300, 44.9, z - 7.2, basic(C.steel, { transparent: true, opacity: 0.5 }));
    kit.box(240, 0.4, 1, 300, 44.9, z + 7.2, basic(C.steel, { transparent: true, opacity: 0.5 }));
  });
  // 屋面检修通道与护栏
  kit.plane(240, 14, 300, 45, 178, basic(0x243646, { transparent: true, opacity: 0.9 }));
  for (let i = 0; i < 9; i++) {
    kit.box(1, 4, 1, 186 + i * 30, 45, 171, basic(C.steel, { transparent: true, opacity: 0.55 }));
  }
  kit.box(242, 0.5, 0.8, 300, 49, 171, basic(C.pale, { transparent: true, opacity: 0.4 }));
  kit.box(242, 0.5, 0.8, 300, 47, 171, basic(C.steel, { transparent: true, opacity: 0.5 }));
  // 屋面排风筒与采光带支架
  kit.cylinder(4.5, 4.5, 22, 410, 45, 56, steel, 14);
  kit.cylinder(5.2, 5.2, 2.4, 410, 67, 56, basic(C.pale, { transparent: true, opacity: 0.45 }), 14);
  kit.led(410, 70, 56, C.amber, 1.1);
  [210, 300, 390].forEach((x) => {
    kit.box(18, 7, 14, x, 45, 175, steel);
    kit.cylinder(5, 5, 0.8, x, 52, 175, basic(C.steel, { opacity: 0.6, transparent: true }), 14);
    kit.box(14, 4.6, 0.6, x, 46, 168.2, basic(0x0b1824));
    kit.box(10, 2.6, 0.4, x, 47.4, 167.7, additive(C.cyan, 0.5));
  });

  // 进水端与厂区入口
  kit.box(30, 14, 18, -470, 0, -55, concreteDark);
  kit.box(34, 1.2, 22, -470, 14, -55, basic(C.steel, { transparent: true, opacity: 0.65 }));
  kit.pipe(
    [
      [-500, 9, -55],
      [-446, 9, -55],
    ],
    2.4,
    0x4b7d99,
    0.85,
  );
  kit.led(-455, 18, -55, C.green, 1.1);
  const gate = kit.box(54, 18, 26, 56, 0, 294, standard(C.wallDark, { metalness: 0.35, roughness: 0.65 }));
  kit.edge(gate, C.pale, 0.35);
  kit.box(50, 12, 0.8, 56, 3, 307.2, glass(0x6ad4ff, 0.3));
  kit.box(60, 1.2, 32, 56, 18, 294, basic(C.steel, { transparent: true, opacity: 0.6 }));
  signBoard(kit, "水处理站", 56, 22.5, 307.8, 44, 8, C.cyan);
  [-36, -8, 20].forEach((x) => {
    kit.box(3, 9, 3, x, 0, 280, concreteDark);
    kit.led(x, 9.4, 280, C.amber, 0.8);
  });
  kit.box(56, 0.8, 0.8, -16, 8, 280, basic(C.amber, { transparent: true, opacity: 0.75 }));

  // ─── 工艺管线涂装：按介质分色并补支架 ─────────────────
  const processColors = [0x4b7d99, 0x8a6a4a, 0x9b8236, 0x2f9c7c, 0x5fa0c0];
  process.forEach((points, index) => {
    kit.pipe(points, 2, processColors[index] ?? 0x56788f, 0.85);
    kit.flow(points, { count: 2, speed: 28, radius: 1.7, color: index === 3 ? C.green : C.pale, opacity: 0.9 });
    for (let i = 0; i < points.length - 1; i++) {
      const [x0, y0, z0] = points[i];
      const [x1, , z1] = points[i + 1];
      kit.box(1.2, y0 - 1.4, 1.2, (x0 + x1) / 2, 0, (z0 + z1) / 2, basic(C.steel, { transparent: true, opacity: 0.5 }));
      kit.box(3.8, 0.6, 3.8, (x0 + x1) / 2, y0 - 1.4, (z0 + z1) / 2, basic(C.steel, { transparent: true, opacity: 0.6 }));
    }
  });

  // 场地配景：树、路灯、围栏
  for (const [x, z, conifer] of [
    [-470, -260, true],
    [-470, -140, false],
    [-470, 40, false],
    [-500, 210, true],
    [470, -250, true],
    [470, -140, false],
    [490, 40, false],
    [440, 236, true],
    [-300, -260, false],
    [-80, -260, true],
    [160, -260, false],
  ] as Array<[number, number, boolean]>) {
    tree(kit, x, z, 1, conifer);
  }
  [-480, -240, 0, 240, 480].forEach((x) => {
    kit.cylinder(1, 1, 18, x, 0, 245, steel, 6);
    kit.box(8, 1.2, 3, x, 18, 245, basic(C.pale, { transparent: true, opacity: 0.6 }));
    kit.glow(22, C.pale, x, 245, 0.2, 0.18);
  });
  fence(kit, 0, 0, 1000, 560);

  return {
    update(elapsed, data) {
      const info = data as WaterSceneData | null;
      kit.update(elapsed);
      basins.forEach((basin, index) => {
        const level = info?.basins?.find((b) => b.key === basinSpecs[index].key)?.level ?? basin.level;
        const target = Math.max(0.02, (basin.innerHeight * level) / 100);
        basin.water.scale.y = target;
        basin.water.position.y = basin.surfaceY + target / 2;
        basin.surface.position.y = basin.surfaceY + target + 0.22;
        const surfaceMat = basin.surface.material as THREE.MeshBasicMaterial;
        surfaceMat.opacity = 0.05 + Math.sin(elapsed * 1.4 + index * 1.1) * 0.04;
        basin.level = level;
        for (let k = 0; k < 3; k++) {
          const ring = ripples[index * 3 + k];
          if (!ring) continue;
          ring.position.y = basin.surfaceY + target + 0.35;
          ring.scale.setScalar(0.86 + Math.sin(elapsed * 1.5 + index + k * 0.8) * 0.14);
        }
      });
      mixerBlades.forEach((blade, index) => {
        blade.rotation.y = elapsed * 1.6 + (index % 2) * Math.PI * 0.25;
      });
      bubbles.forEach((bubble, index) => {
        bubble.position.y = 4 + ((elapsed * 16 + index * 3.4) % 36);
        bubble.scale.setScalar(0.6 + (index % 3) * 0.2);
      });
      pumpRotors.forEach((rotor) => {
        rotor.rotation.y = elapsed * 5;
      });
      scrapers.forEach((scraper) => {
        scraper.group.rotation.y = elapsed * scraper.speed + scraper.phase;
      });
      sprayJets.forEach((jet, index) => {
        const pulse = Math.max(0.1, Math.sin(elapsed * 2.2 + index * 0.9));
        jet.scale.set(0.7 + pulse * 0.35, 0.5 + pulse * 0.7, 0.7 + pulse * 0.35);
        jet.position.y = 47 + pulse * 2.2;
      });
    },
  };
}

/* ═══════════════════════ 设备数字孪生总平面 ═══════════════════════ */

export function buildDeviceScene(root: THREE.Group): BuiltScene {
  const kit = new SceneKit();
  root.add(kit.group);
  ground(kit, 1000, 620);
  road(kit, 268, 980);

  const floorMat = standard(0x16273a, { metalness: 0.25, roughness: 0.8 });
  const shellMat = standard(0x2c3f52, { metalness: 0.4, roughness: 0.55 });
  const columnMat = standard(0x3b4e60, { metalness: 0.55, roughness: 0.45 });
  const darkMetal = standard(0x22303d, { metalness: 0.5, roughness: 0.5 });
  const steel = standard(0x465c6d, { metalness: 0.65, roughness: 0.35 });
  const craneYellow = standard(0x9a7422, { metalness: 0.55, roughness: 0.42 });
  const ductMat = standard(0x41596a, { metalness: 0.55, roughness: 0.4 });
  const robotOrange = standard(0xd9772a, { metalness: 0.45, roughness: 0.5 });
  const rackMat = standard(0x2a5570, { metalness: 0.45, roughness: 0.5 });
  const cartonMat = standard(0x6b5a3f, { metalness: 0.2, roughness: 0.75 });

  // 动态部件在 update 中统一驱动
  const wallFans: THREE.Object3D[] = [];
  const roofFans: THREE.Object3D[] = [];
  const chillerFanBlades: THREE.Object3D[] = [];
  const robotArms: Array<{
    waist: THREE.Group;
    shoulder: THREE.Group;
    elbow: THREE.Group;
    wrist: THREE.Group;
    phase: number;
  }> = [];
  const agvCarts: Array<{ group: THREE.Group; speed: number; offset: number; dir: number; z: number }> = [];
  let craneBridge: THREE.Object3D | null = null;
  let craneTrolley: THREE.Group | null = null;
  let elevatorCounterweight: THREE.Mesh | null = null;


  // ─── 厂房外壳（剖切） ──────────────────────────────────
  kit.box(808, 2, 390, 0, 0, 0, floorMat);
  kit.rect(-404, -195, 404, 195, 2.06, C.steel, 0.28);
  // 后墙完整封闭，侧墙保留剖切矮墙，形成鸟瞰剖切
  const backWall = kit.box(808, 64, 6, 0, 1, -195, shellMat);
  kit.edge(backWall, C.pale, 0.28);
  kit.box(810, 3, 9, 0, 1, -195, darkMetal);
  kit.box(5, 22, 390, -404, 1, 0, shellMat);
  kit.box(5, 22, 390, 404, 1, 0, shellMat);
  kit.box(810, 2, 7, 0, 64.5, -194.5, basic(C.steel, { transparent: true, opacity: 0.6 }));
  [-404, 404].forEach((x) => {
    kit.box(7, 2, 392, x, 22, 0, basic(C.steel, { transparent: true, opacity: 0.55 }));
    for (let i = 0; i < 9; i++) {
      kit.box(0.8, 20, 3, x + (x < 0 ? 1.2 : -1.2), 1, -180 + i * 45, basic(C.pale, { transparent: true, opacity: 0.16 }));
    }
  });
  // 后墙竖向压型钢板、水平缝、高侧窗与厂房大门
  const claddingMat = standard(0x273a4b, { metalness: 0.5, roughness: 0.55 });
  const seamMat = basic(C.steel, { transparent: true, opacity: 0.6 });
  for (let i = 0; i <= 32; i++) {
    const x = -404 + i * 25.25;
    if ((x > -92 && x < -28) || (x > 284 && x < 316) || (x > 154 && x < 186)) continue;
    kit.box(1.4, 63, 1.2, x, 1, -191.7, claddingMat);
  }
  [18, 36, 52].forEach((y) => kit.box(806, 0.7, 0.9, 0, y, -191.6, seamMat));
  for (let i = 0; i < 9; i++) {
    const x = -356 + i * 89;
    kit.box(58, 7, 0.8, x, 54, -191.5, glass(0x7dd3fc, 0.26));
    kit.box(62, 0.8, 1.2, x, 52.8, -191.4, steel);
    kit.box(62, 0.8, 1.2, x, 61.8, -191.4, steel);
    for (let k = 1; k < 4; k++) {
      kit.box(0.8, 7, 1.2, x - 29 + k * 14.5, 54, -191.3, steel);
    }
  }
  // 物流卷帘门 + 雨棚
  kit.box(56, 34, 1.4, -60, 2, -191.5, basic(0x0b1620, { opacity: 0.96, transparent: true }));
  for (let i = 0; i < 8; i++) {
    kit.box(54, 0.65, 0.6, -60, 4 + i * 4.2, -190.8, basic(C.steel, { transparent: true, opacity: 0.8 }));
  }
  kit.box(74, 2, 14, -60, 37, -184, standard(0x2d4353));
  kit.box(74, 0.5, 14, -60, 39, -184, basic(C.cyan, { transparent: true, opacity: 0.35 }));
  [-84, -36].forEach((x) => {
    kit.box(3, 8, 3, x, 2, -187, basic(C.amber, { transparent: true, opacity: 0.55 }));
  });
  signBoard(kit, "物流通道", -60, 40, -176.7, 48, 7, C.amber);
  // 人员门
  kit.box(20, 28, 1.2, 300, 2, -191.4, basic(0x0c1924));
  kit.box(23, 1.2, 2, 300, 30, -190.8, steel);
  kit.led(300, 18, -190.2, C.green, 1.0);
  // 墙面排风机
  [40, 120, 366].forEach((x, index) => {
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(10.5, 0.7, 6, 24),
      basic(C.steel, { transparent: true, opacity: 0.7 }),
    );
    rim.position.set(x, 36, -190.9);
    kit.group.add(rim);
    const fan = new THREE.Group();
    fan.position.set(x, 36, -190.4);
    const bladeMat = basic(0x5f7f94, { transparent: true, opacity: 0.7 });
    for (let k = 0; k < 4; k++) {
      const blade = kit.box(15, 1.6, 2.6, 0, 0, 0, bladeMat, fan);
      blade.rotation.z = (Math.PI / 2) * k;
    }
    wallFans.push(fan);
    void index;
  });
  // 后墙厂牌
  signBoard(kit, "智能装备制造中心", 250, 44, -191.1, 152, 17, C.pale);
  signBoard(kit, "设备运维 · DIGITAL TWIN", 250, 33, -191.0, 118, 9, C.cyan);
  // 侧墙外厂牌
  signBoard(kit, "A 区 · 装备制造", 407.1, 16, 44, 70, 10, C.cyan, Math.PI / 2);
  // 结构柱、柱脚与警示涂装
  for (let i = 0; i <= 8; i++) {
    kit.box(5, 64, 5, -404 + i * 101, 0, 195, columnMat);
    kit.box(5, 64, 5, -404 + i * 101, 0, -195, columnMat);
  }
  for (let i = 0; i <= 6; i++) {
    kit.box(5, 64, 5, 404, 0, -195 + i * 65, columnMat);
    kit.box(5, 64, 5, -404, 0, -195 + i * 65, columnMat);
  }
  const columnPoints: Array<[number, number]> = [];
  for (let i = 0; i <= 8; i++) {
    columnPoints.push([-404 + i * 101, 195], [-404 + i * 101, -195]);
  }
  for (let i = 1; i <= 5; i++) {
    columnPoints.push([404, -195 + i * 65], [-404, -195 + i * 65]);
  }
  columnPoints.forEach(([x, z], index) => {
    kit.box(9, 1.5, 9, x, 2, z, darkMetal);
    kit.box(7, 1.1, 7, x, 3.5, z, steel);
    if (index < 18 && index % 3 === 0) {
      for (let k = 0; k < 3; k++) {
        kit.box(7, 0.8, 1.1, x, 2.2 + k * 1.1, z + (z > 0 ? 4.4 : -4.4), basic(C.amber, { transparent: true, opacity: 0.5 }));
      }
    }
  });
  // 桥式起重机轨道柱
  for (let i = 0; i <= 10; i++) {
    const x = -398 + i * 76.4;
    [-136, 38].forEach((z) => {
      kit.box(4, 48, 4, x, 2, z, columnMat);
      kit.box(8, 1.4, 8, x, 2, z, darkMetal);
      kit.box(9, 2.2, 8, x, 50, z, steel);
    });
  }
  [-136, 38].forEach((z) => {
    kit.box(810, 1.6, 2.6, 0, 51.8, z, steel);
    kit.box(810, 0.8, 4.4, 0, 50.2, z, darkMetal);
  });
  // 屋架与檩条
  const truss: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) {
    const x = -404 + i * 101;
    truss.push(new THREE.Vector3(x, 64, -195), new THREE.Vector3(x, 64, 195));
    truss.push(new THREE.Vector3(x, 64, -195), new THREE.Vector3(x, 74, 0));
    truss.push(new THREE.Vector3(x, 74, 0), new THREE.Vector3(x, 64, 195));
    truss.push(new THREE.Vector3(x, 58, -170), new THREE.Vector3(x, 64, -195));
  }
  for (let i = 0; i <= 6; i++) {
    const z = -195 + i * 65;
    truss.push(new THREE.Vector3(-404, 74, z), new THREE.Vector3(404, 74, z));
  }
  kit.group.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(truss),
      new THREE.LineBasicMaterial({ color: C.steel, transparent: true, opacity: 0.3 }),
    ),
  );
  // 后跨侧屋面、采光带与屋顶设备
  const sideRoofMat = basic(0x0b1a26, { transparent: true, opacity: 0.34, depthWrite: false });
  kit.plane(808, 45, 0, 65, -172.5, sideRoofMat);
  for (let i = 0; i <= 8; i++) {
    kit.line(
      [
        [-404 + i * 101, 65.2, -195],
        [-404 + i * 101, 65.2, -150],
      ],
      C.steel,
      0.26,
    );
  }
  [-330, -160, 20, 210, 360].forEach((x) => {
    kit.plane(46, 15, x, 65.25, -172, additive(0x8fefff, 0.14));
  });
  // 采光高侧窗
  kit.box(806, 7, 1, 0, 65, -150, glass(0x7dd3fc, 0.2));
  for (let i = 0; i <= 16; i++) {
    kit.box(1.2, 7, 1.4, -404 + i * 50.5, 65, -149.6, steel);
  }
  // 屋顶排风机
  [-300, -100, 120, 330].forEach((x) => {
    kit.cylinder(9, 9, 3, x, 65, -171, steel, 18);
    const fan = new THREE.Group();
    fan.position.set(x, 69, -171);
    for (let k = 0; k < 4; k++) {
      const blade = kit.box(17, 0.8, 3, 0, 0, 0, darkMetal, fan);
      blade.rotation.y = (Math.PI / 2) * k;
    }
    roofFans.push(fan);
  });
  // 屋顶空调与排风管
  [-205, 55].forEach((x) => {
    const unit = kit.box(46, 13, 26, x, 65, -170, ductMat);
    kit.edge(unit, C.pale, 0.24);
    kit.box(38, 0.5, 2, x, 70, -156.5, basic(C.steel, { transparent: true, opacity: 0.7 }));
    kit.box(38, 0.5, 2, x, 73, -156.5, basic(C.steel, { transparent: true, opacity: 0.7 }));
  });
  kit.pipe(
    [
      [55, 78, -170],
      [55, 84, -170],
      [160, 84, -170],
      [160, 68, -170],
    ],
    2.6,
    0x5f7f94,
    0.7,
  );


  // ─── 桥式起重机（Q=20t） ───────────────────────────────
  const bridgeGroup = new THREE.Group();
  bridgeGroup.position.set(-70, 55.5, -49);
  kit.group.add(bridgeGroup);
  craneBridge = bridgeGroup;
  [-89, 89].forEach((dz) => {
    kit.box(28, 4, 7, 0, -1, dz, craneYellow, bridgeGroup);
    kit.box(30, 0.8, 8, 0, 3, dz, darkMetal, bridgeGroup);
    [-9, 9].forEach((dx) => {
      kit.cylinder(2.2, 2.2, 2, dx, -1, dz, darkMetal, 12, bridgeGroup);
    });
    for (let k = 0; k < 4; k++) {
      kit.box(26, 0.5, 1.2, 0, -1.8 + k, dz + 3.7, basic(C.amber, { transparent: true, opacity: 0.55 }), bridgeGroup);
    }
  });
  [-7, 7].forEach((dx) => {
    kit.box(6, 5, 178, dx, -1, 0, craneYellow, bridgeGroup);
    kit.box(6.6, 0.5, 178, dx, 4, 0, basic(C.amber, { transparent: true, opacity: 0.4 }), bridgeGroup);
  });
  kit.box(16, 0.5, 166, -18, 3.4, 0, standard(0x3b4e60), bridgeGroup);
  const bridgeRail: THREE.Vector3[] = [];
  for (let i = 0; i <= 10; i++) {
    const z = -83 + i * 16.6;
    bridgeRail.push(new THREE.Vector3(-25, 4, z), new THREE.Vector3(-25, 8, z));
  }
  bridgeRail.push(new THREE.Vector3(-25, 8, -83), new THREE.Vector3(-25, 8, 83));
  const railLines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(bridgeRail), lineMaterial(C.pale, 0.38));
  bridgeGroup.add(railLines);
  const craneCab = kit.box(18, 18, 16, 22, -23, -66, standard(0x2c3f52), bridgeGroup);
  kit.edge(craneCab, C.pale, 0.35);
  kit.box(14, 8, 0.6, 22, -17, -58.2, glass(0x7dd3fc, 0.3), bridgeGroup);
  kit.led(22, -3, -58, C.amber, 1.0, bridgeGroup);
  [-74, -58].forEach((z) => kit.box(1.2, 5, 1.2, 22, -5.5, z, steel, bridgeGroup));
  const trolley = new THREE.Group();
  trolley.position.set(0, 3.4, 10);
  bridgeGroup.add(trolley);
  craneTrolley = trolley;
  kit.box(14, 5, 14, 0, 0, 0, standard(0x596b78), trolley);
  kit.cylinder(4, 4, 10, -3.8, 5, 0, darkMetal, 14, trolley).rotation.z = Math.PI / 2;
  kit.cylinder(4, 4, 10, 3.8, 5, 0, darkMetal, 14, trolley).rotation.z = Math.PI / 2;
  kit.box(10, 2, 8, 0, 5, -7, steel, trolley);
  kit.box(0.7, 26, 0.7, 0, -24, 0, steel, trolley);
  kit.box(6, 4, 4, 0, -28, 0, craneYellow, trolley);
  kit.box(8, 0.8, 1.2, 0, -30, 0, darkMetal, trolley);
  kit.led(0, -31, 0, C.amber, 0.8, trolley);
  signBoard(kit, "Q=20t 桥式起重机", 0, 3, 93, 38, 7, C.amber, 0, bridgeGroup);
  signBoard(kit, "Q=20t", 0, 1.5, -93, 20, 5, C.pale, Math.PI, bridgeGroup);

  // 分区地坪与安全通道
  const zoneBlue = basic(0x0f2233, { transparent: true, opacity: 0.94 });
  kit.plane(350, 158, -203, 2.08, -43, zoneBlue);
  kit.plane(382, 158, 209, 2.08, -43, basic(0x0d1f2c, { transparent: true, opacity: 0.94 }));
  kit.plane(760, 84, 0, 2.08, 170, basic(0x0c1d2a, { transparent: true, opacity: 0.94 }));
  kit.rect(-378, -128, -28, 36, 2.14, C.steel, 0.32);
  kit.rect(0, -128, 382, 36, 2.14, C.steel, 0.32);
  kit.rect(-380, 110, 380, 194, 2.14, C.steel, 0.32);
  // 混凝土分仓缝
  for (let i = 1; i < 8; i++) {
    kit.line(
      [
        [-404 + i * 101, 2.07, -195],
        [-404 + i * 101, 2.07, 195],
      ],
      C.steel,
      0.12,
    );
  }
  [65, 130].forEach((z) => {
    kit.line(
      [
        [-404, 2.07, z],
        [404, 2.07, z],
      ],
      C.steel,
      0.12,
    );
  });
  // 主通道与地面导向文字
  kit.plane(760, 44, 0, 2.18, 70, basic(0x122230, { transparent: true, opacity: 0.95 }));
  kit.rect(-380, 48, 380, 92, 2.22, C.steel, 0.36);
  for (let i = 0; i < 12; i++) {
    kit.box(6, 0.3, 1.4, -350 + i * 64, 2.22, 70, basic(0x8fb6cc, { transparent: true, opacity: 0.35 }));
  }
  floorLabel(kit, "生产区 A · 精密加工", -170, -130, 140, 24, C.cyan, 0.4);
  floorLabel(kit, "动力设备区", 232, 58, 126, 24, C.pale, 0.36);
  floorLabel(kit, "动力辅机区", 232, 102, 132, 24, C.amber, 0.34);
  floorLabel(kit, "原料暂存区", 112, -133, 112, 22, C.pale, 0.4);
  floorLabel(kit, "物流通道", -60, -156, 104, 22, C.amber, 0.34);
  floorLabel(kit, "AGV 主通道", 0, 78, 150, 20, C.cyan, 0.38);

  // ─── AGV 搬运车 ────────────────────────────────────────
  const agvBody = standard(0x334d5f, { metalness: 0.45, roughness: 0.5 });
  [
    { z: 62, dir: 1, speed: 24, offset: 30 },
    { z: 78, dir: -1, speed: 19, offset: 300 },
  ].forEach((spec) => {
    const group = new THREE.Group();
    group.position.set(-300, 2.2, spec.z);
    group.rotation.y = spec.dir > 0 ? 0 : Math.PI;
    kit.group.add(group);
    kit.box(26, 4, 15, 0, 1.2, 0, agvBody, group);
    kit.box(22, 0.6, 12, 0, 5.2, 0, steel, group);
    kit.box(17, 5, 11, 0, 5.8, 0, cartonMat, group);
    [-9, 9].forEach((dx) => {
      [-5.5, 5.5].forEach((dz) => {
        kit.cylinder(1.6, 1.6, 1.8, dx, 0.7, dz, darkMetal, 10, group).rotation.z = Math.PI / 2;
      });
    });
    kit.box(1.2, 3, 13, 13.2, 1.8, 0, basic(C.amber, { transparent: true, opacity: 0.55 }), group);
    kit.box(1.2, 3, 13, -13.2, 1.8, 0, basic(C.amber, { transparent: true, opacity: 0.55 }), group);
    kit.led(12.8, 4.4, 0, C.cyan, 1.0, group);
    kit.led(-12.8, 4.4, 0, C.red, 0.7, group);
    agvCarts.push({ group, speed: spec.speed, offset: spec.offset, dir: spec.dir, z: spec.z });
  });

  // ─── 厂房高天棚灯 ──────────────────────────────────────
  [-300, -100, 100, 300].forEach((x) => {
    [-150, 70].forEach((z) => {
      kit.cylinder(1.4, 1.4, 3, x, 62, z, steel, 8);
      const housing = kit.box(11, 2, 6, x, 60, z, darkMetal);
      kit.edge(housing, C.steel, 0.4);
      kit.box(9, 0.4, 4.4, x, 59.8, z, additive(C.pale, 0.85));
      const cone = new THREE.Mesh(
        new THREE.CylinderGeometry(2.4, 18, 28, 14, 1, true),
        additive(C.pale, 0.028),
      );
      cone.position.set(x, 45.8, z);
      kit.group.add(cone);
      kit.glow(26, C.pale, x, z, 2.3, 0.07);
    });
  });

  // ─── 安全通道与防撞柱 ──────────────────────────────────
  for (let i = 0; i < 4; i++) {
    const x = -330 + i * 220;
    [44, 96].forEach((z) => {
      kit.cylinder(1.6, 1.6, 8, x, 2.2, z, standard(0x8a6a1f, { metalness: 0.4, roughness: 0.5 }), 10);
      kit.box(4, 0.8, 4, x, 9, z, basic(C.amber, { transparent: true, opacity: 0.55 }));
      kit.led(x, 10.4, z, C.amber, 0.6);
    });
  }
  [-370, 370].forEach((x) => {
    kit.plane(10, 48, x, 2.24, 70, basic(0x08131d, { transparent: true, opacity: 0.85 }));
  });
  for (let i = 0; i < 5; i++) {
    kit.box(18, 0.3, 3, -300 + i * 150, 2.24, 70, basic(0xdbeafe, { transparent: true, opacity: 0.18 }));
  }

  // ─── 生产区：9 台加工中心 + 输送线 ─────────────────────
  const machineBodyMat = standard(0x2b4355, { metalness: 0.45, roughness: 0.5 });
  const machineDoorMat = glass(0x5fb6d9, 0.18);
  const machineLeds: Array<{ mesh: THREE.Mesh; material: THREE.MeshBasicMaterial }> = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const x = -350 + col * 92;
      const z = -96 + row * 54;
      const body = kit.box(64, 24, 34, x, 1.2, z, machineBodyMat);
      kit.edge(body, C.pale, 0.25);
      kit.box(48, 10, 1, x, 10, z + 17.2, machineDoorMat);
      kit.box(18, 8, 1.2, x + 22, 14, z + 17.3, basic(0x0c1822));
      const material = additive(C.cyan, 0.9);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 8), material);
      bulb.position.set(x + 22, 26, z + 17.6);
      kit.group.add(bulb);
      machineLeds.push({ mesh: bulb, material });
      // 顶部排屑器、三色警示灯、操作面板与侧置冷却箱
      kit.box(30, 1.4, 8, x, 25.2, z - 4, steel);
      kit.box(60, 0.5, 2, x, 2, z + 18, basic(C.amber, { transparent: true, opacity: 0.3 }));
      kit.cylinder(1.2, 1.2, 3, x - 26, 25.2, z + 9, steel, 8);
      kit.box(3, 2, 3, x - 26, 28.2, z + 9, basic(C.red, { transparent: true, opacity: 0.5 }));
      kit.box(3, 2, 3, x - 26, 30.2, z + 9, basic(C.amber, { transparent: true, opacity: 0.45 }));
      const towerGreen = kit.box(3, 2, 3, x - 26, 32.2, z + 9, basic(C.green, { transparent: true, opacity: 0.9 }));
      kit.edge(towerGreen, C.green, 0.6);
      const panel = kit.box(9, 7, 0.8, x - 23, 17, z + 17.5, basic(0x0d1b26));
      kit.edge(panel, C.steel, 0.4);
      kit.box(6, 3.6, 0.5, x - 23, 18.6, z + 18.1, additive(C.cyan, 0.42));
      kit.box(14, 3.4, 13, x - 22, 2, z + 23, darkMetal);
      for (let k = 0; k < 4; k++) {
        kit.box(12, 0.4, 1.2, x - 22, 5.4, z + 18.5 + k * 3, steel);
      }
      kit.box(10, 8, 10, x + 39, 2, z - 7, darkMetal);
      kit.cylinder(1.4, 1.4, 4, x + 39, 10, z - 7, steel, 10);
    }
  }
  // 输送线（机床出料，位于机床区与主通道之间）
  kit.box(246, 3, 1.6, -267, 4, 35, darkMetal);
  kit.box(246, 3, 1.6, -267, 4, 45, darkMetal);
  for (let i = 0; i < 16; i++) {
    const roller = kit.cylinder(1.6, 1.6, 9, -380 + i * 15, 7, 40, steel, 10);
    roller.rotation.set(Math.PI / 2, 0, 0);
    roller.position.y = 7;
  }
  kit.box(246, 0.4, 9, -267, 8.8, 40, basic(0x101c26, { transparent: true, opacity: 0.9 }));
  for (let i = 0; i < 6; i++) {
    kit.box(1.2, 4.4, 1.2, -382 + i * 46, 2, 35, steel);
    kit.box(1.2, 4.4, 1.2, -382 + i * 46, 2, 45, steel);
  }
  const crates: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const crate = kit.box(12, 8, 7, -360 + i * 82, 9.2, 40, standard(0x38566a, { metalness: 0.35, roughness: 0.55 }));
    kit.edge(crate, C.pale, 0.3);
    crates.push(crate);
  }

  // ─── 机器人焊接单元 ──────────────────────────────────
  const cellX0 = -114;
  const cellX1 = -8;
  const cellZ0 = -112;
  const cellZ1 = 12;
  const cellFenceMat = lineMaterial(C.amber, 0.34);
  const cellRail: THREE.Vector3[] = [];
  [18, 33].forEach((y) => {
    cellRail.push(
      new THREE.Vector3(cellX0, y, cellZ0),
      new THREE.Vector3(cellX1, y, cellZ0),
      new THREE.Vector3(cellX1, y, cellZ1),
      new THREE.Vector3(cellX1, y, cellZ0),
    );
  });
  cellRail.push(
    new THREE.Vector3(cellX0, 18, cellZ0),
    new THREE.Vector3(cellX0, 18, cellZ1),
    new THREE.Vector3(cellX0, 33, cellZ0),
    new THREE.Vector3(cellX0, 33, cellZ1),
  );
  kit.group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(cellRail), cellFenceMat));
  for (let i = 0; i <= 5; i++) {
    const x = cellX0 + ((cellX1 - cellX0) * i) / 5;
    kit.box(1.2, 31, 1.2, x, 2, cellZ0, steel);
    kit.box(1.2, 31, 1.2, x, 2, cellZ1, steel);
  }
  for (let i = 1; i <= 3; i++) {
    const z = cellZ0 + ((cellZ1 - cellZ0) * i) / 4;
    kit.box(1.2, 31, 1.2, cellX0, 2, z, steel);
    kit.box(1.2, 31, 1.2, cellX1, 2, z, steel);
  }
  kit.rect(cellX0, cellZ0, cellX1, cellZ1, 2.22, C.amber, 0.38, true);
  kit.box(46, 4, 22, -61, 2, -58, darkMetal);
  kit.box(40, 1, 18, -61, 6, -58, steel);
  [-80, -42].forEach((x) => kit.box(3, 7, 5, x, 2, -58, robotOrange));
  const robotBase = standard(0x3a4650, { metalness: 0.55, roughness: 0.45 });
  [-100, -26].forEach((robotX, index) => {
    const waist = new THREE.Group();
    waist.position.set(robotX, 6, -58);
    kit.group.add(waist);
    kit.cylinder(11, 13, 3, 0, -4, 0, robotBase, 20, waist);
    kit.box(14, 8, 14, 0, -1, 0, robotOrange, waist);
    kit.cylinder(6, 7, 6, 0, 7, 0, darkMetal, 16, waist);
    kit.edge(kit.box(14, 8, 14, 0, -1, 0, robotOrange, waist), C.pale, 0.24);
    const shoulder = new THREE.Group();
    shoulder.position.set(0, 13, 0);
    waist.add(shoulder);
    kit.box(7, 24, 8, 0, 0, 0, robotOrange, shoulder);
    const elbow = new THREE.Group();
    elbow.position.set(0, 24, 0);
    shoulder.add(elbow);
    kit.box(5, 20, 5, 0, 0, 0, robotOrange, elbow);
    const wrist = new THREE.Group();
    wrist.position.set(0, 20, 0);
    elbow.add(wrist);
    kit.box(3.6, 8, 3.6, 0, 0, 0, darkMetal, wrist);
    kit.led(0, 9, 0, C.amber, 1.1, wrist);
    robotArms.push({ waist, shoulder, elbow, wrist, phase: index * 1.9 });
  });
  signBoard(kit, "机器人焊接单元", -61, 38, 13.1, 68, 10, C.amber);

  // ─── 原料暂存高位货架 ────────────────────────────────
  for (let bay = 0; bay < 3; bay++) {
    const x0 = 34 + bay * 56;
    [0, 46].forEach((dx) => kit.box(2, 34, 26, x0 + dx, 2, -170, rackMat));
    for (let shelf = 1; shelf <= 4; shelf++) {
      kit.box(46, 0.8, 26, x0 + 23, 2 + shelf * 7.6, -170, rackMat);
      for (let k = 0; k < 2; k++) {
        const pallet = kit.box(18, 5, 18, x0 + 12 + k * 22, 2.6 + shelf * 7.6, -170, cartonMat);
        kit.edge(pallet, C.amber, 0.2);
      }
    }
  }
  signBoard(kit, "原料暂存 · RAW", 118, 39, -155.8, 96, 11, C.pale);

  // ─── 设备区：AHU / 冷冻机 / 电梯 ──────────────────────
  // AHU 组合式空调机组
  const ahu = kit.box(92, 52, 56, 100, 3.2, -78, standard(0x334a5c, { metalness: 0.4, roughness: 0.5 }));
  kit.edge(ahu, C.pale, 0.35);
  kit.box(100, 2, 62, 100, 2, -78, darkMetal);
  for (let i = 0; i < 4; i++) {
    kit.box(70, 1, 0.8, 100, 10 + i * 9, -49.6, basic(0x4a6375, { transparent: true, opacity: 0.8 }));
  }
  [78, 100, 122].forEach((x) => {
    kit.box(0.8, 52, 0.7, x, 3.2, -49.7, basic(C.pale, { transparent: true, opacity: 0.3 }));
  });
  [62, 138].forEach((x) => {
    const door = kit.box(14, 32, 1, x, 12, -49.5, standard(0x2d4353));
    kit.edge(door, C.pale, 0.24);
    kit.cylinder(0.5, 0.5, 4, x + 5, 25, -48.8, steel, 8).rotation.x = Math.PI / 2;
  });
  const ahuFans: THREE.Object3D[] = [];
  [-25, 25].forEach((dx) => {
    kit.cylinder(13, 13, 4, 100 + dx, 54.2, -78, steel, 20);
    const guard = new THREE.Mesh(
      new THREE.TorusGeometry(12.5, 0.5, 5, 22),
      basic(C.pale, { transparent: true, opacity: 0.4 }),
    );
    guard.rotation.x = Math.PI / 2;
    guard.position.set(100 + dx, 58.4, -78);
    kit.group.add(guard);
    const blades = new THREE.Group();
    blades.position.set(100 + dx, 57.2, -78);
    for (let k = 0; k < 3; k++) {
      const blade = kit.box(19, 0.8, 2.6, 0, 0, 0, darkMetal, blades);
      blade.rotation.y = (Math.PI / 3) * k;
    }
    ahuFans.push(blades);
  });
  const ahuPanel = kit.box(12, 8, 1, 139, 41, -49.4, basic(0x0b1824));
  kit.edge(ahuPanel, C.steel, 0.5);
  kit.box(8, 4, 0.5, 139, 43, -48.8, additive(C.cyan, 0.5));
  signBoard(kit, "AHU-01 空调机组", 100, 46, -48.7, 58, 8, C.pale);
  kit.box(24, 18, 28, 156, 54, -78, ductMat);
  kit.box(74, 18, 24, 196, 70, -78, ductMat);
  kit.box(66, 1.2, 2, 196, 76, -65.8, basic(C.cyan, { transparent: true, opacity: 0.3 }));
  kit.line(
    [
      [160, 74, -78],
      [160, 82, -78],
    ],
    C.steel,
    0.45,
  );
  kit.pipe(
    [
      [100, 54, -78],
      [100, 66, -78],
      [188, 66, -78],
      [188, 40, -40],
    ],
    3,
    0x5f7f94,
  );

  // 冷冻机组
  const chiller = kit.box(104, 44, 62, 240, 3.2, -22, standard(0x2d4455, { metalness: 0.45, roughness: 0.45 }));
  kit.edge(chiller, C.pale, 0.35);
  kit.box(112, 2, 70, 240, 2, -22, darkMetal);
  [205, 240, 275].forEach((x, index) => {
    kit.cylinder(12, 12, 5, x, 47.2, -22, steel, 18);
    const blades = new THREE.Group();
    blades.position.set(x, 53, -22);
    for (let k = 0; k < 3; k++) {
      const blade = kit.box(18, 0.7, 2.4, 0, 0, 0, darkMetal, blades);
      blade.rotation.y = (Math.PI / 3) * k + index * 0.4;
    }
    chillerFanBlades.push(blades);
  });
  for (let i = 0; i < 5; i++) {
    kit.box(90, 1, 0.8, 240, 10 + i * 7, 10.1, basic(0x4a6375, { transparent: true, opacity: 0.7 }));
  }
  const chillerPanel = kit.box(14, 9, 1, 282, 28, 10.4, basic(0x0b1824));
  kit.edge(chillerPanel, C.steel, 0.5);
  kit.box(10, 5, 0.5, 282, 30, 10.9, additive(C.cyan, 0.5));
  signBoard(kit, "CH-01 冷水机组", 206, 42, 10.7, 54, 8, C.pale);
  [-80, 80].forEach((dx) => {
    kit.box(10, 2, 8, 240 + dx, 2, -22, basic(0x18242f, { transparent: true, opacity: 0.8 }));
  });
  const valveWheel = new THREE.Mesh(
    new THREE.TorusGeometry(2.4, 0.55, 5, 12),
    standard(0x8f3c3c, { metalness: 0.45, roughness: 0.45 }),
  );
  valveWheel.position.set(240, 40.5, 24);
  valveWheel.rotation.x = Math.PI / 2;
  kit.group.add(valveWheel);
  kit.led(188, 42, -40, C.green, 1.0);
  kit.pipe(
    [
      [240, 38, 10],
      [240, 38, 24],
      [100, 38, 24],
      [100, 38, -50],
    ],
    2.4,
    0x54788e,
  );
  kit.flow(
    [
      [240, 38, 10],
      [240, 38, 24],
      [100, 38, 24],
      [100, 38, -50],
    ],
    { count: 3, speed: 24, color: C.pale, radius: 1.4 },
  );


  // 电梯井（玻璃）
  const shaftMat = glass(0x4dd4ff, 0.14);
  const shaft = kit.box(64, 132, 54, 326, 2, -84, shaftMat);
  kit.edge(shaft, C.pale, 0.6);
  for (let i = 1; i < 4; i++) {
    kit.box(66, 0.8, 56, 326, 2 + i * 33, -84, basic(C.pale, { transparent: true, opacity: 0.2 }));
  }
  [302, 350].forEach((x) => {
    [-106, -62].forEach((z) => {
      kit.box(1.6, 130, 2, x, 3, z, steel);
    });
  });
  const counterweight = kit.box(15, 40, 10, 347, 16, -84, standard(0x3c5568, { metalness: 0.45, roughness: 0.45 }));
  kit.edge(counterweight, C.pale, 0.3);
  elevatorCounterweight = counterweight;
  const cab = kit.box(44, 26, 36, 326, 40, -84, standard(0x4a6a80, { metalness: 0.6, roughness: 0.35 }));
  kit.edge(cab, C.pale, 0.5);
  [-10, 10].forEach((dx) => {
    kit.box(18, 21, 0.6, dx, -11, 18.2, steel, cab);
    kit.box(0.8, 21, 0.8, dx, -11, 18.5, basic(C.pale, { transparent: true, opacity: 0.5 }), cab);
  });
  const cabLight = kit.led(326, 66, -66, C.pale, 1.4);
  kit.box(70, 3, 60, 326, 135, -84, basic(C.pale, { transparent: true, opacity: 0.35 }));
  kit.cylinder(4, 4, 16, 326, 138, -84, steel, 12);
  kit.line(
    [
      [326, 138, -84],
      [326, 150, -84],
    ],
    C.pale,
    0.5,
    true,
  );
  // 首层电梯门、门套与楼层指示灯
  kit.box(50, 3, 3, 326, 31, -56.3, steel);
  [-10.5, 10.5].forEach((dx) => {
    const leaf = kit.box(20, 26, 1.2, 326 + dx, 2, -56.4, standard(0x3d586b, { metalness: 0.5, roughness: 0.4 }));
    kit.edge(leaf, C.pale, 0.24);
  });
  kit.box(6, 4, 1, 326, 27.5, -56.9, basic(0x08131d));
  kit.box(4, 2, 0.6, 326, 28.5, -56.4, additive(C.green, 0.8));
  signBoard(kit, "客梯 EL-01", 326, 36, -55.4, 40, 8, C.cyan);
  kit.box(12, 6, 1.4, 373, 16, -56.2, darkMetal);
  kit.led(373, 20, -55.4, C.amber, 1.0);

  // ─── 动力辅机区 ──────────────────────────────────────
  // 空压站：螺杆机 + 卧式储气罐 + 冷干机
  const compressorTank = kit.cylinder(16, 16, 66, -336, 6, 146, standard(0x3c5568, { metalness: 0.45, roughness: 0.45 }), 20);
  compressorTank.rotation.z = Math.PI / 2;
  compressorTank.position.set(-336, 16, 132);
  kit.edge(compressorTank, C.pale, 0.28);
  kit.box(108, 2, 22, -317, 2, 132, darkMetal);
  const compressorBox = kit.box(34, 26, 28, -282, 2, 146, standard(0x2e4557, { metalness: 0.5, roughness: 0.45 }));
  kit.edge(compressorBox, C.pale, 0.28);
  for (let i = 0; i < 4; i++) {
    kit.box(26, 1.2, 0.7, -282, 8 + i * 4.5, 160.1, basic(0x4a6375, { transparent: true, opacity: 0.7 }));
  }
  const compressorPanel = kit.box(10, 8, 0.8, -292, 20, 160.3, basic(0x0b1824));
  kit.edge(compressorPanel, C.steel, 0.5);
  kit.box(6, 4, 0.5, -292, 22, 160.8, additive(C.cyan, 0.5));
  kit.cylinder(5, 5, 18, -256, 2, 146, standard(0x3d586b), 14);
  kit.cylinder(6, 6, 9, -256, 20, 146, steel, 14);
  const dryer = kit.box(22, 20, 18, -238, 2, 166, ductMat);
  kit.edge(dryer, C.pale, 0.2);
  kit.pipe(
    [
      [-336, 30, 146],
      [-262, 30, 146],
      [-262, 26, 190],
    ],
    1.8,
    0x56788f,
  );
  signBoard(kit, "空压站 · AIR", -282, 31, 160.6, 48, 8, C.pale);
  kit.led(-272, 29, 160.4, C.green, 0.9);

  // 配电柜排
  kit.box(188, 2, 32, -150, 2, 146, darkMetal);
  for (let i = 0; i < 6; i++) {
    const x = -230 + i * 32;
    const cabinet = kit.box(28, 38, 24, x, 3, 146, darkMetal);
    kit.edge(cabinet, C.pale, 0.22);
    for (let k = 0; k < 4; k++) {
      kit.box(20, 0.8, 0.6, x, 13 + k * 7, 134.3, basic(0x4a6375, { transparent: true, opacity: 0.6 }));
    }
    const meter = kit.box(9, 5, 0.5, x, 30, 133.8, basic(0x0b1824));
    kit.edge(meter, C.steel, 0.4);
    kit.box(6, 2.4, 0.4, x, 31, 133.2, additive(C.cyan, 0.5));
    kit.led(x, 36, 134.5, C.green, 0.8);
  }
  kit.box(180, 2.4, 9, -150, 46, 137, darkMetal);
  kit.box(180, 0.6, 2.4, -150, 48.4, 137, basic(C.amber, { transparent: true, opacity: 0.35 }));
  [-216, -150, -84].forEach((x) => {
    kit.box(2, 6, 2, x, 40, 137, steel);
    kit.pipe(
      [
        [x, 48, 137],
        [x, 48, 134],
        [x, 44, 134],
      ],
      0.8,
      0x3f5465,
      0.7,
    );
  });
  kit.box(184, 0.4, 8, -150, 2.18, 127, basic(0x0a1620, { transparent: true, opacity: 0.9 }));
  for (let i = 0; i < 15; i++) {
    kit.box(1.2, 0.25, 7, -238 + i * 12.6, 2.3, 127, basic(C.steel, { transparent: true, opacity: 0.35 }));
  }
  kit.box(184, 0.5, 2, -150, 2.2, 120, basic(C.amber, { transparent: true, opacity: 0.35 }));
  signBoard(kit, "低压配电室", -150, 43, 133.2, 86, 9, C.amber);

  // 给排水泵组
  const pumpBlades: THREE.Object3D[] = [];
  [-80, -24, 32].forEach((x) => {
    kit.box(38, 2, 30, x, 2, 146, darkMetal);
    kit.box(34, 4, 26, x, 2.2, 146, steel);
    kit.cylinder(11, 11, 12, x - 6, 6, 146, standard(0x3d586b), 16);
    kit.cylinder(7, 7, 10, x + 12, 6, 146, pipeMat(), 12);
    const fan = kit.cylinder(8, 8, 2, x - 6, 18.2, 146, darkMetal, 16);
    const blades = kit.box(14, 1, 3, x - 6, 19, 146, basic(0x6b8497, { transparent: true, opacity: 0.8 }));
    pumpBlades.push(blades);
    kit.pipe(
      [
        [x + 18, 11, 146],
        [x + 28, 11, 146],
        [x + 28, 20, 146],
        [x + 28, 20, 180],
      ],
      1.4,
      0x56788f,
    );
    const gauge = kit.cylinder(2.2, 2.2, 6, x + 22, 14, 146, steel, 12);
    gauge.rotation.z = Math.PI / 2;
    gauge.position.set(x + 21, 20, 146);
    kit.led(x + 21, 23, 146.8, C.green, 0.7);
    void fan;
  });
  kit.pipe(
    [
      [-102, 8, 160],
      [80, 8, 160],
    ],
    2.2,
    0x56788f,
  );
  [-41, 15].forEach((x) => {
    const wheel = new THREE.Mesh(
      new THREE.TorusGeometry(2.6, 0.55, 5, 12),
      standard(0x8f3c3c, { metalness: 0.45, roughness: 0.45 }),
    );
    wheel.position.set(x, 11.5, 160);
    wheel.rotation.x = Math.PI / 2;
    kit.group.add(wheel);
  });
  kit.pipe(
    [
      [-100, 18, 180],
      [70, 18, 180],
    ],
    1.8,
    0x56788f,
  );
  kit.flow(
    [
      [-100, 18, 180],
      [70, 18, 180],
    ],
    { count: 3, speed: 20, color: C.pale, radius: 1.2 },
  );
  const pumpPanel = kit.box(22, 34, 16, 74, 2, 146, darkMetal);
  kit.edge(pumpPanel, C.pale, 0.3);
  kit.box(16, 8, 0.6, 74, 30, 154.2, basic(0x0b1824));
  kit.box(12, 5, 0.4, 74, 31.5, 154.8, additive(C.cyan, 0.5));
  kit.led(74, 24, 154.6, C.green, 0.9);
  signBoard(kit, "生活给水泵房", 74, 20, 155.0, 48, 8, C.pale);

  // 消防泵组（红）
  const redMetal = standard(0x8f3c3c, { metalness: 0.45, roughness: 0.45 });
  [126, 164].forEach((x) => {
    kit.box(34, 2, 30, x, 2, 146, darkMetal);
    kit.box(30, 4, 26, x, 2.2, 146, redMetal);
    kit.cylinder(10, 10, 12, x - 4, 6, 146, redMetal, 16);
    kit.cylinder(6, 6, 9, x + 12, 6, 146, steel, 12);
    kit.box(20, 1.2, 4, x - 4, 19, 146, redMetal);
    kit.pipe(
      [
        [x + 17, 12, 146],
        [x + 25, 12, 146],
        [x + 25, 20, 146],
        [x + 25, 20, 180],
      ],
      1.6,
      0x9f4444,
    );
  });
  kit.cylinder(7, 7, 8, 100, 2.2, 158, redMetal, 14);
  kit.cylinder(4, 4, 6, 100, 10.2, 158, steel, 12);
  const firePanel = kit.box(26, 40, 20, 202, 2, 146, redMetal);
  kit.edge(firePanel, C.pale, 0.25);
  kit.box(18, 8, 0.6, 202, 30, 156.2, basic(0x0b1824));
  kit.box(14, 5, 0.4, 202, 31.5, 156.8, additive(C.red, 0.45));
  kit.led(202, 36, 156.4, C.red, 1.0);
  kit.pipe(
    [
      [110, 18, 180],
      [190, 18, 180],
    ],
    2.2,
    0x9f4444,
  );
  kit.pipe(
    [
      [190, 18, 180],
      [190, 18, 196],
      [190, 58, 196],
    ],
    1.8,
    0x9f4444,
  );
  const fireWheel = new THREE.Mesh(
    new THREE.TorusGeometry(2.8, 0.6, 5, 12),
    redMetal,
  );
  fireWheel.position.set(158, 22, 180);
  fireWheel.rotation.x = Math.PI / 2;
  kit.group.add(fireWheel);
  kit.led(146, 23, 146, C.red, 1.3);
  signBoard(kit, "消防泵组", 145, 42, 160.3, 56, 9, C.red);

  // 箱式变电站与安全围栏
  const transformerMat = standard(0x2f4657, { metalness: 0.45, roughness: 0.45 });
  [262, 330].forEach((x, index) => {
    kit.box(38, 2, 30, x, 2, 146, darkMetal);
    const body = kit.box(34, 30, 26, x, 4, 146, transformerMat);
    kit.edge(body, C.pale, 0.28);
    for (let k = 0; k < 5; k++) {
      kit.box(2, 18, 18, x - 19 + k * 1.4, 10, 146, steel);
      kit.box(2, 18, 18, x + 19 - k * 1.4, 10, 146, steel);
    }
    [-9, 0, 9].forEach((dx) => kit.cylinder(2.4, 2.4, 9, x + dx, 34, 139, basic(0xc9d8e4, { transparent: true, opacity: 0.7 }), 10));
    kit.box(16, 8, 0.6, x, 20, 133.2, basic(0x0b1824));
    kit.box(11, 5, 0.4, x, 21.5, 132.7, additive(C.green, 0.5));
    kit.led(x + 13, 29, 133.4, index === 0 ? C.green : C.amber, 0.9);
  });
  const cageBase: THREE.Vector3[] = [];
  [26, 2.2].forEach((y) => {
    cageBase.push(
      new THREE.Vector3(218, y, 114),
      new THREE.Vector3(374, y, 114),
      new THREE.Vector3(374, y, 178),
      new THREE.Vector3(218, y, 178),
      new THREE.Vector3(218, y, 114),
    );
  });
  kit.group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(cageBase), lineMaterial(C.amber, 0.28)));
  for (let x = 218; x <= 374; x += 26) {
    kit.box(1.2, 24, 1.2, x, 2, 114, steel);
    kit.box(1.2, 24, 1.2, x, 2, 178, steel);
  }
  for (let z = 114; z <= 178; z += 21) {
    kit.box(1.2, 24, 1.2, 218, 2, z, steel);
    kit.box(1.2, 24, 1.2, 374, 2, z, steel);
  }
  [240, 352].forEach((x) => kit.box(1.6, 32, 1.6, x, 2, 179, steel));
  kit.box(110, 1.4, 1.6, 296, 26, 179, steel);
  signBoard(kit, "箱式变电站 · 高压危险", 296, 31, 179.6, 118, 11, C.amber);

  // ─── 电缆桥架与工艺管线 ────────────────────────────────
  const trayPoints1: Vec3[] = [
    [-380, 6, 60],
    [380, 6, 60],
  ];
  const trayPoints2: Vec3[] = [
    [-380, 42, 52],
    [380, 42, 52],
  ];
  [trayPoints1, trayPoints2].forEach((points) => {
    kit.pipe(points, 2.4, 0x3f5465, 0.85);
    kit.flow(points, { count: 4, speed: 30, color: C.pale, radius: 1.1, opacity: 0.75 });
  });
  for (let i = 0; i < 12; i++) {
    const x = -360 + i * 64;
    kit.line(
      [
        [x, 6, 60],
        [x, 0, 60],
      ],
      C.steel,
      0.3,
    );
  }

  // ─── 场地配景 ─────────────────────────────────────────
  [-470, 470].forEach((x) => {
    tree(kit, x, -240, 1, true);
    tree(kit, x, -130, 1, false);
    tree(kit, x, 30, 1, true);
    tree(kit, x, 230, 1, false);
  });
  [-360, -180, 0, 180, 360].forEach((x) => {
    kit.cylinder(1, 1, 18, x, 0, 246, steel, 6);
    kit.box(8, 1.2, 3, x, 18, 246, basic(C.pale, { transparent: true, opacity: 0.6 }));
  });
  fence(kit, 0, 0, 1000, 560);

  // ─── 厂区大门与人行入口 ────────────────────────────────
  kit.plane(46, 58, 0, 0.24, 302, basic(0x0d1a27, { transparent: true, opacity: 0.95 }));
  kit.line(
    [
      [0, 0.4, 278],
      [0, 0.4, 330],
    ],
    0x8fb6cc,
    0.32,
    true,
  );
  [-52, 52].forEach((x) => {
    const post = kit.box(6, 36, 6, x, 0, 281, standard(0x2c3f52));
    kit.edge(post, C.pale, 0.32);
    for (let k = 0; k < 4; k++) {
      kit.box(6.4, 1.4, 6.4, x, 6 + k * 6, 281, basic(C.amber, { transparent: true, opacity: 0.3 }));
    }
    kit.led(x, 37, 281, C.amber, 1.0);
  });
  kit.box(112, 2.6, 4, 0, 35, 281, standard(0x2c3f52));
  kit.box(108, 0.5, 2, 0, 37.6, 281, basic(C.cyan, { transparent: true, opacity: 0.4 }));
  signBoard(kit, "智能装备制造中心", 0, 42, 283.2, 100, 13, C.pale);
  [-66, 66].forEach((x, index) => {
    kit.box(30, 14, 1.2, x, 2, 281 + (index === 0 ? 0.8 : -0.8), standard(0x3b4e60));
    for (let k = 0; k < 7; k++) {
      kit.box(1, 13, 1.4, x - 13 + k * 4.3, 2.5, 281.8 + (index === 0 ? 0.8 : -0.8), steel);
    }
    kit.led(x + 14, 9, 282, C.green, 0.8);
  });
  const kiosk = kit.box(22, 17, 16, -78, 0, 264, standard(0x2c3f52));
  kit.edge(kiosk, C.pale, 0.32);
  kit.box(18, 9, 0.6, -78, 5, 272.3, glass(0x7dd3fc, 0.26));
  kit.box(24, 1.2, 18, -78, 17, 264, standard(0x3b4e60));
  kit.box(22, 0.4, 16, -78, 18.2, 264, basic(C.pale, { transparent: true, opacity: 0.35 }));
  signBoard(kit, "门卫 · GATE", -78, 22.5, 272.6, 34, 7, C.cyan);
  kit.led(-70, 12, 272.4, C.green, 0.8);
  kit.cylinder(1.8, 1.8, 12, 24, 0, 266, steel, 10);
  for (let i = 0; i < 6; i++) {
    kit.box(7, 1, 1, -18 + i * 7, 11, 266, basic(i % 2 === 0 ? C.pale : C.amber, { transparent: true, opacity: 0.55 }));
  }
  [-420, 420].forEach((x) => {
    kit.box(14, 3, 120, x, 0, -120, basic(0x14382f, { transparent: true, opacity: 0.85 }));
    for (let k = 0; k < 3; k++) {
      tree(kit, x + 24, -170 + k * 55, 0.9, k === 1);
    }
  });

  // ─── 夹层办公与参观走廊 ────────────────────────────────
  const deckMat = standard(0x2a3d4d, { metalness: 0.35, roughness: 0.6 });
  const mezzDeck = kit.box(150, 2, 46, -326, 24, -166, deckMat);
  kit.edge(mezzDeck, C.pale, 0.28);
  [-398, -326, -254].forEach((x) => {
    [-186, -146].forEach((z) => kit.box(3, 22, 3, x, 2, z, columnMat));
  });
  const mezzRail: THREE.Vector3[] = [];
  for (let i = 0; i <= 10; i++) {
    const x = -401 + i * 15;
    mezzRail.push(new THREE.Vector3(x, 26, -143), new THREE.Vector3(x, 32, -143));
  }
  mezzRail.push(new THREE.Vector3(-401, 32, -143), new THREE.Vector3(-251, 32, -143));
  kit.group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(mezzRail), lineMaterial(C.pale, 0.4)));
  const officeGlass = kit.box(100, 16, 34, -356, 26, -168, glass(0x4dd4ff, 0.12));
  kit.edge(officeGlass, C.pale, 0.3);
  for (let i = 0; i <= 6; i++) {
    kit.box(1.2, 16, 1.2, -406 + i * 16.6, 26, -150.9, steel);
  }
  kit.box(104, 1.2, 38, -356, 42, -168, standard(0x2a3d4d));
  kit.box(102, 0.4, 36, -356, 43.2, -168, basic(C.pale, { transparent: true, opacity: 0.25 }));
  signBoard(kit, "生产管理办公室", -356, 33, -150.7, 76, 8, C.cyan);
  kit.led(-316, 33, -149.9, C.green, 0.8);
  for (let i = 0; i < 4; i++) {
    kit.box(18, 0.4, 8, -386 + i * 22, 26.4, -165, basic(0xdbeafe, { transparent: true, opacity: 0.14 }));
  }
  const stairs: THREE.Group = new THREE.Group();
  kit.group.add(stairs);
  for (let i = 0; i < 11; i++) {
    kit.box(8, 2, 2.2, -265, 2 + i * 2, -120 - i * 2.2, steel, stairs);
    kit.box(1, 3, 1, -269.2, 4 + i * 2, -120 - i * 2.2, basic(C.amber, { transparent: true, opacity: 0.4 }), stairs);
    kit.box(1, 3, 1, -260.8, 4 + i * 2, -120 - i * 2.2, basic(C.amber, { transparent: true, opacity: 0.4 }), stairs);
  }
  kit.box(8, 0.4, 26, -265, 24, -138, steel);

  // ─── 质检中心（玻璃隔间） ─────────────────────────────
  const qcBase = kit.box(118, 2, 54, 302, 2, -160, standard(0x1d2f3e, { metalness: 0.3, roughness: 0.7 }));
  kit.edge(qcBase, C.pale, 0.25);
  const qcGlass = kit.box(114, 20, 50, 302, 4, -160, glass(0x7dd3fc, 0.14));
  kit.edge(qcGlass, C.pale, 0.35);
  for (let i = 0; i <= 5; i++) {
    kit.box(1.4, 20, 1.4, 248 + i * 21.6, 4, -134.9, steel);
  }
  kit.box(118, 1.4, 54, 302, 24, -160, standard(0x2a3d4d));
  kit.box(116, 0.4, 52, 302, 25.4, -160, basic(C.pale, { transparent: true, opacity: 0.3 }));
  for (let i = 0; i < 3; i++) {
    kit.box(30, 9, 14, 272 + i * 30, 4.4, -172, basic(0xdbeafe, { transparent: true, opacity: 0.12 }));
    kit.box(4, 5, 4, 272 + i * 30, 4.4, -170, steel);
  }
  signBoard(kit, "质检中心 · QC", 302, 32, -133.6, 88, 9, C.pale);

  // 设备节点 LED / 光环
  const nodeSpecs: Array<{ key: string; x: number; y: number; z: number }> = [
    { key: "elevator", x: 326, y: 140, z: -84 },
    { key: "ahu", x: 100, y: 58, z: -78 },
    { key: "chiller", x: 240, y: 56, z: -22 },
    { key: "compressor", x: -282, y: 34, z: 146 },
    { key: "switchgear", x: -150, y: 44, z: 146 },
    { key: "pump", x: -24, y: 25, z: 146 },
    { key: "firepump", x: 146, y: 25, z: 146 },
  ];
  const nodeLeds = new Map<string, THREE.Mesh>();
  const nodeGlows = new Map<string, THREE.Mesh>();
  nodeSpecs.forEach((node) => {
    const mesh = kit.led(node.x, node.y, node.z, C.cyan, 2);
    const glow = kit.glow(24, C.cyan, node.x, node.z, 1.6, 0.2);
    nodeLeds.set(node.key, mesh);
    nodeGlows.set(node.key, glow);
  });

  return {
    update(elapsed, data) {
      const info = data as DeviceSceneData | null;
      kit.update(elapsed);
      ahuFans.forEach((fan, index) => {
        fan.rotation.y = elapsed * (3 + index * 0.6);
      });
      pumpBlades.forEach((blade) => {
        blade.rotation.y = elapsed * 6;
      });
      chillerFanBlades.forEach((fan, index) => {
        fan.rotation.y = elapsed * (4.2 + index * 0.35);
      });
      wallFans.forEach((fan, index) => {
        fan.rotation.z = elapsed * (3.4 + index * 0.5);
      });
      roofFans.forEach((fan) => {
        fan.rotation.y = elapsed * 3.8;
      });
      robotArms.forEach((arm) => {
        const t = elapsed * 0.85 + arm.phase;
        arm.waist.rotation.y = Math.sin(t) * 1.15;
        arm.shoulder.rotation.x = -0.32 + Math.sin(t * 1.3) * 0.4;
        arm.elbow.rotation.x = -0.5 + Math.cos(t * 1.1) * 0.45;
        arm.wrist.rotation.z = Math.sin(t * 1.7) * 0.9;
      });
      crates.forEach((crate, index) => {
        crate.position.x = -390 + ((elapsed * 18 + index * 90) % 246);
      });
      if (craneBridge) {
        craneBridge.position.x = -70 + Math.sin(elapsed * 0.09) * 250;
      }
      if (craneTrolley) {
        craneTrolley.position.z = Math.sin(elapsed * 0.32) * 68;
      }
      agvCarts.forEach((cart) => {
        const span = 700;
        const travel = ((elapsed * cart.speed + cart.offset) % span + span) % span;
        cart.group.position.x = cart.dir > 0 ? -350 + travel : 350 - travel;
      });
      const cabY = Math.max(16, 53 + Math.sin(elapsed * 1.1) * 42);
      cab.position.y = cabY;
      cabLight.position.y = cabY + 14;
      if (elevatorCounterweight) {
        elevatorCounterweight.position.y = Math.min(114, Math.max(22, 149 - cabY));
      }

      info?.nodes?.forEach((node) => {
        const mesh = nodeLeds.get(node.key);
        const glow = nodeGlows.get(node.key);
        const color = LEVEL_HEX[node.level];
        if (mesh) {
          (mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
          mesh.scale.setScalar(1 + Math.sin(elapsed * 3.2 + node.health) * 0.12);
        }
        if (glow) {
          (glow.material as THREE.MeshBasicMaterial).color.setHex(color);
          (glow.material as THREE.MeshBasicMaterial).opacity =
            node.level === "ok" ? 0.12 : 0.28 + Math.sin(elapsed * 3.8) * 0.16;
        }
      });
      machineLeds.forEach((item, index) => {
        item.material.opacity = 0.55 + Math.sin(elapsed * 2.6 + index) * 0.3;
      });
    },
  };
}

function pipeMat() {
  return standard(0x56788f, { metalness: 0.65, roughness: 0.35 });
}
