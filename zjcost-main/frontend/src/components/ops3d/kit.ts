import * as THREE from "three";

/**
 * 厂区 3D 场景公共构件库。
 * 坐标约定：x / z 为地平面，y 为竖直方向；盒体的 y 参数表示“底面高度”。
 * 所有几何与材质由场景卸载时统一遍历释放，这里只负责快速搭建。
 */

export type Vec3 = [number, number, number];

export interface FlowOptions {
  count?: number;
  speed?: number;
  radius?: number;
  color?: number;
  opacity?: number;
}

const UP = new THREE.Vector3(0, 1, 0);

export function standard(color: number, options: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.35,
    roughness: 0.52,
    ...options,
  });
}

export function glass(color: number, opacity = 0.24, options: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity,
    metalness: 0.45,
    roughness: 0.35,
    emissive: new THREE.Color(color).multiplyScalar(0.16),
    depthWrite: false,
    side: THREE.DoubleSide,
    ...options,
  });
}

export function basic(color: number, options: THREE.MeshBasicMaterialParameters = {}) {
  return new THREE.MeshBasicMaterial({ color, ...options });
}

export function additive(color: number, opacity = 0.6) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

export function lineMaterial(color: number, opacity = 0.4, dashed = false) {
  if (dashed) {
    return new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 8, gapSize: 6 });
  }
  return new THREE.LineBasicMaterial({ color, transparent: true, opacity });
}

/** 径向渐变光晕贴图，用于地面泛光与设备光环 */
export function radialTexture(color: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const c = new THREE.Color(color);
    const rgb = `${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}`;
    const gradient = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
    gradient.addColorStop(0, `rgba(${rgb}, 0.55)`);
    gradient.addColorStop(0.4, `rgba(${rgb}, 0.2)`);
    gradient.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

interface FlowDot {
  mesh: THREE.Mesh;
}

export class SceneKit {
  readonly group = new THREE.Group();

  private flows: Array<{ dots: FlowDot[]; segments: THREE.Vector3[]; lengths: number[]; total: number; speed: number; gap: number }> = [];

  constructor() {
    this.group.name = "ops-scene";
  }

  /** 底面在 y 高度的长方体 */
  box(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
    parent: THREE.Object3D = this.group,
  ) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y + h / 2, z);
    parent.add(mesh);
    return mesh;
  }

  /** 圆柱体，底面在 y */
  cylinder(
    radiusTop: number,
    radiusBottom: number,
    h: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
    segments = 20,
    parent: THREE.Object3D = this.group,
  ) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, h, segments), material);
    mesh.position.set(x, y + h / 2, z);
    parent.add(mesh);
    return mesh;
  }

  edge(mesh: THREE.Mesh, color: number, opacity = 0.5) {
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
    );
    mesh.add(edges);
    return edges;
  }

  line(points: Vec3[], color: number, opacity = 0.45, dashed = false) {
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p)));
    const material = lineMaterial(color, opacity, dashed);
    const line = new THREE.Line(geometry, material);
    if (dashed) line.computeLineDistances();
    this.group.add(line);
    return line;
  }

  rect(x0: number, z0: number, x1: number, z1: number, y: number, color: number, opacity = 0.35, dashed = false) {
    return this.line(
      [
        [x0, y, z0],
        [x1, y, z0],
        [x1, y, z1],
        [x0, y, z1],
        [x0, y, z0],
      ],
      color,
      opacity,
      dashed,
    );
  }

  grid(w: number, d: number, step: number, y: number, color: number, opacity = 0.1) {
    const points: THREE.Vector3[] = [];
    for (let x = -w / 2; x <= w / 2 + 0.01; x += step) {
      points.push(new THREE.Vector3(x, y, -d / 2), new THREE.Vector3(x, y, d / 2));
    }
    for (let z = -d / 2; z <= d / 2 + 0.01; z += step) {
      points.push(new THREE.Vector3(-w / 2, y, z), new THREE.Vector3(w / 2, y, z));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
    this.group.add(lines);
    return lines;
  }

  plane(w: number, d: number, x: number, y: number, z: number, material: THREE.Material, parent: THREE.Object3D = this.group) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  glow(radius: number, color: number, x: number, z: number, y = 0.3, opacity = 0.7) {
    const material = new THREE.MeshBasicMaterial({
      map: radialTexture(color),
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 40), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    return mesh;
  }

  led(x: number, y: number, z: number, color: number, radius = 1.2, parent: THREE.Object3D = this.group) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 10, 10), additive(color, 0.95));
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  /** 正交管线：逐段圆柱 + 节点球，视觉上比 CatmullRom 更“工程” */
  pipe(points: Vec3[], radius: number, color: number, opacity = 0.85) {
    const material = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.55,
      roughness: 0.35,
      transparent: true,
      opacity,
      emissive: new THREE.Color(color).multiplyScalar(0.12),
    });
    const group = new THREE.Group();
    const vectors = points.map((p) => new THREE.Vector3(...p));
    for (let i = 0; i < vectors.length - 1; i++) {
      const a = vectors[i];
      const b = vectors[i + 1];
      const length = a.distanceTo(b);
      if (length < 0.01) continue;
      const segment = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 10), material);
      segment.position.copy(a).add(b).multiplyScalar(0.5);
      segment.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
      group.add(segment);
    }
    for (const point of vectors) {
      const joint = new THREE.Mesh(new THREE.SphereGeometry(radius, 10, 8), material);
      joint.position.copy(point);
      group.add(joint);
    }
    this.group.add(group);
    return group;
  }

  /** 沿折线流动的光点，自动按弧长匀速运动 */
  flow(points: Vec3[], options: FlowOptions = {}) {
    const { count = 2, speed = 28, radius = 1.6, color = 0x7de9ff, opacity = 0.95 } = options;
    const vectors = points.map((p) => new THREE.Vector3(...p));
    const lengths: number[] = [];
    let total = 0;
    for (let i = 0; i < vectors.length - 1; i++) {
      const length = vectors[i].distanceTo(vectors[i + 1]);
      lengths.push(length);
      total += length;
    }
    if (total < 0.01) return;

    const material = additive(color, opacity);
    const dots: FlowDot[] = [];
    const geometry = new THREE.SphereGeometry(radius, 8, 8);
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geometry, material);
      this.group.add(mesh);
      dots.push({ mesh });
    }

    const flow = {
      dots,
      segments: vectors,
      lengths,
      total,
      speed,
      gap: total / Math.max(count, 1),
    };
    this.flows.push(flow);

    const apply = (flowItem: typeof flow, elapsed: number) => {
      const base = elapsed * flowItem.speed;
      flowItem.dots.forEach((dot, index) => {
        let distance = (base + index * flowItem.gap) % flowItem.total;
        let segmentIndex = 0;
        while (segmentIndex < flowItem.lengths.length && distance > flowItem.lengths[segmentIndex]) {
          distance -= flowItem.lengths[segmentIndex];
          segmentIndex++;
        }
        const start = flowItem.segments[Math.min(segmentIndex, flowItem.segments.length - 2)];
        const end = flowItem.segments[Math.min(segmentIndex + 1, flowItem.segments.length - 1)];
        const segmentLength = Math.max(flowItem.lengths[segmentIndex] ?? 1, 0.001);
        dot.mesh.position.copy(start).lerp(end, Math.min(distance / segmentLength, 1));
      });
    };

    apply(flow, 0);
    this.flowAppliers.push((elapsed) => apply(flow, elapsed));
  }

  private flowAppliers: Array<(elapsed: number) => void> = [];

  update(elapsed: number) {
    this.flowAppliers.forEach((apply) => apply(elapsed));
  }
}

/** 生成厂区标牌：深色半透明底板 + 发光边线 + 中文/英文标字 */
export function signBoard(
  kit: SceneKit,
  text: string,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  color = 0x9ff2ff,
  rotationY = 0,
  parent: THREE.Object3D = kit.group,
) {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const c = new THREE.Color(color);
    const rgb = `${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}`;
    ctx.fillStyle = "rgba(5, 20, 34, 0.9)";
    ctx.fillRect(6, 12, 628, 104);
    ctx.strokeStyle = `rgba(${rgb}, 0.78)`;
    ctx.lineWidth = 3;
    ctx.strokeRect(6, 12, 628, 104);
    ctx.fillStyle = `rgba(${rgb}, 0.95)`;
    ctx.fillRect(6, 12, 8, 104);
    ctx.fillRect(6, 112, 628, 3);
    ctx.font = "700 56px 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(226, 248, 255, 0.96)";
    ctx.fillText(text, 322, 66, 560);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotationY;
  parent.add(mesh);
  return mesh;
}

/** 地面分区 / 导向文字：平铺在水平面上的发光标线 */
export function floorLabel(
  kit: SceneKit,
  text: string,
  x: number,
  z: number,
  width: number,
  height: number,
  color = 0x9ff2ff,
  opacity = 0.45,
  rotation = 0,
  y = 2.24,
  parent: THREE.Object3D = kit.group,
) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const c = new THREE.Color(color);
    const rgb = `${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}`;
    ctx.strokeStyle = `rgba(${rgb}, ${Math.min(1, opacity + 0.16)})`;
    ctx.lineWidth = 3;
    ctx.strokeRect(10, 26, 492, 76);
    ctx.fillStyle = `rgba(${rgb}, ${Math.min(1, opacity + 0.32)})`;
    ctx.font = "700 52px 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 256, 64, 452);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  mesh.rotation.set(-Math.PI / 2, 0, rotation);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

/** 生成锯齿屋面的斜面板，返回顶面高度 */
export function addSawtoothRoof(
  kit: SceneKit,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  baseY: number,
  step: number,
  material: THREE.Material,
  glowMaterial: THREE.Material,
) {
  const width = x1 - x0;
  const depth = z1 - z0;
  const rows = Math.max(1, Math.round(depth / step));
  for (let row = 0; row < rows; row++) {
    const z = z0 + (depth * row) / rows;
    const rowDepth = depth / rows;
    const slope = new THREE.Mesh(new THREE.PlaneGeometry(width, Math.hypot(rowDepth * 1.08, 9)), material);
    slope.rotation.x = -Math.PI / 2 + 0.22;
    slope.position.set((x0 + x1) / 2, baseY + 4 + (row % 2) * 0.4, z + rowDepth / 2);
    kit.group.add(slope);

    // 锯齿竖向采光带
    const skylight = new THREE.Mesh(new THREE.PlaneGeometry(width, 7), glowMaterial);
    skylight.position.set((x0 + x1) / 2, baseY + 2 + (row % 2), z + 0.4);
    kit.group.add(skylight);
  }
}
