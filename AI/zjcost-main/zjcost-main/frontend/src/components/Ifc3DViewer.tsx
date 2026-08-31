import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { isWeakGpuDevice } from "../utils/deviceCapability";

import { Button, Segmented, Select, Tooltip } from "antd";

import {

  CloseOutlined,

  DownOutlined,

  LeftOutlined,

  RightOutlined,

  SettingOutlined,

  UpOutlined,

} from "@ant-design/icons";

import * as THREE from "three";

import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";

import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";

import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";


import {
  buildDigitalShowroom,
  addShowroomMurals,
  addHallGuideArrows,
  type BuiltShowroom,
  type ShowroomInteractable,
  type ShowroomZone,
  type ShowroomZoneId,
  SHOWROOM_GUIDE_LINES,
  getZoneById,
} from "./DigitalShowroom";



const AAA_BLOOM_THRESHOLD = 0.93;

const AAA_BLOOM_STRENGTH = 0.16;

const AAA_BLOOM_RADIUS = 0.24;

const AAA_VIGNETTE_INTENSITY = 0.16;

const AAA_SATURATION = 1.02;

const AAA_CONTRAST = 1.03;



const FilmGradingShader = {

  uniforms: {

    tDiffuse: { value: null },

    saturation: { value: 1.0 },

    contrast: { value: 1.0 },

    brightness: { value: 1.0 },

    vignetteIntensity: { value: 0.0 },

  },

  vertexShader: `

    varying vec2 vUv;

    void main() {

      vUv = uv;

      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

    }

  `,

  fragmentShader: `

    uniform sampler2D tDiffuse;

    uniform float saturation;

    uniform float contrast;

    uniform float brightness;

    uniform float vignetteIntensity;

    varying vec2 vUv;



    void main() {

      vec4 tex = texture2D(tDiffuse, vUv);

      vec3 color = tex.rgb * brightness;

      color = (color - 0.5) * contrast + 0.5;

      vec3 gray = vec3(dot(color, vec3(0.299, 0.587, 0.114)));

      color = mix(gray, color, saturation);



      vec2 center = vUv - 0.5;

      float vign = smoothstep(0.55, 1.1, length(center));

      color *= 1.0 - vign * vignetteIntensity;



      color = pow(color, vec3(0.98));

      gl_FragColor = vec4(color, tex.a);

    }

  `,

};



const MAX_PREVIEW_ELEMENTS = 20000;

const LARGE_MODEL_THRESHOLD = 6000;

const EDGE_RENDER_LIMIT = 1200;

const LARGE_MODEL_EDGE_RENDER_LIMIT = 900;

const MESH_EDGE_RENDER_LIMIT = 120;

const LARGE_MODEL_MESH_EDGE_RENDER_LIMIT = 220;

const MAX_PIXEL_RATIO = 2.0;

const LARGE_MODEL_MAX_PIXEL_RATIO = 1.5;

const DRAG_MIN_PIXEL_RATIO = 1.0;

const DRAG_LARGE_MODEL_MIN_PIXEL_RATIO = 0.75;

const MODEL_MERGE_MIN_ELEMENTS = 800;

const WALK_PROXIMITY_RADIUS = 3.0;

const WALK_SPEED = 5.8;

const WALK_RUN_MULTIPLIER = 1.65;

const WALK_AVATAR_TURN_SPEED = 10;

const WALK_AVATAR_HEIGHT = 1.92;

const WALK_CAMERA_LERP = 60.0;

const WALK_COLLISION_RADIUS = 0.28;

const WALK_COLLISION_HEIGHT = 1.55;

const WALK_COLLISION_PADDING = 0.05;

const WALK_GRAVITY = 17.5;

const WALK_JUMP_SPEED = 5.8;

const WALK_SCAN_INTERVAL_MS = 80;

const WALK_INSPECTABLE_LIMIT = 2400;

const WALK_FIRST_PERSON_EYE_HEIGHT = 1.92;

const WALK_FIRST_PERSON_FORWARD_OFFSET = 0.08;

const WALK_PITCH_MIN = -1.2;

const WALK_PITCH_MAX = 1.05;

const WALK_MOUSE_SENSITIVITY_X = 0.0026;

const WALK_MOUSE_SENSITIVITY_Y = 0.0022;

const WALK_CAMERA_DISTANCE = 3.05;

const WALK_CAMERA_RUN_DISTANCE = 3.45;

const WALK_CAMERA_SHOULDER_OFFSET = 0.52;

const WALK_CAMERA_VERTICAL_OFFSET = 0.34;

const WALK_CAMERA_AIM_HEIGHT = 1.62;

const WALK_CAMERA_AIM_DISTANCE = 18;

const WALK_MOBILE_CAMERA_DISTANCE = 4.3;

const WALK_MOBILE_CAMERA_RUN_DISTANCE = 4.75;

const WALK_MOBILE_CAMERA_SHOULDER_OFFSET = 0.12;

const WALK_MOBILE_CAMERA_VERTICAL_OFFSET = 0.68;

const WALK_MOBILE_CAMERA_AIM_HEIGHT = 1.76;

const WALK_MOBILE_CAMERA_FOV = 72;

const WALK_CAMERA_COLLISION_BUFFER = 0.35;

const WALK_CAMERA_THIRD_PERSON_FOV = 68;

const WALK_CAMERA_FIRST_PERSON_FOV = 74;

const WALK_CAMERA_RUN_FOV_BOOST = 4;

const WALK_CINEMATIC_SUN_DIRECTION = new THREE.Vector3(-1.9, -2.35, 1.65);

const WALK_SHADOW_MAP_SIZE = 2048;

const FLY_SPEED = 12.0;

const FLY_RUN_MULTIPLIER = 2.0;

const FLY_VERTICAL_SPEED = 8.0;

const AUTO_CRUISE_TRANSITION_SECONDS = 4.5;

const AUTO_CRUISE_ISSUE_THRESHOLD = 5.0;

interface AutoCruiseWaypoint {
  position: [number, number, number];
  target: [number, number, number];
  staySeconds: number;
  label: string;
}

const AUTO_CRUISE_WAYPOINTS: AutoCruiseWaypoint[] = [
  { position: [-1.1, -8.5, 0.02], target: [-1.1, 0, 1.6], staySeconds: 3.5, label: "丝路序厅" },
  { position: [-1.1, -1, 0.02], target: [-7, 3, 1.6], staySeconds: 3.0, label: "中央大厅" },
  { position: [-5, 3, 0.02], target: [-8, 5.5, 2.0], staySeconds: 3.5, label: "边塞雄关展区" },
  { position: [3, 4, 0.02], target: [7, 5.5, 2.0], staySeconds: 3.5, label: "西域佛光展区" },
  { position: [5, -2, 0.02], target: [5, -5.5, 1.6], staySeconds: 3.5, label: "大漠遗珍展区" },
  { position: [-1.1, -5, 0.02], target: [-1.1, -8.5, 1.6], staySeconds: 3.0, label: "返回序厅" },
];

type WalkIssueSeverity = "info" | "warning" | "error";

interface WalkIssuePoint {
  position: [number, number, number];
  component: string;
  description: string;
  severity: WalkIssueSeverity;
}

const WALK_ISSUE_POINTS: WalkIssuePoint[] = [
  { position: [-7.8, -4.8, 1.5], component: "西南角钢筋混凝土柱", description: "柱表面存在蜂窝麻面，需进行修补处理。", severity: "warning" },
  { position: [-6.8, -0.4, 2.0], component: "吊顶内矩形送风管", description: "风管连接处密封胶条老化，存在漏风风险。", severity: "error" },
  { position: [-1.2, 1.8, 1.5], component: "中庭结构柱", description: "柱垂直度偏差 8mm，超出规范允许范围。", severity: "warning" },
  { position: [0.88, -1.2, 1.5], component: "会议室单扇门", description: "门框与墙体间存在缝隙，需打胶密封。", severity: "info" },
];

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const buildModelRomanNamePattern = () =>

  [116, 105, 97, 110, 119, 101, 105, 100, 111, 110, 103].reduce(

    (name, code) => name + String.fromCharCode(code),

    "",

  ) + "2?";

const MODEL_ROMAN_NAME_PATTERN = buildModelRomanNamePattern();

const MODEL_PERSON_NAME_PATTERN = new RegExp("\\u7530\\u7ef4\\u4e1c2?|" + MODEL_ROMAN_NAME_PATTERN, "gi");

type OrientationMode = "raw" | "z-up";

type ViewMode = "explode" | "model" | "grid" | "walk";

type RenderMode = "transparent" | "solid";

type QualityMode = "cinematic" | "balanced" | "performance";

type WalkCameraMode = "first" | "third";

type WalkMotionState = "idle" | "walk" | "run";

type ProceduralTextureKind = "floor" | "wall" | "concrete" | "wood" | "glass" | "metal" | "duct" | "ground" | "roof" | "generic";

// 博物馆公共建筑主题材质开关：仅模型漫游（WalkVerify）页面启用，
// 用于统一棕色外立面、长城肌理女儿墙与场地分区材质，不影响其它页面的默认材质。
let museumMaterialThemeActive = false;

function setMuseumMaterialTheme(active: boolean) {

  museumMaterialThemeActive = active;

}

type DisposableSceneResource = { dispose: () => void };



export interface Element3D {

  id: string;

  label: string;

  name: string;

  type: string;

  element_type?: string;

  predefined_type?: string;

  object_type?: string;

  description?: string;

  material?: string;

  count?: number;

  unit?: string;

  quantity_estimate?: number;

  confidence?: number;

  pset_keys?: string[];

  length: number;

  width: number;

  height: number;

  thickness?: number;

  area?: number;

  volume?: number;

  pos_x: number;

  pos_y: number;

  pos_z: number;

  mesh_vertices?: number[];

  mesh_indices?: number[];

  mesh_kind?: string;

}



interface Props {

  elements: Element3D[];

  style?: React.CSSProperties;

  initialViewMode?: ViewMode;

  presentationMode?: boolean;

  sceneTitle?: string;

  onExitWalkMode?: () => void;

  materialTheme?: "museum";

}



interface SceneItem {

  element: Element3D;

  mesh: THREE.Mesh;

  material: THREE.MeshStandardMaterial;

  baseOpacity: number;

  bounds: THREE.Box3;

}



interface WalkBounds {

  minX: number;

  maxX: number;

  minY: number;

  maxY: number;

}



interface BuildingCluster {

  items: SceneItem[];

  bounds: THREE.Box3;

  center: THREE.Vector3;

  size: THREE.Vector3;

  footprintArea: number;

}



interface AvatarRig {

  avatar: THREE.Group;

  leftLeg: THREE.Mesh;

  rightLeg: THREE.Mesh;

  leftArm: THREE.Mesh;

  rightArm: THREE.Mesh;

  disposables: DisposableSceneResource[];

}



interface MaterialProfile {

  color: number;

  texture: ProceduralTextureKind;

  roughness: number;

  metalness: number;

  opacityFactor?: number;

  bumpScale?: number;

}



function clamp(value: number, min: number, max: number) {

  return Math.max(min, Math.min(max, value));

}



function wrapRadians(value: number) {

  return Math.atan2(Math.sin(value), Math.cos(value));

}



function approachAngle(current: number, target: number, maxStep: number) {

  const diff = wrapRadians(target - current);

  if (Math.abs(diff) <= maxStep) {

    return target;

  }

  return current + Math.sign(diff) * maxStep;

}



function easeFactor(deltaSeconds: number, strength: number) {

  return 1 - Math.exp(-strength * deltaSeconds);

}



function headingCardinal(degrees: number) {

  const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

  return labels[Math.round(degrees / 45) % labels.length];

}



function isIfcType(element: Element3D, types: string[]) {

  return types.includes(element.type);

}



function elementSearchText(element: Element3D) {

  return [

    element.type,

    element.element_type,

    element.predefined_type,

    element.object_type,

    element.label,

    element.name,

    element.material,

  ].filter(Boolean).join(" ").toLowerCase();

}

function elementTypeKey(element: Element3D) {
  return (
    element.element_type
    || element.type
    || element.object_type
    || element.predefined_type
    || element.label
    || "Unclassified"
  );
}



function elementMaterialKind(element: Element3D): ProceduralTextureKind {

  const text = elementSearchText(element);

  if (isIfcType(element, ["IfcDoor"]) || text.includes("door")) return "wood";

  if (isIfcType(element, ["IfcWindow", "IfcCurtainWall"]) || text.includes("window") || text.includes("glass")) return "glass";

  if (isRoofLikeSurface(element)) return "roof";

  if (isIfcType(element, ["IfcSlab", "IfcCovering"]) || text.includes("floor") || text.includes("tile")) return "floor";

  if (isIfcType(element, ["IfcWall", "IfcWallStandardCase"]) || text.includes("wall")) return "wall";

  if (isIfcType(element, ["IfcPipeSegment", "IfcPipeFitting", "IfcCableCarrierSegment", "IfcCableCarrierFitting"]) || text.includes("pipe")) return "metal";

  if (isIfcType(element, ["IfcDuctSegment", "IfcDuctFitting"]) || text.includes("duct")) return "duct";

  if (isIfcType(element, ["IfcColumn", "IfcBeam", "IfcMember", "IfcFooting", "IfcPile", "IfcStair", "IfcStairFlight", "IfcRamp"]) || text.includes("concrete")) return "concrete";

  return "generic";

}



// 博物馆公共建筑主题材质：棕色装饰外立面、长城肌理女儿墙、
// 市政道路 / 景观水池 / 绿植造景 / 硬化铺装分区材质。
function museumMaterialProfile(element: Element3D, kind: ProceduralTextureKind): MaterialProfile | null {

  const text = elementSearchText(element);

  // 场地分区元素（由模型漫游页按场景注入，材质字段含中文关键词）
  if (text.includes("沥青") || text.includes("asphalt") || text.includes("市政道路")) {

    return { color: 0x3c4148, texture: "ground", roughness: 0.9, metalness: 0.02, bumpScale: 0.02 };

  }

  if (text.includes("景观水池") || text.includes("水景") || text.includes("水面") || text.includes("water pool")) {

    return { color: 0x2f7fc4, texture: "glass", roughness: 0.08, metalness: 0.05, opacityFactor: 0.55 };

  }

  if (text.includes("绿植") || text.includes("绿化") || text.includes("绿篱") || text.includes("草坪") || text.includes("green")) {

    return { color: 0x4d7a3a, texture: "wall", roughness: 0.9, metalness: 0.0, bumpScale: 0.03 };

  }

  if (text.includes("铺装") || text.includes("地砖") || text.includes("广场砖") || text.includes("透水砖") || text.includes("硬化")) {

    return { color: 0x9b968c, texture: "floor", roughness: 0.6, metalness: 0.03, bumpScale: 0.02 };

  }

  // 女儿墙：棕色仿古砌筑，配合凹凸垛口造型
  if (text.includes("女儿墙") || text.includes("parapet")) {

    return { color: 0x7d4f30, texture: "wall", roughness: 0.8, metalness: 0.02, bumpScale: 0.03 };

  }

  if (kind === "wall") {

    // 博物馆外立面：统一棕色装饰建材
    return { color: 0x8a5736, texture: kind, roughness: 0.72, metalness: 0.03, bumpScale: 0.02 };

  }

  if (kind === "roof") {

    return { color: 0x6e4a30, texture: kind, roughness: 0.7, metalness: 0.03, bumpScale: 0.02 };

  }

  return null;

}

function componentMaterialProfile(element: Element3D): MaterialProfile {

  const kind = elementMaterialKind(element);

  if (museumMaterialThemeActive) {

    const themed = museumMaterialProfile(element, kind);

    if (themed) return themed;

  }

  switch (kind) {

    case "floor":

      return { color: 0xb9b5ad, texture: kind, roughness: 0.48, metalness: 0.05, bumpScale: 0.01 };

    case "wall":

      return { color: 0xd8d4cb, texture: kind, roughness: 0.76, metalness: 0.02, bumpScale: 0.014 };

    case "concrete":

      return { color: 0xbcc0ba, texture: kind, roughness: 0.72, metalness: 0.04, bumpScale: 0.018 };

    case "wood":

      return { color: 0x8e6644, texture: kind, roughness: 0.48, metalness: 0.03, bumpScale: 0.024 };

    case "roof":

      return { color: 0xc9ced4, texture: kind, roughness: 0.62, metalness: 0.04, bumpScale: 0.016 };

    case "glass":

      return { color: 0xc7dceb, texture: kind, roughness: 0.1, metalness: 0.0, opacityFactor: 0.18 };

    case "metal":

      return { color: 0xa8afb4, texture: kind, roughness: 0.2, metalness: 0.85, bumpScale: 0.008 };

    case "duct":

      return { color: 0xb4bac0, texture: kind, roughness: 0.26, metalness: 0.7, bumpScale: 0.006 };

    default:

      return {

        color: 0xc6c2ba,

        texture: "generic",

        roughness: 0.66,

        metalness: 0.08,

        bumpScale: 0.012,

      };

  }

}



function colorStyle(hex: number, alpha = 1) {

  const color = new THREE.Color(hex);

  return `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${alpha})`;

}



function drawTextureNoise(ctx: CanvasRenderingContext2D, width: number, height: number, alpha: number, seed: number) {

  let state = seed >>> 0;

  const next = () => {

    state = (state * 1664525 + 1013904223) >>> 0;

    return state / 0xffffffff;

  };

  const image = ctx.getImageData(0, 0, width, height);

  for (let i = 0; i < image.data.length; i += 4) {

    const delta = (next() - 0.5) * 255 * alpha;

    image.data[i] = Math.max(0, Math.min(255, image.data[i] + delta));

    image.data[i + 1] = Math.max(0, Math.min(255, image.data[i + 1] + delta));

    image.data[i + 2] = Math.max(0, Math.min(255, image.data[i + 2] + delta));

  }

  ctx.putImageData(image, 0, 0);

}



function createProceduralTexture(kind: ProceduralTextureKind) {

  const canvas = document.createElement("canvas");

  const size = 512;

  canvas.width = size;

  canvas.height = size;

  const ctx = canvas.getContext("2d");

  if (!ctx) {

    return new THREE.CanvasTexture(canvas);

  }



  const baseColor = {

    floor: 0xa8a49c,
    wall: 0xd8d4cb,
    concrete: 0xbcc0ba,
    wood: 0x8e6644,
    glass: 0x9fc4d8,
    metal: 0xa8afb4,
    duct: 0xb4bac0,
    ground: 0x6b7a5b,
    roof: 0xc2c8cc,
    generic: 0xc6c2ba,

  }[kind];



  ctx.fillStyle = colorStyle(baseColor);

  ctx.fillRect(0, 0, size, size);

  drawTextureNoise(ctx, size, size, kind === "glass" ? 0.035 : 0.07, kind.length * 97);



  if (kind === "floor") {

    const random = seededRandom(3157);

    for (let i = 0; i < 18; i += 1) {

      const x = random() * size;

      const y = random() * size;

      const radiusX = size * (0.12 + random() * 0.26);

      const radiusY = size * (0.08 + random() * 0.2);

      const gradient = ctx.createRadialGradient(x, y, 0, x, y, Math.max(radiusX, radiusY));

      gradient.addColorStop(0, random() > 0.5 ? "rgba(255, 255, 255, 0.055)" : "rgba(28, 36, 44, 0.045)");

      gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

      ctx.fillStyle = gradient;

      ctx.beginPath();

      ctx.ellipse(x, y, radiusX, radiusY, random() * Math.PI, 0, Math.PI * 2);

      ctx.fill();

    }

    ctx.strokeStyle = "rgba(38, 45, 48, 0.12)";

    ctx.lineWidth = 1;

    for (let p = 138; p < size; p += 184) {

      ctx.beginPath();

      ctx.moveTo(p + random() * 8 - 4, 0);

      ctx.lineTo(p + random() * 12 - 6, size);

      ctx.stroke();

    }

    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";

    for (let p = 156; p < size; p += 212) {

      ctx.beginPath();

      ctx.moveTo(0, p + random() * 8 - 4);

      ctx.lineTo(size, p + random() * 12 - 6);

      ctx.stroke();

    }

    ctx.fillStyle = "rgba(20, 28, 32, 0.12)";

    for (let i = 0; i < 70; i += 1) {

      const x = random() * size;

      const y = random() * size;

      const mark = 0.6 + random() * 1.4;

      ctx.beginPath();

      ctx.ellipse(x, y, mark, mark * (0.35 + random() * 0.4), random() * Math.PI, 0, Math.PI * 2);

      ctx.fill();

    }

  } else if (kind === "wall") {

    ctx.strokeStyle = "rgba(105, 95, 82, 0.2)";

    ctx.lineWidth = 2;

    for (let y = 36; y < size; y += 44) {

      ctx.beginPath();

      ctx.moveTo(0, y);

      ctx.lineTo(size, y + Math.sin(y) * 3);

      ctx.stroke();

    }

    ctx.fillStyle = "rgba(255, 255, 255, 0.13)";

    ctx.fillRect(0, 0, size, 18);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";

    ctx.lineWidth = 1;

    for (let x = 16; x < size; x += 29) {

      ctx.beginPath();

      ctx.moveTo(x, 0);

      ctx.bezierCurveTo(x + 6, 58, x - 7, 142, x + 4, size);

      ctx.stroke();

    }

  } else if (kind === "concrete") {

    ctx.strokeStyle = "rgba(54, 65, 82, 0.22)";

    ctx.lineWidth = 1.5;

    for (let i = 0; i < 18; i += 1) {

      const y = (i * 41 + 17) % size;

      ctx.beginPath();

      ctx.moveTo((i * 19) % size, y);

      ctx.lineTo(((i * 19) + 70) % size, y + 18 - (i % 3) * 8);

      ctx.stroke();

    }

    ctx.fillStyle = "rgba(30, 41, 59, 0.22)";

    for (let i = 0; i < 70; i += 1) {

      const x = (i * 37 + 11) % size;

      const y = (i * 53 + 23) % size;

      ctx.fillRect(x, y, i % 4 === 0 ? 2 : 1, 1);

    }

    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";

    for (let i = 0; i < 9; i += 1) {

      const y = (i * 31 + 18) % size;

      ctx.beginPath();

      ctx.moveTo(0, y);

      ctx.lineTo(size, y + Math.sin(i) * 8);

      ctx.stroke();

    }

  } else if (kind === "wood") {

    ctx.strokeStyle = "rgba(61, 35, 16, 0.32)";

    ctx.lineWidth = 2;

    for (let x = 14; x < size; x += 18) {

      ctx.beginPath();

      for (let y = 0; y <= size; y += 16) {

        const px = x + Math.sin((y + x) * 0.05) * 5;

        if (y === 0) ctx.moveTo(px, y);

        else ctx.lineTo(px, y);

      }

      ctx.stroke();

    }

    ctx.strokeStyle = "rgba(255, 221, 169, 0.2)";

    for (let x = 8; x < size; x += 48) {

      ctx.beginPath();

      ctx.moveTo(x, 0);

      ctx.lineTo(x + 8, size);

      ctx.stroke();

    }

    ctx.strokeStyle = "rgba(63, 32, 14, 0.38)";

    ctx.lineWidth = 1.4;

    for (let i = 0; i < 5; i += 1) {

      const cx = 38 + i * 44;

      const cy = 58 + ((i * 37) % 120);

      ctx.beginPath();

      ctx.ellipse(cx, cy, 12, 5, 0.4, 0, Math.PI * 2);

      ctx.stroke();

      ctx.beginPath();

      ctx.ellipse(cx + 2, cy, 5, 2, 0.4, 0, Math.PI * 2);

      ctx.stroke();

    }

  } else if (kind === "glass") {

    ctx.fillStyle = "rgba(76, 118, 140, 0.18)";

    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = "rgba(177, 224, 238, 0.26)";

    ctx.lineWidth = 4;

    ctx.beginPath();

    ctx.moveTo(22, size);

    ctx.lineTo(size, 34);

    ctx.stroke();

    ctx.strokeStyle = "rgba(18, 55, 84, 0.46)";

    ctx.lineWidth = 2;

    for (let p = 0; p < size; p += 64) {

      ctx.strokeRect(p, 0, 1, size);

    }

    ctx.strokeStyle = "rgba(231, 181, 114, 0.2)";

    ctx.lineWidth = 2;

    ctx.beginPath();

    ctx.moveTo(0, 46);

    ctx.lineTo(size, 6);

    ctx.stroke();

    ctx.beginPath();

    ctx.moveTo(0, 132);

    ctx.lineTo(size, 92);

    ctx.stroke();

  } else if (kind === "metal" || kind === "duct") {

    ctx.strokeStyle = kind === "duct" ? "rgba(75, 85, 99, 0.36)" : "rgba(30, 41, 59, 0.32)";

    ctx.lineWidth = 3;

    for (let y = 24; y < size; y += kind === "duct" ? 42 : 34) {

      ctx.beginPath();

      ctx.moveTo(0, y);

      ctx.lineTo(size, y);

      ctx.stroke();

    }

    ctx.fillStyle = "rgba(255, 255, 255, 0.2)";

    for (let x = 18; x < size; x += 52) {

      for (let y = 18; y < size; y += 52) {

        ctx.beginPath();

        ctx.arc(x, y, 2, 0, Math.PI * 2);

        ctx.fill();

      }

    }

    ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";

    ctx.lineWidth = 1;

    for (let i = 0; i < 18; i += 1) {

      const y = (i * 17 + 9) % size;

      ctx.beginPath();

      ctx.moveTo(0, y);

      ctx.lineTo(size, y + 18);

      ctx.stroke();

    }

    ctx.strokeStyle = "rgba(15, 23, 42, 0.18)";

    for (let x = 0; x <= size; x += kind === "duct" ? 84 : 96) {

      ctx.beginPath();

      ctx.moveTo(x, 0);

      ctx.lineTo(x, size);

      ctx.stroke();

    }

  } else if (kind === "ground") {

    const random = seededRandom(7419);

    ctx.fillStyle = "rgba(38, 49, 42, 0.74)";

    ctx.fillRect(0, 0, size, size);

    for (let i = 0; i < 28; i += 1) {

      const x = random() * size;

      const y = random() * size;

      const radiusX = size * (0.08 + random() * 0.22);

      const radiusY = size * (0.05 + random() * 0.18);

      const gradient = ctx.createRadialGradient(x, y, 0, x, y, Math.max(radiusX, radiusY));

      const green = 58 + Math.round(random() * 36);

      const warm = 46 + Math.round(random() * 26);

      gradient.addColorStop(0, `rgba(${warm}, ${green}, ${42 + Math.round(random() * 18)}, ${0.18 + random() * 0.2})`);

      gradient.addColorStop(1, "rgba(31, 39, 34, 0)");

      ctx.fillStyle = gradient;

      ctx.beginPath();

      ctx.ellipse(x, y, radiusX, radiusY, random() * Math.PI, 0, Math.PI * 2);

      ctx.fill();

    }

    ctx.strokeStyle = "rgba(156, 148, 128, 0.1)";

    ctx.lineWidth = 1;

    for (let i = 0; i < 34; i += 1) {

      const y = random() * size;

      ctx.beginPath();

      ctx.moveTo(random() * size * 0.18, y);

      for (let x = 0; x <= size; x += 42) {

        ctx.lineTo(x, y + Math.sin((x + i * 19) * 0.026) * 10 + (random() - 0.5) * 9);

      }

      ctx.stroke();

    }

    ctx.fillStyle = "rgba(14, 18, 16, 0.24)";

    for (let i = 0; i < 180; i += 1) {

      const x = random() * size;

      const y = random() * size;

      const pebble = 0.7 + random() * 1.8;

      ctx.beginPath();

      ctx.ellipse(x, y, pebble, pebble * (0.45 + random() * 0.55), random() * Math.PI, 0, Math.PI * 2);

      ctx.fill();

    }

  } else {

    ctx.strokeStyle = "rgba(15, 23, 42, 0.24)";

    ctx.lineWidth = 2;

    ctx.strokeRect(18, 18, size - 36, size - 36);

  }



  const texture = new THREE.CanvasTexture(canvas);

  texture.colorSpace = THREE.SRGBColorSpace;

  texture.wrapS = THREE.RepeatWrapping;

  texture.wrapT = THREE.RepeatWrapping;

  texture.anisotropy = 16;

  texture.minFilter = THREE.LinearMipmapLinearFilter;

  texture.magFilter = THREE.LinearFilter;

  texture.repeat.set(kind === "ground" ? 14 : kind === "floor" ? 1.35 : 1.65, kind === "ground" ? 14 : kind === "floor" ? 1.35 : 1.65);

  texture.needsUpdate = true;

  return texture;

}



interface ProceduralTexturePack {

  map: THREE.Texture;

  normalMap: THREE.Texture;

  bumpMap: THREE.Texture;

  roughnessMap?: THREE.Texture;

  repeat: number;

}



function computeNormalFromHeight(

  heightData: Uint8ClampedArray,

  size: number,

  strength: number,

): THREE.Texture {

  const canvas = document.createElement("canvas");

  canvas.width = size;

  canvas.height = size;

  const ctx = canvas.getContext("2d");

  const output = ctx!.createImageData(size, size);

  const sample = (x: number, y: number) => {

    const xx = ((x % size) + size) % size;

    const yy = ((y % size) + size) % size;

    const idx = (yy * size + xx) * 4;

    return (heightData[idx] + heightData[idx + 1] + heightData[idx + 2]) / 3;

  };

  for (let y = 0; y < size; y += 1) {

    for (let x = 0; x < size; x += 1) {

      const l = sample(x - 1, y);

      const r = sample(x + 1, y);

      const u = sample(x, y - 1);

      const d = sample(x, y + 1);

      const dx = (r - l) / 255 * strength;

      const dy = (d - u) / 255 * strength;

      const nx = -dx;

      const ny = -dy;

      const nz = 1;

      const len = Math.hypot(nx, ny, nz);

      const idx = (y * size + x) * 4;

      output.data[idx] = Math.round((nx / len) * 127 + 128);

      output.data[idx + 1] = Math.round((ny / len) * 127 + 128);

      output.data[idx + 2] = Math.round((nz / len) * 127 + 128);

      output.data[idx + 3] = 255;

    }

  }

  ctx!.putImageData(output, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);

  tex.wrapS = THREE.RepeatWrapping;

  tex.wrapT = THREE.RepeatWrapping;

  tex.anisotropy = 12;

  tex.minFilter = THREE.LinearMipmapLinearFilter;

  tex.magFilter = THREE.LinearFilter;

  return tex;

}



function createAAATexturePack(kind: ProceduralTextureKind): ProceduralTexturePack {

  const size = 512;

  const canvas = document.createElement("canvas");

  canvas.width = size;

  canvas.height = size;

  const ctx = canvas.getContext("2d")!;



  const baseRGB: Record<ProceduralTextureKind, [number, number, number]> = {

    floor: [185, 181, 173],
    wall: [216, 212, 203],
    concrete: [188, 192, 186],
    wood: [142, 102, 68],
    glass: [159, 196, 216],
    metal: [168, 175, 180],
    duct: [180, 186, 192],
    ground: [107, 122, 91],
    roof: [194, 200, 204],
    generic: [198, 194, 186],

  };

  const base = baseRGB[kind];

  ctx.fillStyle = `rgb(${base[0]}, ${base[1]}, ${base[2]})`;

  ctx.fillRect(0, 0, size, size);



  const random = seededRandom(kind.length * 131 + kind.charCodeAt(0) + 7);

  const baseImg = ctx.getImageData(0, 0, size, size);

  for (let i = 0; i < baseImg.data.length; i += 4) {

    const n = (random() - 0.5) * (kind === "glass" ? 6 : 28);

    baseImg.data[i] = Math.max(0, Math.min(255, baseImg.data[i] + n));

    baseImg.data[i + 1] = Math.max(0, Math.min(255, baseImg.data[i + 1] + n * 0.9));

    baseImg.data[i + 2] = Math.max(0, Math.min(255, baseImg.data[i + 2] + n * 0.8));

  }

  ctx.putImageData(baseImg, 0, 0);



  const mortarColors = {

    wall: [126, 118, 108],
    concrete: [118, 120, 116],
    floor: [132, 129, 122],

  } as const;

  const mortars = mortarColors as unknown as Record<string, [number, number, number]>;



  if (kind === "wall") {

    const brickW = 56;

    const brickH = 26;

    const mortar = mortars.wall;

    for (let row = 0; row * brickH < size; row += 1) {

      const offset = (row % 2) * (brickW / 2);

      for (let col = -1; col * brickW < size + brickW; col += 1) {

        const x = col * brickW + offset;

        const y = row * brickH;

        ctx.fillStyle = `rgba(${mortar[0]}, ${mortar[1]}, ${mortar[2]}, 0.55)`;

        ctx.fillRect(x, y + brickH - 3, brickW + 2, 3);

        ctx.fillRect(x + brickW - 2, y, 3, brickH);

        ctx.fillStyle = `rgba(255, 240, 220, ${0.025 + random() * 0.045})`;

        ctx.fillRect(x + 3, y + 3, brickW - 6, brickH - 6);

        ctx.fillStyle = `rgba(14, 10, 6, ${0.015 + random() * 0.05})`;

        ctx.beginPath();

        ctx.arc(x + 8 + random() * (brickW - 18), y + 5 + random() * (brickH - 10), 1 + random() * 1.8, 0, Math.PI * 2);

        ctx.fill();

      }

    }

  } else if (kind === "concrete") {

    for (let i = 0; i < 28; i += 1) {

      const x = random() * size;

      const y = random() * size;

      const w = 20 + random() * 80;

      const h = 1.2 + random() * 1.6;

      ctx.fillStyle = `rgba(48, 44, 40, ${0.18 + random() * 0.18})`;

      ctx.beginPath();

      ctx.ellipse(x, y, w, h, random() * Math.PI, 0, Math.PI * 2);

      ctx.fill();

    }

    for (let i = 0; i < 140; i += 1) {

      const x = random() * size;

      const y = random() * size;

      ctx.fillStyle = `rgba(20, 18, 14, ${0.22 + random() * 0.22})`;

      ctx.fillRect(x, y, 1, 1);

      ctx.fillStyle = `rgba(230, 228, 220, ${0.05 + random() * 0.08})`;

      ctx.fillRect(x + 2, y + 2, 1, 1);

    }

  } else if (kind === "floor") {

    const tileW = 72;

    const tileH = 72;

    for (let y = 0; y < size; y += tileH) {

      for (let x = 0; x < size; x += tileW) {

        const grout = mortars.floor;

        ctx.strokeStyle = `rgba(${grout[0]}, ${grout[1]}, ${grout[2]}, 0.65)`;

        ctx.lineWidth = 2;

        ctx.strokeRect(x, y, tileW, tileH);

        ctx.fillStyle = `rgba(255, 250, 235, ${0.025 + random() * 0.035})`;

        ctx.fillRect(x + 3, y + 3, tileW - 6, tileH - 6);

        ctx.fillStyle = `rgba(28, 24, 20, ${0.015 + random() * 0.04})`;

        ctx.beginPath();

        ctx.ellipse(x + random() * tileW, y + random() * tileH, 1.2 + random() * 2.4, 0.8 + random() * 1.2, 0, 0, Math.PI * 2);

        ctx.fill();

      }

    }

  } else if (kind === "wood") {

    ctx.strokeStyle = "rgba(48, 26, 10, 0.45)";

    ctx.lineWidth = 2;

    for (let x = 6; x < size; x += 22) {

      ctx.beginPath();

      ctx.moveTo(x, 0);

      for (let y = 0; y <= size; y += 14) {

        ctx.lineTo(x + Math.sin((y + x) * 0.04) * 4, y);

      }

      ctx.stroke();

    }

    ctx.strokeStyle = "rgba(255, 220, 170, 0.22)";

    ctx.lineWidth = 1;

    for (let x = 14; x < size; x += 64) {

      ctx.beginPath();

      ctx.moveTo(x, 0);

      ctx.lineTo(x + 4, size);

      ctx.stroke();

    }

    for (let i = 0; i < 6; i += 1) {

      const cx = 40 + i * 78 + random() * 20;

      const cy = 60 + (i * 47) % (size - 120);

      ctx.strokeStyle = "rgba(44, 20, 6, 0.48)";

      ctx.lineWidth = 1.6;

      ctx.beginPath();

      ctx.ellipse(cx, cy, 14, 6, 0.4, 0, Math.PI * 2);

      ctx.stroke();

      ctx.beginPath();

      ctx.ellipse(cx + 2, cy, 6, 2.4, 0.4, 0, Math.PI * 2);

      ctx.stroke();

    }

  } else if (kind === "metal" || kind === "duct") {

    for (let y = 16; y < size; y += 30) {

      ctx.strokeStyle = kind === "duct" ? "rgba(60, 68, 78, 0.55)" : "rgba(26, 34, 44, 0.55)";

      ctx.lineWidth = 2.4;

      ctx.beginPath();

      ctx.moveTo(0, y);

      ctx.lineTo(size, y);

      ctx.stroke();

    }

    for (let x = 12; x < size; x += 68) {

      for (let y = 12; y < size; y += 68) {

        ctx.fillStyle = "rgba(255, 255, 255, 0.28)";

        ctx.beginPath();

        ctx.arc(x, y, 1.6, 0, Math.PI * 2);

        ctx.fill();

      }

    }

    for (let i = 0; i < 18; i += 1) {

      ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";

      ctx.lineWidth = 1;

      const y = (i * 17 + 8) % size;

      ctx.beginPath();

      ctx.moveTo(0, y);

      ctx.lineTo(size, y + 14);

      ctx.stroke();

    }

  } else if (kind === "ground") {

    for (let i = 0; i < 34; i += 1) {

      const x = random() * size;

      const y = random() * size;

      const rx = size * (0.08 + random() * 0.22);

      const ry = size * (0.05 + random() * 0.18);

      const grad = ctx.createRadialGradient(x, y, 2, x, y, Math.max(rx, ry));

      const g = 58 + Math.round(random() * 40);

      const w = 48 + Math.round(random() * 30);

      grad.addColorStop(0, `rgba(${w}, ${g}, ${46 + Math.round(random() * 20)}, ${0.22 + random() * 0.2})`);

      grad.addColorStop(1, "rgba(30, 38, 32, 0)");

      ctx.fillStyle = grad;

      ctx.beginPath();

      ctx.ellipse(x, y, rx, ry, random() * Math.PI, 0, Math.PI * 2);

      ctx.fill();

    }

    for (let i = 0; i < 220; i += 1) {

      const x = random() * size;

      const y = random() * size;

      ctx.fillStyle = `rgba(12, 18, 12, ${0.3 + random() * 0.26})`;

      ctx.beginPath();

      ctx.ellipse(x, y, 1 + random() * 2.2, 0.6 + random() * 1.4, random() * Math.PI, 0, Math.PI * 2);

      ctx.fill();

    }

  } else if (kind === "roof") {

    // Standing-seam metal roof: vertical seams with a light highlight edge
    ctx.strokeStyle = "rgba(92, 102, 112, 0.5)";
    ctx.lineWidth = 3;
    for (let x = 32; x < size; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
    ctx.lineWidth = 1;
    for (let x = 35; x < size; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }

    for (let i = 0; i < 90; i += 1) {
      const x = random() * size;
      const y = random() * size;
      ctx.fillStyle = `rgba(40, 48, 56, ${0.04 + random() * 0.08})`;
      ctx.fillRect(x, y, 1.5 + random() * 3, 1 + random() * 2);
    }

  } else if (kind === "glass") {

    const glow = ctx.createLinearGradient(0, 0, size, size);

    glow.addColorStop(0, "rgba(255, 240, 210, 0.22)");

    glow.addColorStop(0.5, "rgba(130, 180, 210, 0.08)");

    glow.addColorStop(1, "rgba(60, 100, 130, 0.18)");

    ctx.fillStyle = glow;

    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = "rgba(180, 220, 240, 0.32)";

    ctx.lineWidth = 3;

    for (let p = 0; p < size; p += 64) {

      ctx.strokeRect(p, 0, 1, size);

    }

  }



  const colorCanvas = ctx.getImageData(0, 0, size, size);

  const repeat = kind === "ground" ? 14 : kind === "floor" ? 1.35 : 1.65;



  const map = new THREE.CanvasTexture(canvas);

  map.colorSpace = THREE.SRGBColorSpace;

  map.wrapS = THREE.RepeatWrapping;

  map.wrapT = THREE.RepeatWrapping;

  map.anisotropy = 16;

  map.minFilter = THREE.LinearMipmapLinearFilter;

  map.magFilter = THREE.LinearFilter;

  map.repeat.set(repeat, repeat);

  map.needsUpdate = true;



  const normalStrength = kind === "glass" ? 0.6 : kind === "metal" || kind === "duct" ? 1.2 : 2.4;

  const normalMap = computeNormalFromHeight(colorCanvas.data, size, normalStrength);

  normalMap.repeat.copy(map.repeat);

  normalMap.needsUpdate = true;

  // Height-style texture for bump mapping: unlike tangent-space normal maps,
  // three.js corrects bump perturbation for double-sided (flipped) faces,
  // so back faces lit through DoubleSide do not invert to black.
  const bumpMap = new THREE.CanvasTexture(canvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.copy(map.repeat);
  bumpMap.needsUpdate = true;

  return { map, normalMap, bumpMap, repeat };

}



function applyProjectedUv(geometry: THREE.BufferGeometry) {

  geometry.computeBoundingBox();

  const bounds = geometry.boundingBox;

  const position = geometry.getAttribute("position");

  if (!bounds || !position || position.count <= 0) {

    return geometry;

  }

  const size = bounds.getSize(new THREE.Vector3());

  const uvs: number[] = [];

  const useXZ = size.z > size.y && size.x >= size.y;

  const useYZ = size.z > size.x && size.y > size.x;

  const invX = 1 / Math.max(size.x, 0.001);

  const invY = 1 / Math.max(size.y, 0.001);

  const invZ = 1 / Math.max(size.z, 0.001);

  for (let i = 0; i < position.count; i += 1) {

    const x = position.getX(i);

    const y = position.getY(i);

    const z = position.getZ(i);

    if (useYZ) {

      uvs.push((y - bounds.min.y) * invY, (z - bounds.min.z) * invZ);

    } else if (useXZ) {

      uvs.push((x - bounds.min.x) * invX, (z - bounds.min.z) * invZ);

    } else {

      uvs.push((x - bounds.min.x) * invX, (y - bounds.min.y) * invY);

    }

  }

  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));

  return geometry;

}



function fallbackSize(element: Element3D) {

  const count = Math.max(element.count || 1, 1);

  const quantity = Math.max((element.quantity_estimate || 0) / count, 0);

  const unit = element.unit || "";

  const isVolumeUnit = unit === "m鲁" || unit.toLowerCase() === "m3";

  const isAreaUnit = unit === "m虏" || unit.toLowerCase() === "m2";



  if (isIfcType(element, ["IfcWall", "IfcWallStandardCase", "IfcCurtainWall"])) {

    const wallHeight = 3;

    const wallWidth = 0.2;

    const lengthFromVolume = isVolumeUnit && quantity > 0 ? quantity / (wallHeight * wallWidth) : 0;

    const lengthFromArea = isAreaUnit && quantity > 0 ? Math.sqrt(quantity) : 0;

    return {

      length: clamp(lengthFromVolume || lengthFromArea || 4, 1.2, 18),

      width: wallWidth,

      height: wallHeight,

    };

  }



  if (isIfcType(element, ["IfcSlab", "IfcRoof", "IfcCovering"])) {

    const side = quantity > 0 ? Math.sqrt(quantity) : 4;

    return { length: clamp(side, 1.2, 18), width: clamp(side, 1.2, 18), height: 0.18 };

  }



  if (isIfcType(element, ["IfcBeam", "IfcMember"])) {

    const lengthFromVolume = isVolumeUnit && quantity > 0 ? quantity / (0.3 * 0.45) : 0;

    return { length: clamp(lengthFromVolume || quantity || 4, 1.2, 18), width: 0.3, height: 0.45 };

  }



  if (isIfcType(element, ["IfcColumn", "IfcPile"])) {

    const side = isVolumeUnit && quantity > 0 ? Math.sqrt(quantity / 3) : 0.45;

    return { length: clamp(side, 0.25, 2.5), width: clamp(side, 0.25, 2.5), height: 3 };

  }



  if (isIfcType(element, ["IfcDoor", "IfcWindow"])) {

    return { length: 1, width: 0.12, height: 2 };

  }



  if (isIfcType(element, ["IfcPipeSegment", "IfcDuctSegment", "IfcCableCarrierSegment"])) {

    return { length: clamp(quantity || 3, 1.2, 18), width: 0.18, height: 0.18 };

  }



  if (quantity > 0 && unit === "m鲁") {

    const side = clamp(Math.cbrt(quantity), 0.25, 8);

    return { length: side, width: side, height: side };

  }

  if (quantity > 0 && unit === "m虏") {

    const side = clamp(Math.sqrt(quantity), 0.5, 12);

    return { length: side, width: side, height: 0.22 };

  }

  if (quantity > 0 && unit === "m") {

    return { length: clamp(quantity, 0.5, 16), width: 0.18, height: 0.18 };

  }

  if (element.label.includes("wall")) return { length: 4, width: 0.2, height: 3 };

  if (element.label.includes("slab") || element.label.includes("floor")) return { length: 4, width: 4, height: 0.3 };

  if (element.label.includes("beam")) return { length: 4, width: 0.3, height: 0.45 };

  if (element.label.includes("column")) return { length: 0.45, width: 0.45, height: 3 };

  if (element.label.includes("door") || element.label.includes("gate")) return { length: 1, width: 0.12, height: 2 };

  if (element.label.includes("pipe") || element.label.includes("cable")) return { length: 3, width: 0.18, height: 0.18 };


  return { length: 1.2, width: 1.2, height: 1.2 };

}



function elementSize(element: Element3D) {

  const fallback = fallbackSize(element);

  return {

    length: clamp(Math.abs(element.length || fallback.length), 0.08, 40),

    width: clamp(Math.abs(element.width || fallback.width), 0.08, 40),

    height: clamp(Math.abs(element.height || fallback.height), 0.08, 40),

  };

}



function hasPreviewMesh(element: Element3D) {

  return (

    element.mesh_kind === "mesh"

    && Array.isArray(element.mesh_vertices)

    && Array.isArray(element.mesh_indices)

    && element.mesh_vertices.length >= 9

    && element.mesh_indices.length >= 3

  );

}



function createPreviewMeshGeometry(element: Element3D) {

  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute(

    "position",

    new THREE.Float32BufferAttribute(element.mesh_vertices || [], 3),

  );

  geometry.setIndex(element.mesh_indices || []);

  geometry.computeVertexNormals();

  geometry.computeBoundingBox();

  applyProjectedUv(geometry);

  return geometry;

}



function pointToBoxDistanceSq(point: THREE.Vector3, box: THREE.Box3) {

  const dx = point.x < box.min.x ? box.min.x - point.x : point.x > box.max.x ? point.x - box.max.x : 0;

  const dy = point.y < box.min.y ? box.min.y - point.y : point.y > box.max.y ? point.y - box.max.y : 0;

  const dz = point.z < box.min.z ? box.min.z - point.z : point.z > box.max.z ? point.z - box.max.z : 0;

  return dx * dx + dy * dy + dz * dz;

}



function footprintArea(box: THREE.Box3) {

  return Math.max(0, box.max.x - box.min.x) * Math.max(0, box.max.y - box.min.y);

}



function xyBoxDistance(a: THREE.Box3, b: THREE.Box3) {

  const dx = Math.max(0, Math.max(a.min.x - b.max.x, b.min.x - a.max.x));

  const dy = Math.max(0, Math.max(a.min.y - b.max.y, b.min.y - a.max.y));

  return Math.hypot(dx, dy);

}



function createBuildingCluster(items: SceneItem[]): BuildingCluster {

  const bounds = new THREE.Box3();

  items.forEach((item) => bounds.union(item.bounds));

  const center = bounds.getCenter(new THREE.Vector3());

  const size = bounds.getSize(new THREE.Vector3());

  return {

    items,

    bounds,

    center,

    size,

    footprintArea: footprintArea(bounds),

  };

}



function getBuildingClusters(sceneItems: SceneItem[], modelSize: THREE.Vector3, groundZ: number) {

  const modelFootprint = Math.max(footprintArea(new THREE.Box3(

    new THREE.Vector3(0, 0, 0),

    new THREE.Vector3(modelSize.x, modelSize.y, 0),

  )), 1);

  const mergeGap = clamp(Math.max(modelSize.x, modelSize.y) * 0.025, 1.2, 5.5);

  const candidates = sceneItems

    .filter((item) => {

      const itemSize = item.bounds.getSize(new THREE.Vector3());

      const itemFootprint = Math.max(itemSize.x * itemSize.y, 0);

      const isWallLike =
        item.bounds.max.z > groundZ + 0.8
        && Math.max(itemSize.x, itemSize.y) > 0.35
        && itemSize.z > 0.08;

      const isFloorLike =
        isHorizontalSurface(item.element)
        && itemFootprint > 1.5
        && itemSize.z < 1.5;

      return (

        (isWallLike || isFloorLike)

        && itemFootprint < modelFootprint * 0.72

      );

    })

    .sort((a, b) => footprintArea(b.bounds) - footprintArea(a.bounds));



  const clusters: BuildingCluster[] = [];

  candidates.forEach((item) => {

    const matches = clusters

      .map((cluster, index) => ({ cluster, index }))

      .filter(({ cluster }) => xyBoxDistance(cluster.bounds, item.bounds) <= mergeGap)

      .map(({ index }) => index);



    if (matches.length === 0) {

      clusters.push(createBuildingCluster([item]));

      return;

    }



    const baseIndex = matches[0];

    const mergedItems = [...clusters[baseIndex].items, item];

    matches.slice(1).reverse().forEach((index) => {

      mergedItems.push(...clusters[index].items);

      clusters.splice(index, 1);

    });

    clusters[baseIndex] = createBuildingCluster(mergedItems);

  });



  return clusters

    .filter((cluster) => cluster.footprintArea > Math.max(6, modelFootprint * 0.012))

    .sort((a, b) => b.footprintArea - a.footprintArea)

    .slice(0, 4);

}



function isHorizontalSurface(element: Element3D) {

  return (
    isIfcType(element, ["IfcSlab", "IfcRoof", "IfcCovering", "IfcFloor"])
    || elementSearchText(element).match(/\b(floor|slab|ground|pavement|deck)\b/) != null
  );

}

function isRoofLikeSurface(element: Element3D) {

  const text = elementSearchText(element);

  const type = elementTypeKey(element).toLowerCase();

  return (
    isIfcType(element, ["IfcRoof"])
    || /roof|canopy|屋面|屋顶|雨棚|斜板|slope|sloped|inclined/.test(text)
    || /roof|canopy|屋面|屋顶|雨棚|斜板|slope|sloped|inclined/.test(type)
  );

}



/**
 * Find exhibition hall centers from indoor floor slabs.
 * A real exhibition hall floor is a broad horizontal surface that is:
 * - large enough to hold exhibits (> 8 m²)
 * - not huge like an outdoor plaza (< 600 m²)
 * - reasonably close to the ground level
 */
function findExhibitionHallCenters(sceneItems: SceneItem[], groundZ: number): { center: THREE.Vector3; bounds: THREE.Box3; enclosureScore: number }[] {

  const floorItems = sceneItems
    .filter((item) => isHorizontalSurface(item.element))
    .filter((item) => {
      const area = footprintArea(item.bounds);
      const z = item.bounds.max.z;
      const size = item.bounds.getSize(new THREE.Vector3());
      const thickness = size.z;
      const aspect = Math.max(size.x, size.y) / Math.max(Math.min(size.x, size.y), 0.01);
      return area > 12 && area < 600 && aspect < 2.5 && z > groundZ - 0.5 && z < groundZ + 3 && thickness < 1.5;
    })
    .sort((a, b) => footprintArea(b.bounds) - footprintArea(a.bounds));

  // Merge nearby floors that belong to the same hall (e.g. split by structural joints)
  const mergeGap = 2.0;
  const clusters: SceneItem[][] = [];
  floorItems.forEach((item) => {
    const matches = clusters
      .map((cluster, index) => ({ cluster, index }))
      .filter(({ cluster }) => {
        const clusterBounds = cluster.reduce((box, i) => box.union(i.bounds), new THREE.Box3());
        return xyBoxDistance(clusterBounds, item.bounds) <= mergeGap;
      })
      .map(({ index }) => index);

    if (matches.length === 0) {
      clusters.push([item]);
      return;
    }
    const baseIndex = matches[0];
    clusters[baseIndex].push(item);
    for (let i = matches.length - 1; i >= 1; i--) {
      clusters[baseIndex].push(...clusters[matches[i]]);
      clusters.splice(matches[i], 1);
    }
  });

  const wallCandidates = sceneItems.filter((item) => {
    const size = item.bounds.getSize(new THREE.Vector3());
    return item.bounds.max.z > groundZ + 1.2
      && size.z > 1.2
      && Math.max(size.x, size.y) > 0.35
      && Math.min(size.x, size.y) < 1.8;
  });

  return clusters
    .map((items) => {
      const bounds = new THREE.Box3();
      items.forEach((item) => bounds.union(item.bounds));
      const center = bounds.getCenter(new THREE.Vector3());
      center.z = groundZ;
      const searchRadius = Math.max(bounds.getSize(new THREE.Vector3()).length() * 0.55, 9);
      const enclosureScore = wallCandidates.reduce((score, wall) => {
        const wallCenter = wall.bounds.getCenter(new THREE.Vector3());
        const distance = Math.hypot(wallCenter.x - center.x, wallCenter.y - center.y);
        if (distance > searchRadius) return score;
        const wallSize = wall.bounds.getSize(new THREE.Vector3());
        return score + Math.min(Math.max(wallSize.x, wallSize.y), 12) * clamp(1 - distance / searchRadius, 0.15, 1);
      }, 0);
      return { center, bounds, enclosureScore };
    })
    .sort((a, b) => (b.enclosureScore - a.enclosureScore) || (footprintArea(b.bounds) - footprintArea(a.bounds)));

}



function getWalkGroundZ(sceneItems: SceneItem[], bounds: THREE.Box3) {

  if (bounds.isEmpty()) {

    return 0;

  }

  const modelSize = bounds.getSize(new THREE.Vector3());

  const modelFootprint = Math.max(modelSize.x * modelSize.y, 1);

  const broadHorizontalSurfaces = sceneItems

    .map((item) => {

      const itemSize = item.bounds.getSize(new THREE.Vector3());

      return {

        z: item.bounds.max.z,

        area: itemSize.x * itemSize.y,

        item,

      };

    })

    .filter(({ area, item, z }) => (

      isHorizontalSurface(item.element)

      && area > Math.max(3, modelFootprint * 0.004)

      && z <= bounds.min.z + modelSize.z * 0.55

    ));



  if (broadHorizontalSurfaces.length === 0) {

    return bounds.min.z;

  }



  const maxArea = Math.max(...broadHorizontalSurfaces.map((surface) => surface.area));

  const walkableSurfaces = broadHorizontalSurfaces

    .filter((surface) => surface.area >= maxArea * 0.22)

    .sort((a, b) => (a.z - b.z) || (b.area - a.area));

  return walkableSurfaces[0]?.z ?? bounds.min.z;

}



function isWalkPassableElement(element: Element3D) {

  const searchable = [

    element.type,

    element.element_type,

    element.predefined_type,

    element.object_type,

    element.label,

    element.name,

  ].filter(Boolean).join(" ").toLowerCase();

  return isIfcType(element, [

    "IfcDoor",

    "IfcWindow",

    "IfcOpeningElement",

    "IfcSpace",

    "IfcStair",

    "IfcStairFlight",

    "IfcRamp",

    "IfcRampFlight",

  ]) || [

    "door",

    "window",

    "opening",

    "space",

    "stair",

    "door",

    "gate",

    "beam",

    "curtain_wall",

    "railing",

    "stair",


  ].some((keyword) => searchable.includes(keyword));

}



function isWalkObstacle(element: Element3D, bounds: THREE.Box3, groundZ: number) {

  if (isHorizontalSurface(element) || isWalkPassableElement(element)) {

    return false;

  }

  const size = bounds.getSize(new THREE.Vector3());

  const overlapsBodyHeight = bounds.max.z > groundZ + 0.18 && bounds.min.z < groundZ + WALK_COLLISION_HEIGHT + 0.35;

  return overlapsBodyHeight && size.z > 0.35 && Math.max(size.x, size.y) > 0.12;

}



function circleIntersectsBoxXY(

  point: THREE.Vector3,

  box: THREE.Box3,

  radius: number,

  bodyHeight: number,

) {

  const minZ = point.z + 0.08;

  const maxZ = point.z + bodyHeight;

  if (maxZ < box.min.z || minZ > box.max.z) {

    return false;

  }

  const nearestX = clamp(point.x, box.min.x, box.max.x);

  const nearestY = clamp(point.y, box.min.y, box.max.y);

  const dx = point.x - nearestX;

  const dy = point.y - nearestY;

  return dx * dx + dy * dy < radius * radius;

}



function findWalkSpawnPoint(

  initialPoints: THREE.Vector3[],

  canStandAt: (position: THREE.Vector3) => boolean,

  walkBounds: WalkBounds,

  groundZ: number,

) {

  const angles = [0, Math.PI / 2, Math.PI, Math.PI * 1.5, Math.PI / 4, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75];

  const maxRange = 3.0;

  const candidate = new THREE.Vector3();



  for (const initialPoint of initialPoints) {

    candidate.set(

      clamp(initialPoint.x, walkBounds.minX, walkBounds.maxX),

      clamp(initialPoint.y, walkBounds.minY, walkBounds.maxY),

      groundZ + 0.02,

    );

    if (canStandAt(candidate)) {

      return candidate.clone();

    }



    for (let distance = 1.2; distance <= maxRange; distance += 1.2) {

      for (const angle of angles) {

        candidate.set(

          clamp(initialPoint.x + Math.cos(angle) * distance, walkBounds.minX, walkBounds.maxX),

          clamp(initialPoint.y + Math.sin(angle) * distance, walkBounds.minY, walkBounds.maxY),

          groundZ + 0.02,

        );

        if (canStandAt(candidate)) {

          return candidate.clone();

        }

      }

    }

  }



  return candidate.set(

    clamp(initialPoints[0]?.x || 0, walkBounds.minX, walkBounds.maxX),

    clamp(initialPoints[0]?.y || 0, walkBounds.minY, walkBounds.maxY),

    groundZ + 0.02,

  ).clone();

}



function getWalkSpawnCandidates(sceneItems: SceneItem[], center: THREE.Vector3, rawSpawnPoint: THREE.Vector3, groundZ: number) {

  const floorCandidates = sceneItems

    .filter((item) => isHorizontalSurface(item.element) && item.bounds.min.z <= groundZ + 1.2)

    .map((item) => {

      const size = item.bounds.getSize(new THREE.Vector3());

      const itemCenter = item.bounds.getCenter(new THREE.Vector3());

      itemCenter.z = groundZ + 0.02;

      return {

        point: itemCenter,

        area: size.x * size.y,

        zDistance: Math.abs(item.bounds.min.z - groundZ),

      };

    })

    .filter((item) => item.area > WALK_COLLISION_RADIUS * WALK_COLLISION_RADIUS * 4)

    .sort((a, b) => (a.zDistance - b.zDistance) || (b.area - a.area))

    .slice(0, 10)

    .map((item) => item.point);



  // Prefer the raw spawn point (inside the primary exhibition hall) first,
  // then fall back to other floor centers only if it is blocked.
  return [
    rawSpawnPoint.clone(),
    ...floorCandidates,
    new THREE.Vector3(center.x, center.y, groundZ + 0.02),
  ];

}



function isVisualTestMode() {

  if (typeof window === "undefined") {

    return false;

  }

  return new URLSearchParams(window.location.search).has("visual-test");

}



function formatNumber(value?: number, digits = 3) {

  if (value == null || !Number.isFinite(value) || value <= 0) return "";

  return value.toFixed(digits).replace(/\.?0+$/, "");

}



function formatQuantity(element: Element3D) {

  const value = formatNumber(element.quantity_estimate, 4);

  return value ? `${value}${element.unit || ""}` : "";

}



function displayText(value?: string | number | null) {
  return String(value ?? "").replace(MODEL_PERSON_NAME_PATTERN, "anonymous");
}



function formatDimensions(element: Element3D) {
  const dims = [
    ["length", element.length],
    ["width", element.width],
    ["height", element.height],
    ["thickness", element.thickness],
  ]
    .map(([label, value]) => {
      const formatted = formatNumber(value as number | undefined);
      return formatted ? `${label}${formatted}m` : "";
    })
    .filter(Boolean);
  return dims.join(" / ");

}



function formatCoordinate(element: Element3D) {

  return [element.pos_x, element.pos_y, element.pos_z]

    .map((value) => (Number.isFinite(value) ? value.toFixed(3).replace(/\.?0+$/, "") : "0"))

    .join(", ");

}



function buildElementInfoRows(element: Element3D) {

  const rows = [

    ["IFC 类型", element.type],
    ["构件分类", element.label],
    ["名称", element.name],
    ["元素类型", element.element_type],
    ["预定义类型", element.predefined_type],
    ["对象类型", element.object_type],
    ["材质", element.material],
    ["工程量", formatQuantity(element)],
    ["尺寸", formatDimensions(element)],
    ["面积", formatNumber(element.area, 4) ? `${formatNumber(element.area, 4)}m2` : ""],
    ["体积", formatNumber(element.volume, 4) ? `${formatNumber(element.volume, 4)}m3` : ""],
    ["坐标", formatCoordinate(element)],
    ["置信度", element.confidence != null ? `${formatNumber(element.confidence, 1) || element.confidence}%` : ""],
    ["属性集", element.pset_keys?.length ? element.pset_keys.join(" / ") : ""],
    ["描述", element.description],


  ];

  return rows

    .map(([label, value]) => [label, displayText(value)] as [string, string])

    .filter(([, value]) => Boolean(value));

}



function createAvatar(): AvatarRig {



  const avatar = new THREE.Group();



  // === Materials（《我的世界》Steve 配色） ===



  const steveSkinMaterial = new THREE.MeshStandardMaterial({

    color: 0xb5876a,

    roughness: 0.85,

    metalness: 0.0,

  });



  const steveHairMaterial = new THREE.MeshStandardMaterial({

    color: 0x33221a,

    roughness: 0.9,

    metalness: 0.0,

  });



  const steveShirtMaterial = new THREE.MeshStandardMaterial({

    color: 0x00a3a3,

    roughness: 0.8,

    metalness: 0.0,

  });



  const stevePantsMaterial = new THREE.MeshStandardMaterial({

    color: 0x4040aa,

    roughness: 0.85,

    metalness: 0.0,

  });



  const steveShoeMaterial = new THREE.MeshStandardMaterial({

    color: 0x6f6f6f,

    roughness: 0.9,

    metalness: 0.0,

  });



  // 8×8 像素脸（经典 Steve），Nearest 采样保持马赛克颗粒感

  const faceCanvas = document.createElement("canvas");

  faceCanvas.width = 8;

  faceCanvas.height = 8;

  const faceCtx = faceCanvas.getContext("2d")!;

  const facePalette: Record<string, string> = {

    S: "#b5876a",

    H: "#33221a",

    W: "#ffffff",

    B: "#4a3fd1",

    N: "#915e43",

    M: "#6e4230",

  };

  const faceRows = [

    "HHHHHHHH",

    "SSSSSSSS",

    "SSSSSSSS",

    "SWBSSBWS",

    "SSSNNSSS",

    "SSSNNSSS",

    "SSMMMMSS",

    "SSSMMSSS",

  ];

  faceRows.forEach((row, rowY) => {

    row.split("").forEach((ch, rowX) => {

      faceCtx.fillStyle = facePalette[ch];

      faceCtx.fillRect(rowX, rowY, 1, 1);

    });

  });

  const faceTexture = new THREE.CanvasTexture(faceCanvas);

  faceTexture.magFilter = THREE.NearestFilter;

  faceTexture.minFilter = THREE.NearestFilter;

  faceTexture.colorSpace = THREE.SRGBColorSpace;

  const faceMaterial = new THREE.MeshStandardMaterial({

    map: faceTexture,

    roughness: 0.85,

    metalness: 0.0,

  });



  // === 头（0.5m 方块，正面贴像素脸，其余面为皮肤/头发色） ===



  const headGeometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);

  const head = new THREE.Mesh(headGeometry, [

    steveSkinMaterial,

    steveSkinMaterial,

    faceMaterial,

    steveHairMaterial,

    steveHairMaterial,

    steveSkinMaterial,

  ]);

  head.position.z = 1.55;

  head.castShadow = true;

  avatar.add(head);



  // === 躯干（青色上衣） ===



  const torsoGeometry = new THREE.BoxGeometry(0.5, 0.25, 0.75);

  const torso = new THREE.Mesh(torsoGeometry, steveShirtMaterial);

  torso.position.z = 1.05;

  torso.castShadow = true;

  avatar.add(torso);



  // === 手臂（皮肤色方块） ===



  const armGeometry = new THREE.BoxGeometry(0.25, 0.25, 0.75);

  const leftArm = new THREE.Mesh(armGeometry, steveSkinMaterial);

  leftArm.position.set(-0.375, 0, 1.05);

  leftArm.castShadow = true;

  avatar.add(leftArm);



  const rightArm = new THREE.Mesh(armGeometry, steveSkinMaterial);

  rightArm.position.set(0.375, 0, 1.05);

  rightArm.castShadow = true;

  avatar.add(rightArm);



  // === 腿（靛蓝裤子 + 灰色鞋） ===



  const legGeometry = new THREE.BoxGeometry(0.25, 0.25, 0.55);

  const leftLeg = new THREE.Mesh(legGeometry, stevePantsMaterial);

  leftLeg.position.set(-0.125, 0, 0.475);

  leftLeg.castShadow = true;

  avatar.add(leftLeg);



  const rightLeg = new THREE.Mesh(legGeometry, stevePantsMaterial);

  rightLeg.position.set(0.125, 0, 0.475);

  rightLeg.castShadow = true;

  avatar.add(rightLeg);



  const shoeGeometry = new THREE.BoxGeometry(0.25, 0.25, 0.2);

  const leftShoe = new THREE.Mesh(shoeGeometry, steveShoeMaterial);

  leftShoe.position.set(-0.125, 0, 0.1);

  leftShoe.castShadow = true;

  avatar.add(leftShoe);



  const rightShoe = new THREE.Mesh(shoeGeometry, steveShoeMaterial);

  rightShoe.position.set(0.125, 0, 0.1);

  rightShoe.castShadow = true;

  avatar.add(rightShoe);



  // === Direction indicator (small arrow on ground) ===



  const facingGeometry = new THREE.ConeGeometry(0.08, 0.24, 16);



  const facingMaterial = new THREE.MeshStandardMaterial({



    color: 0xff6600,



    roughness: 0.5,



    metalness: 0.1,



    emissive: 0xff4400,



    emissiveIntensity: 0.06,



  });



  const facing = new THREE.Mesh(facingGeometry, facingMaterial);



  facing.position.set(0, 0.35, 1.1);



  facing.castShadow = true;



  avatar.add(facing);



  return {

    avatar,

    leftLeg,

    rightLeg,

    leftArm,

    rightArm,

    disposables: [

      headGeometry, faceTexture, faceMaterial,

      steveSkinMaterial, steveHairMaterial, steveShirtMaterial,

      stevePantsMaterial, steveShoeMaterial,

      torsoGeometry, armGeometry, legGeometry, shoeGeometry,

      facingGeometry, facingMaterial,

    ],

  };



}



function createPaintingTexture(index: number) {

  const canvas = document.createElement("canvas");

  canvas.width = 512;

  canvas.height = 320;

  const ctx = canvas.getContext("2d");

  if (!ctx) {

    return new THREE.CanvasTexture(canvas);

  }

  const style = index % 5;

  // Helper: seeded random for reproducible textures

  let seed = index * 9301 + 49297;

  const rand = () => {

    seed = (seed * 9301 + 49297) % 233280;

    return seed / 233280;

  };

  const W = canvas.width;

  const H = canvas.height;

  if (style === 0) {

    // Landscape: sky gradient + mountains + field

    const sky = ctx.createLinearGradient(0, 0, 0, H * 0.6);

    sky.addColorStop(0, "#8fb8d8");

    sky.addColorStop(0.5, "#d4c89a");

    sky.addColorStop(1, "#e8d8a8");

    ctx.fillStyle = sky;

    ctx.fillRect(0, 0, W, H);

    // Sun glow

    const sunX = W * (0.2 + rand() * 0.6);

    const sunY = H * 0.28;

    const sunGrad = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, H * 0.3);

    sunGrad.addColorStop(0, "rgba(255,240,200,0.9)");

    sunGrad.addColorStop(1, "rgba(255,240,200,0)");

    ctx.fillStyle = sunGrad;

    ctx.fillRect(0, 0, W, H);

    // Mountain layers (back to front)

    const mountainColors = ["#5a6a78", "#445566", "#33414f"];

    for (let layer = 0; layer < 3; layer++) {

      ctx.fillStyle = mountainColors[layer];

      ctx.beginPath();

      ctx.moveTo(0, H * 0.65);

      const peaks = 5 + layer * 2;

      for (let p = 0; p <= peaks; p++) {

        const px = (p / peaks) * W;

        const py = H * (0.55 + layer * 0.05) - rand() * H * 0.18;

        ctx.lineTo(px, py);

      }

      ctx.lineTo(W, H);

      ctx.lineTo(0, H);

      ctx.closePath();

      ctx.fill();

    }

    // Field foreground

    ctx.fillStyle = "#3a4a28";

    ctx.fillRect(0, H * 0.78, W, H * 0.22);

    ctx.fillStyle = "rgba(80,100,50,0.5)";

    for (let i = 0; i < 40; i++) {

      ctx.fillRect(rand() * W, H * 0.78 + rand() * H * 0.2, 2, 4 + rand() * 6);

    }

  } else if (style === 1) {

    // Abstract: color blocks + brush strokes

    const palettes = [

      ["#c44536", "#e8c547", "#3a6ea5", "#1a1a2e"],

      ["#2c5f2d", "#97bc62", "#d8d8aa", "#1e2e1e"],

      ["#8e44ad", "#3498db", "#e74c3c", "#2c3e50"],

    ];

    const palette = palettes[index % palettes.length];

    ctx.fillStyle = palette[3];

    ctx.fillRect(0, 0, W, H);

    // Large color blocks

    for (let i = 0; i < 5; i++) {

      ctx.fillStyle = palette[i % 3];

      ctx.globalAlpha = 0.7 + rand() * 0.3;

      const bx = rand() * W;

      const by = rand() * H;

      const bw = W * (0.15 + rand() * 0.35);

      const bh = H * (0.15 + rand() * 0.35);

      ctx.fillRect(bx, by, bw, bh);

    }

    // Brush strokes

    ctx.globalAlpha = 0.6;

    for (let i = 0; i < 30; i++) {

      ctx.strokeStyle = palette[i % 3];

      ctx.lineWidth = 3 + rand() * 8;

      ctx.beginPath();

      const sx = rand() * W;

      const sy = rand() * H;

      ctx.moveTo(sx, sy);

      ctx.bezierCurveTo(sx + 40, sy + 30, sx + 80, sy - 20, sx + 120, sy + 40);

      ctx.stroke();

    }

    ctx.globalAlpha = 1;

  } else if (style === 2) {

    // Portrait: dark background + figure silhouette

    const bgGrad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.7);

    bgGrad.addColorStop(0, "#3a2e22");

    bgGrad.addColorStop(1, "#1a1410");

    ctx.fillStyle = bgGrad;

    ctx.fillRect(0, 0, W, H);

    // Body (shoulders)

    ctx.fillStyle = "#2a2018";

    ctx.beginPath();

    ctx.ellipse(W / 2, H * 0.95, W * 0.32, H * 0.28, 0, Math.PI, 0);

    ctx.fill();

    // Neck

    ctx.fillStyle = "#8a6a4a";

    ctx.fillRect(W / 2 - W * 0.05, H * 0.62, W * 0.1, H * 0.12);

    // Head

    ctx.beginPath();

    ctx.ellipse(W / 2, H * 0.42, W * 0.14, H * 0.2, 0, 0, Math.PI * 2);

    ctx.fill();

    // Hair

    ctx.fillStyle = "#1a1208";

    ctx.beginPath();

    ctx.ellipse(W / 2, H * 0.34, W * 0.15, H * 0.13, 0, Math.PI, 0);

    ctx.fill();

    // Face shading

    ctx.fillStyle = "rgba(60,40,25,0.4)";

    ctx.beginPath();

    ctx.ellipse(W / 2 + W * 0.04, H * 0.44, W * 0.1, H * 0.16, 0, 0, Math.PI * 2);

    ctx.fill();

    // Rim light

    ctx.strokeStyle = "rgba(255,220,180,0.3)";

    ctx.lineWidth = 3;

    ctx.beginPath();

    ctx.ellipse(W / 2 - W * 0.02, H * 0.42, W * 0.13, H * 0.19, 0, Math.PI * 0.6, Math.PI * 1.4);

    ctx.stroke();

  } else if (style === 3) {

    // Mural: geometric pattern (art deco style)

    ctx.fillStyle = "#1a1a2e";

    ctx.fillRect(0, 0, W, H);

    const accentColors = ["#d4af37", "#c44536", "#e8c547"];

    // Border frame

    ctx.strokeStyle = accentColors[0];

    ctx.lineWidth = 8;

    ctx.strokeRect(16, 16, W - 32, H - 32);

    // Central sunburst

    const cx = W / 2;

    const cy = H / 2;

    ctx.fillStyle = accentColors[0];

    ctx.beginPath();

    ctx.arc(cx, cy, 40, 0, Math.PI * 2);

    ctx.fill();

    const rays = 16;

    for (let i = 0; i < rays; i++) {

      const angle = (i / rays) * Math.PI * 2;

      ctx.fillStyle = accentColors[i % 3];

      ctx.beginPath();

      ctx.moveTo(cx, cy);

      ctx.lineTo(cx + Math.cos(angle - 0.1) * 120, cy + Math.sin(angle - 0.1) * 120);

      ctx.lineTo(cx + Math.cos(angle) * 150, cy + Math.sin(angle) * 150);

      ctx.lineTo(cx + Math.cos(angle + 0.1) * 120, cy + Math.sin(angle + 0.1) * 120);

      ctx.closePath();

      ctx.fill();

    }

    // Corner ornaments

    ctx.fillStyle = accentColors[1];

    [[0, 0], [W, 0], [0, H], [W, H]].forEach(([x, y]) => {

      ctx.beginPath();

      ctx.arc(x, y, 30, 0, Math.PI * 2);

      ctx.fill();

    });

  } else {

    // Still life: table + vase + fruit

    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);

    bgGrad.addColorStop(0, "#4a3c2e");

    bgGrad.addColorStop(1, "#2a2018");

    ctx.fillStyle = bgGrad;

    ctx.fillRect(0, 0, W, H);

    // Table

    ctx.fillStyle = "#6b4a2e";

    ctx.fillRect(0, H * 0.7, W, H * 0.3);

    ctx.fillStyle = "rgba(0,0,0,0.3)";

    ctx.fillRect(0, H * 0.7, W, 4);

    // Vase

    ctx.fillStyle = "#3a5a6a";

    ctx.beginPath();

    ctx.moveTo(W * 0.4, H * 0.7);

    ctx.bezierCurveTo(W * 0.35, H * 0.5, W * 0.35, H * 0.35, W * 0.42, H * 0.3);

    ctx.lineTo(W * 0.58, H * 0.3);

    ctx.bezierCurveTo(W * 0.65, H * 0.35, W * 0.65, H * 0.5, W * 0.6, H * 0.7);

    ctx.closePath();

    ctx.fill();

    // Vase highlight

    ctx.fillStyle = "rgba(180,210,220,0.4)";

    ctx.fillRect(W * 0.44, H * 0.35, W * 0.04, H * 0.3);

    // Fruit (apples)

    ctx.fillStyle = "#c44536";

    ctx.beginPath();

    ctx.arc(W * 0.3, H * 0.78, 22, 0, Math.PI * 2);

    ctx.fill();

    ctx.beginPath();

    ctx.arc(W * 0.7, H * 0.8, 20, 0, Math.PI * 2);

    ctx.fill();

    ctx.fillStyle = "#e8c547";

    ctx.beginPath();

    ctx.arc(W * 0.5, H * 0.82, 18, 0, Math.PI * 2);

    ctx.fill();

  }

  // Subtle canvas texture overlay

  ctx.globalAlpha = 0.06;

  for (let i = 0; i < 200; i++) {

    ctx.fillStyle = rand() > 0.5 ? "#ffffff" : "#000000";

    ctx.fillRect(rand() * W, rand() * H, 1, 1);

  }

  ctx.globalAlpha = 1;

  // Vignette

  const vignette = ctx.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, W * 0.7);

  vignette.addColorStop(0, "rgba(0,0,0,0)");

  vignette.addColorStop(1, "rgba(0,0,0,0.35)");

  ctx.fillStyle = vignette;

  ctx.fillRect(0, 0, W, H);

  const texture = new THREE.CanvasTexture(canvas);

  texture.colorSpace = THREE.SRGBColorSpace;

  texture.anisotropy = 16;

  return texture;

}



function createSkyDomeMaterial(sunDirection: THREE.Vector3) {

  return new THREE.ShaderMaterial({

    uniforms: {

      sunDirection: { value: sunDirection.clone().normalize() },

      time: { value: 0 },

    },

    vertexShader: `

      varying vec3 vWorldPosition;



      void main() {

        vec4 worldPosition = modelMatrix * vec4(position, 1.0);

        vWorldPosition = worldPosition.xyz;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

      }

    `,

    fragmentShader: `

      uniform vec3 sunDirection;

      varying vec3 vWorldPosition;



      float hash(vec2 p) {

        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);

      }

      float noise(vec2 p) {

        vec2 i = floor(p);

        vec2 f = fract(p);

        vec2 u = f * f * (3.0 - 2.0 * f);

        float a = hash(i);

        float b = hash(i + vec2(1.0, 0.0));

        float c = hash(i + vec2(0.0, 1.0));

        float d = hash(i + vec2(1.0, 1.0));

        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);

      }

      float fbm(vec2 p) {

        float v = 0.0;

        float a = 0.5;

        for (int i = 0; i < 5; i += 1) {

          v += a * noise(p);

          p *= 2.02;

          a *= 0.5;

        }

        return v;

      }



      void main() {

        vec3 direction = normalize(vWorldPosition - cameraPosition);

        float height = clamp(direction.z * 0.5 + 0.5, 0.0, 1.0);

        vec3 lowHaze = vec3(0.78, 0.87, 0.95);
        vec3 horizon = vec3(0.72, 0.84, 0.95);
        vec3 midSky = vec3(0.42, 0.66, 0.90);
        vec3 topSky = vec3(0.12, 0.29, 0.60);
        vec3 zenith = vec3(0.04, 0.11, 0.30);



        vec3 sky = mix(lowHaze, horizon, smoothstep(0.0, 0.12, height));

        sky = mix(sky, midSky, smoothstep(0.1, 0.45, height));

        sky = mix(sky, topSky, smoothstep(0.4, 0.82, height));

        sky = mix(sky, zenith, smoothstep(0.78, 1.0, height));



        float sunAmount = max(dot(direction, normalize(sunDirection)), 0.0);

        float sunDisc = pow(sunAmount, 900.0);

        sky += vec3(1.0, 0.96, 0.84) * sunDisc * 0.38;
        sky += vec3(1.0, 0.84, 0.58) * pow(sunAmount, 12.0) * 0.12;
        sky += vec3(1.0, 0.90, 0.72) * pow(sunAmount, 5.0) * 0.06;



        vec2 cloudPos = direction.xy / max(abs(direction.z), 0.05) * 3.0;

        float cloudLayer = smoothstep(0.48, 0.72, fbm(cloudPos * 1.2) + 0.15 * noise(cloudPos * 4.2));

        cloudLayer *= smoothstep(0.0, 0.22, height);

        vec3 cloudColor = mix(vec3(0.99, 0.99, 1.00), vec3(0.92, 0.95, 0.99), sunAmount);
        sky = mix(sky, cloudColor, cloudLayer * 0.48);



        float opposing = max(dot(direction, normalize(vec3(0.85, 0.45, 0.32))), 0.0);

        sky += vec3(0.15, 0.18, 0.28) * pow(opposing, 3.0) * 0.18;



        float horizonHaze = 1.0 - smoothstep(0.002, 0.32, abs(direction.z));

        sky = mix(sky, vec3(0.84, 0.90, 0.96), horizonHaze * 0.20);
        sky *= 0.98;



        gl_FragColor = vec4(sky, 1.0);

      }

    `,

    side: THREE.BackSide,

    depthWrite: false,

  });

}



function createSunGlowTexture() {

  const canvas = document.createElement("canvas");

  canvas.width = 256;

  canvas.height = 256;

  const ctx = canvas.getContext("2d");

  if (!ctx) {

    return new THREE.CanvasTexture(canvas);

  }



  const center = canvas.width / 2;

  const gradient = ctx.createRadialGradient(center, center, 4, center, center, center);

  gradient.addColorStop(0, "rgba(246, 250, 255, 0.58)");
  gradient.addColorStop(0.16, "rgba(232, 242, 255, 0.22)");
  gradient.addColorStop(0.45, "rgba(214, 234, 255, 0.08)");
  gradient.addColorStop(1, "rgba(214, 234, 255, 0)");

  ctx.fillStyle = gradient;

  ctx.fillRect(0, 0, canvas.width, canvas.height);



  const texture = new THREE.CanvasTexture(canvas);

  texture.colorSpace = THREE.SRGBColorSpace;

  texture.needsUpdate = true;

  return texture;

}



function createCloudTexture(seed: number) {

  const canvas = document.createElement("canvas");

  canvas.width = 256;

  canvas.height = 128;

  const ctx = canvas.getContext("2d");

  if (!ctx) {

    return new THREE.CanvasTexture(canvas);

  }



  const random = seededRandom(seed);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 11; i += 1) {

    const x = canvas.width * (0.14 + random() * 0.72);

    const y = canvas.height * (0.36 + random() * 0.22);

    const radiusX = canvas.width * (0.1 + random() * 0.13);

    const radiusY = canvas.height * (0.08 + random() * 0.12);

    const gradient = ctx.createRadialGradient(x, y, 2, x, y, radiusX);

    gradient.addColorStop(0, "rgba(255, 255, 255, 0.42)");
    gradient.addColorStop(0.48, "rgba(226, 238, 250, 0.20)");
    gradient.addColorStop(1, "rgba(190, 212, 234, 0)");

    ctx.fillStyle = gradient;

    ctx.beginPath();

    ctx.ellipse(x, y, radiusX, radiusY, (random() - 0.5) * 0.28, 0, Math.PI * 2);

    ctx.fill();

  }

  ctx.fillStyle = "rgba(28, 37, 47, 0.18)";

  ctx.fillRect(0, canvas.height * 0.58, canvas.width, canvas.height * 0.12);

  drawTextureNoise(ctx, canvas.width, canvas.height, 0.01, seed + 17);



  const texture = new THREE.CanvasTexture(canvas);

  texture.colorSpace = THREE.SRGBColorSpace;

  texture.minFilter = THREE.LinearFilter;

  texture.magFilter = THREE.LinearFilter;

  texture.needsUpdate = true;

  return texture;

}



function addGroundShadow(

  scene: THREE.Scene,

  disposables: DisposableSceneResource[],

  x: number,

  y: number,

  z: number,

  scaleX: number,

  scaleY: number,

  opacity: number,

) {

  const shadowGeometry = new THREE.CircleGeometry(1, 28);

  const shadowMaterial = new THREE.MeshBasicMaterial({

    color: 0x14120f,

    transparent: true,

    opacity,

    depthWrite: false,

  });

  const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);

  shadow.position.set(x, y, z + 0.018);

  shadow.scale.set(scaleX, scaleY, 1);

  scene.add(shadow);

  disposables.push(shadowGeometry, shadowMaterial);

}



function addCloud(

  scene: THREE.Scene,

  disposables: DisposableSceneResource[],

  position: THREE.Vector3,

  scale: number,

) {

  const texture = createCloudTexture(Math.round((position.x * 17 + position.y * 23 + position.z * 5) * 31));

  const material = new THREE.SpriteMaterial({

    map: texture,

    color: 0xf4faff,

    transparent: true,

    opacity: 0.34,

    depthWrite: false,

  });

  const cloud = new THREE.Sprite(material);

  cloud.position.copy(position);

  cloud.scale.set(scale * 6.2, scale * 2.05, 1);

  scene.add(cloud);

  disposables.push(texture, material);

}



function createSunShaftTexture() {

  const canvas = document.createElement("canvas");

  canvas.width = 128;

  canvas.height = 512;

  const ctx = canvas.getContext("2d");

  if (!ctx) {

    return new THREE.CanvasTexture(canvas);

  }



  const horizontalFade = ctx.createLinearGradient(0, 0, canvas.width, 0);

  horizontalFade.addColorStop(0, "rgba(255, 190, 108, 0)");

  horizontalFade.addColorStop(0.5, "rgba(255, 190, 108, 0.34)");

  horizontalFade.addColorStop(1, "rgba(255, 190, 108, 0)");

  ctx.fillStyle = horizontalFade;

  ctx.fillRect(0, 0, canvas.width, canvas.height);



  ctx.globalCompositeOperation = "destination-in";

  const verticalFade = ctx.createLinearGradient(0, 0, 0, canvas.height);

  verticalFade.addColorStop(0, "rgba(255, 255, 255, 0)");

  verticalFade.addColorStop(0.18, "rgba(255, 255, 255, 0.72)");

  verticalFade.addColorStop(0.64, "rgba(255, 255, 255, 0.2)");

  verticalFade.addColorStop(1, "rgba(255, 255, 255, 0)");

  ctx.fillStyle = verticalFade;

  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.globalCompositeOperation = "source-over";



  drawTextureNoise(ctx, canvas.width, canvas.height, 0.012, 16427);



  const texture = new THREE.CanvasTexture(canvas);

  texture.colorSpace = THREE.SRGBColorSpace;

  texture.minFilter = THREE.LinearFilter;

  texture.magFilter = THREE.LinearFilter;

  texture.needsUpdate = true;

  return texture;

}



function addSunShafts(

  scene: THREE.Scene,

  disposables: DisposableSceneResource[],

  sunPosition: THREE.Vector3,

  center: THREE.Vector3,

  radius: number,

  groundZ: number,

) {

  const texture = createSunShaftTexture();

  const material = new THREE.SpriteMaterial({

    map: texture,

    color: 0xe8f3ff,

    transparent: true,

    opacity: 0.022,

    depthWrite: false,

    depthTest: true,

    fog: false,

  });

  const direction = sunPosition.clone().sub(center).normalize();

  const right = new THREE.Vector3(-direction.y, direction.x, 0).normalize();

  const base = center.clone().lerp(sunPosition, 0.34);

  for (let i = 0; i < 5; i += 1) {

    const shaft = new THREE.Sprite(material);

    const spread = (i - 2) * clamp(radius * 0.16, 7, 26);

    shaft.position.copy(base)

      .addScaledVector(right, spread)

      .setZ(groundZ + clamp(radius * (0.74 + i * 0.045), 26, 112));

    shaft.scale.set(clamp(radius * (0.36 + i * 0.05), 22, 92), clamp(radius * 1.25, 80, 240), 1);

    scene.add(shaft);

  }

  disposables.push(texture, material);

}



function seededRandom(seed: number) {

  let state = seed >>> 0;

  return () => {

    state = (state * 1664525 + 1013904223) >>> 0;

    return state / 0xffffffff;

  };

}



function createOrganicBlobGeometry(radius: number, seed: number) {

  const geometry = new THREE.IcosahedronGeometry(radius, 2);

  const random = seededRandom(seed);

  const position = geometry.getAttribute("position");

  const vertex = new THREE.Vector3();

  for (let i = 0; i < position.count; i += 1) {

    vertex.set(position.getX(i), position.getY(i), position.getZ(i));

    const length = Math.max(vertex.length(), 0.001);

    const variation = 0.76 + random() * 0.38;

    vertex.multiplyScalar((radius * variation) / length);

    position.setXYZ(i, vertex.x, vertex.y, vertex.z);

  }

  position.needsUpdate = true;

  geometry.computeVertexNormals();

  return geometry;

}



function addTreeInstanced(

  scene: THREE.Scene,

  disposables: DisposableSceneResource[],

  treePositions: Array<{ x: number; y: number; z: number; scale: number }>,

  cameraPosition?: THREE.Vector3,

) {

  if (treePositions.length === 0) return;



  // Shared materials for all trees

  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x5d4633, roughness: 0.95, metalness: 0 });

  const crownMaterials = [

    new THREE.MeshStandardMaterial({ color: 0x4a6f3f, roughness: 0.92, metalness: 0 }),

    new THREE.MeshStandardMaterial({ color: 0x3f5f38, roughness: 0.92, metalness: 0 }),

    new THREE.MeshStandardMaterial({ color: 0x52784a, roughness: 0.92, metalness: 0 }),

  ];



  // Create LOD levels for trees

  const LOD_DISTANCES = { high: 30, medium: 60 }; // distances for LOD switching



  // Group trees by distance from camera (or center if no camera)

  const center = new THREE.Vector3();

  if (treePositions.length > 0) {

    treePositions.forEach(pos => center.add(new THREE.Vector3(pos.x, pos.y, pos.z)));

    center.divideScalar(treePositions.length);

  }

  const referencePoint = cameraPosition || center;



  const highDetailTrees: typeof treePositions = [];

  const mediumDetailTrees: typeof treePositions = [];

  const lowDetailTrees: typeof treePositions = [];



  treePositions.forEach(pos => {

    const dist = Math.sqrt(

      (pos.x - referencePoint.x) ** 2 +

      (pos.y - referencePoint.y) ** 2 +

      (pos.z - referencePoint.z) ** 2

    );



    if (dist < LOD_DISTANCES.high) {

      highDetailTrees.push(pos);

    } else if (dist < LOD_DISTANCES.medium) {

      mediumDetailTrees.push(pos);

    } else {

      lowDetailTrees.push(pos);

    }

  });



  // High detail: full geometry (3 crown parts)

  if (highDetailTrees.length > 0) {

    createTreeLODLevel(scene, disposables, highDetailTrees, trunkMaterial, crownMaterials, 'high');

  }



  // Medium detail: simplified geometry (2 crown parts)

  if (mediumDetailTrees.length > 0) {

    createTreeLODLevel(scene, disposables, mediumDetailTrees, trunkMaterial, crownMaterials, 'medium');

  }



  // Low detail: billboard sprites (already handled by addDistantTreeLine)

  // For very distant trees, we could add billboards here

}



function createTreeLODLevel(

  scene: THREE.Scene,

  disposables: DisposableSceneResource[],

  treePositions: Array<{ x: number; y: number; z: number; scale: number }>,

  trunkMaterial: THREE.MeshStandardMaterial,

  crownMaterials: THREE.MeshStandardMaterial[],

  level: 'high' | 'medium' | 'low',

) {

  if (treePositions.length === 0) return;



  // Adjust geometry complexity based on LOD level

  const trunkSegments = level === 'high' ? 8 : level === 'medium' ? 6 : 4;

  const crownDetail = level === 'high' ? 3 : level === 'medium' ? 2 : 1;



  const trunkGeometry = new THREE.CylinderGeometry(0.10, 0.17, 1.55, trunkSegments);

  trunkGeometry.rotateX(Math.PI / 2);

  const trunkInstanced = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, treePositions.length);

  trunkInstanced.castShadow = level === 'high';

  trunkInstanced.receiveShadow = true;



  // Crown parts based on LOD level

  const crownConfigs = [

    { radius: 0.62, seed: 12345, offset: [0, 0, 2.04], scale: [1.1, 0.82, 0.76] },

    { radius: 0.48, seed: 67890, offset: [-0.36, -0.15, 1.88], scale: [1.22, 0.9, 0.88] },

    { radius: 0.46, seed: 11111, offset: [0.34, 0.12, 1.92], scale: [1.1, 0.82, 0.88] },

  ];



  const activeCrownConfigs = crownConfigs.slice(0, crownDetail);

  const crownGeometries = activeCrownConfigs.map(config =>

    createOrganicBlobGeometry(config.radius, config.seed)

  );



  const crownInstanced = crownGeometries.map((geom, idx) => {

    const instanced = new THREE.InstancedMesh(geom, crownMaterials[idx], treePositions.length);

    instanced.castShadow = level === 'high';

    instanced.receiveShadow = level !== 'low';

    return instanced;

  });



  const matrix = new THREE.Matrix4();

  const position = new THREE.Vector3();

  const quaternion = new THREE.Quaternion();

  const scale = new THREE.Vector3();



  treePositions.forEach((pos, i) => {

    // Trunk

    position.set(pos.x, pos.y, pos.z + 0.76 * pos.scale);

    quaternion.identity();

    scale.set(pos.scale, pos.scale, pos.scale);

    matrix.compose(position, quaternion, scale);

    trunkInstanced.setMatrixAt(i, matrix);



    // Crown parts

    activeCrownConfigs.forEach((config, idx) => {

      position.set(

        pos.x + config.offset[0] * pos.scale,

        pos.y + config.offset[1] * pos.scale,

        pos.z + config.offset[2] * pos.scale,

      );

      scale.set(

        config.scale[0] * pos.scale,

        config.scale[1] * pos.scale,

        config.scale[2] * pos.scale,

      );

      matrix.compose(position, quaternion, scale);

      crownInstanced[idx].setMatrixAt(i, matrix);

    });



    // Add ground shadow only for high detail

    if (level === 'high') {

      addGroundShadow(scene, disposables, pos.x, pos.y, pos.z, 0.72 * pos.scale, 0.46 * pos.scale, 0.16);

    }

  });



  scene.add(trunkInstanced);

  crownInstanced.forEach((inst) => scene.add(inst));



  disposables.push(trunkGeometry, ...crownGeometries);

}



function addShrubInstanced(

  scene: THREE.Scene,

  disposables: DisposableSceneResource[],

  shrubPositions: Array<{ x: number; y: number; z: number; scale: number }>,

) {

  if (shrubPositions.length === 0) return;



  const geometry = new THREE.SphereGeometry(0.46, 8, 6);

  const material = new THREE.MeshStandardMaterial({ color: 0x496b3f, roughness: 0.92 });

  const instanced = new THREE.InstancedMesh(geometry, material, shrubPositions.length);

  instanced.castShadow = true;

  instanced.receiveShadow = true;



  const matrix = new THREE.Matrix4();

  const position = new THREE.Vector3();

  const quaternion = new THREE.Quaternion();

  const scale = new THREE.Vector3();



  shrubPositions.forEach((pos, i) => {

    position.set(pos.x, pos.y, pos.z + 0.28 * pos.scale);

    quaternion.identity();

    scale.set(1.35 * pos.scale, 1.05 * pos.scale, 0.62 * pos.scale);

    matrix.compose(position, quaternion, scale);

    instanced.setMatrixAt(i, matrix);



    // Add ground shadow

    addGroundShadow(scene, disposables, pos.x, pos.y, pos.z, 0.54 * pos.scale, 0.34 * pos.scale, 0.12);

  });



  scene.add(instanced);

  disposables.push(geometry, material);

}



function addTree(

  scene: THREE.Scene,

  disposables: DisposableSceneResource[],

  x: number,

  y: number,

  z: number,

  scale: number,

) {

  addGroundShadow(scene, disposables, x, y, z, 0.72 * scale, 0.46 * scale, 0.16);



  const trunkGeometry = new THREE.CylinderGeometry(0.10 * scale, 0.17 * scale, 1.55 * scale, 8);

  trunkGeometry.rotateX(Math.PI / 2);

  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x5d4633, roughness: 0.95, metalness: 0 });

  const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);

  trunk.position.set(x, y, z + 0.76 * scale);

  trunk.castShadow = true;

  trunk.receiveShadow = true;

  scene.add(trunk);



  const crownParts = [

    [0, 0, 2.04, 0.62, 0x4a6f3f],

    [-0.36, -0.15, 1.88, 0.48, 0x3f5f38],

    [0.34, 0.12, 1.92, 0.46, 0x52784a],

  ];

  crownParts.forEach(([ox, oy, oz, blobScale, color], index) => {

    const crownGeometry = createOrganicBlobGeometry(

      scale * (blobScale as number),

      Math.round((x * 11.3 + y * 7.7 + index * 31.1) * 1000),

    );

    const crownMaterial = new THREE.MeshStandardMaterial({

      color: color as number,

      roughness: 0.92,

      metalness: 0,

    });

    const crown = new THREE.Mesh(crownGeometry, crownMaterial);

    crown.scale.set(1.1 + (index % 2) * 0.12, 0.82 + (index % 3) * 0.08, 0.76 + (index % 2) * 0.12);

    crown.position.set(x + ox * scale, y + oy * scale, z + oz * scale);

    crown.castShadow = true;

    crown.receiveShadow = true;

    scene.add(crown);

    disposables.push(crownGeometry, crownMaterial);

  });

  disposables.push(trunkGeometry, trunkMaterial);

}



function addShrub(

  scene: THREE.Scene,

  disposables: DisposableSceneResource[],

  x: number,

  y: number,

  z: number,

  scale: number,

) {

  addGroundShadow(scene, disposables, x, y, z, 0.54 * scale, 0.34 * scale, 0.12);



  const geometry = new THREE.SphereGeometry(0.46 * scale, 8, 6);

  const material = new THREE.MeshStandardMaterial({ color: 0x496b3f, roughness: 0.92 });

  const shrub = new THREE.Mesh(geometry, material);

  shrub.scale.set(1.35, 1.05, 0.62);

  shrub.position.set(x, y, z + 0.28 * scale);

  shrub.castShadow = true;

  shrub.receiveShadow = true;

  scene.add(shrub);

  disposables.push(geometry, material);

}



function createTreeBillboardTexture(seed: number) {

  const canvas = document.createElement("canvas");

  canvas.width = 256;

  canvas.height = 384;

  const ctx = canvas.getContext("2d");

  if (!ctx) {

    return new THREE.CanvasTexture(canvas);

  }



  const random = seededRandom(seed);

  ctx.clearRect(0, 0, canvas.width, canvas.height);



  const trunkGradient = ctx.createLinearGradient(112, 190, 146, canvas.height);

  trunkGradient.addColorStop(0, "rgba(83, 62, 44, 0.86)");

  trunkGradient.addColorStop(1, "rgba(42, 31, 24, 0.76)");

  ctx.fillStyle = trunkGradient;

  ctx.beginPath();

  ctx.moveTo(118, canvas.height);

  ctx.lineTo(137, canvas.height);

  ctx.lineTo(133, 172);

  ctx.lineTo(122, 172);

  ctx.closePath();

  ctx.fill();



  for (let i = 0; i < 16; i += 1) {

    const x = 76 + random() * 105;

    const y = 52 + random() * 126;

    const radiusX = 34 + random() * 48;

    const radiusY = 28 + random() * 48;

    const gradient = ctx.createRadialGradient(x, y, 6, x, y, Math.max(radiusX, radiusY));

    const tone = 56 + Math.round(random() * 34);

    gradient.addColorStop(0, `rgba(${tone}, ${88 + Math.round(random() * 38)}, ${48 + Math.round(random() * 20)}, 0.82)`);

    gradient.addColorStop(0.62, `rgba(${34 + Math.round(random() * 20)}, ${67 + Math.round(random() * 28)}, ${39 + Math.round(random() * 12)}, 0.62)`);

    gradient.addColorStop(1, "rgba(24, 42, 29, 0)");

    ctx.fillStyle = gradient;

    ctx.beginPath();

    ctx.ellipse(x, y, radiusX, radiusY, (random() - 0.5) * 0.5, 0, Math.PI * 2);

    ctx.fill();

  }



  ctx.globalCompositeOperation = "destination-in";

  const fade = ctx.createLinearGradient(0, 0, 0, canvas.height);

  fade.addColorStop(0, "rgba(255, 255, 255, 0.92)");

  fade.addColorStop(0.86, "rgba(255, 255, 255, 0.88)");

  fade.addColorStop(1, "rgba(255, 255, 255, 0)");

  ctx.fillStyle = fade;

  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.globalCompositeOperation = "source-over";



  const texture = new THREE.CanvasTexture(canvas);

  texture.colorSpace = THREE.SRGBColorSpace;

  texture.minFilter = THREE.LinearFilter;

  texture.magFilter = THREE.LinearFilter;

  texture.needsUpdate = true;

  return texture;

}



function addDistantTreeLine(

  scene: THREE.Scene,

  disposables: DisposableSceneResource[],

  walkBounds: WalkBounds,

  groundZ: number,

  radius: number,

) {

  const textures = Array.from({ length: 8 }, (_, index) => createTreeBillboardTexture(8200 + index * 137));

  const materials = textures.map((texture) => new THREE.SpriteMaterial({

    map: texture,

    color: 0xd6dfcf,

    transparent: true,

    opacity: 0.82,

    depthWrite: false,

    fog: true,

  }));

  disposables.push(...textures, ...materials);



  const random = seededRandom(27141);

  const siteWidth = walkBounds.maxX - walkBounds.minX;

  const siteDepth = walkBounds.maxY - walkBounds.minY;

  const count = 54;

  const margin = clamp(radius * 0.18, 8, 22);

  for (let i = 0; i < count; i += 1) {

    const side = i % 4;

    const t = (i / count + random() * 0.18) % 1;

    const x = side < 2

      ? walkBounds.minX + siteWidth * t

      : (side === 2 ? walkBounds.minX - margin : walkBounds.maxX + margin);

    const y = side >= 2

      ? walkBounds.minY + siteDepth * t

      : (side === 0 ? walkBounds.minY - margin : walkBounds.maxY + margin);

    const height = clamp(radius * (0.055 + random() * 0.035), 5.5, 13.5);

    const width = height * (0.48 + random() * 0.2);

    const sprite = new THREE.Sprite(materials[i % materials.length]);

    sprite.position.set(

      x + (random() - 0.5) * margin * 0.65,

      y + (random() - 0.5) * margin * 0.65,

      groundZ + height * 0.5 - 0.08,

    );

    sprite.scale.set(width, height, 1);

    scene.add(sprite);

  }

}



function addSiteBench(

  scene: THREE.Scene,

  disposables: DisposableSceneResource[],

  x: number,

  y: number,

  z: number,

  rotation: number,

) {

  const material = new THREE.MeshStandardMaterial({ color: 0x6f5a42, roughness: 0.72 });

  const metalMaterial = new THREE.MeshStandardMaterial({ color: 0x4a5054, roughness: 0.5, metalness: 0.22 });

  const group = new THREE.Group();

  group.position.set(x, y, z);

  group.rotation.z = rotation;

  addGroundShadow(scene, disposables, x, y, z, 0.9, 0.34, 0.11);



  const seatGeometry = new THREE.BoxGeometry(1.5, 0.34, 0.12);

  const backGeometry = new THREE.BoxGeometry(1.5, 0.10, 0.58);

  const legGeometry = new THREE.BoxGeometry(0.1, 0.08, 0.48);

  const seat = new THREE.Mesh(seatGeometry, material);

  seat.position.set(0, 0, 0.5);

  group.add(seat);

  const back = new THREE.Mesh(backGeometry, material);

  back.position.set(0, 0.22, 0.78);

  back.rotation.x = -0.18;

  group.add(back);

  [-0.55, 0.55].forEach((offsetX) => {

    [-0.1, 0.14].forEach((offsetY) => {

      const leg = new THREE.Mesh(legGeometry, metalMaterial);

      leg.position.set(offsetX, offsetY, 0.24);

      group.add(leg);

    });

  });



  scene.add(group);

  disposables.push(seatGeometry, backGeometry, legGeometry, material, metalMaterial);

}



function addCinematicMuseumSetPieces(

  scene: THREE.Scene,

  disposables: DisposableSceneResource[],

  buildingClusters: BuildingCluster[],

  walkBounds: WalkBounds,

  groundZ: number,

  radius: number,

) {

  const outlineMaterial = new THREE.LineBasicMaterial({

    color: 0xffd89a,

    transparent: true,

    opacity: 0.28,

  });

  const warmGlowMaterial = new THREE.MeshBasicMaterial({

    color: 0xffd6a0,

    transparent: true,

    opacity: 0.45,

    blending: THREE.AdditiveBlending,

    depthWrite: false,

  });

  const warmGlowIntenseMaterial = new THREE.MeshBasicMaterial({

    color: 0xffe8c0,

    transparent: true,

    opacity: 0.55,

    blending: THREE.AdditiveBlending,

    depthWrite: false,

  });

  const coolGlowMaterial = new THREE.MeshBasicMaterial({

    color: 0x8fd9ff,

    transparent: true,

    opacity: 0.22,

    blending: THREE.AdditiveBlending,

    depthWrite: false,

  });

  const canopyMaterial = new THREE.MeshPhysicalMaterial({

    color: 0x8f979e,

    roughness: 0.55,

    metalness: 0.12,

    clearcoat: 0.25,

    clearcoatRoughness: 0.3,

    reflectivity: 0.35,

    envMapIntensity: 0.8,

  });

  const portalMaterial = new THREE.MeshPhysicalMaterial({

    color: 0x5a5048,

    roughness: 0.55,

    metalness: 0.08,

    clearcoat: 0.4,

    clearcoatRoughness: 0.3,

    envMapIntensity: 0.9,

  });

  const poolMaterial = new THREE.MeshPhysicalMaterial({

    color: 0x0a181f,

    roughness: 0.04,

    metalness: 0.0,

    transparent: true,

    opacity: 0.72,

    // 真实折射（transmission）会触发昂贵的离屏折射渲染，改为廉价透明水面
    ior: 1.33,

    envMapIntensity: 2.2,

    clearcoat: 1,

    clearcoatRoughness: 0.03,

    reflectivity: 1.0,

  });

  const contactMaterial = new THREE.MeshBasicMaterial({

    color: 0x05070a,

    transparent: true,

    opacity: 0.3,

    depthWrite: false,

  });

  const bollardBodyGeometry = new THREE.CylinderGeometry(0.055, 0.075, 0.62, 12);

  bollardBodyGeometry.rotateX(Math.PI / 2);

  const bollardBodyMaterial = new THREE.MeshPhysicalMaterial({

    color: 0x1d2125,

    roughness: 0.35,

    metalness: 0.85,

    clearcoat: 1,

    clearcoatRoughness: 0.08,

  });

  const bollardLightGeometry = new THREE.SphereGeometry(0.105, 14, 8);



  buildingClusters.slice(0, 2).forEach((cluster, clusterIndex) => {

    const outlineGeometry = new THREE.BoxGeometry(

      cluster.size.x + 0.18,

      cluster.size.y + 0.18,

      cluster.size.z + 0.18,

    );

    const outlineEdges = new THREE.EdgesGeometry(outlineGeometry);

    const outline = new THREE.LineSegments(outlineEdges, outlineMaterial);

    outline.position.copy(cluster.center);

    scene.add(outline);

    disposables.push(outlineGeometry, outlineEdges);



    const contactGeometry = new THREE.PlaneGeometry(cluster.size.x * 1.08, cluster.size.y * 1.08);

    const contact = new THREE.Mesh(contactGeometry, contactMaterial);

    contact.position.set(cluster.center.x, cluster.center.y, groundZ + 0.007);

    scene.add(contact);

    disposables.push(contactGeometry);



    const roofZ = cluster.bounds.max.z + 0.1;

    const stripLongGeometry = new THREE.BoxGeometry(clamp(cluster.size.x * 0.9, 6, 44), 0.075, 0.055);

    const stripSideGeometry = new THREE.BoxGeometry(0.075, clamp(cluster.size.y * 0.9, 6, 44), 0.055);

    [-1, 1].forEach((side) => {

      const longStrip = new THREE.Mesh(stripLongGeometry, clusterIndex % 2 === 0 ? warmGlowMaterial : coolGlowMaterial);

      longStrip.position.set(cluster.center.x, cluster.center.y + side * cluster.size.y * 0.48, roofZ);

      scene.add(longStrip);

      const sideStrip = new THREE.Mesh(stripSideGeometry, clusterIndex % 2 === 0 ? coolGlowMaterial : warmGlowMaterial);

      sideStrip.position.set(cluster.center.x + side * cluster.size.x * 0.48, cluster.center.y, roofZ + 0.02);

      scene.add(sideStrip);

    });

    disposables.push(stripLongGeometry, stripSideGeometry);



    const apron = clamp(Math.max(cluster.size.x, cluster.size.y) * 0.12, 2.6, 8.5);

    const frontY = cluster.bounds.min.y - apron * 0.22;

    const entryWidth = clamp(cluster.size.x * 0.24, 3.2, 12);

    const entryHeight = clamp(cluster.size.z * 0.26, 2.0, 5.2);

    const entryZ = groundZ + entryHeight * 0.5;

    const columnGeometry = new THREE.BoxGeometry(0.22, 0.28, entryHeight);

    const beamGeometry = new THREE.BoxGeometry(entryWidth + 0.42, 0.3, 0.24);

    [-1, 1].forEach((side) => {

      const column = new THREE.Mesh(columnGeometry, portalMaterial);

      column.position.set(cluster.center.x + side * entryWidth * 0.5, frontY, entryZ);

      column.castShadow = true;

      column.receiveShadow = true;

      scene.add(column);

    });

    const beam = new THREE.Mesh(beamGeometry, portalMaterial);

    beam.position.set(cluster.center.x, frontY, groundZ + entryHeight + 0.1);

    beam.castShadow = true;

    beam.receiveShadow = true;

    scene.add(beam);

    disposables.push(columnGeometry, beamGeometry);



    const canopyGeometry = new THREE.BoxGeometry(entryWidth * 1.36, apron * 0.58, 0.18);

    const canopy = new THREE.Mesh(canopyGeometry, canopyMaterial);

    canopy.position.set(cluster.center.x, frontY - apron * 0.16, groundZ + entryHeight + 0.38);

    canopy.castShadow = true;

    canopy.receiveShadow = true;

    scene.add(canopy);

    disposables.push(canopyGeometry);



    const entryGlowGeometry = new THREE.BoxGeometry(entryWidth * 0.78, 0.045, entryHeight * 0.62);

    const entryGlow = new THREE.Mesh(entryGlowGeometry, warmGlowIntenseMaterial);

    entryGlow.position.set(cluster.center.x, frontY - 0.16, groundZ + entryHeight * 0.5);

    scene.add(entryGlow);

    disposables.push(entryGlowGeometry);



    const poolGeometry = new THREE.PlaneGeometry(clamp(cluster.size.x * 0.38, 4, 18), clamp(cluster.size.y * 0.16, 2, 8));

    const pool = new THREE.Mesh(poolGeometry, poolMaterial);

    pool.position.set(cluster.center.x, frontY - apron * 1.15, groundZ + 0.019);

    scene.add(pool);

    disposables.push(poolGeometry);



    const spot = new THREE.SpotLight(0xe5f1ff, 4.2, clamp(radius * 0.68, 16, 56), Math.PI / 5.8, 0.48, 1.0);

    spot.position.set(cluster.center.x, frontY - apron * 0.65, groundZ + entryHeight + 0.2);

    spot.target.position.set(cluster.center.x, frontY + apron * 0.35, groundZ + 0.7);

    spot.castShadow = false;

    scene.add(spot, spot.target);



    const bollardCount = clamp(Math.floor(entryWidth / 1.25), 4, 8);

    for (let i = 0; i < bollardCount; i += 1) {

      const t = bollardCount === 1 ? 0.5 : i / (bollardCount - 1);

      const x = cluster.center.x - entryWidth * 0.66 + entryWidth * 1.32 * t;

      const y = clamp(frontY - apron * 0.82, walkBounds.minY + 1.1, walkBounds.maxY - 1.1);

      const body = new THREE.Mesh(bollardBodyGeometry, bollardBodyMaterial);

      body.position.set(x, y, groundZ + 0.31);

      body.castShadow = true;

      scene.add(body);

      const lamp = new THREE.Mesh(bollardLightGeometry, warmGlowMaterial);

      lamp.position.set(x, y, groundZ + 0.68);

      scene.add(lamp);

    }

  });



  disposables.push(

    outlineMaterial,

    warmGlowMaterial,

    warmGlowIntenseMaterial,

    coolGlowMaterial,

    canopyMaterial,

    portalMaterial,

    poolMaterial,

    contactMaterial,

    bollardBodyGeometry,

    bollardBodyMaterial,

    bollardLightGeometry,

  );

}



function addFacadeAccents(

  scene: THREE.Scene,

  disposables: DisposableSceneResource[],

  buildingClusters: BuildingCluster[],

  groundZ: number,

) {

  const glassMaterial = new THREE.MeshPhysicalMaterial({

    color: 0xbfdcea,

    roughness: 0.05,

    metalness: 0.0,

    clearcoat: 1,

    clearcoatRoughness: 0.02,

    transmission: 0,

    ior: 1.5,

    reflectivity: 0.28,

    transparent: true,

    opacity: 0.34,

    emissive: 0x0a1622,

    emissiveIntensity: 0.04,

    envMapIntensity: 0.9,

  });

  const trimMaterial = new THREE.MeshPhysicalMaterial({

    color: 0x8e9291,

    roughness: 0.3,

    metalness: 0.92,

    clearcoat: 0.5,

    clearcoatRoughness: 0.1,

    reflectivity: 0.85,

    envMapIntensity: 1.3,

  });

  const warmInsetMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd09a,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
  });

  // 立面玻璃与暖光内衬面板数量多且互不重叠，收集后各自合并成单个透明网格，
  // 把上百次透明 draw call 压到 1 次
  const glassParts: THREE.BufferGeometry[] = [];
  const insetParts: THREE.BufferGeometry[] = [];



  buildingClusters.slice(0, 2).forEach((cluster) => {

    const facadeItems = cluster.items

      .filter((item) => {

        const itemSize = item.bounds.getSize(new THREE.Vector3());

        const verticalPlane = itemSize.z > 1.8

          && Math.max(itemSize.x, itemSize.y) > 2.4

          && Math.min(itemSize.x, itemSize.y) < clamp(Math.max(cluster.size.x, cluster.size.y) * 0.06, 0.75, 2.2);

        return (

          verticalPlane

          && item.bounds.max.z > groundZ + 2.0

          && item.bounds.min.z < cluster.bounds.min.z + cluster.size.z * 0.76

        );

      })

      .sort((a, b) => {

        const aSize = a.bounds.getSize(new THREE.Vector3());

        const bSize = b.bounds.getSize(new THREE.Vector3());

        return (Math.max(bSize.x, bSize.y) * bSize.z) - (Math.max(aSize.x, aSize.y) * aSize.z);

      })

      .slice(0, 10);



    facadeItems.forEach((item, itemIndex) => {

      const itemSize = item.bounds.getSize(new THREE.Vector3());

      const wallCenter = item.bounds.getCenter(new THREE.Vector3());

      const alignX = itemSize.x < itemSize.y;

      const longSide = alignX ? itemSize.y : itemSize.x;

      const panelCount = clamp(Math.floor(longSide / 4.4), 1, 3);

      const levelCount = itemSize.z > 5.2 ? 2 : 1;

      const panelWidth = clamp(longSide / (panelCount + 1.35), 1.25, 3.6);

      const panelHeight = clamp(itemSize.z / (levelCount + 2.2), 0.85, 2.2);

      const outward = alignX

        ? (wallCenter.x < cluster.center.x ? -1 : 1)

        : (wallCenter.y < cluster.center.y ? -1 : 1);



      for (let level = 0; level < levelCount; level += 1) {

        for (let slot = 0; slot < panelCount; slot += 1) {

          const offset = (slot - (panelCount - 1) / 2) * clamp(panelWidth * 1.35, 1.75, 4.2);

          const z = clamp(

            item.bounds.min.z + itemSize.z * (0.34 + level * 0.22),

            groundZ + 1.55,

            item.bounds.max.z - panelHeight * 0.55,

          );

          const panelGeometry = alignX

            ? new THREE.BoxGeometry(0.055, panelWidth, panelHeight)

            : new THREE.BoxGeometry(panelWidth, 0.055, panelHeight);

          const panel = new THREE.Mesh(panelGeometry, glassMaterial);

          if (alignX) {

            panel.position.set(

              outward > 0 ? item.bounds.max.x + 0.034 : item.bounds.min.x - 0.034,

              clamp(wallCenter.y + offset, item.bounds.min.y + panelWidth * 0.58, item.bounds.max.y - panelWidth * 0.58),

              z,

            );

          } else {

            panel.position.set(

              clamp(wallCenter.x + offset, item.bounds.min.x + panelWidth * 0.58, item.bounds.max.x - panelWidth * 0.58),

              outward > 0 ? item.bounds.max.y + 0.034 : item.bounds.min.y - 0.034,

              z,

            );

          }

          panel.updateMatrix();

          glassParts.push(panelGeometry.clone().applyMatrix4(panel.matrix));

          disposables.push(panelGeometry);



          if ((slot + level + itemIndex) % 3 === 0) {

            const glowGeometry = alignX

              ? new THREE.BoxGeometry(0.058, panelWidth * 0.92, panelHeight * 0.58)

              : new THREE.BoxGeometry(panelWidth * 0.92, 0.058, panelHeight * 0.58);

            const glow = new THREE.Mesh(glowGeometry, warmInsetMaterial);

            glow.position.copy(panel.position);

            glow.position.z += panelHeight * 0.04;

            glow.updateMatrix();

            insetParts.push(glowGeometry.clone().applyMatrix4(glow.matrix));

            disposables.push(glowGeometry);

          }



          const trimGeometry = alignX

            ? new THREE.BoxGeometry(0.07, panelWidth + 0.12, 0.045)

            : new THREE.BoxGeometry(panelWidth + 0.12, 0.07, 0.045);

          [-1, 1].forEach((edge) => {

            const trim = new THREE.Mesh(trimGeometry, trimMaterial);

            trim.position.copy(panel.position);

            trim.position.z += edge * panelHeight * 0.52;

            scene.add(trim);

          });

          disposables.push(trimGeometry);

        }

      }

    });

  });



  if (glassParts.length > 0) {
    const mergedGlass = mergeGeometries(glassParts);
    if (mergedGlass) {
      scene.add(new THREE.Mesh(mergedGlass, glassMaterial));
      disposables.push(mergedGlass);
    }
  }

  if (insetParts.length > 0) {
    const mergedInset = mergeGeometries(insetParts);
    if (mergedInset) {
      scene.add(new THREE.Mesh(mergedInset, warmInsetMaterial));
      disposables.push(mergedInset);
    }
  }

  glassParts.forEach((g) => disposables.push(g));

  insetParts.forEach((g) => disposables.push(g));

  disposables.push(glassMaterial, trimMaterial, warmInsetMaterial);

}



function addLandscapeDetails(

  scene: THREE.Scene,

  disposables: DisposableSceneResource[],

  buildingClusters: BuildingCluster[],

  walkBounds: WalkBounds,

  groundZ: number,

  radius: number,

) {

  const pathMaterial = new THREE.MeshStandardMaterial({ color: 0x7a7468, roughness: 0.92, metalness: 0.02 });

  const plazaMaterial = new THREE.MeshStandardMaterial({ color: 0x88857a, roughness: 0.85, metalness: 0.05 });

  const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0x6a6a60, roughness: 0.9, metalness: 0.02 });

  const lawnMaterial = new THREE.MeshStandardMaterial({ color: 0x58704a, roughness: 0.96 });

  const largest = buildingClusters[0];

  const siteWidth = walkBounds.maxX - walkBounds.minX;

  const siteDepth = walkBounds.maxY - walkBounds.minY;



  if (largest) {

    const pathGeometry = new THREE.PlaneGeometry(

      clamp(largest.size.x * 1.18, 10, siteWidth * 0.62),

      clamp(largest.size.y * 0.16, 2.2, 6.5),

    );

    const path = new THREE.Mesh(pathGeometry, pathMaterial);

    path.position.set(largest.center.x, largest.bounds.min.y - clamp(largest.size.y * 0.14, 2.2, 6), groundZ + 0.012);

    scene.add(path);

    disposables.push(pathGeometry);



    const plazaGeometry = new THREE.PlaneGeometry(

      clamp(largest.size.x * 0.42, 5, 14),

      clamp(largest.size.y * 0.32, 4, 12),

    );

    const plaza = new THREE.Mesh(plazaGeometry, plazaMaterial);

    plaza.position.set(largest.center.x, path.position.y - clamp(largest.size.y * 0.23, 4, 10), groundZ + 0.014);

    scene.add(plaza);

    disposables.push(plazaGeometry);



    const edgeWidth = clamp(largest.size.x * 1.18, 10, siteWidth * 0.62);

    const edgeOffset = clamp(largest.size.y * 0.085, 1.2, 3.4);

    const edgeGeometry = new THREE.PlaneGeometry(edgeWidth, 0.09);

    [-1, 1].forEach((side) => {

      const edge = new THREE.Mesh(edgeGeometry, edgeMaterial);

      edge.position.set(path.position.x, path.position.y + side * edgeOffset, groundZ + 0.018);

      scene.add(edge);

    });

    disposables.push(edgeGeometry);

  }



  buildingClusters.slice(0, 2).forEach((cluster, clusterIndex) => {

    const margin = clamp(Math.max(cluster.size.x, cluster.size.y) * 0.16, 2.2, 7);

    const positions = [

      [cluster.bounds.min.x - margin, cluster.bounds.min.y - margin],

      [cluster.center.x, cluster.bounds.min.y - margin],

      [cluster.bounds.max.x + margin, cluster.bounds.min.y - margin],

      [cluster.bounds.min.x - margin, cluster.center.y],

      [cluster.bounds.max.x + margin, cluster.center.y],

      [cluster.bounds.min.x - margin, cluster.bounds.max.y + margin],

      [cluster.center.x, cluster.bounds.max.y + margin],

      [cluster.bounds.max.x + margin, cluster.bounds.max.y + margin],

    ];

    positions.forEach(([x, y], index) => {

      const clampedX = clamp(x + ((index % 2) - 0.5) * margin * 0.28, walkBounds.minX + 1.4, walkBounds.maxX - 1.4);

      const clampedY = clamp(y + (((index + 1) % 2) - 0.5) * margin * 0.28, walkBounds.minY + 1.4, walkBounds.maxY - 1.4);

      addTree(scene, disposables, clampedX, clampedY, groundZ, clamp(radius * (0.014 + (index % 3) * 0.002), 0.68, 1.45));

      if (index % 2 === 0) {

        addShrub(scene, disposables, clampedX + margin * 0.38, clampedY - margin * 0.22, groundZ, clamp(radius * 0.012, 0.55, 1.15));

      }

    });



    for (let i = 0; i < 6; i += 1) {

      const t = (i + 1) / 7;

      const side = i % 2 === 0 ? -1 : 1;

      const x = clamp(cluster.bounds.min.x + cluster.size.x * t, walkBounds.minX + 1.2, walkBounds.maxX - 1.2);

      const y = clamp(

        side < 0 ? cluster.bounds.min.y - margin * 0.58 : cluster.bounds.max.y + margin * 0.58,

        walkBounds.minY + 1.2,

        walkBounds.maxY - 1.2,

      );

      addShrub(scene, disposables, x, y, groundZ, clamp(radius * 0.011, 0.5, 1.05));

    }



    if (clusterIndex < 2) {

      addSiteBench(

        scene,

        disposables,

        clamp(cluster.center.x - cluster.size.x * 0.18, walkBounds.minX + 2, walkBounds.maxX - 2),

        clamp(cluster.bounds.min.y - margin * 0.95, walkBounds.minY + 2, walkBounds.maxY - 2),

        groundZ,

        0,

      );

      addSiteBench(

        scene,

        disposables,

        clamp(cluster.center.x + cluster.size.x * 0.18, walkBounds.minX + 2, walkBounds.maxX - 2),

        clamp(cluster.bounds.max.y + margin * 0.95, walkBounds.minY + 2, walkBounds.maxY - 2),

        groundZ,

        Math.PI,

      );

    }

  });



  for (let i = 0; i < 4; i += 1) {

    const lawnGeometry = new THREE.PlaneGeometry(clamp(siteWidth * 0.14, 5, 18), clamp(siteDepth * 0.1, 4, 14));

    const lawn = new THREE.Mesh(lawnGeometry, lawnMaterial);

    const x = i < 2 ? walkBounds.minX + siteWidth * (0.18 + i * 0.18) : walkBounds.maxX - siteWidth * (0.18 + (i - 2) * 0.18);

    const y = i % 2 === 0 ? walkBounds.minY + siteDepth * 0.18 : walkBounds.maxY - siteDepth * 0.18;

    lawn.position.set(x, y, groundZ + 0.01);

    scene.add(lawn);

    disposables.push(lawnGeometry);

  }

  disposables.push(pathMaterial, plazaMaterial, edgeMaterial, lawnMaterial);

}



const FLAT_PANEL_TILT = 0.2;

interface RoofSurfaceInfo {
  item: SceneItem;
  kind: "flat" | "sloped";
  bounds: THREE.Box3;
  normal: THREE.Vector3;
  anchor: THREE.Vector3;
}

/**
 * 采样构件网格的上表面，返回面积加权的朝上法线与表面锚点。
 * 封闭实体（屋面板）上下表面的法线会相互抵消，因此只统计朝上/朝下中
 * 面积占优的一侧，用于识别坡屋面的坡向与坡度。
 */
function estimateRoofTopSurface(item: SceneItem): { normal: THREE.Vector3; anchor: THREE.Vector3 } | null {
  const geometry = item.mesh?.geometry as THREE.BufferGeometry | undefined;
  const positionAttr = geometry?.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!positionAttr || positionAttr.count < 3) {
    return null;
  }
  const index = geometry?.getIndex() ?? null;
  const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(positionAttr.count / 3);
  if (triangleCount < 1) {
    return null;
  }
  const step = Math.max(1, Math.floor(triangleCount / 900));
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const face = new THREE.Vector3();
  const upWeighted = new THREE.Vector3();
  const downWeighted = new THREE.Vector3();
  const upAnchor = new THREE.Vector3();
  const downAnchor = new THREE.Vector3();
  let upArea = 0;
  let downArea = 0;
  let totalArea = 0;
  for (let triangle = 0; triangle < triangleCount; triangle += step) {
    const i0 = index ? index.getX(triangle * 3) : triangle * 3;
    const i1 = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
    const i2 = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
    a.fromBufferAttribute(positionAttr, i0).add(item.mesh.position);
    b.fromBufferAttribute(positionAttr, i1).add(item.mesh.position);
    c.fromBufferAttribute(positionAttr, i2).add(item.mesh.position);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    face.crossVectors(ab, ac);
    const area = face.length() / 2;
    if (area <= 1e-6) {
      continue;
    }
    totalArea += area;
    if (face.z > 0) {
      upArea += area;
      upWeighted.add(face);
      upAnchor.addScaledVector(a, area).addScaledVector(b, area).addScaledVector(c, area);
    } else if (face.z < 0) {
      downArea += area;
      downWeighted.add(face);
      downAnchor.addScaledVector(a, area).addScaledVector(b, area).addScaledVector(c, area);
    }
  }
  const useUp = upArea >= downArea;
  const dominantArea = useUp ? upArea : downArea;
  if (dominantArea <= 0.5 || dominantArea < totalArea * 0.1) {
    return null;
  }
  const weighted = useUp ? upWeighted : downWeighted.negate();
  const normal = weighted.normalize();
  if (normal.z < 0.18) {
    return null;
  }
  const anchor = (useUp ? upAnchor : downAnchor).divideScalar(dominantArea * 3);
  return { normal, anchor };
}

/** 汇总一个建筑簇的平屋面（水平薄板）与坡屋面（几何采样呈明显倾角）候选面。 */
function collectRoofSurfaces(cluster: BuildingCluster, groundZ: number): RoofSurfaceInfo[] {
  // 高度门槛按簇内主要构件顶高的 70 分位推算，避免个别高耸构件（塔/城墙）抬高门槛漏掉真实屋面
  const topHeights = cluster.items
    .filter((item) => footprintArea(item.bounds) >= 3)
    .map((item) => item.bounds.max.z - groundZ)
    .sort((a, b) => a - b);
  const percentileHeight = topHeights.length
    ? topHeights[Math.min(topHeights.length - 1, Math.floor(topHeights.length * 0.7))]
    : cluster.size.z;
  const minHeight = groundZ + clamp(percentileHeight * 0.55, 2.8, 14);
  const surfaces: RoofSurfaceInfo[] = [];
  // 仅当构件直接坐落在候选面之上且覆盖大部分时才算“上层楼板”
  // （女儿墙、屋面梁底部嵌入屋面板，不会被误判为上方楼层）
  const hasStoryAbove = (item: SceneItem) => cluster.items.some((other) => {
    if (other === item) return false;
    if (other.bounds.min.z < item.bounds.max.z - 0.05) return false;
    const overlapX = Math.min(other.bounds.max.x, item.bounds.max.x) - Math.max(other.bounds.min.x, item.bounds.min.x);
    const overlapY = Math.min(other.bounds.max.y, item.bounds.max.y) - Math.max(other.bounds.min.y, item.bounds.min.y);
    if (overlapX <= 0 || overlapY <= 0) return false;
    return overlapX * overlapY >= footprintArea(item.bounds) * 0.45;
  });
  const isRoofish = (item: SceneItem, itemSize: { z: number }) => {
    const namedRoof = isRoofLikeSurface(item.element);
    if (namedRoof) return true;
    if (!isHorizontalSurface(item.element)) return false;
    if (itemSize.z > Math.max(0.9, cluster.size.z * 0.12)) return false;
    return !hasStoryAbove(item);
  };
  cluster.items.forEach((item) => {
    const itemSize = item.bounds.getSize(new THREE.Vector3());
    const isHighEnough = item.bounds.max.z > minHeight;
    const isLargeEnough = itemSize.x > 1.5 && itemSize.y > 1.5 && footprintArea(item.bounds) > 9;
    if (!isHighEnough || !isLargeEnough) {
      return;
    }
    if (!isRoofish(item, itemSize)) {
      return;
    }
    const top = estimateRoofTopSurface(item);
    const tilt = top ? Math.acos(clamp(top.normal.z, -1, 1)) : null;
    if (top != null && tilt != null && tilt >= 0.12 && tilt <= 1.05) {
      // 坡屋面：几何上表面呈明显倾角（约 7°~60°），板阵沿坡面法线贴附
      surfaces.push({ item, kind: "sloped", bounds: item.bounds, normal: top.normal, anchor: top.anchor });
      return;
    }
    if (top == null || (tilt != null && tilt < 0.12)) {
      // 平屋面：上表面水平（含上表面水平的网架/大厚度屋面板）
      surfaces.push({
        item,
        kind: "flat",
        bounds: item.bounds,
        normal: new THREE.Vector3(0, 0, 1),
        anchor: item.bounds.getCenter(new THREE.Vector3()),
      });
    }
  });
  return surfaces
    .sort((a, b) => footprintArea(b.bounds) - footprintArea(a.bounds))
    .slice(0, 8);
}

/**
 * 漫游场景光伏板：平屋面按行列铺倾斜板阵，坡屋面沿坡面法线贴附板阵。
 * 覆盖面积最大的若干建筑簇的大面积屋面，共享同一组材质便于静态合并。
 */
function addSolarPanels(
  scene: THREE.Scene,
  disposables: DisposableSceneResource[],
  buildingClusters: BuildingCluster[],
  groundZ: number,
) {
  const clusters = buildingClusters.slice(0, 4);
  const largestCluster = clusters[0];
  const baseSize = largestCluster?.size || new THREE.Vector3(20, 16, 8);
  const panelWidth = clamp(baseSize.x * 0.042, 0.9, 1.55);
  const panelDepth = clamp(baseSize.y * 0.032, 0.58, 1.05);
  const panelGeometry = new THREE.BoxGeometry(panelWidth, panelDepth, 0.06);
  const panelMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x4f6d84,
    roughness: 0.42,
    metalness: 0.08,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    reflectivity: 0.45,
    emissive: 0x000000,
    emissiveIntensity: 0,
    envMapIntensity: 0.45,
  });
  const frameGeometry = new THREE.BoxGeometry(panelWidth + 0.12, panelDepth + 0.12, 0.035);
  const frameMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x8a9198,
    roughness: 0.28,
    metalness: 0.9,
    clearcoat: 0.6,
    clearcoatRoughness: 0.12,
    reflectivity: 0.85,
    envMapIntensity: 1.3,
  });
  disposables.push(panelGeometry, panelMaterial, frameGeometry, frameMaterial);

  const upVector = new THREE.Vector3(0, 0, 1);
  let panelBudget = 800;
  // 已铺板位记录：相邻屋面板（平板/斜板、不同标高）各自布阵时避免互相重叠
  const placedPanels: Array<{ x: number; y: number; z: number }> = [];
  const isPanelOccupied = (x: number, y: number, z: number) => placedPanels.some((p) =>
    Math.abs(p.z - z) < 1.6
    && Math.abs(p.x - x) < panelWidth * 1.1
    && Math.abs(p.y - y) < panelDepth * 1.1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.far = 6.5;

  const placePanel = (position: THREE.Vector3, quaternion: THREE.Quaternion) => {
    if (panelBudget <= 0) {
      return;
    }
    panelBudget -= 1;
    const normalOffset = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
    const frame = new THREE.Mesh(frameGeometry, frameMaterial);
    frame.position.copy(position).addScaledVector(normalOffset, 0.05);
    frame.quaternion.copy(quaternion);
    frame.castShadow = true;
    scene.add(frame);
    const panel = new THREE.Mesh(panelGeometry, panelMaterial);
    panel.position.copy(position).addScaledVector(normalOffset, 0.11);
    panel.quaternion.copy(quaternion);
    panel.castShadow = true;
    scene.add(panel);
  };

  // 坡屋面全场最多铺 4 块大面，避免满屋顶零散小阵列
  let slopedArraysLeft = 4;

  clusters.forEach((cluster) => {
    const surfaces = collectRoofSurfaces(cluster, groundZ);

    // ---- 平屋面：同一标高的屋面板合并为一层，整层只铺一块对齐坐标轴的规整阵列 ----
    const flatLevels: Array<{ z: number; surfaces: RoofSurfaceInfo[] }> = [];
    surfaces
      .filter((surface) => surface.kind === "flat")
      .sort((a, b) => b.bounds.max.z - a.bounds.max.z)
      .forEach((surface) => {
        const level = flatLevels.find((entry) => Math.abs(entry.z - surface.bounds.max.z) <= 0.45);
        if (level) {
          level.surfaces.push(surface);
        } else {
          flatLevels.push({ z: surface.bounds.max.z, surfaces: [surface] });
        }
      });
    flatLevels
      .sort((a, b) => b.surfaces.reduce((sum, s) => sum + footprintArea(s.bounds), 0)
        - a.surfaces.reduce((sum, s) => sum + footprintArea(s.bounds), 0))
      .forEach((level) => {
        const levelArea = level.surfaces.reduce((sum, s) => sum + footprintArea(s.bounds), 0);
        if (levelArea < 20) {
          return;
        }
        const unionBox = new THREE.Box3();
        level.surfaces.forEach((surface) => unionBox.union(surface.bounds));
        // 边距整体内缩，留出女儿墙/檐口带
        const margin = Math.max(panelWidth, 1.1);
        const innerMinX = unionBox.min.x + margin;
        const innerMaxX = unionBox.max.x - margin;
        const innerMinY = unionBox.min.y + margin;
        const innerMaxY = unionBox.max.y - margin;
        if (innerMaxX <= innerMinX || innerMaxY <= innerMinY) {
          return;
        }
        const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), FLAT_PANEL_TILT);
        const stepX = panelWidth * 1.24;
        const stepY = panelDepth * 1.34;
        const columns = clamp(Math.floor((innerMaxX - innerMinX) / stepX) + 1, 1, 20);
        const rows = clamp(Math.floor((innerMaxY - innerMinY) / stepY) + 1, 1, 10);
        const slabMeshes = level.surfaces.map((surface) => surface.item.mesh);
        // 单板边缘再退距半块板宽，板缝/边角不放板
        const edgeInset = Math.max(margin - panelWidth * 0.35, 0.35);
        const probeZ = level.z + 3;
        for (let row = 0; row < rows; row += 1) {
          for (let col = 0; col < columns; col += 1) {
            const x = columns === 1 ? (innerMinX + innerMaxX) / 2 : innerMinX + ((innerMaxX - innerMinX) * col) / (columns - 1);
            const y = rows === 1 ? (innerMinY + innerMaxY) / 2 : innerMinY + ((innerMaxY - innerMinY) * row) / (rows - 1);
            if (isPanelOccupied(x, y, level.z)) {
              continue;
            }
            // 向下投射到本层屋面板上：L 形/拼合屋面自动裁边，只落在实际板上
            raycaster.set(new THREE.Vector3(x, y, probeZ), new THREE.Vector3(0, 0, -1));
            const hits = raycaster.intersectObjects(slabMeshes, false);
            for (const hit of hits) {
              if (hit.point.z < level.z - 1.2) {
                continue;
              }
              if (hit.face && hit.face.normal.z < 0.5) {
                continue;
              }
              const slab = level.surfaces.find((surface) => surface.item.mesh === hit.object);
              if (!slab) {
                continue;
              }
              if (
                hit.point.x < slab.bounds.min.x + edgeInset
                || hit.point.x > slab.bounds.max.x - edgeInset
                || hit.point.y < slab.bounds.min.y + edgeInset
                || hit.point.y > slab.bounds.max.y - edgeInset
              ) {
                continue;
              }
              placePanel(new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z + 0.02), quaternion);
              placedPanels.push({ x: hit.point.x, y: hit.point.y, z: level.z });
              break;
            }
          }
        }
      });

    // ---- 坡屋面：只铺面积最大的少数几块，板位射线贴合真实坡面 ----
    surfaces
      .filter((surface) => surface.kind === "sloped" && footprintArea(surface.bounds) >= 45)
      .sort((a, b) => footprintArea(b.bounds) - footprintArea(a.bounds))
      .forEach((surface) => {
        if (slopedArraysLeft <= 0) {
          return;
        }
        slopedArraysLeft -= 1;
        const roofBounds = surface.bounds;
        // 以水平屋脊方向 e1、沿坡向上方向 e2 建立面内坐标系
        const normal = surface.normal;
        const e1 = new THREE.Vector3().crossVectors(upVector, normal).normalize();
        const e2 = new THREE.Vector3().crossVectors(normal, e1).normalize();
        const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(e1, e2, normal));
        const corners: THREE.Vector3[] = [];
        [roofBounds.min.x, roofBounds.max.x].forEach((x) => {
          [roofBounds.min.y, roofBounds.max.y].forEach((y) => {
            [roofBounds.min.z, roofBounds.max.z].forEach((z) => {
              corners.push(new THREE.Vector3(x, y, z));
            });
          });
        });
        let uMin = Infinity;
        let uMax = -Infinity;
        let vMin = Infinity;
        let vMax = -Infinity;
        corners.forEach((corner) => {
          const delta = corner.clone().sub(surface.anchor);
          uMin = Math.min(uMin, delta.dot(e1));
          uMax = Math.max(uMax, delta.dot(e1));
          vMin = Math.min(vMin, delta.dot(e2));
          vMax = Math.max(vMax, delta.dot(e2));
        });
        const inset = 0.9;
        uMin += inset;
        uMax -= inset;
        vMin += inset;
        vMax -= inset;
        if (uMax - uMin < panelWidth || vMax - vMin < panelDepth) {
          return;
        }
        const stepU = panelWidth * 1.24;
        const stepV = panelDepth * 1.34;
        const columns = clamp(Math.floor((uMax - uMin) / stepU) + 1, 1, 18);
        const rows = clamp(Math.floor((vMax - vMin) / stepV) + 1, 1, 8);
        const spanU = (columns - 1) * stepU;
        const spanV = (rows - 1) * stepV;
        const startU = uMin + (uMax - uMin - spanU) / 2;
        const startV = vMin + (vMax - vMin - spanV) / 2;
        const testBounds = roofBounds.clone().expandByScalar(0.12);
        // 沿拟合平面法线向下投射到真实坡面取板位，阵列自然收进屋面边界
        const probeOffset = normal.clone().multiplyScalar(3);
        for (let row = 0; row < rows; row += 1) {
          for (let col = 0; col < columns; col += 1) {
            const planePoint = surface.anchor.clone()
              .addScaledVector(e1, startU + col * stepU)
              .addScaledVector(e2, startV + row * stepV);
            raycaster.set(planePoint.clone().add(probeOffset), normal.clone().negate());
            const hits = raycaster.intersectObject(surface.item.mesh, false);
            if (!hits.length) {
              continue;
            }
            const hit = hits[0];
            // 命中点偏离拟合平面过远，说明该处不属于这块坡面（如檐口外悬空）
            if (Math.abs(hit.distance - probeOffset.length()) > 2.2) {
              continue;
            }
            // 命中侧面（山墙/檐口板边）而非朝上屋面时跳过
            if (hit.face && hit.face.normal.z < 0.3) {
              continue;
            }
            const p = hit.point;
            if (!testBounds.containsPoint(p) || isPanelOccupied(p.x, p.y, p.z)) {
              continue;
            }
            placePanel(p, quaternion);
            placedPanels.push({ x: p.x, y: p.y, z: p.z });
          }
        }
      });
  });
}

/**
 * 女儿墙长城造型：沿墙顶生成“连续压顶带 + 等距垛口”的完整垛口剖面。
 * 沿构件外包矩形周界密集向下射线检测定位墙顶实际走向，
 * 压顶带沿墙连续铺设，垛块按固定节距立在其上，形成真正的凹凸轮廓。
 * 仅处理名称含“女儿墙/parapet”的构件，颜色取墙体色略加深。
 */
function addParapetCrenellations(
  scene: THREE.Scene,
  disposables: DisposableSceneResource[],
  buildingClusters: BuildingCluster[],
) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 3.4;
  const downVector = new THREE.Vector3(0, 0, -1);
  const materialCache = new Map<string, THREE.MeshStandardMaterial>();
  let totalMerlons = 0;

  // 生成一块沿 ab 方向铺设、截面 width×height、底面贴地的矩形块
  const appendParapetBlock = (
    parts: THREE.BufferGeometry[],
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    width: number,
    height: number,
  ) => {
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    if (length < 1e-3) {
      return;
    }
    const geometry = new THREE.BoxGeometry(length + width * 0.5, width, height);
    geometry.rotateZ(Math.atan2(dy, dx));
    geometry.translate((ax + bx) / 2, (ay + by) / 2, az + height / 2);
    parts.push(geometry);
  };

  buildingClusters.forEach((cluster) => {
    cluster.items.forEach((item) => {
      const text = elementSearchText(item.element);
      if (!/女儿墙|parapet/i.test(text)) {
        return;
      }
      const size = item.bounds.getSize(new THREE.Vector3());
      // 过滤掉矮压顶/超厚构件，只处理真正的带状女儿墙
      if (Math.max(size.x, size.y) < 2.5 || size.z < 0.35 || size.z > 3) {
        return;
      }
      const baseColor = item.material?.color ? item.material.color.clone() : new THREE.Color(0xcfc4ae);
      baseColor.multiplyScalar(0.88);
      const colorKey = baseColor.getHexString();
      let material = materialCache.get(colorKey);
      if (!material) {
        material = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.85 });
        materialCache.set(colorKey, material);
        disposables.push(material);
      }

      // 沿墙走向密集采样：每步先内圈后外圈轨迹，取第一个命中，保证点列沿墙有序
      const wallPoints: Array<{ x: number; y: number; z: number }> = [];
      const probeZ = item.bounds.max.z + 0.55;
      const marchEdge = (ax: number, ay: number, bx: number, by: number) => {
        const length = Math.hypot(bx - ax, by - ay);
        const steps = Math.max(2, Math.round(length / 0.3));
        const ox = ax - bx;
        const oy = ay - by;
        const edgeLen = Math.max(Math.abs(ox), Math.abs(oy), 1e-3);
        for (let i = 1; i < steps; i += 1) {
          const t = i / steps;
          const px = ax + (bx - ax) * t;
          const py = ay + (by - ay) * t;
          for (const inset of [0.14, 0.34]) {
            const x = px + (oy / edgeLen) * inset;
            const y = py + (-ox / edgeLen) * inset;
            raycaster.set(new THREE.Vector3(x, y, probeZ), downVector);
            const hits = raycaster.intersectObject(item.mesh, false);
            if (!hits.length) {
              continue;
            }
            const hit = hits[0];
            // 只认墙顶附近的命中，侧面/底部的命中跳过
            if (hit.point.z < item.bounds.max.z - 0.5) {
              continue;
            }
            wallPoints.push({ x, y, z: hit.point.z });
            break;
          }
        }
      };
      const minX = item.bounds.min.x;
      const maxX = item.bounds.max.x;
      const minY = item.bounds.min.y;
      const maxY = item.bounds.max.y;
      marchEdge(minX, minY, maxX, minY);
      marchEdge(maxX, minY, maxX, maxY);
      marchEdge(maxX, maxY, minX, maxY);
      marchEdge(minX, maxY, minX, minY);
      if (wallPoints.length < 4) {
        return;
      }

      const parts: THREE.BufferGeometry[] = [];
      // 连续压顶带：相邻命中点间距小于 0.85 视为同一段墙，逐段铺设
      for (let i = 1; i < wallPoints.length; i += 1) {
        const p0 = wallPoints[i - 1];
        const p1 = wallPoints[i];
        if (Math.hypot(p1.x - p0.x, p1.y - p0.y) > 0.85 || Math.abs(p1.z - p0.z) > 0.4) {
          continue;
        }
        appendParapetBlock(parts, p0.x, p0.y, p0.z + 0.01, p1.x, p1.y, 0.34, 0.16);
      }
      // 垛口：沿墙走向每约 0.9m 立一块，块间留缺口，凹凸分明
      let merlonCount = 0;
      for (let i = 0; i < wallPoints.length - 1 && merlonCount < 400; i += 3) {
        const p0 = wallPoints[i];
        const p1 = wallPoints[Math.min(i + 1, wallPoints.length - 1)];
        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        if (Math.hypot(dx, dy) > 0.7) {
          continue;
        }
        const half = 0.18;
        appendParapetBlock(
          parts,
          p0.x - dx * half,
          p0.y - dy * half,
          p0.z + 0.15,
          p0.x + dx * half,
          p0.y + dy * half,
          0.36,
          0.52,
        );
        merlonCount += 1;
      }
      if (parts.length === 0) {
        return;
      }
      const merged = mergeGeometries(parts);
      parts.forEach((part) => part.dispose());
      if (!merged) {
        return;
      }
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = true;
      scene.add(mesh);
      disposables.push(merged);
      totalMerlons += merlonCount;
    });
  });
  if (totalMerlons > 0) {
    console.log(`[Parapet] 女儿墙垛口 ${totalMerlons} 个`);
  }
}

/** 在两点之间生成一根方形截面杆件几何，追加到待合并列表。 */
function appendMemberGeometry(parts: THREE.BufferGeometry[], a: THREE.Vector3, b: THREE.Vector3, thickness: number) {
  const direction = new THREE.Vector3().subVectors(b, a);
  const length = direction.length();
  if (length < 1e-4) {
    return;
  }
  const geometry = new THREE.BoxGeometry(thickness, thickness, length);
  geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.normalize()),
  ));
  geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  parts.push(geometry);
}

/** 塔吊塔身桁架：4 根立柱 + 水平横杆 + 逐层交替斜腹杆，合并为单一几何体。 */
function buildTowerMastGeometry(width: number, height: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const half = width / 2;
  const cornerSigns: Array<[number, number]> = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  cornerSigns.forEach(([sx, sy]) => {
    appendMemberGeometry(parts, new THREE.Vector3(sx * half, sy * half, 0), new THREE.Vector3(sx * half, sy * half, height), 0.16);
  });
  const segments = Math.max(3, Math.round(height / 1.7));
  const segmentHeight = height / segments;
  for (let i = 0; i <= segments; i += 1) {
    const z = i * segmentHeight;
    appendMemberGeometry(parts, new THREE.Vector3(-half, -half, z), new THREE.Vector3(half, -half, z), 0.09);
    appendMemberGeometry(parts, new THREE.Vector3(-half, half, z), new THREE.Vector3(half, half, z), 0.09);
    appendMemberGeometry(parts, new THREE.Vector3(-half, -half, z), new THREE.Vector3(-half, half, z), 0.09);
    appendMemberGeometry(parts, new THREE.Vector3(half, -half, z), new THREE.Vector3(half, half, z), 0.09);
    if (i < segments) {
      const flip = i % 2 === 0;
      const zNext = z + segmentHeight;
      const xNear = flip ? -half : half;
      const xFar = flip ? half : -half;
      const yNear = flip ? -half : half;
      const yFar = flip ? half : -half;
      appendMemberGeometry(parts, new THREE.Vector3(xNear, -half, z), new THREE.Vector3(xFar, -half, zNext), 0.08);
      appendMemberGeometry(parts, new THREE.Vector3(xNear, half, z), new THREE.Vector3(xFar, half, zNext), 0.08);
      appendMemberGeometry(parts, new THREE.Vector3(-half, yNear, z), new THREE.Vector3(-half, yFar, zNext), 0.08);
      appendMemberGeometry(parts, new THREE.Vector3(half, yNear, z), new THREE.Vector3(half, yFar, zNext), 0.08);
    }
  }
  return mergeGeometries(parts) ?? new THREE.BufferGeometry();
}

/** 起重臂桁架：三角形截面，自 x=0 延伸至 x=length。 */
function buildBoomTrussGeometry(length: number, height: number, width: number, panels: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const half = width / 2;
  appendMemberGeometry(parts, new THREE.Vector3(0, -half, 0), new THREE.Vector3(length, -half, 0), 0.13);
  appendMemberGeometry(parts, new THREE.Vector3(0, half, 0), new THREE.Vector3(length, half, 0), 0.13);
  appendMemberGeometry(parts, new THREE.Vector3(0, 0, height), new THREE.Vector3(length, 0, height), 0.13);
  const stepX = length / Math.max(panels, 1);
  for (let i = 0; i <= panels; i += 1) {
    const x = i * stepX;
    appendMemberGeometry(parts, new THREE.Vector3(x, -half, 0), new THREE.Vector3(x, half, 0), 0.08);
    appendMemberGeometry(parts, new THREE.Vector3(x, -half, 0), new THREE.Vector3(x, 0, height), 0.08);
    appendMemberGeometry(parts, new THREE.Vector3(x, half, 0), new THREE.Vector3(x, 0, height), 0.08);
    if (i < panels) {
      const xNext = (i + 1) * stepX;
      appendMemberGeometry(parts, new THREE.Vector3(x, -half, 0), new THREE.Vector3(xNext, 0, height), 0.07);
      appendMemberGeometry(parts, new THREE.Vector3(xNext, -half, 0), new THREE.Vector3(x, 0, height), 0.07);
      appendMemberGeometry(parts, new THREE.Vector3(x, half, 0), new THREE.Vector3(xNext, 0, height), 0.07);
      appendMemberGeometry(parts, new THREE.Vector3(xNext, half, 0), new THREE.Vector3(x, 0, height), 0.07);
    }
  }
  return mergeGeometries(parts) ?? new THREE.BufferGeometry();
}

/** 工地图牌贴图：蓝色标题栏 + 占位条文行。 */
function createSiteSignTexture(title: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 232;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#eef2f6";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#1d4e89";
    context.fillRect(0, 0, canvas.width, 56);
    context.fillStyle = "#ffffff";
    context.font = "bold 30px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(title, canvas.width / 2, 29);
    context.fillStyle = "#8a97a5";
    for (let i = 0; i < 5; i += 1) {
      context.fillRect(30, 82 + i * 27, 320 - (i % 3) * 56, 9);
    }
    context.fillStyle = "#c0392b";
    context.fillRect(0, canvas.height - 8, canvas.width, 8);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 漫游场景施工布置：场地四周布置带缓慢回转动画的塔吊、蓝色围挡、
 * 大门与标牌、集装箱板房与材料堆场，营造在建工地氛围。
 * 所有布置自动避开建筑轮廓、彼此与场地出入口。
 */
function addConstructionSiteProps(
  scene: THREE.Scene,
  disposables: DisposableSceneResource[],
  buildingClusters: BuildingCluster[],
  walkBounds: WalkBounds,
  groundZ: number,
  radius: number,
) {
  const primary = buildingClusters[0];
  const placed: Array<{ x: number; y: number; r: number }> = [];

  function track<T extends DisposableSceneResource>(resource: T): T {
    disposables.push(resource);
    return resource;
  }

  const craneYellow = track(new THREE.MeshStandardMaterial({ color: 0xf0b31e, roughness: 0.52, metalness: 0.38 }));
  const steelDark = track(new THREE.MeshStandardMaterial({ color: 0x454b52, roughness: 0.58, metalness: 0.5 }));
  const concreteMat = track(new THREE.MeshStandardMaterial({ color: 0x9d9c94, roughness: 0.92 }));
  const cabWhite = track(new THREE.MeshStandardMaterial({ color: 0xe9e9e2, roughness: 0.5 }));
  const glassMat = track(new THREE.MeshStandardMaterial({ color: 0x20303f, roughness: 0.2, metalness: 0.5 }));
  const warningRed = track(new THREE.MeshStandardMaterial({ color: 0xd34c2c, roughness: 0.6 }));
  const fenceBlue = track(new THREE.MeshStandardMaterial({ color: 0x2e6cb0, roughness: 0.7 }));
  const brickRed = track(new THREE.MeshStandardMaterial({ color: 0xa4573a, roughness: 0.9 }));
  const sandTan = track(new THREE.MeshStandardMaterial({ color: 0xd6bd8e, roughness: 0.95 }));
  const gravelGray = track(new THREE.MeshStandardMaterial({ color: 0x9aa0a2, roughness: 0.95 }));
  const pipeGray = track(new THREE.MeshStandardMaterial({ color: 0xb6bab3, roughness: 0.85, side: THREE.DoubleSide }));
  const rebarSteel = track(new THREE.MeshStandardMaterial({ color: 0x767c82, roughness: 0.5, metalness: 0.6 }));
  const flagRed = track(new THREE.MeshStandardMaterial({ color: 0xc73a2e, roughness: 0.7, side: THREE.DoubleSide }));

  const isClearOfClusters = (x: number, y: number, margin: number) =>
    buildingClusters.every((cluster) => {
      const bounds = cluster.bounds;
      return x < bounds.min.x - margin || x > bounds.max.x + margin || y < bounds.min.y - margin || y > bounds.max.y + margin;
    });
  const isFree = (x: number, y: number, clearance: number) =>
    isClearOfClusters(x, y, 1.6) && !placed.some((p) => Math.hypot(p.x - x, p.y - y) < p.r + clearance);
  const occupy = (x: number, y: number, r: number) => {
    placed.push({ x, y, r });
  };
  const clampToBounds = (x: number, y: number, inset: number) => ({
    x: clamp(x, walkBounds.minX + inset, walkBounds.maxX - inset),
    y: clamp(y, walkBounds.minY + inset, walkBounds.maxY - inset),
  });

  const addBoxMesh = (
    parent: THREE.Object3D,
    width: number,
    depth: number,
    height: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
    rotateY = 0,
  ) => {
    const mesh = new THREE.Mesh(track(new THREE.BoxGeometry(width, depth, height)), material);
    mesh.position.set(x, y, z);
    if (rotateY) {
      mesh.rotation.y = rotateY;
    }
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // ---- 大门、门柱与横梁，标牌（先占位，避免塔吊/板房挤占出入口）----
  const inset = 1.0;
  const gateY = walkBounds.minY + inset;
  const gateX = (walkBounds.minX + walkBounds.maxX) / 2;
  const gateHalf = 4.2;
  occupy(gateX, gateY + 1, 7);
  addBoxMesh(scene, 0.55, 0.55, 2.9, gateX - gateHalf, gateY, groundZ + 1.45, concreteMat);
  addBoxMesh(scene, 0.55, 0.55, 2.9, gateX + gateHalf, gateY, groundZ + 1.45, concreteMat);
  addBoxMesh(scene, gateHalf * 2 + 0.8, 0.5, 0.5, gateX, gateY, groundZ + 3.05, craneYellow);

  const signTitles = ["安全生产牌", "质量管理牌", "文明施工牌"];
  signTitles.forEach((title, index) => {
    const x = gateX + (index - 1) * 2.5;
    const y = gateY + 2.4;
    const material = track(new THREE.MeshStandardMaterial({
      map: track(createSiteSignTexture(title)),
      roughness: 0.65,
      side: THREE.DoubleSide,
    }));
    const board = new THREE.Mesh(track(new THREE.PlaneGeometry(1.9, 1.15)), material);
    board.position.set(x, y, groundZ + 1.78);
    board.rotation.x = Math.PI / 2;
    board.scale.x = -1;
    board.castShadow = true;
    scene.add(board);
    addBoxMesh(scene, 1.98, 0.08, 1.23, x, y - 0.06, groundZ + 1.78, steelDark);
    [-0.7, 0.7].forEach((offset) => {
      addBoxMesh(scene, 0.09, 0.09, 2.4, x + offset, y, groundZ + 1.2, steelDark);
    });
    occupy(x, y, 1.5);
  });

  [gateX - gateHalf - 1.8, gateX + gateHalf + 1.8].forEach((x) => {
    addBoxMesh(scene, 0.08, 0.08, 5.2, x, gateY + 0.4, groundZ + 2.6, steelDark);
    const flag = new THREE.Mesh(track(new THREE.PlaneGeometry(1.15, 0.65)), flagRed);
    flag.position.set(x + 0.62, gateY + 0.4, groundZ + 4.85);
    flag.rotation.x = Math.PI / 2;
    flag.scale.x = -1;
    scene.add(flag);
  });

  // ---- 蓝色围挡：沿场地四边排布，南侧留出大门缺口 ----
  const fencePanelGeometry = track(new THREE.BoxGeometry(2.84, 0.09, 1.95));
  const fencePostGeometry = track(new THREE.BoxGeometry(0.13, 0.13, 2.3));
  const fenceSides = [
    { axis: "x" as const, fixed: walkBounds.minY + inset, from: walkBounds.minX, to: walkBounds.maxX, isGateSide: true },
    { axis: "x" as const, fixed: walkBounds.maxY - inset, from: walkBounds.minX, to: walkBounds.maxX, isGateSide: false },
    { axis: "y" as const, fixed: walkBounds.minX + inset, from: walkBounds.minY, to: walkBounds.maxY, isGateSide: false },
    { axis: "y" as const, fixed: walkBounds.maxX - inset, from: walkBounds.minY, to: walkBounds.maxY, isGateSide: false },
  ];
  fenceSides.forEach((side) => {
    const span = side.to - side.from;
    if (span < 5) {
      return;
    }
    const count = Math.max(2, Math.floor(span / 3));
    const step = span / count;
    const isXSide = side.axis === "x";
    for (let i = 0; i < count; i += 1) {
      const center = side.from + (i + 0.5) * step;
      if (side.isGateSide && Math.abs(center - gateX) < gateHalf + 1.4) {
        continue;
      }
      const panel = new THREE.Mesh(fencePanelGeometry, fenceBlue);
      panel.position.set(isXSide ? center : side.fixed, isXSide ? side.fixed : center, groundZ + 1.02);
      panel.rotation.y = isXSide ? 0 : Math.PI / 2;
      panel.receiveShadow = true;
      scene.add(panel);
    }
    for (let i = 0; i <= count; i += 1) {
      const boundary = side.from + i * step;
      if (side.isGateSide && Math.abs(boundary - gateX) < gateHalf) {
        continue;
      }
      const post = new THREE.Mesh(fencePostGeometry, steelDark);
      post.position.set(isXSide ? boundary : side.fixed, isXSide ? side.fixed : boundary, groundZ + 1.15);
      scene.add(post);
    }
  });

  // ---- 塔吊：主楼轮廓外扩一圈取角点/边中点，布置 3 台带回转动画的塔吊 ----
  const jibLength = clamp(radius * 0.42, 14, 30);
  const counterLength = jibLength * 0.34;
  const jibGeometry = track(buildBoomTrussGeometry(jibLength, 1.35, 1.05, Math.max(6, Math.round(jibLength / 2.2))));
  const counterGeometry = track(buildBoomTrussGeometry(counterLength, 0.95, 0.95, 3));
  const apexGeometry = track(new THREE.ConeGeometry(0.85, 2.6, 4));
  const primaryHeight = primary?.size.z ?? 10;

  const createTowerCrane = (x: number, y: number, mastHeight: number, initialYaw: number, slewSpeed: number) => {
    const crane = new THREE.Group();
    crane.position.set(x, y, groundZ);
    addBoxMesh(crane, 3.4, 3.4, 0.5, 0, 0, 0.25, concreteMat);
    const mast = new THREE.Mesh(track(buildTowerMastGeometry(1.5, mastHeight)), craneYellow);
    mast.position.set(0, 0, 0.5);
    mast.castShadow = true;
    crane.add(mast);
    const slew = new THREE.Group();
    slew.position.set(0, 0, 0.5 + mastHeight);
    addBoxMesh(slew, 1.9, 1.9, 0.32, 0, 0, 0.1, steelDark);
    const apex = new THREE.Mesh(apexGeometry, craneYellow);
    apex.position.set(0, 0, 1.56);
    apex.rotation.y = Math.PI / 4;
    slew.add(apex);
    addBoxMesh(slew, 1.15, 1.05, 1.3, 1.0, 0.72, 0.95, cabWhite);
    addBoxMesh(slew, 0.06, 0.9, 0.85, 1.56, 0.72, 0.95, glassMat);
    const jib = new THREE.Mesh(jibGeometry, craneYellow);
    jib.position.set(0.3, 0, 0.5);
    slew.add(jib);
    addBoxMesh(slew, 0.9, 0.7, 0.7, jibLength + 0.1, 0, 1.15, warningRed);
    const counterBoom = new THREE.Mesh(counterGeometry, craneYellow);
    counterBoom.rotation.y = Math.PI;
    counterBoom.position.set(-0.3, 0, 0.45);
    slew.add(counterBoom);
    for (let i = 0; i < 3; i += 1) {
      addBoxMesh(slew, 0.55, 1.7, 1.15, -0.95 - i * 0.6, 0, 0.95, concreteMat);
    }
    addBoxMesh(slew, 1.5, 1.05, 0.95, -1.9, 0, 0.85, steelDark);
    const tieParts: THREE.BufferGeometry[] = [];
    appendMemberGeometry(tieParts, new THREE.Vector3(0, 0, 2.9), new THREE.Vector3(0.3 + jibLength * 0.55, 0, 1.85), 0.05);
    appendMemberGeometry(tieParts, new THREE.Vector3(0, 0, 2.9), new THREE.Vector3(-0.3 - counterLength * 0.9, 0, 1.4), 0.05);
    slew.add(new THREE.Mesh(track(mergeGeometries(tieParts) ?? new THREE.BufferGeometry()), steelDark));
    const trolleyX = jibLength * 0.6;
    addBoxMesh(slew, 0.55, 0.75, 0.28, trolleyX, 0, 0.32, steelDark);
    const cableHeight = clamp(mastHeight * 0.42, 3.5, 10);
    const cable = new THREE.Mesh(track(new THREE.CylinderGeometry(0.022, 0.022, cableHeight, 6)), steelDark);
    cable.position.set(trolleyX, 0, 0.2 - cableHeight / 2);
    slew.add(cable);
    addBoxMesh(slew, 0.24, 0.24, 0.32, trolleyX, 0, 0.2 - cableHeight - 0.16, warningRed);
    addBoxMesh(slew, 4.4, 0.32, 0.26, trolleyX, 0, 0.2 - cableHeight - 0.45, steelDark);
    addBoxMesh(slew, 3.2, 0.2, 0.18, trolleyX, 0, 0.2 - cableHeight - 0.67, rebarSteel);
    slew.rotation.z = initialYaw;
    slew.userData.craneSlew = slewSpeed;
    slew.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.userData.animated = true;
        mesh.castShadow = true;
      }
    });
    crane.add(slew);
    scene.add(crane);
    occupy(x, y, 3.2);
  };

  const gap = clamp(radius * 0.055, 4, 9);
  const expanded = primary
    ? {
        minX: primary.bounds.min.x - gap,
        maxX: primary.bounds.max.x + gap,
        minY: primary.bounds.min.y - gap,
        maxY: primary.bounds.max.y + gap,
      }
    : {
        minX: walkBounds.minX + 6,
        maxX: walkBounds.maxX - 6,
        minY: walkBounds.minY + 6,
        maxY: walkBounds.maxY - 6,
      };
  const ringCenterX = (expanded.minX + expanded.maxX) / 2;
  const ringCenterY = (expanded.minY + expanded.maxY) / 2;
  const craneCandidates: Array<[number, number]> = [
    [expanded.maxX, expanded.maxY],
    [expanded.minX, expanded.minY],
    [expanded.minX, expanded.maxY],
    [expanded.maxX, expanded.minY],
    [ringCenterX, expanded.maxY],
    [expanded.minX, ringCenterY],
    [expanded.maxX, ringCenterY],
  ];
  const craneHeights = [1.28, 1.02, 0.8].map((factor) => clamp(primaryHeight * factor + 7, 14, 38));
  const slewSpeeds = [0.075, -0.056, 0.066];
  const yawOffsets = [0.35, -0.55, 1.1];
  let craneCount = 0;
  for (const [rawX, rawY] of craneCandidates) {
    if (craneCount >= 3) {
      break;
    }
    const spot = clampToBounds(rawX, rawY, 2.2);
    if (!isFree(spot.x, spot.y, 3.0)) {
      continue;
    }
    const focus = primary?.center ?? new THREE.Vector3(ringCenterX, ringCenterY, groundZ);
    createTowerCrane(
      spot.x,
      spot.y,
      craneHeights[craneCount],
      Math.atan2(focus.y - spot.y, focus.x - spot.x) + yawOffsets[craneCount],
      slewSpeeds[craneCount],
    );
    craneCount += 1;
  }

  // ---- 集装箱板房与材料堆场：就近可用空地自动寻位 ----
  const findClearSpot = (startX: number, startY: number, inset: number, clearance: number) => {
    const offsets: Array<[number, number]> = [[0, 0]];
    for (let ring = 1; ring <= 14; ring += 1) {
      const step = ring * 1.8;
      offsets.push([step, 0], [-step, 0], [0, step], [0, -step], [step, step], [-step, step], [step, -step], [-step, -step]);
    }
    for (const [dx, dy] of offsets) {
      const spot = clampToBounds(startX + dx, startY + dy, inset);
      if (isFree(spot.x, spot.y, clearance)) {
        return spot;
      }
    }
    return null;
  };

  const createSiteContainer = (x: number, y: number, rotateY: number, baseZ: number, body: THREE.Material) => {
    const group = new THREE.Group();
    group.position.set(x, y, groundZ + baseZ);
    group.rotation.y = rotateY;
    addBoxMesh(group, 5.8, 2.9, 2.55, 0, 0, 1.28, body);
    addBoxMesh(group, 0.08, 1.7, 1.95, 2.92, 0, 1.3, steelDark);
    addBoxMesh(group, 0.08, 1.15, 0.75, -1.3, 0, 1.7, glassMat);
    scene.add(group);
    addGroundShadow(scene, disposables, x, y, groundZ, 3.4, 1.8, 0.16);
  };

  const containerSpot = findClearSpot(walkBounds.minX + 12, walkBounds.maxY - 10, 6, 4.5);
  if (containerSpot) {
    createSiteContainer(containerSpot.x, containerSpot.y, Math.PI / 2, 0, cabWhite);
    createSiteContainer(containerSpot.x + 3.7, containerSpot.y + 0.4, Math.PI / 2 + 0.12, 0, fenceBlue);
    createSiteContainer(containerSpot.x + 1.4, containerSpot.y - 0.3, Math.PI / 2 - 0.08, 2.72, cabWhite);
    occupy(containerSpot.x + 1.8, containerSpot.y, 5.2);
  }

  const yardSpot = findClearSpot(walkBounds.maxX - 12, walkBounds.minY + 12, 7, 6);
  if (yardSpot) {
    const moundGeometry = track(new THREE.ConeGeometry(2.3, 1.5, 20));
    const moundSand = new THREE.Mesh(moundGeometry, sandTan);
    moundSand.position.set(yardSpot.x - 5, yardSpot.y + 2.4, groundZ + 0.75);
    moundSand.castShadow = true;
    scene.add(moundSand);
    const moundGravel = new THREE.Mesh(moundGeometry, gravelGray);
    moundGravel.position.set(yardSpot.x - 5, yardSpot.y - 1.2, groundZ + 0.68);
    moundGravel.scale.set(0.82, 0.82, 0.9);
    moundGravel.castShadow = true;
    scene.add(moundGravel);

    [-1.1, 1.1].forEach((offsetX) => {
      addBoxMesh(scene, 0.3, 0.3, 0.22, yardSpot.x + 0.4 + offsetX, yardSpot.y + 3.2, groundZ + 0.11, steelDark);
    });
    const rebarGeometry = track(new THREE.CylinderGeometry(0.045, 0.045, 6, 6));
    for (let i = 0; i < 5; i += 1) {
      const rebar = new THREE.Mesh(rebarGeometry, rebarSteel);
      rebar.rotation.z = Math.PI / 2;
      rebar.rotation.y = 0.05;
      rebar.position.set(yardSpot.x + 0.4, yardSpot.y + 2.85 + i * 0.17, groundZ + 0.33);
      scene.add(rebar);
    }

    const brickGeometry = track(new THREE.BoxGeometry(1.5, 1.0, 0.28));
    [-2.2, 2.2].forEach((offsetX, index) => {
      const px = yardSpot.x + 4.6 + offsetX;
      const py = yardSpot.y - 2.6;
      addBoxMesh(scene, 1.6, 1.1, 0.1, px, py, groundZ + 0.05, steelDark);
      const layers = index === 0 ? 4 : 2;
      for (let layer = 0; layer < layers; layer += 1) {
        const brick = new THREE.Mesh(brickGeometry, brickRed);
        brick.position.set(px, py, groundZ + 0.26 + layer * 0.3);
        brick.rotation.z = layer % 2 === 0 ? 0 : 0.04;
        brick.castShadow = true;
        scene.add(brick);
      }
    });

    const pipeGeometry = track(new THREE.CylinderGeometry(0.5, 0.5, 2.4, 14, 1, true));
    const pipeSpots: Array<[number, number, number]> = [
      [yardSpot.x - 1.2, yardSpot.y - 5, 0.5],
      [yardSpot.x + 1.2, yardSpot.y - 5, 0.5],
      [yardSpot.x, yardSpot.y - 5, 1.42],
    ];
    pipeSpots.forEach(([px, py, pz]) => {
      const pipe = new THREE.Mesh(pipeGeometry, pipeGray);
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(px, py, groundZ + pz);
      pipe.castShadow = true;
      scene.add(pipe);
    });
    occupy(yardSpot.x, yardSpot.y, 8.5);
  }
}



function addMuseumExhibits(

  scene: THREE.Scene,

  disposables: DisposableSceneResource[],

  sceneItems: SceneItem[],

  center: THREE.Vector3,

  size: THREE.Vector3,

  groundZ: number,

) {

  const railMaterial = new THREE.MeshPhysicalMaterial({

    color: 0xc8b678,

    roughness: 0.22,

    metalness: 0.92,

    clearcoat: 1,

    clearcoatRoughness: 0.08,

    reflectivity: 0.95,

    envMapIntensity: 1.4,

  });

  const plinthMaterial = new THREE.MeshPhysicalMaterial({

    color: 0xe0dacf,

    roughness: 0.65,

    metalness: 0.05,

    clearcoat: 0.3,

    clearcoatRoughness: 0.35,

    envMapIntensity: 0.85,

  });

  const wallItems = sceneItems

    .filter((item) => {

      const itemSize = item.bounds.getSize(new THREE.Vector3());

      const text = elementSearchText(item.element);

      return (
        (text.includes("wall") || text.includes("curtain"))


        && itemSize.z > 1.8

        && Math.max(itemSize.x, itemSize.y) > 2.2

        && item.bounds.min.z < groundZ + size.z * 0.55

      );

    })

    .sort((a, b) => {

      const aSize = a.bounds.getSize(new THREE.Vector3());

      const bSize = b.bounds.getSize(new THREE.Vector3());

      return Math.max(bSize.x, bSize.y) - Math.max(aSize.x, aSize.y);

    })

    .slice(0, 14);



  wallItems.forEach((item, index) => {

    const wallSize = item.bounds.getSize(new THREE.Vector3());

    const wallCenter = item.bounds.getCenter(new THREE.Vector3());

    const alignX = wallSize.x < wallSize.y;

    const paintingSlots = clamp(Math.floor((alignX ? wallSize.y : wallSize.x) / 2.6), 1, 5);

    const paintingWidth = clamp((alignX ? wallSize.y : wallSize.x) * 0.16, 1.0, 2.2);

    const paintingHeight = clamp(wallSize.z * 0.28, 0.75, 1.35);

    const outward = alignX

      ? (wallCenter.x < center.x ? -1 : 1)

      : (wallCenter.y < center.y ? -1 : 1);

    for (let slot = 0; slot < paintingSlots; slot += 1) {

      const longSide = alignX ? wallSize.y : wallSize.x;

      const offset = (slot - (paintingSlots - 1) / 2) * clamp(longSide * 0.18, 1.2, 2.4);

      const paintingTexture = createPaintingTexture(index * 5 + slot);

      const paintingGeometry = new THREE.PlaneGeometry(paintingWidth, paintingHeight);

      const paintingMaterial = new THREE.MeshBasicMaterial({ map: paintingTexture, side: THREE.DoubleSide });

      const painting = new THREE.Mesh(paintingGeometry, paintingMaterial);

      if (alignX) {

        painting.position.set(

          outward > 0 ? item.bounds.max.x + 0.05 : item.bounds.min.x - 0.05,

          clamp(wallCenter.y + offset, item.bounds.min.y + paintingWidth * 0.55, item.bounds.max.y - paintingWidth * 0.55),

          clamp(wallCenter.z, groundZ + 1.25, groundZ + size.z * 0.5),

        );

        painting.rotation.y = Math.PI / 2;

      } else {

        painting.position.set(

          clamp(wallCenter.x + offset, item.bounds.min.x + paintingWidth * 0.55, item.bounds.max.x - paintingWidth * 0.55),

          outward > 0 ? item.bounds.max.y + 0.05 : item.bounds.min.y - 0.05,

          clamp(wallCenter.z, groundZ + 1.25, groundZ + size.z * 0.5),

        );

        painting.rotation.x = Math.PI / 2;

      }

      scene.add(painting);

      disposables.push(paintingTexture, paintingGeometry, paintingMaterial);



      const railGeometry = new THREE.BoxGeometry(clamp(paintingWidth * 1.08, 1.2, 2.5), 0.04, 0.045);

      const rail = new THREE.Mesh(railGeometry, railMaterial);

      rail.position.copy(painting.position);

      rail.position.z += paintingHeight * 0.62;

      if (alignX) {

        rail.rotation.z = Math.PI / 2;

      }

      scene.add(rail);

      disposables.push(railGeometry);

    }

  });



  const galleryWidth = clamp(size.x * 0.3, 8, 22);

  const galleryDepth = clamp(size.y * 0.22, 7, 18);

  const exhibitCount = 8;

  for (let i = 0; i < exhibitCount; i += 1) {

    const pedestalGeometry = new THREE.BoxGeometry(0.9, 0.9, 0.72);

    const pedestal = new THREE.Mesh(pedestalGeometry, plinthMaterial);

    const angle = i * Math.PI * 0.5 + Math.PI * 0.25;

    pedestal.position.set(

      center.x + Math.cos(angle) * galleryWidth * 0.18,

      center.y + Math.sin(angle) * galleryDepth * 0.2,

      groundZ + 0.36,

    );

    scene.add(pedestal);



    const sculptureType = i % 5;

    const sculptureGeometry = sculptureType === 0

      ? new THREE.TorusKnotGeometry(0.28, 0.08, 48, 8)

      : sculptureType === 1

        ? new THREE.SphereGeometry(0.32, 20, 12)

        : sculptureType === 2

          ? new THREE.CylinderGeometry(0.14, 0.24, 0.6, 12)

          : sculptureType === 3

            ? new THREE.ConeGeometry(0.22, 0.5, 8)

            : new THREE.BoxGeometry(0.38, 0.5, 0.28);

    const sculptureMaterial = new THREE.MeshPhysicalMaterial({

      color: i % 4 === 0 ? 0x9a8768 : i % 4 === 1 ? 0xb8b2a8 : i % 4 === 2 ? 0x8d9698 : 0xc4a882,

      roughness: i % 4 === 1 ? 0.55 : 0.18,

      metalness: i % 4 === 2 ? 0.9 : 0.2,

      clearcoat: i % 4 === 2 ? 1 : 0.4,

      clearcoatRoughness: i % 4 === 2 ? 0.08 : 0.2,

      reflectivity: i % 4 === 2 ? 1.0 : 0.5,

      envMapIntensity: 1.5,

    });

    const sculpture = new THREE.Mesh(sculptureGeometry, sculptureMaterial);

    sculpture.position.set(pedestal.position.x, pedestal.position.y, groundZ + 0.92);

    scene.add(sculpture);

    disposables.push(pedestalGeometry, sculptureGeometry, sculptureMaterial);

  }

  disposables.push(railMaterial, plinthMaterial);

}



void addMuseumExhibits;



function addClusteredMuseumExhibits(

  scene: THREE.Scene,

  disposables: DisposableSceneResource[],

  sceneItems: SceneItem[],

  buildingClusters: BuildingCluster[],

  groundZ: number,

) {

  const railMaterial = new THREE.MeshPhysicalMaterial({

    color: 0xc8b678,

    roughness: 0.22,

    metalness: 0.92,

    clearcoat: 1,

    clearcoatRoughness: 0.08,

    reflectivity: 0.95,

    envMapIntensity: 1.4,

  });

  const plinthMaterial = new THREE.MeshPhysicalMaterial({

    color: 0xe0dacf,

    roughness: 0.65,

    metalness: 0.05,

    clearcoat: 0.3,

    clearcoatRoughness: 0.35,

    envMapIntensity: 0.85,

  });

  const clusters = buildingClusters.length > 0 ? buildingClusters : [createBuildingCluster(sceneItems)];

  let paintingIndex = 0;



  clusters.slice(0, 2).forEach((cluster) => {

    const wallItems = cluster.items

      .filter((item) => {

        const itemSize = item.bounds.getSize(new THREE.Vector3());

        const text = elementSearchText(item.element);

        const typedWall = isIfcType(item.element, ["IfcWall", "IfcWallStandardCase", "IfcCurtainWall"]);

        const namedWall = text.includes("wall") || text.includes("curtain");

        const verticalPlane = itemSize.z > 1.8

          && Math.max(itemSize.x, itemSize.y) > 2.2

          && Math.min(itemSize.x, itemSize.y) < 1.5;

        return (

          (typedWall || namedWall || verticalPlane)

          && item.bounds.min.z < cluster.bounds.min.z + cluster.size.z * 0.68

          && item.bounds.max.z > groundZ + 1.2

        );

      })

      .sort((a, b) => {

        const aSize = a.bounds.getSize(new THREE.Vector3());

        const bSize = b.bounds.getSize(new THREE.Vector3());

        return Math.max(bSize.x, bSize.y) - Math.max(aSize.x, aSize.y);

      })

      .slice(0, buildingClusters.length > 1 ? 12 : 18);



    wallItems.forEach((item) => {

      const wallSize = item.bounds.getSize(new THREE.Vector3());

      const wallCenter = item.bounds.getCenter(new THREE.Vector3());

      const alignX = wallSize.x < wallSize.y;

      const longSide = alignX ? wallSize.y : wallSize.x;

      const paintingSlots = clamp(Math.floor(longSide / 2.6), 1, 5);

      const paintingWidth = clamp(longSide * 0.16, 1.0, 2.2);

      const paintingHeight = clamp(wallSize.z * 0.28, 0.75, 1.35);

      const outward = alignX

        ? (wallCenter.x < cluster.center.x ? -1 : 1)

        : (wallCenter.y < cluster.center.y ? -1 : 1);

      for (let slot = 0; slot < paintingSlots; slot += 1) {

        const offset = (slot - (paintingSlots - 1) / 2) * clamp(longSide * 0.2, 1.45, 2.8);

        const paintingTexture = createPaintingTexture(paintingIndex);

        const paintingGeometry = new THREE.PlaneGeometry(paintingWidth, paintingHeight);

        const paintingMaterial = new THREE.MeshStandardMaterial({

          map: paintingTexture,

          side: THREE.DoubleSide,

          roughness: 0.85,

          metalness: 0.0,

          emissive: 0x111111,

          emissiveIntensity: 0.15,

          emissiveMap: paintingTexture,

        });

        const painting = new THREE.Mesh(paintingGeometry, paintingMaterial);

        // Ornate gilded frame around the painting

        const frameDepth = 0.06;

        const frameOverhang = 0.12;

        const frameGeometry = new THREE.BoxGeometry(

          paintingWidth + frameOverhang * 2,

          paintingHeight + frameOverhang * 2,

          frameDepth,

        );

        const isGilded = paintingIndex % 2 === 0;

        const frameMaterial = new THREE.MeshPhysicalMaterial({

          color: isGilded ? 0xb8860b : 0x3a2818,

          roughness: isGilded ? 0.25 : 0.55,

          metalness: isGilded ? 0.9 : 0.2,

          clearcoat: isGilded ? 1.0 : 0.3,

          clearcoatRoughness: isGilded ? 0.08 : 0.3,

          reflectivity: isGilded ? 1.0 : 0.4,

          envMapIntensity: 1.4,

        });

        const frame = new THREE.Mesh(frameGeometry, frameMaterial);

        if (alignX) {

          painting.position.set(

            outward > 0 ? item.bounds.max.x + 0.06 : item.bounds.min.x - 0.06,

            clamp(wallCenter.y + offset, item.bounds.min.y + paintingWidth * 0.55, item.bounds.max.y - paintingWidth * 0.55),

            clamp(wallCenter.z, groundZ + 1.25, cluster.bounds.min.z + cluster.size.z * 0.58),

          );

          painting.rotation.y = Math.PI / 2;

          frame.position.copy(painting.position);

          frame.position.x -= outward * frameDepth * 0.5;

          frame.rotation.y = Math.PI / 2;

        } else {

          painting.position.set(

            clamp(wallCenter.x + offset, item.bounds.min.x + paintingWidth * 0.55, item.bounds.max.x - paintingWidth * 0.55),

            outward > 0 ? item.bounds.max.y + 0.06 : item.bounds.min.y - 0.06,

            clamp(wallCenter.z, groundZ + 1.25, cluster.bounds.min.z + cluster.size.z * 0.58),

          );

          painting.rotation.x = Math.PI / 2;

          frame.position.copy(painting.position);

          frame.position.y -= outward * frameDepth * 0.5;

          frame.rotation.x = Math.PI / 2;

        }

        scene.add(frame);

        scene.add(painting);

        disposables.push(paintingTexture, paintingGeometry, paintingMaterial, frameGeometry, frameMaterial);



        const railGeometry = new THREE.BoxGeometry(clamp(paintingWidth * 1.08, 1.25, 2.8), 0.04, 0.045);

        const rail = new THREE.Mesh(railGeometry, railMaterial);

        rail.position.copy(painting.position);

        rail.position.z += paintingHeight * 0.62;

        if (alignX) {

          rail.rotation.z = Math.PI / 2;

        }

        scene.add(rail);

        disposables.push(railGeometry);

        paintingIndex += 1;

      }

    });



    const floorItems = cluster.items

      .filter((item) => isHorizontalSurface(item.element) && item.bounds.min.z < groundZ + 1.4)

      .sort((a, b) => {

        const aSize = a.bounds.getSize(new THREE.Vector3());

        const bSize = b.bounds.getSize(new THREE.Vector3());

        return (a.bounds.max.z - b.bounds.max.z) || ((bSize.x * bSize.y) - (aSize.x * aSize.y));

      });

    const floorZ = floorItems[0]?.bounds.max.z ?? groundZ;

    const exhibitCount = buildingClusters.length > 1 ? 8 : 12;

    const spreadX = clamp(cluster.size.x * 0.26, 1.6, 7.2);

    const spreadY = clamp(cluster.size.y * 0.26, 1.6, 7.2);



    const displayCaseGlassMaterial = new THREE.MeshPhysicalMaterial({

      color: 0xffffff,

      roughness: 0.0,

      metalness: 0.0,

      // 真实折射（transmission）会触发昂贵的离屏折射渲染，改为廉价透明玻璃
      ior: 1.5,

      thickness: 0.05,

      transparent: true,

      opacity: 0.3,

      envMapIntensity: 1.0,

      side: THREE.DoubleSide,

    });



    // Spotlight material for exhibits

    const exhibitSpotlightMaterial = new THREE.MeshStandardMaterial({

      color: 0x333333,

      roughness: 0.4,

      metalness: 0.8,

    });



    // Information plaque material

    const plaqueMaterial = new THREE.MeshStandardMaterial({

      color: 0x1a1a1a,

      roughness: 0.3,

      metalness: 0.6,

    });



    for (let i = 0; i < exhibitCount; i += 1) {

      const pedestalGeometry = new THREE.BoxGeometry(0.82, 0.82, 0.68);

      const pedestal = new THREE.Mesh(pedestalGeometry, plinthMaterial);

      const angle = i * ((Math.PI * 2) / exhibitCount) + Math.PI * 0.25;

      pedestal.position.set(

        clamp(cluster.center.x + Math.cos(angle) * spreadX, cluster.bounds.min.x + 1, cluster.bounds.max.x - 1),

        clamp(cluster.center.y + Math.sin(angle) * spreadY, cluster.bounds.min.y + 1, cluster.bounds.max.y - 1),

        floorZ + 0.34,

      );

      scene.add(pedestal);



      // Add spotlight above exhibit

      const spotlightBaseGeometry = new THREE.CylinderGeometry(0.08, 0.1, 0.15, 12);

      const spotlightBase = new THREE.Mesh(spotlightBaseGeometry, exhibitSpotlightMaterial);

      spotlightBase.position.set(pedestal.position.x, pedestal.position.y, floorZ + 2.2);

      scene.add(spotlightBase);



      const spotlightConeGeometry = new THREE.ConeGeometry(0.12, 0.2, 12);

      const spotlightCone = new THREE.Mesh(spotlightConeGeometry, exhibitSpotlightMaterial);

      spotlightCone.position.set(pedestal.position.x, pedestal.position.y, floorZ + 2.1);

      // Z-up 场景：绕 X 转 90° 让锥口朝下罩住展品；转 180° 会让它横躺指向 -Y
      spotlightCone.rotation.x = Math.PI / 2;

      scene.add(spotlightCone);



      // Add warm glow light effect

      const glowLightGeometry = new THREE.SphereGeometry(0.06, 8, 6);

      const glowLightMaterial = new THREE.MeshBasicMaterial({

        color: 0xffe8b0,

        transparent: true,

        opacity: 0.8,

      });

      const glowLight = new THREE.Mesh(glowLightGeometry, glowLightMaterial);

      glowLight.position.set(pedestal.position.x, pedestal.position.y, floorZ + 2.0);

      scene.add(glowLight);



      // Add information plaque

      const infoPlaqueGeometry = new THREE.BoxGeometry(0.35, 0.25, 0.02);

      const infoPlaque = new THREE.Mesh(infoPlaqueGeometry, plaqueMaterial);

      infoPlaque.position.set(pedestal.position.x, pedestal.position.y + 0.42, floorZ + 0.5);

      scene.add(infoPlaque);



      // Plaque text background (lighter area)

      const plaqueTextGeometry = new THREE.PlaneGeometry(0.3, 0.18);

      const plaqueTextMaterial = new THREE.MeshBasicMaterial({

        color: 0xf5f5f0,

        transparent: true,

        opacity: 0.9,

      });

      const plaqueText = new THREE.Mesh(plaqueTextGeometry, plaqueTextMaterial);

      plaqueText.position.set(pedestal.position.x, pedestal.position.y + 0.431, floorZ + 0.5);

      scene.add(plaqueText);



      const useGlassCase = i % 3 === 0;

      if (useGlassCase) {

        const caseGeometry = new THREE.BoxGeometry(0.7, 0.7, 0.55);

        const caseMesh = new THREE.Mesh(caseGeometry, displayCaseGlassMaterial);

        caseMesh.position.set(pedestal.position.x, pedestal.position.y, floorZ + 0.92);

        scene.add(caseMesh);

        disposables.push(caseGeometry);

      }



      const sculptureType = i % 7;

      const sculptureGeometry = sculptureType === 0

        ? new THREE.TorusKnotGeometry(0.25, 0.07, 40, 8)

        : sculptureType === 1

          ? new THREE.SphereGeometry(0.29, 18, 10)

          : sculptureType === 2

            ? new THREE.CylinderGeometry(0.12, 0.22, 0.55, 12)

            : sculptureType === 3

              ? new THREE.ConeGeometry(0.2, 0.45, 8)

              : sculptureType === 4

                ? new THREE.DodecahedronGeometry(0.25, 0)

                : sculptureType === 5

                  ? new THREE.OctahedronGeometry(0.26, 0)

                  : new THREE.BoxGeometry(0.35, 0.45, 0.25);

      const sculptureMaterial = new THREE.MeshPhysicalMaterial({

        color: i % 5 === 0 ? 0x9a8768 : i % 5 === 1 ? 0xb8b2a8 : i % 5 === 2 ? 0x8d9698 : i % 5 === 3 ? 0xc4a882 : 0xa89078,

        roughness: i % 5 === 1 ? 0.6 : 0.18,

        metalness: i % 5 === 2 ? 0.9 : 0.2,

        clearcoat: i % 5 === 2 ? 1 : 0.4,

        clearcoatRoughness: i % 5 === 2 ? 0.08 : 0.2,

        reflectivity: i % 5 === 2 ? 1.0 : 0.5,

        envMapIntensity: 1.3,

      });

      const sculpture = new THREE.Mesh(sculptureGeometry, sculptureMaterial);

      sculpture.position.set(pedestal.position.x, pedestal.position.y, floorZ + 0.86);

      scene.add(sculpture);



      disposables.push(pedestalGeometry, sculptureGeometry, sculptureMaterial, spotlightBaseGeometry, spotlightConeGeometry, glowLightGeometry, infoPlaqueGeometry, plaqueTextGeometry, exhibitSpotlightMaterial, plaqueMaterial, displayCaseGlassMaterial, glowLightMaterial, plaqueTextMaterial);

    }

    // Add NPC visitors and a guide figure inside the museum

    addMuseumNPCs(scene, disposables, cluster, floorZ);

  });

}



function addMuseumNPCs(

  scene: THREE.Scene,

  disposables: DisposableSceneResource[],

  cluster: BuildingCluster,

  floorZ: number,

) {

  // Shared geometries & materials for NPC bodies (low-poly stylized figures)

  const headGeometry = new THREE.SphereGeometry(0.14, 12, 8);

  const torsoGeometry = new THREE.CapsuleGeometry(0.18, 0.5, 4, 8);

  const armGeometry = new THREE.CapsuleGeometry(0.06, 0.4, 4, 8);

  const legGeometry = new THREE.CapsuleGeometry(0.07, 0.55, 4, 8);

  const baseMaterial = new THREE.MeshStandardMaterial({

    roughness: 0.7,

    metalness: 0.05,

  });

  const skinMaterial = new THREE.MeshStandardMaterial({

    color: 0xe0b890,

    roughness: 0.6,

    metalness: 0.0,

  });

  const hairMaterial = new THREE.MeshStandardMaterial({

    color: 0x2a1a0e,

    roughness: 0.8,

    metalness: 0.0,

  });

  disposables.push(headGeometry, torsoGeometry, armGeometry, legGeometry, baseMaterial, skinMaterial, hairMaterial);

  const npcColors = [0x4a5a7a, 0x7a4a4a, 0x4a7a5a, 0x7a7a4a, 0x5a4a7a, 0x3a5a6a];

  const npcCount = 5;

  for (let i = 0; i < npcCount; i++) {

    const npcGroup = new THREE.Group();

    const bodyMaterial = new THREE.MeshStandardMaterial({

      color: npcColors[i % npcColors.length],

      roughness: 0.7,

      metalness: 0.05,

    });

    disposables.push(bodyMaterial);

    // Torso

    const torso = new THREE.Mesh(torsoGeometry, bodyMaterial);

    torso.position.z = 0.55;

    npcGroup.add(torso);

    // Head

    const head = new THREE.Mesh(headGeometry, skinMaterial);

    head.position.z = 1.0;

    npcGroup.add(head);

    // Hair (cap on top of head)

    const hair = new THREE.Mesh(headGeometry, hairMaterial);

    hair.position.z = 1.04;

    hair.scale.set(1.05, 1.05, 0.7);

    npcGroup.add(hair);

    // Arms

    const leftArm = new THREE.Mesh(armGeometry, bodyMaterial);

    leftArm.position.set(-0.22, 0, 0.6);

    leftArm.rotation.x = 0.15;

    npcGroup.add(leftArm);

    const rightArm = new THREE.Mesh(armGeometry, bodyMaterial);

    rightArm.position.set(0.22, 0, 0.6);

    rightArm.rotation.x = 0.15;

    npcGroup.add(rightArm);

    // Legs

    const leftLeg = new THREE.Mesh(legGeometry, bodyMaterial);

    leftLeg.position.set(-0.1, 0, 0.15);

    npcGroup.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeometry, bodyMaterial);

    rightLeg.position.set(0.1, 0, 0.15);

    npcGroup.add(rightLeg);

    // Position NPCs around the cluster, near exhibits but not on top of them

    const angle = (i / npcCount) * Math.PI * 2 + Math.PI * 0.15;

    const dist = Math.min(cluster.size.x, cluster.size.y) * 0.22;

    npcGroup.position.set(

      clamp(cluster.center.x + Math.cos(angle) * dist, cluster.bounds.min.x + 1.5, cluster.bounds.max.x - 1.5),

      clamp(cluster.center.y + Math.sin(angle) * dist, cluster.bounds.min.y + 1.5, cluster.bounds.max.y - 1.5),

      floorZ,

    );

    // Face toward the cluster center (as if looking at exhibits)

    npcGroup.rotation.z = Math.atan2(cluster.center.x - npcGroup.position.x, cluster.center.y - npcGroup.position.y);

    npcGroup.traverse((child) => {

      if (child instanceof THREE.Mesh) {

        child.castShadow = true;

      }

    });

    scene.add(npcGroup);

  }

  // Add a guide figure near the cluster center with a distinct uniform

  const guideGroup = new THREE.Group();

  const guideUniform = new THREE.MeshStandardMaterial({

    color: 0x1a3a5a,

    roughness: 0.5,

    metalness: 0.1,

  });

  disposables.push(guideUniform);

  const guideTorso = new THREE.Mesh(torsoGeometry, guideUniform);

  guideTorso.position.z = 0.55;

  guideGroup.add(guideTorso);

  const guideHead = new THREE.Mesh(headGeometry, skinMaterial);

  guideHead.position.z = 1.0;

  guideGroup.add(guideHead);

  const guideHair = new THREE.Mesh(headGeometry, hairMaterial);

  guideHair.position.z = 1.04;

  guideHair.scale.set(1.05, 1.05, 0.7);

  guideGroup.add(guideHair);

  const guideLeftArm = new THREE.Mesh(armGeometry, guideUniform);

  guideLeftArm.position.set(-0.22, 0, 0.6);

  guideLeftArm.rotation.x = 0.15;

  guideGroup.add(guideLeftArm);

  const guideRightArm = new THREE.Mesh(armGeometry, guideUniform);

  guideRightArm.position.set(0.22, 0, 0.6);

  guideRightArm.rotation.x = 0.15;

  guideGroup.add(guideRightArm);

  const guideLeftLeg = new THREE.Mesh(legGeometry, guideUniform);

  guideLeftLeg.position.set(-0.1, 0, 0.15);

  guideGroup.add(guideLeftLeg);

  const guideRightLeg = new THREE.Mesh(legGeometry, guideUniform);

  guideRightLeg.position.set(0.1, 0, 0.15);

  guideGroup.add(guideRightLeg);

  // Guide badge (small glowing dot on chest)

  const badgeGeometry = new THREE.CircleGeometry(0.04, 8);

  const badgeMaterial = new THREE.MeshBasicMaterial({ color: 0xffd700 });

  const badge = new THREE.Mesh(badgeGeometry, badgeMaterial);

  badge.position.set(0, 0.18, 0.72);

  badge.rotation.x = -Math.PI / 2 + 0.3;

  guideGroup.add(badge);

  disposables.push(badgeGeometry, badgeMaterial);

  // Place guide near the entrance area (offset from center)

  guideGroup.position.set(

    clamp(cluster.center.x + Math.min(cluster.size.x * 0.3, 4), cluster.bounds.min.x + 1.5, cluster.bounds.max.x - 1.5),

    clamp(cluster.center.y - Math.min(cluster.size.y * 0.15, 2), cluster.bounds.min.y + 1.5, cluster.bounds.max.y - 1.5),

    floorZ,

  );

  guideGroup.rotation.z = Math.PI * 0.75;

  guideGroup.traverse((child) => {

    if (child instanceof THREE.Mesh) {

      child.castShadow = true;

    }

  });

  scene.add(guideGroup);

}



function addSceneEnhancements(

  scene: THREE.Scene,

  disposables: DisposableSceneResource[],

  sceneItems: SceneItem[],

  center: THREE.Vector3,

  size: THREE.Vector3,

  radius: number,

  groundZ: number,

  walkBounds: WalkBounds,

): BuiltShowroom | null {

  const sunGeometry = new THREE.SphereGeometry(clamp(radius * 0.045, 1.8, 5.5), 32, 16);

  const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xfff3d0, fog: false });

  const sun = new THREE.Mesh(sunGeometry, sunMaterial);

  sun.position.set(

    center.x + WALK_CINEMATIC_SUN_DIRECTION.x * radius,

    center.y + WALK_CINEMATIC_SUN_DIRECTION.y * radius,

    groundZ + WALK_CINEMATIC_SUN_DIRECTION.z * radius,

  );

  scene.add(sun);

  disposables.push(sunGeometry, sunMaterial);



  const sunGlowTexture = createSunGlowTexture();

  const sunGlowMaterial = new THREE.SpriteMaterial({

    map: sunGlowTexture,

    transparent: true,

    opacity: 0.045,

    depthWrite: false,

    depthTest: true,

    fog: false,

  });

  const sunGlow = new THREE.Sprite(sunGlowMaterial);

  sunGlow.position.copy(sun.position);

  sunGlow.scale.setScalar(clamp(radius * 0.42, 16, 44));

  scene.add(sunGlow);

  disposables.push(sunGlowTexture, sunGlowMaterial);

  addSunShafts(scene, disposables, sun.position, center, radius, groundZ);



  const sunLight = new THREE.DirectionalLight(0xf3f8ff, 0.42);

  sunLight.position.copy(sun.position);

  sunLight.target.position.set(center.x, center.y, groundZ + size.z * 0.38);

  sunLight.castShadow = false;

  sunLight.shadow.mapSize.set(WALK_SHADOW_MAP_SIZE, WALK_SHADOW_MAP_SIZE);

  const shadowSpan = clamp(radius * 1.2, 42, 180);

  sunLight.shadow.camera.left = -shadowSpan;

  sunLight.shadow.camera.right = shadowSpan;

  sunLight.shadow.camera.top = shadowSpan;

  sunLight.shadow.camera.bottom = -shadowSpan;

  sunLight.shadow.camera.near = 1;

  sunLight.shadow.camera.far = clamp(radius * 5, 180, 900);

  scene.add(sunLight, sunLight.target);



  const cloudHeight = groundZ + clamp(radius * 1.35, 34, 128);

  [

    [-0.9, -1.4, 1.0],

    [0.55, -1.15, 0.78],

    [1.1, 0.85, 0.92],

    [-1.25, 0.65, 0.72],

    [-0.15, 1.45, 0.58],

    [1.55, -0.12, 0.62],

  ].forEach(([ox, oy, s], index) => {

    addCloud(

      scene,

      disposables,

      new THREE.Vector3(center.x + ox * radius, center.y + oy * radius, cloudHeight + index * radius * 0.08),

      clamp(radius * 0.08 * s, 2.8, 10.5),

    );

  });



  // Optimized: use InstancedMesh for trees and shrubs to reduce draw calls

  const treeCount = 40;

  const treePositions: Array<{ x: number; y: number; z: number; scale: number }> = [];

  const shrubPositions: Array<{ x: number; y: number; z: number; scale: number }> = [];



  for (let i = 0; i < treeCount; i += 1) {

    const side = i % 4;

    const t = (i / treeCount + 0.13 * (i % 3)) % 1;

    const x = side < 2

      ? walkBounds.minX + (walkBounds.maxX - walkBounds.minX) * t

      : (side === 2 ? walkBounds.minX + 1.2 : walkBounds.maxX - 1.2);

    const y = side >= 2

      ? walkBounds.minY + (walkBounds.maxY - walkBounds.minY) * t

      : (side === 0 ? walkBounds.minY + 1.2 : walkBounds.maxY - 1.2);

    const treeScale = clamp(radius * (0.018 + (i % 4) * 0.002), 0.8, 1.75);

    

    treePositions.push({ x, y, z: groundZ, scale: treeScale });

    

    if (i % 3 !== 1) {

      shrubPositions.push({

        x: clamp(x + (i % 2 === 0 ? 1.1 : -1.1), walkBounds.minX + 0.8, walkBounds.maxX - 0.8),

        y: clamp(y + (i % 2 === 0 ? -0.9 : 0.9), walkBounds.minY + 0.8, walkBounds.maxY - 0.8),

        z: groundZ,

        scale: clamp(treeScale * 0.62, 0.55, 1.1),

      });

    }

  }



  // Use instanced rendering for better performance

  addTreeInstanced(scene, disposables, treePositions);

  addShrubInstanced(scene, disposables, shrubPositions);



  const buildingClusters = getBuildingClusters(sceneItems, size, groundZ);
  const mainClusters = buildingClusters.slice(0, 2);

  addDistantTreeLine(scene, disposables, walkBounds, groundZ, radius);

  addCinematicMuseumSetPieces(scene, disposables, mainClusters, walkBounds, groundZ, radius);

  addLandscapeDetails(scene, disposables, mainClusters, walkBounds, groundZ, radius);

  addFacadeAccents(scene, disposables, mainClusters, groundZ);

  addSolarPanels(scene, disposables, buildingClusters, groundZ);

  addParapetCrenellations(scene, disposables, buildingClusters);

  addConstructionSiteProps(scene, disposables, buildingClusters, walkBounds, groundZ, radius);

  addClusteredMuseumExhibits(scene, disposables, sceneItems, mainClusters, groundZ);

  // Build the themed digital showroom inside exhibition halls identified by wall clusters.
  let builtShowroom: BuiltShowroom | null = null;

  const exhibitionHalls = findExhibitionHallCenters(sceneItems, groundZ);
  // 入口招牌挂在第二个馆（用户指定的出生招牌馆），单馆时挂唯一馆
  const signHallIndex = exhibitionHalls.length > 1 ? 1 : 0;
  console.log(`[DigitalShowroom] exhibitionHalls=${exhibitionHalls.length}, groundZ=${groundZ.toFixed(3)}`);

  // Collect wall-like items for mural placement
  const wallItems = sceneItems.filter((item) => {
    const text = elementSearchText(item.element).toLowerCase();
    const typedWall = isIfcType(item.element, ["IfcWall", "IfcWallStandardCase", "IfcCurtainWall"]);
    const namedWall = text.includes("wall") || text.includes("curtain");
    if (!typedWall && !namedWall) return false;
    const size = item.bounds.getSize(new THREE.Vector3());
    return size.z > 1.2 && Math.max(size.x, size.y) > 0.3;
  });

  if (exhibitionHalls.length > 0) {
    // Distribute zones across halls:
    // 1 hall  -> all 3 zones in it
    // 2 halls -> zones [0,1] in first, zone [2] in second
    const zoneSplit: number[][] = exhibitionHalls.length >= 2
      ? [[0, 1], [2]]
      : [[0, 1, 2]];

    exhibitionHalls.forEach((hall, hallIndex) => {
      const zones = zoneSplit[hallIndex] || [];
      if (zones.length === 0) return;

      const hallSize = hall.bounds.getSize(new THREE.Vector3());
      console.log(
        `[DigitalShowroom] hall ${hallIndex}: center=(${hall.center.x.toFixed(2)}, ${hall.center.y.toFixed(2)}, ${hall.center.z.toFixed(2)}), size=(${hallSize.x.toFixed(2)}, ${hallSize.y.toFixed(2)}), zones=${zones.join(",")}`,
      );

      const result = buildDigitalShowroom(
        scene,
        disposables,
        hall.center,
        hallSize,
        hall.bounds,
        groundZ,
        zones,
        hallIndex === signHallIndex,
      );

      // 展馆地面 —— 使用反光材质替代Reflector以提升性能
      const mirrorSize = Math.min(Math.max(hallSize.x, hallSize.y) * 0.9, 24);
      const mirrorGeometry = new THREE.PlaneGeometry(mirrorSize, mirrorSize);
      const mirrorMat = new THREE.MeshStandardMaterial({
        color: 0x3a3328,
        roughness: 0.15,
        metalness: 0.6,
      });
      const mirror = new THREE.Mesh(mirrorGeometry, mirrorMat);
      mirror.position.set(hall.center.x, hall.center.y, groundZ + 0.005);
      // Z-up 场景：PlaneGeometry 默认已水平铺地，不能再绕 X 翻转（否则会立起成一堵墙）
      mirror.receiveShadow = true;
      scene.add(mirror);
      disposables.push(mirrorGeometry, mirrorMat);

      // Add murals on hall walls for each zone
      result.zoneMarkers.forEach(({ zone }) => {
        addShowroomMurals(
          scene,
          disposables,
          hall.bounds,
          hall.center,
          groundZ,
          zone,
          wallItems,
        );
      });

      // Add guide arrows between zone markers within this hall
      addHallGuideArrows(scene, disposables, result.zoneMarkers, groundZ);

      // Merge results into builtShowroom
      if (!builtShowroom) {
        builtShowroom = result;
      } else {
        builtShowroom.interactables.push(...result.interactables);
        builtShowroom.zoneMarkers.push(...result.zoneMarkers);
        if (result.guideNpcPosition && !builtShowroom.guideNpcPosition) {
          builtShowroom.guideNpcPosition = result.guideNpcPosition;
        }
      }
    });
  }

  return builtShowroom;

}



/**
 * 漫游模式：把场景中所有静态、非交互、不透明网格按“同一材质实例”合并，
 * 将展厅、喷泉、车辆等数百个独立网格压缩为少量合并网格，大幅降低 draw call，
 * 解决“望向建筑特别卡”的问题。
 * 交互展品(spinning/exhibitId)、透明材质、实例化网格、精灵、已合并的建筑网格等一律跳过，
 * 保证拾取、动画与透明叠层渲染不受影响。
 */
function materialMergeKey(material: THREE.Material): string | null {
  const mat = material as THREE.MeshBasicMaterial & THREE.MeshStandardMaterial;
  // 透明材质依赖逐对象深度排序，不参与合并
  if (mat.transparent) return null;
  const mapKey = mat.map ? `map:${mat.map.uuid}` : "nomap";
  const base = [
    `side:${mat.side ?? THREE.FrontSide}`,
    `depth:${mat.depthTest ? 1 : 0}${mat.depthWrite ? 1 : 0}`,
    `blend:${mat.blending ?? THREE.NormalBlending}`,
    mapKey,
  ].join(":");
  if ((mat as { isMeshBasicMaterial?: boolean }).isMeshBasicMaterial) {
    return `basic:${mat.color?.getHex() ?? 0}:${base}`;
  }
  if ((mat as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial) {
    return [
      "std",
      mat.color?.getHex() ?? 0,
      mat.roughness ?? 1,
      mat.metalness ?? 0,
      mat.emissive?.getHex() ?? 0,
      mat.emissiveIntensity ?? 1,
      mat.envMapIntensity ?? 1,
      mat.flatShading ? 1 : 0,
      mat.wireframe ? 1 : 0,
      base,
    ].join(":");
  }
  return null;
}

function mergeSceneStaticMeshes(scene: THREE.Scene, disposables: DisposableSceneResource[]): void {
  scene.updateMatrixWorld(true);

  const candidates: THREE.Mesh[] = [];

  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
    if ((mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) return;
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (!material || Array.isArray(material)) return;
    // 透明材质依赖逐对象深度排序，合并会打乱叠层顺序，跳过
    if (material.transparent) return;
    // 漫游模式已合并的建筑网格带 elementIndex 属性，跳过避免重复合并
    if (mesh.geometry.getAttribute("elementIndex")) return;
    const ud = mesh.userData as Record<string, unknown>;
    if (ud.exhibitId !== undefined || ud.spinning === true || ud.animated === true) return;
    // 负缩放镜像（行列式 ≤ 0）会翻转法线，跳过以保证渲染正确
    if (mesh.matrixWorld.determinant() <= 0) return;
    candidates.push(mesh);
  });

  if (candidates.length === 0) return;

  // 按材质属性分桶（非实例）：相同属性但不同实例的材质（如景观树/灌木）也能合并
  const buckets = new Map<string, THREE.Mesh[]>();
  const bucketMaterials = new Map<string, THREE.Material>();
  candidates.forEach((mesh) => {
    const key = materialMergeKey(mesh.material as THREE.Material);
    if (!key) return;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(mesh);
    else {
      buckets.set(key, [mesh]);
      bucketMaterials.set(key, mesh.material as THREE.Material);
    }
  });

  let mergedMeshCount = 0;
  let mergedPartCount = 0;

  buckets.forEach((meshes, key) => {
    if (meshes.length < 2) return;
    const parts: THREE.BufferGeometry[] = [];
    meshes.forEach((mesh) => {
      const part = mesh.geometry.clone();
      part.applyMatrix4(mesh.matrixWorld);
      parts.push(part);
    });

    let merged: THREE.BufferGeometry | null = null;
    try {
      merged = mergeGeometries(parts);
    } catch {
      merged = null;
    }
    parts.forEach((part) => disposables.push(part));
    if (!merged) return;

    const mergedMesh = new THREE.Mesh(merged, bucketMaterials.get(key) as THREE.Material);
    mergedMesh.castShadow = meshes.some((m) => m.castShadow);
    mergedMesh.receiveShadow = meshes.some((m) => m.receiveShadow);
    scene.add(mergedMesh);
    disposables.push(merged);

    meshes.forEach((mesh) => {
      const parent = mesh.parent;
      if (parent) parent.remove(mesh);
    });

    mergedMeshCount += 1;
    mergedPartCount += meshes.length;
  });

  if (mergedMeshCount > 0) {
    console.log(`[MergeStatic] 合并 ${mergedPartCount} 个网格 -> ${mergedMeshCount} 个合并网格`);
  }

}



export default function Ifc3DViewer({

  elements,

  style,

  initialViewMode = "model",

  presentationMode = false,

  sceneTitle = "IFC 建筑漫游",

  onExitWalkMode,

  materialTheme,


}: Props) {

  const hostRef = useRef<HTMLDivElement>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {

    if (materialTheme === "museum") {

      setMuseumMaterialTheme(true);

      return () => setMuseumMaterialTheme(false);

    }

    return undefined;

  }, [materialTheme]);

  const [orientationMode, setOrientationMode] = useState<OrientationMode>("z-up");

  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);

  const [renderMode, setRenderMode] = useState<RenderMode>("solid");

  // 核显/低配设备默认从"均衡"起步（影院画质的 PostFX+高像素比在核显上明显卡顿），用户仍可手动切换
  const [qualityMode, setQualityMode] = useState<QualityMode>(() => (isWeakGpuDevice() ? "balanced" : "cinematic"));

  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);

  const [nearbyElement, setNearbyElement] = useState<Element3D | null>(null);

  const [selectedElement, setSelectedElement] = useState<Element3D | null>(null);

  const [viewerWidth, setViewerWidth] = useState(0);

  const [walkToolsOpen, setWalkToolsOpen] = useState(false);

  const [walkPointerLocked, setWalkPointerLocked] = useState(false);
  const walkPointerToggleRef = useRef<(() => void) | null>(null);

  const [walkCameraMode, setWalkCameraMode] = useState<WalkCameraMode>("first");

  const [walkMotionState, setWalkMotionState] = useState<WalkMotionState>("idle");

  const [walkHeadingDeg, setWalkHeadingDeg] = useState(0);

  const [autoCruiseActive, setAutoCruiseActive] = useState(false);

  const [autoCruiseProgress, setAutoCruiseProgress] = useState(0);

  const [autoCruiseLabel, setAutoCruiseLabel] = useState("");

  const [showcaseActive, setShowcaseActive] = useState(false);

  const [nearbyIssue, setNearbyIssue] = useState<WalkIssuePoint | null>(null);

  const [nearbyShowroomExhibit, setNearbyShowroomExhibit] = useState<ShowroomInteractable | null>(null);

  const [activeShowroomExhibit, setActiveShowroomExhibit] = useState<ShowroomInteractable | null>(null);

  const [activeGuideZone, setActiveGuideZone] = useState<ShowroomZoneId | null>(null);

  const [guideLineIndex, setGuideLineIndex] = useState(0);

  const [guideVisible, setGuideVisible] = useState(false);

  const [renderStats, setRenderStats] = useState({ calls: 0, triangles: 0 });

  const walkCameraModeRef = useRef<WalkCameraMode>("first");

  const builtShowroomRef = useRef<BuiltShowroom | null>(null);

  const nearbyShowroomExhibitRef = useRef<ShowroomInteractable | null>(null);

  const autoCruiseControlRef = useRef<{ start: () => void; stop: () => void }>({ start: () => {}, stop: () => {} });

  const showcaseActiveRef = useRef(false);

  const showcaseControlRef = useRef<{ toggle: () => void; exit: () => void }>({ toggle: () => {}, exit: () => {} });

  const setNearbyIssueRef = useRef<(issue: WalkIssuePoint | null) => void>(() => {});

  const clearSelectedItemRef = useRef<() => void>(() => {});

  const isCompactViewer = viewerWidth > 0 && viewerWidth < 760;

  const isWalkView = viewMode === "walk";

  const showMainTools = !presentationMode && !isWalkView && (!isCompactViewer || walkToolsOpen);

  const showFilterTools = !presentationMode && !isWalkView && (!isCompactViewer || walkToolsOpen);

  const selectedInfoRows = useMemo(

    () => selectedElement ? buildElementInfoRows(selectedElement) : [],

    [selectedElement],

  );

  const requestExitWalkMode = () => {

    if (autoCruiseActive) {

      autoCruiseControlRef.current.stop();

    }

    if (document.pointerLockElement) {

      document.exitPointerLock();

    }

    setWalkPointerLocked(false);

    setWalkMotionState("idle");

    setViewMode("model");

    onExitWalkMode?.();

  };

  const toggleAutoCruise = () => {

    if (autoCruiseActive) {

      autoCruiseControlRef.current.stop();

    } else {

      autoCruiseControlRef.current.start();

    }

  };

  const pressWalkKey = (key: string, pressed: boolean) => {

    document.dispatchEvent(new KeyboardEvent(pressed ? "keydown" : "keyup", {

      key,

      bubbles: true,

    }));

  };

  const walkControlPointer = (key: string) => ({

    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {

      event.preventDefault();

      event.stopPropagation();

      pressWalkKey(key, true);

    },

    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {

      event.preventDefault();

      event.stopPropagation();

      pressWalkKey(key, false);

    },

    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => {

      event.preventDefault();

      event.stopPropagation();

      pressWalkKey(key, false);

    },

    onPointerLeave: (event: ReactPointerEvent<HTMLElement>) => {

      event.preventDefault();

      event.stopPropagation();

      pressWalkKey(key, false);

    },

  });

  const meshCount = useMemo(

    () => elements.filter((element) => hasPreviewMesh(element)).length,

    [elements],

  );

  const typeOptions = useMemo(() => {

    const counts = new Map<string, number>();

    elements.forEach((element) => {

      const key = elementTypeKey(element);

      counts.set(key, (counts.get(key) || 0) + 1);

    });

    return Array.from(counts.entries())

      .sort((a, b) => b[1] - a[1])

      .map(([value, count]) => ({ value, label: `${value} (${count})` }));

  }, [elements]);

  const filteredElements = useMemo(() => {

    if (selectedTypes.length === 0) return elements;

    const selected = new Set(selectedTypes);

    return elements.filter((element) => selected.has(elementTypeKey(element)));

  }, [elements, selectedTypes]);

  const previewElements = useMemo(

    () => filteredElements.slice(0, MAX_PREVIEW_ELEMENTS),

    [filteredElements],

  );



  useEffect(() => {

    setViewMode(initialViewMode);

  }, [initialViewMode]);



  useEffect(() => {

    const valid = new Set(typeOptions.map((item) => item.value));

    setSelectedTypes((prev) => {

      const next = prev.filter((item) => valid.has(item));

      return next.length === prev.length ? prev : next;

    });

  }, [typeOptions]);



  useEffect(() => {

    if (viewMode !== "walk") {

      showcaseControlRef.current.exit();

      setNearbyElement(null);

      setWalkPointerLocked(false);

      setWalkMotionState("idle");

      setWalkHeadingDeg(0);

      setAutoCruiseActive(false);

      setAutoCruiseProgress(0);

      setAutoCruiseLabel("");

      setNearbyIssue(null);

    }

  }, [viewMode]);



  useEffect(() => {

    walkCameraModeRef.current = walkCameraMode;

  }, [walkCameraMode]);



  useEffect(() => {

    if (!selectedElement) {

      return;

    }

    if (!previewElements.some((element) => element.id === selectedElement.id)) {

      clearSelectedItemRef.current();

    }

  }, [previewElements, selectedElement]);



  useEffect(() => {

    if (!isCompactViewer) {

      setWalkToolsOpen(false);

    }

  }, [isCompactViewer]);



  useEffect(() => {

    const host = hostRef.current;

    if (!host) {

      return undefined;

    }

    const updateWidth = () => setViewerWidth(host.clientWidth);

    updateWidth();

    const resizeObserver = new ResizeObserver(updateWidth);

    resizeObserver.observe(host);

    return () => resizeObserver.disconnect();

  }, []);



  useEffect(() => {

    const container = containerRef.current;

    if (!container || previewElements.length === 0) {

      setNearbyElement(null);

      return undefined;

    }



    container.replaceChildren();

    setNearbyElement(null);

    setSelectedElement(null);



    const width = Math.max(container.clientWidth || 900, 1);

    const height = Math.max(container.clientHeight || 500, 1);

    const largePreview = previewElements.length > LARGE_MODEL_THRESHOLD;

    const isWalkMode = viewMode === "walk";
    const shadowsEnabled = isWalkMode && qualityMode !== "performance" && !largePreview;
    const maxPixelRatio = largePreview && !isWalkMode ? LARGE_MODEL_MAX_PIXEL_RATIO : MAX_PIXEL_RATIO;
    const basePixelRatio = qualityMode === "performance"
      ? 1
      : qualityMode === "balanced"
        ? 1.25
        : Math.min(window.devicePixelRatio || 1, maxPixelRatio);
    const pixelRatio = basePixelRatio;
    const dragMinPixelRatio = qualityMode === "performance"
      ? 1
      : largePreview && !isWalkMode
        ? DRAG_LARGE_MODEL_MIN_PIXEL_RATIO
        : DRAG_MIN_PIXEL_RATIO;
    let currentPixelRatio = pixelRatio;

    // 自适应分辨率：核显等弱 GPU 上持续掉帧时由渲染循环调低（乘数），流畅后回升。
    // 与拖拽降倍率相互独立（拖拽按各自下限乘 adaptiveScale）。
    let adaptiveScale = 1;
    let adaptiveSlowFrames = 0;
    let adaptiveFastFrames = 0;

    const applyAdaptivePixelRatio = () => {
      const host = containerRef.current;
      if (!host) return;
      const next = Math.max(dragMinPixelRatio, pixelRatio * adaptiveScale);
      if (Math.abs(currentPixelRatio - next) < 1e-3) return;
      currentPixelRatio = next;
      renderer.setPixelRatio(next);
      renderer.setSize(Math.max(host.clientWidth, 1), Math.max(host.clientHeight, 1));
      composer?.setSize(Math.max(host.clientWidth, 1), Math.max(host.clientHeight, 1));
      needsRender = true;
    };

    const applyPixelRatio = (nextRatio: number): boolean => {
      const host = containerRef.current;
      if (!host) return false;
      const changed = Math.abs(currentPixelRatio - nextRatio) > 1e-6;
      currentPixelRatio = nextRatio;
      renderer.setPixelRatio(nextRatio);
      renderer.setSize(Math.max(host.clientWidth, 1), Math.max(host.clientHeight, 1));
      return changed;
    };



    const visualTestMode = isVisualTestMode();

    const renderer = new THREE.WebGLRenderer({

      antialias: true,

      powerPreference: "high-performance",

      preserveDrawingBuffer: visualTestMode,

      stencil: false,

    });

    renderer.outputColorSpace = THREE.SRGBColorSpace;

    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    renderer.setPixelRatio(pixelRatio);
    renderer.toneMappingExposure = isWalkMode ? 0.94 : 1.02;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.enabled = shadowsEnabled;
    renderer.info.autoReset = false;

    const scene = new THREE.Scene();

    // 临时调试钩子：暴露 scene/renderer 用于浏览器内 A/B 测性能，验证后移除
    (window as unknown as Record<string, unknown>).__debugScene = scene;

    (window as unknown as Record<string, unknown>).__debugRenderer = renderer;

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 2000);

    const useZUp = orientationMode === "z-up" || isWalkMode;

    if (useZUp) {

      scene.up.set(0, 0, 1);

      camera.up.set(0, 0, 1);

    }

    const controls = new OrbitControls(camera, renderer.domElement);

    controls.enabled = !isWalkMode;

    const disposables: DisposableSceneResource[] = [controls];

    const materialTextures = new Map<ProceduralTextureKind, THREE.Texture>();

    const getMaterialTexture = (kind: ProceduralTextureKind) => {

      const cached = materialTextures.get(kind);

      if (cached) {

        return cached;

      }

      const texture = createProceduralTexture(kind);

      materialTextures.set(kind, texture);

      disposables.push(texture);

      return texture;

    };

    let frameId = 0;



    scene.background = new THREE.Color(isWalkMode ? 0x8fc7ee : 0x0a1a33);

    const roomEnvironment = new RoomEnvironment();

    const pmremGenerator = new THREE.PMREMGenerator(renderer);

    const environmentMap = pmremGenerator.fromScene(roomEnvironment, 0.04).texture;

    scene.environment = environmentMap;

    disposables.push({

      dispose: () => {

        environmentMap.dispose();

        roomEnvironment.dispose();

        pmremGenerator.dispose();

      },

    });

    scene.add(new THREE.AmbientLight(0xe8f2ff, isWalkMode ? 0.48 : 1.05));

    scene.add(new THREE.HemisphereLight(0xbfdfff, 0x59624f, isWalkMode ? 0.78 : 0.58));



    const keyLight = new THREE.DirectionalLight(isWalkMode ? 0xfff4dd : 0xf4f8ff, isWalkMode ? 1.18 : 1.45);

    keyLight.position.set(isWalkMode ? -70 : 40, useZUp ? -100 : 60, useZUp ? 88 : 50);

    keyLight.castShadow = shadowsEnabled;

    keyLight.shadow.mapSize.set(2048, 2048);

    keyLight.shadow.camera.near = 0.5;

    keyLight.shadow.camera.far = 220;

    keyLight.shadow.camera.left = -60;

    keyLight.shadow.camera.right = 60;

    keyLight.shadow.camera.top = 60;

    keyLight.shadow.camera.bottom = -60;

    keyLight.shadow.bias = -0.0005;

    keyLight.shadow.normalBias = 0.04;

    scene.add(keyLight);



    if (isWalkMode && !largePreview) {

      const warmFill = new THREE.DirectionalLight(0xdcecff, qualityMode === "performance" ? 0.22 : 0.32);

      warmFill.position.set(60, 80, 30);

      scene.add(warmFill);

      scene.fog = new THREE.FogExp2(0x9dc6e8, 0.0009);

    }

    const grid = new THREE.GridHelper(120, 40, 0x7f8580, 0x9ba19a);

    // 网格随模型包围盒自适应：水平方向铺满建筑投影并留 1.5 倍边距
    const fitGridToModel = () => {
      if (grid.parent == null || bounds.isEmpty()) return;
      const foot = Math.max(size.x, size.y, 12);
      const span = Math.ceil((foot * 1.5) / 6) * 6;
      grid.scale.set(span / 120, span / 120, span / 120);
      if (useZUp) grid.position.set(center.x, center.y, 0);
      else grid.position.set(center.x, 0, center.z);
    };

    if (useZUp) {

      grid.rotation.x = Math.PI / 2;

    }

    if (!isWalkMode) {

      scene.add(grid);

    }

    const group = new THREE.Group();

    scene.add(group);



    container.appendChild(renderer.domElement);



    const usePostFX = isWalkMode && qualityMode === "cinematic" && !largePreview;

    const composer = usePostFX

      ? (() => {

          const c = new EffectComposer(renderer);

          c.setPixelRatio(pixelRatio);

          c.setSize(width, height);

          const renderPass = new RenderPass(scene, camera);

          c.addPass(renderPass);

          // Bloom: HDR glow on bright surfaces

          const bloomPass = new UnrealBloomPass(

            new THREE.Vector2(width, height),

            AAA_BLOOM_STRENGTH,

            AAA_BLOOM_RADIUS,

            AAA_BLOOM_THRESHOLD,

          );

          c.addPass(bloomPass);

          // Color grading: saturation / contrast / vignette

          const gradingPass = new ShaderPass(FilmGradingShader);

          gradingPass.uniforms.saturation.value = AAA_SATURATION;

          gradingPass.uniforms.contrast.value = AAA_CONTRAST;

          gradingPass.uniforms.brightness.value = 0.99;

          gradingPass.uniforms.vignetteIntensity.value = AAA_VIGNETTE_INTENSITY;

          c.addPass(gradingPass);

          const outputPass = new OutputPass();

          c.addPass(outputPass);

          return c;

        })()

      : null;



    const rawPrepared = previewElements.map((element) => {

      const isMeshPreview = hasPreviewMesh(element);

      const geometry = isMeshPreview ? createPreviewMeshGeometry(element) : undefined;

      const size = elementSize(element);

      const rawPosition = new THREE.Vector3(element.pos_x || 0, element.pos_y || 0, element.pos_z || 0);



      if (geometry?.boundingBox && !geometry.boundingBox.isEmpty()) {

        const meshCenter = geometry.boundingBox.getCenter(new THREE.Vector3());

        const meshSize = geometry.boundingBox.getSize(new THREE.Vector3());

        geometry.translate(-meshCenter.x, -meshCenter.y, -meshCenter.z);

        rawPosition.copy(meshCenter);

        size.length = Math.max(meshSize.x, 0.08);

        size.width = Math.max(meshSize.y, 0.08);

        size.height = Math.max(meshSize.z, 0.08);

      }



      return {

        element,

        geometry,

        isMeshPreview: Boolean(geometry),

        rawPosition,

        rawSize: size,

      };

    });

    const maxRawBoxSize = rawPrepared.reduce((max, item) => Math.max(

      max,

      item.rawSize.length,

      item.rawSize.width,

      item.rawSize.height,

    ), 1);

    const coordinateScale = maxRawBoxSize > 500 ? 0.001 : 1;

    const prepared = rawPrepared.map((item) => {

      if (item.geometry && coordinateScale !== 1) {

        item.geometry.scale(coordinateScale, coordinateScale, coordinateScale);

      }

      const meshScale = item.isMeshPreview ? coordinateScale : 1;

      return {

        ...item,

        size: {

          length: clamp(item.rawSize.length * meshScale, 0.08, 80),

          width: clamp(item.rawSize.width * meshScale, 0.08, 80),

          height: clamp(item.rawSize.height * meshScale, 0.08, 80),

        },

        pos: {

          x: item.rawPosition.x * coordinateScale,

          y: item.rawPosition.y * coordinateScale,

          z: item.rawPosition.z * coordinateScale,

        },

      };

    });

    const scaledPositions = prepared.map((item) => item.pos);

    const minPos = scaledPositions.reduce((acc, pos) => ({

      x: Math.min(acc.x, pos.x),

      y: Math.min(acc.y, pos.y),

      z: Math.min(acc.z, pos.z),

    }), { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY });

    const maxPos = scaledPositions.reduce((acc, pos) => ({

      x: Math.max(acc.x, pos.x),

      y: Math.max(acc.y, pos.y),

      z: Math.max(acc.z, pos.z),

    }), { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY, z: Number.NEGATIVE_INFINITY });

    const spread = Math.max(maxPos.x - minPos.x, maxPos.y - minPos.y, maxPos.z - minPos.z, 0);

    const uniquePositions = new Set(

      scaledPositions.map((pos) => `${pos.x.toFixed(2)},${pos.y.toFixed(2)},${pos.z.toFixed(2)}`),

    ).size;

    const maxBoxSize = prepared.reduce((max, item) => Math.max(

      max,

      item.size.length,

      item.size.width,

      item.size.height,

    ), 1);

    const forceGridLayout = viewMode === "grid";

    const useGridLayout = forceGridLayout || uniquePositions <= 1 || spread > Math.max(maxBoxSize * 220, 2000);

    const useExplodeLayout = viewMode === "explode" && !useGridLayout;

    const columns = Math.ceil(Math.sqrt(prepared.length));

    const cellSize = clamp(maxBoxSize * 1.9, 1.8, 12);

    const modelCenter = {

      x: (maxPos.x - minPos.x) / 2,

      y: (maxPos.y - minPos.y) / 2,

      z: (maxPos.z - minPos.z) / 2,

    };

    const explodeDistance = clamp(Math.max(spread, maxBoxSize) * 0.045, 0.6, 8);

    const edgeLimit = largePreview ? LARGE_MODEL_EDGE_RENDER_LIMIT : EDGE_RENDER_LIMIT;

    const meshEdgeLimit = largePreview ? LARGE_MODEL_MESH_EDGE_RENDER_LIMIT : MESH_EDGE_RENDER_LIMIT;

    let renderedEdges = 0;

    let renderedMeshEdges = 0;

    const sceneItems: SceneItem[] = [];

    const enableModelMerge = !isWalkMode
      && renderMode === "solid"
      && previewElements.length > MODEL_MERGE_MIN_ELEMENTS;

    // 漫游模式：按材质合并构件网格，降低 draw call，避免"望向建筑"掉帧
    const mergedSceneMeshes: THREE.Mesh[] = [];
    const walkMergeBuckets = new Map<
      string,
      { entries: { geometry: THREE.BufferGeometry; x: number; y: number; z: number; elementIndex: number }[]; material: THREE.Material }
    >();
    const modelMergeBuckets = new Map<
      string,
      { entries: { geometry: THREE.BufferGeometry; x: number; y: number; z: number; elementIndex: number; mesh: THREE.Mesh }[]; material: THREE.Material }
    >();
    const pickTargets: THREE.Object3D[] = [];



    const materialTexturePacks = new Map<ProceduralTextureKind, ProceduralTexturePack>();

    const getMaterialTexturePack = (kind: ProceduralTextureKind) => {

      const cached = materialTexturePacks.get(kind);

      if (cached) return cached;

      const pack = createAAATexturePack(kind);

      materialTexturePacks.set(kind, pack);

      disposables.push(pack.map, pack.normalMap, pack.bumpMap);

      if (pack.roughnessMap) disposables.push(pack.roughnessMap);

      return pack;

    };



    prepared.forEach(({ element, geometry: preparedGeometry, isMeshPreview, size }, index) => {

      const dx = size.length;

      const dy = size.width;

      const dz = size.height;



      const scaled = scaledPositions[index];

      let x = useGridLayout ? (index % columns) * cellSize : scaled.x - minPos.x;

      let y = useGridLayout ? Math.floor(index / columns) * cellSize : scaled.y - minPos.y;

      let z = useGridLayout ? 0 : scaled.z - minPos.z;

      if (useExplodeLayout) {

        const vx = x - modelCenter.x;

        const vy = y - modelCenter.y;

        const vz = (z - modelCenter.z) * 0.35;

        const length = Math.hypot(vx, vy, vz);

        if (length > 0.001) {

          x += (vx / length) * explodeDistance;

          y += (vy / length) * explodeDistance;

          z += (vz / length) * explodeDistance;

        } else {

          const angle = index * 2.399963229728653;

          x += Math.cos(angle) * explodeDistance;

          y += Math.sin(angle) * explodeDistance;

        }

      }



      const geometry = preparedGeometry || new THREE.BoxGeometry(dx, dy, dz);

      const profile = componentMaterialProfile(element);

      const baseOpacity = renderMode === "solid" ? 1 : (isMeshPreview ? 0.56 : 0.5);

      const opacity = clamp(baseOpacity * (profile.opacityFactor || 1), 0.26, 1);

      const usePhysical = isWalkMode && qualityMode !== "performance" && !largePreview && profile.texture !== "generic" && profile.texture !== "glass";

      const pack = usePhysical ? getMaterialTexturePack(profile.texture) : undefined;



      let material: THREE.MeshStandardMaterial;

      if (usePhysical && pack) {

        const physicalOptions: THREE.MeshPhysicalMaterialParameters = {

          color: profile.color,

          map: pack.map,

          bumpMap: pack.bumpMap,

          bumpScale: profile.texture === "metal" || profile.texture === "duct" ? 0.35 : 0.5,

          roughness: profile.roughness,

          metalness: profile.metalness,

          envMapIntensity: profile.texture === "glass" ? 1.8 : profile.texture === "metal" || profile.texture === "duct" ? 1.6 : 1.1,

          side: THREE.DoubleSide,

          transparent: profile.opacityFactor !== undefined || opacity < 0.95,

          opacity,

          depthWrite: renderMode === "solid" && opacity > 0.72,

        };

        if (profile.texture === "glass") {

          // 真实折射（transmission）会触发昂贵的离屏折射渲染，改为廉价透明玻璃
          physicalOptions.ior = 1.5;

          physicalOptions.thickness = 0;

          physicalOptions.attenuationColor = new THREE.Color(0xdff2ff);

          physicalOptions.attenuationDistance = Infinity;

          physicalOptions.clearcoat = 0.65;

          physicalOptions.clearcoatRoughness = 0.05;

          physicalOptions.reflectivity = 0.2;
          physicalOptions.envMapIntensity = 0.9;

        } else if (profile.texture === "metal" || profile.texture === "duct") {

          physicalOptions.metalness = 0.95;

          physicalOptions.roughness = 0.28;

          physicalOptions.clearcoat = 0.15;

          physicalOptions.clearcoatRoughness = 0.2;

          physicalOptions.reflectivity = 0.8;

        } else if (profile.texture === "wood") {

          physicalOptions.clearcoat = 0.35;

          physicalOptions.clearcoatRoughness = 0.35;

          physicalOptions.reflectivity = 0.3;

        } else if (profile.texture === "floor" || profile.texture === "concrete") {

          physicalOptions.clearcoat = 0.12;

          physicalOptions.clearcoatRoughness = 0.8;

        }

        const physical = new THREE.MeshPhysicalMaterial(physicalOptions);

        physical.emissive = new THREE.Color(0x000000);

        physical.emissiveIntensity = 0;

        material = physical;

      } else {

        const texture = !largePreview ? getMaterialTexture(profile.texture) : undefined;

        const materialOptions: THREE.MeshStandardMaterialParameters = {

          color: profile.color,

          transparent: renderMode !== "solid" || opacity < 0.98,

          opacity,

          roughness: profile.roughness,

          metalness: profile.metalness,

          envMapIntensity: profile.texture === "glass" ? 1.5 : profile.texture === "metal" || profile.texture === "duct" ? 1.25 : 0.7,

          side: THREE.DoubleSide,

          depthWrite: renderMode === "solid" && opacity > 0.72,

        };

        if (texture) {

          materialOptions.map = texture;

          if (profile.bumpScale) {

            materialOptions.bumpMap = texture;

            materialOptions.bumpScale = profile.bumpScale;

          }

        }

        material = new THREE.MeshStandardMaterial(materialOptions);

      }

      disposables.push(geometry, material);



      const mesh = new THREE.Mesh(geometry, material);

      if (isMeshPreview) {

        mesh.position.set(x, y, z);

      } else {

        mesh.position.set(x + dx / 2, y + dy / 2, z + dz / 2);

      }

      mesh.castShadow = isWalkMode;

      mesh.receiveShadow = isWalkMode;

      if (isWalkMode) {

        // 漫游模式：按材质分桶，循环结束后合并为少量网格（共享同一材质）
    const mergeKey = [
          usePhysical ? "P" : "S",
          profile.texture,
          profile.color.toString(16),
          profile.roughness,
          profile.metalness,
          profile.opacityFactor ?? "",
          opacity,
        ].join("|");
        let bucket = walkMergeBuckets.get(mergeKey);
        if (!bucket) {
          bucket = { entries: [], material };
          walkMergeBuckets.set(mergeKey, bucket);
        }
        bucket.entries.push({ geometry, x, y, z, elementIndex: index });
      } else {
        if (enableModelMerge) {
          const mergeKey = [
            "M",
            profile.texture,
            profile.color.toString(16),
            profile.roughness,
            profile.metalness,
            profile.opacityFactor ?? "",
            opacity,
          ].join("|");
          let bucket = modelMergeBuckets.get(mergeKey);
          if (!bucket) {
            bucket = { entries: [], material };
            modelMergeBuckets.set(mergeKey, bucket);
          }
          bucket.entries.push({ geometry, x, y, z, elementIndex: index, mesh });
        } else {
          group.add(mesh);
          pickTargets.push(mesh);
        }
      }

      const sceneItem: SceneItem = {

        element,

        mesh,

        material,

        baseOpacity: opacity,

        bounds: new THREE.Box3().setFromObject(mesh),

      };

      mesh.userData.sceneItem = sceneItem;

      sceneItems.push(sceneItem);



      const canRenderEdge = !isWalkMode && renderedEdges < edgeLimit && (!isMeshPreview || renderedMeshEdges < meshEdgeLimit);

      if (canRenderEdge) {

        const edgeGeometry = new THREE.EdgesGeometry(geometry);

        const edgeMaterial = new THREE.LineBasicMaterial({

          color: isMeshPreview ? 0xe2e8f0 : 0x0f172a,

          transparent: true,

          opacity: isMeshPreview ? 0.32 : 0.28,

        });

        disposables.push(edgeGeometry, edgeMaterial);

        const edge = new THREE.LineSegments(edgeGeometry, edgeMaterial);

        edge.position.copy(mesh.position);

        group.add(edge);

        renderedEdges += 1;

        if (isMeshPreview) {

          renderedMeshEdges += 1;

        }

      }

    });

    // 漫游模式：把同一材质的所有构件几何合并成一个网格，draw call 从上千降到个位数
    if (isWalkMode) {
      walkMergeBuckets.forEach((bucket) => {
        if (bucket.entries.length === 0) return;
        const parts: THREE.BufferGeometry[] = [];
        bucket.entries.forEach((entry) => {
          const part = entry.geometry.clone();
          part.translate(entry.x, entry.y, entry.z);
          parts.push(part);
        });
        const merged = mergeGeometries(parts);
        // 记录每个顶点所属构件索引，用于点击拾取时反查
        const elementIndex = new Float32Array(merged.attributes.position.count);
        let offset = 0;
        bucket.entries.forEach((entry) => {
          const count = entry.geometry.attributes.position.count;
          elementIndex.fill(entry.elementIndex, offset, offset + count);
          offset += count;
        });
        merged.setAttribute("elementIndex", new THREE.BufferAttribute(elementIndex, 1));
        const mergedMesh = new THREE.Mesh(merged, bucket.material);
        mergedMesh.castShadow = true;
        mergedMesh.receiveShadow = true;
        group.add(mergedMesh);
        mergedSceneMeshes.push(mergedMesh);
        pickTargets.push(mergedMesh);
        parts.forEach((part) => disposables.push(part));
        disposables.push(merged);
      });
    }

    // 模型模式：大批量构件也按材质合并成少量网格，降低拖拽时的 draw call
    if (!isWalkMode && enableModelMerge) {
      modelMergeBuckets.forEach((bucket) => {
        if (bucket.entries.length < 2 || bucket.material.transparent) {
          bucket.entries.forEach((entry) => {
            group.add(entry.mesh);
            pickTargets.push(entry.mesh);
          });
          return;
        }
        const parts: THREE.BufferGeometry[] = [];
        bucket.entries.forEach((entry) => {
          const part = entry.geometry.clone();
          // 按每个构件的实际位置平移，确保合并后与单个网格渲染完全一致
          part.translate(entry.mesh.position.x, entry.mesh.position.y, entry.mesh.position.z);
          parts.push(part);
        });
        const merged = mergeGeometries(parts);
        if (!merged) {
          // 几何属性不一致时无法合并，退回逐个网格
          bucket.entries.forEach((entry) => {
            group.add(entry.mesh);
            pickTargets.push(entry.mesh);
          });
          parts.forEach((part) => disposables.push(part));
          return;
        }
        // 记录每个顶点所属构件索引，用于点击拾取时反查
        const elementIndex = new Float32Array(merged.attributes.position.count);
        let offset = 0;
        bucket.entries.forEach((entry) => {
          const count = entry.geometry.attributes.position.count;
          elementIndex.fill(entry.elementIndex, offset, offset + count);
          offset += count;
        });
        merged.setAttribute("elementIndex", new THREE.BufferAttribute(elementIndex, 1));
        const mergedMesh = new THREE.Mesh(merged, bucket.material);
        mergedMesh.castShadow = false;
        mergedMesh.receiveShadow = false;
        group.add(mergedMesh);
        mergedSceneMeshes.push(mergedMesh);
        pickTargets.push(mergedMesh);
        bucket.entries.forEach((entry) => {
          entry.mesh.visible = false;
          entry.mesh.userData.mergedMesh = mergedMesh;
        });
        parts.forEach((part) => disposables.push(part));
        disposables.push(merged);
      });
      if (pickTargets.length === 0) {
        sceneItems.forEach((item) => pickTargets.push(item.mesh));
      }
    }



    const bounds = new THREE.Box3().setFromObject(group);

    const center = bounds.isEmpty() ? new THREE.Vector3(0, 0, 0) : bounds.getCenter(new THREE.Vector3());

    const size = bounds.isEmpty() ? new THREE.Vector3(10, 10, 10) : bounds.getSize(new THREE.Vector3());

    fitGridToModel();

    const radius = Math.max(size.x, size.y, size.z, 10);

    const groundZ = getWalkGroundZ(sceneItems, bounds);

    if (shadowsEnabled && !bounds.isEmpty()) {
      const shadowSpan = clamp(radius * 1.05, 42, 170);
      keyLight.position.set(
        center.x + WALK_CINEMATIC_SUN_DIRECTION.x * radius,
        center.y + WALK_CINEMATIC_SUN_DIRECTION.y * radius,
        groundZ + WALK_CINEMATIC_SUN_DIRECTION.z * radius,
      );
      keyLight.target.position.set(center.x, center.y, groundZ + size.z * 0.35);
      scene.add(keyLight.target);
      keyLight.shadow.camera.left = -shadowSpan;
      keyLight.shadow.camera.right = shadowSpan;
      keyLight.shadow.camera.top = shadowSpan;
      keyLight.shadow.camera.bottom = -shadowSpan;
      keyLight.shadow.camera.far = clamp(radius * 5, 180, 900);
      keyLight.shadow.camera.updateProjectionMatrix();
    }

    const walkPadding = Math.max(radius * 0.22, 6);

    const walkBounds = {

      minX: bounds.isEmpty() ? -20 : bounds.min.x - walkPadding,

      maxX: bounds.isEmpty() ? 20 : bounds.max.x + walkPadding,

      minY: bounds.isEmpty() ? -20 : bounds.min.y - walkPadding,

      maxY: bounds.isEmpty() ? 20 : bounds.max.y + walkPadding,

    };

    // Compute exhibition hall centers directly from wall clusters.
    // This is more reliable than generic building clustering which can pick up plazas.
    const exhibitionHalls = findExhibitionHallCenters(sceneItems, groundZ);
    console.log(`[Spawn] exhibitionHalls=${exhibitionHalls.length}`);

    // 出生点绑定到带入口招牌的展馆：双馆时为第二个馆（用户指定的出生招牌）
    const primaryHall = exhibitionHalls.length > 1 ? exhibitionHalls[1] : exhibitionHalls[0];

    // 上帝视角：相机绕主展馆中心自动环绕，展示全馆布局。
    // 半径/高度取主展馆自身跨度；若用全局模型包围盒，相机会被推到离馆很远的位置。
    const showcaseCenter = primaryHall
      ? new THREE.Vector3(primaryHall.center.x, primaryHall.center.y, primaryHall.center.z)
      : center.clone();
    const showcaseSpan = primaryHall
      ? Math.max(
          primaryHall.bounds.max.x - primaryHall.bounds.min.x,
          primaryHall.bounds.max.y - primaryHall.bounds.min.y,
          10,
        )
      : Math.max(
          bounds.max.x - bounds.min.x,
          bounds.max.y - bounds.min.y,
          bounds.max.z - bounds.min.z,
          10,
        );
    const showcaseRadius = Math.max(showcaseSpan * 0.85, 16);
    const showcaseHeight = Math.max(showcaseSpan * 0.7, 13);
    let showcaseAngle = 0;
    // 上帝视角轨道参数：滚轮缩放半径（远近）、拖拽调整环绕角与相机高度，均带平滑逼近
    let showcaseRadiusCurrent = showcaseRadius;
    let showcaseRadiusTarget = showcaseRadius;
    let showcaseHeightCurrent = showcaseHeight;
    let showcaseHeightTarget = showcaseHeight;
    let showcaseDragging = false;
    let showcaseLastX = 0;
    let showcaseLastY = 0;
    const showcaseRadiusMin = Math.max(showcaseSpan * 0.3, 7);
    const showcaseRadiusMax = Math.max(showcaseSpan * 2.6, 60);
    const showcaseHeightMin = Math.max(showcaseSpan * 0.16, 4);
    const showcaseHeightMax = Math.max(showcaseSpan * 1.7, 40);
    let showcaseSavedCameraState: {
      position: THREE.Vector3;
      lookAt: THREE.Vector3;
      up: THREE.Vector3;
      controlsTarget: THREE.Vector3;
    } | null = null;

    const enterShowcase = () => {
      if (showcaseActiveRef.current) {
        return;
      }
      autoCruiseControlRef.current.stop();
      if (document.pointerLockElement === renderer.domElement) {
        document.exitPointerLock();
      }
      setWalkPointerLocked(false);
      showcaseActiveRef.current = true;
      controls.enabled = false;
      showcaseAngle = 0;
      showcaseRadiusCurrent = showcaseRadius;
      showcaseRadiusTarget = showcaseRadius;
      showcaseHeightCurrent = showcaseHeight;
      showcaseHeightTarget = showcaseHeight;
      showcaseSavedCameraState = {
        position: camera.position.clone(),
        lookAt: controls.target.clone(),
        up: camera.up.clone(),
        controlsTarget: controls.target.clone(),
      };
      if (isWalkMode && walkState) {
        walkState.cameraLookAt.copy(showcaseCenter);
        walkState.cameraPrimed = true;
      }
      setShowcaseActive(true);
    };

    const exitShowcase = () => {
      if (!showcaseActiveRef.current) {
        return;
      }
      showcaseActiveRef.current = false;
      controls.enabled = true;
      if (showcaseSavedCameraState) {
        camera.position.copy(showcaseSavedCameraState.position);
        camera.up.copy(showcaseSavedCameraState.up);
        controls.target.copy(showcaseSavedCameraState.controlsTarget);
        camera.lookAt(showcaseSavedCameraState.lookAt);
        showcaseSavedCameraState = null;
      }
      if (isWalkMode && walkState) {
        walkState.cameraLookAt.copy(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(4).add(camera.position));
        walkState.cameraPrimed = true;
      }
      needsRender = true;
      setShowcaseActive(false);
    };

    showcaseControlRef.current = {
      toggle: () => (showcaseActiveRef.current ? exitShowcase() : enterShowcase()),
      exit: exitShowcase,
    };

    // 出生点设在主展馆入口招牌正南 4m 的广场上，面向招牌
    const rawSpawnPoint = primaryHall
      ? new THREE.Vector3(
          clamp(
            primaryHall.center.x,
            walkBounds.minX + 1,
            walkBounds.maxX - 1,
          ),
          clamp(
            primaryHall.bounds.min.y - 1.5,
            walkBounds.minY + 1,
            walkBounds.maxY - 1,
          ),
          groundZ + 0.02,
        )
      : new THREE.Vector3(
          center.x,
          bounds.isEmpty() ? -8 : bounds.min.y - Math.min(walkPadding * 0.65, 12),
          groundZ + 0.02,
        );

    const walkObstacles = isWalkMode

      ? sceneItems

        .filter((item) => isWalkObstacle(item.element, item.bounds, groundZ))

        .map((item) => item.bounds.clone().expandByScalar(WALK_COLLISION_PADDING))

      : [];

    const walkCollisionObstacles = walkObstacles;

    const canStandAt = (position: THREE.Vector3) => (

      !walkCollisionObstacles.some((box) => circleIntersectsBoxXY(

        position,

        box,

        WALK_COLLISION_RADIUS,

        WALK_COLLISION_HEIGHT,

      ))

    );

    const walkSpawnCandidates = isWalkMode

      ? getWalkSpawnCandidates(sceneItems, center, rawSpawnPoint, groundZ)

      : [rawSpawnPoint];

    const spawnPoint = isWalkMode

      ? findWalkSpawnPoint(walkSpawnCandidates, canStandAt, walkBounds, groundZ)

      : rawSpawnPoint;

    const walkInspectableItems = isWalkMode

      ? sceneItems

        .filter((item) => (

          item.bounds.max.z > groundZ + 0.12

          && item.bounds.min.z < groundZ + WALK_AVATAR_HEIGHT * 2.2

        ))

        .sort((a, b) => (

          pointToBoxDistanceSq(spawnPoint, a.bounds) - pointToBoxDistanceSq(spawnPoint, b.bounds)

        ))

        .slice(0, WALK_INSPECTABLE_LIMIT)

      : [];

    if (isWalkMode) {

      const walkGroundSize = clamp(Math.max(size.x, size.y) + walkPadding * 2.2, 28, 320);

      const groundRepeat = 18;

      const groundGeometry = new THREE.PlaneGeometry(walkGroundSize, walkGroundSize);

      groundGeometry.attributes.uv.needsUpdate = true;

      const baseUv = groundGeometry.attributes.uv;

      for (let i = 0; i < baseUv.count; i += 1) {

        baseUv.setXY(i, baseUv.getX(i) * groundRepeat, baseUv.getY(i) * groundRepeat);

      }

      const groundPack = !largePreview ? createAAATexturePack("ground") : undefined;

      const grassColor = new THREE.Color(0x6b7a5b);

      const groundMaterial = new THREE.MeshStandardMaterial({

        color: grassColor,

        map: groundPack?.map,

        normalMap: groundPack?.normalMap,

        normalScale: new THREE.Vector2(1.2, 1.2),

        roughness: 0.96,

        metalness: 0.02,

      });

      const ground = new THREE.Mesh(groundGeometry, groundMaterial);

      ground.position.set(center.x, center.y, groundZ - 0.018);

      ground.receiveShadow = true;

      scene.add(ground);

      disposables.push(groundGeometry, groundMaterial);

      if (groundPack) {

        disposables.push(groundPack.map, groundPack.normalMap);

      }



      const pathWidth = clamp(Math.max(size.x, size.y) * 0.18, 4.2, 14);

      const pathLength = clamp(Math.max(size.x, size.y) * 1.4, 28, 220);

      const pathGeometry = new THREE.PlaneGeometry(pathLength, pathWidth);

      const pathPack = !largePreview ? createAAATexturePack("floor") : undefined;

      const pathMaterial = new THREE.MeshStandardMaterial({

        color: 0xa8a49a,

        map: pathPack?.map,

        normalMap: pathPack?.normalMap,

        normalScale: new THREE.Vector2(0.7, 0.7),

        roughness: 0.9,

        metalness: 0.03,

      });

      const path = new THREE.Mesh(pathGeometry, pathMaterial);

      path.position.set(center.x, (walkBounds.minY + center.y) / 2, groundZ + 0.01);

      path.receiveShadow = true;

      scene.add(path);

      disposables.push(pathGeometry, pathMaterial);

      if (pathPack) {

        disposables.push(pathPack.map, pathPack.normalMap);

      }



      const plazaSize = clamp(Math.max(size.x, size.y) * 0.45, 12, 60);

      const plazaGeometry = new THREE.PlaneGeometry(plazaSize, plazaSize);

      const plazaMaterial = new THREE.MeshStandardMaterial({

        color: 0x9b9a94,

        map: pathPack?.map,

        normalMap: pathPack?.normalMap,

        roughness: 0.88,

        metalness: 0.04,

      });

      const plaza = new THREE.Mesh(plazaGeometry, plazaMaterial);

      plaza.position.set(center.x, center.y, groundZ + 0.014);

      plaza.receiveShadow = true;

      scene.add(plaza);

      disposables.push(plazaGeometry, plazaMaterial);



      if (!largePreview) {

        const lampGeometry = new THREE.CylinderGeometry(0.16, 0.16, 0.045, 24);

        lampGeometry.rotateX(Math.PI / 2);

        const lampMaterial = new THREE.MeshBasicMaterial({

          color: 0xfff2c4,

          transparent: true,

          opacity: 0.95,

        });

        const lampZ = clamp(center.z + size.z * 0.42, groundZ + 2.45, groundZ + 5.4);

        const lampOffsets = [

          [0, 0],

          [-radius * 0.22, radius * 0.15],

          [radius * 0.24, -radius * 0.14],

        ];

        lampOffsets.forEach(([offsetX, offsetY], index) => {

          const lamp = new THREE.Mesh(lampGeometry, lampMaterial);

          lamp.position.set(

            clamp(center.x + offsetX, walkBounds.minX + 1.2, walkBounds.maxX - 1.2),

            clamp(center.y + offsetY, walkBounds.minY + 1.2, walkBounds.maxY - 1.2),

            lampZ,

          );

          scene.add(lamp);



          const fillLight = new THREE.PointLight(

            0xfff2c4,

            index === 0 ? 8 : 5,

            clamp(radius * 0.9, 14, 46),

            1.8,

          );

          fillLight.position.copy(lamp.position).setZ(lamp.position.z - 0.2);

          scene.add(fillLight);

        });

        disposables.push(lampGeometry, lampMaterial);



        const skyGeometry = new THREE.SphereGeometry(clamp(radius * 10, 360, 1200), 48, 24);

        const skySunDirection = new THREE.Vector3(-1.9, -2.35, 1.65);

        const skyMaterial = createSkyDomeMaterial(skySunDirection);

        const sky = new THREE.Mesh(skyGeometry, skyMaterial);

        sky.position.copy(center).setZ(center.z + radius * 0.35);

        scene.add(sky);

        disposables.push(skyGeometry, skyMaterial);



        const addSceneEnhancementsResult = addSceneEnhancements(scene, disposables, sceneItems, center, size, radius, groundZ, walkBounds);

        builtShowroomRef.current = addSceneEnhancementsResult;

        // TEMP DEBUG: expose scene/camera for raycast diagnosis
        (window as unknown as Record<string, unknown>).__zhDebug = { scene, camera, THREE };



        // Add parking lot with cars

        const parkingLotSize = clamp(Math.max(size.x, size.y) * 0.35, 15, 80);

        const parkingLotX = center.x + radius * 0.6;

        const parkingLotY = center.y - radius * 0.3;

        const parkingGeometry = new THREE.PlaneGeometry(parkingLotSize, parkingLotSize * 0.6);

        const parkingMaterial = new THREE.MeshStandardMaterial({

          color: 0x3a3a3a,

          roughness: 0.95,

          metalness: 0.05,

        });

        const parkingLot = new THREE.Mesh(parkingGeometry, parkingMaterial);

        parkingLot.position.set(parkingLotX, parkingLotY, groundZ + 0.015);

        parkingLot.receiveShadow = true;

        scene.add(parkingLot);

        disposables.push(parkingGeometry, parkingMaterial);



        // Add parking lines

        const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });

        const carWidth = 2.4;

        const carLength = 4.8;

        const parkingRows = 4;

        const parkingCols = 6;

        const startX = parkingLotX - (parkingCols * carWidth) / 2;

        const startY = parkingLotY - (parkingRows * carLength) / 2;

        const lineGeometry = new THREE.PlaneGeometry(0.15, carLength * 0.9);

        disposables.push(lineGeometry, lineMaterial);

        for (let row = 0; row < parkingRows; row++) {

          for (let col = 0; col < parkingCols; col++) {

            const line = new THREE.Mesh(lineGeometry, lineMaterial);

            line.position.set(

              startX + col * carWidth + carWidth / 2,

              startY + row * carLength + carLength / 2,

              groundZ + 0.02,

            );

            scene.add(line);

          }

        }



        // AAA quality car paint texture generator

        const createCarPaintTexture = (color: number, size = 512) => {

          const canvas = document.createElement("canvas");

          canvas.width = size;

          canvas.height = size;

          const ctx = canvas.getContext("2d")!;

          const r = (color >> 16) & 0xff;

          const g = (color >> 8) & 0xff;

          const b = color & 0xff;



          // Base color gradient

          const grad = ctx.createLinearGradient(0, 0, size, size);

          grad.addColorStop(0, `rgb(${r},${g},${b})`);

          grad.addColorStop(0.5, `rgb(${Math.min(255, r + 15)},${Math.min(255, g + 15)},${Math.min(255, b + 15)})`);

          grad.addColorStop(1, `rgb(${Math.max(0, r - 10)},${Math.max(0, g - 10)},${Math.max(0, b - 10)})`);

          ctx.fillStyle = grad;

          ctx.fillRect(0, 0, size, size);



          // Metallic flakes

          for (let i = 0; i < 800; i++) {

            const x = Math.random() * size;

            const y = Math.random() * size;

            const s = Math.random() * 2 + 0.5;

            const brightness = Math.random() * 60 + 40;

            ctx.fillStyle = `rgba(${brightness + 100},${brightness + 100},${brightness + 100},${Math.random() * 0.3 + 0.1})`;

            ctx.beginPath();

            ctx.arc(x, y, s, 0, Math.PI * 2);

            ctx.fill();

          }



          const texture = new THREE.CanvasTexture(canvas);

          texture.wrapS = texture.wrapT = THREE.RepeatWrapping;



          // Normal map

          const normalCanvas = document.createElement("canvas");

          normalCanvas.width = size / 2;

          normalCanvas.height = size / 2;

          const nCtx = normalCanvas.getContext("2d")!;

          nCtx.fillStyle = "rgb(128,128,255)";

          nCtx.fillRect(0, 0, size / 2, size / 2);

          for (let i = 0; i < 300; i++) {

            const x = Math.random() * size / 2;

            const y = Math.random() * size / 2;

            nCtx.fillStyle = `rgb(${128 + Math.random() * 10 - 5},${128 + Math.random() * 10 - 5},${250 + Math.random() * 5})`;

            nCtx.beginPath();

            nCtx.arc(x, y, Math.random() * 2, 0, Math.PI * 2);

            nCtx.fill();

          }

          const normalMap = new THREE.CanvasTexture(normalCanvas);

          normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;



          return { map: texture, normalMap };

        };



        // AAA quality stone texture

        const createStoneTexture = (size = 512) => {

          const canvas = document.createElement("canvas");

          canvas.width = size;

          canvas.height = size;

          const ctx = canvas.getContext("2d")!;



          // Base stone color

          ctx.fillStyle = "#8a8a8a";

          ctx.fillRect(0, 0, size, size);



          // Stone grain

          for (let i = 0; i < 2000; i++) {

            const x = Math.random() * size;

            const y = Math.random() * size;

            const gray = Math.random() * 40 + 100;

            ctx.fillStyle = `rgba(${gray},${gray},${gray},${Math.random() * 0.3})`;

            ctx.fillRect(x, y, Math.random() * 4 + 1, Math.random() * 4 + 1);

          }



          // Cracks and veins

          for (let i = 0; i < 15; i++) {

            ctx.strokeStyle = `rgba(60,60,60,${Math.random() * 0.3 + 0.1})`;

            ctx.lineWidth = Math.random() * 1.5 + 0.5;

            ctx.beginPath();

            let x = Math.random() * size;

            let y = Math.random() * size;

            ctx.moveTo(x, y);

            for (let j = 0; j < 8; j++) {

              x += (Math.random() - 0.5) * 60;

              y += (Math.random() - 0.5) * 60;

              ctx.lineTo(x, y);

            }

            ctx.stroke();

          }



          const texture = new THREE.CanvasTexture(canvas);

          texture.wrapS = texture.wrapT = THREE.RepeatWrapping;



          // Normal map

          const normalCanvas = document.createElement("canvas");

          normalCanvas.width = size / 2;

          normalCanvas.height = size / 2;

          const nCtx = normalCanvas.getContext("2d")!;

          nCtx.fillStyle = "rgb(128,128,255)";

          nCtx.fillRect(0, 0, size / 2, size / 2);

          for (let i = 0; i < 500; i++) {

            const x = Math.random() * size / 2;

            const y = Math.random() * size / 2;

            const offset = Math.random() * 20 - 10;

            nCtx.fillStyle = `rgb(${128 + offset},${128 + offset},${240 + Math.random() * 15})`;

            nCtx.fillRect(x, y, Math.random() * 3 + 1, Math.random() * 3 + 1);

          }

          const normalMap = new THREE.CanvasTexture(normalCanvas);

          normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;



          return { map: texture, normalMap };

        };



        // Add AAA quality cars

        const carColors = [0xcc2220, 0x1a4d99, 0x1a6b3a, 0xf5c518, 0xf8f8f8, 0x1a1a1a, 0x4a4a4a, 0x8b1a1a];

        // Shared geometries and materials (created once, reused for all cars)
        const sharedTireGeometry = new THREE.TorusGeometry(0.28, 0.1, 12, 24);
        const sharedTireMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9, metalness: 0.1 });
        const sharedRimGeometry = new THREE.CylinderGeometry(0.2, 0.2, 0.18, 16);
        const sharedRimMaterial = new THREE.MeshPhysicalMaterial({ color: 0xcccccc, roughness: 0.15, metalness: 0.95, clearcoat: 0.8, clearcoatRoughness: 0.1 });
        const sharedBumperGeometry = new THREE.BoxGeometry(carWidth * 0.88, 0.15, 0.2);
        const sharedBumperMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.4 });
        const sharedHeadlightGeometry = new THREE.BoxGeometry(0.25, 0.08, 0.12);
        const sharedHeadlightMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const sharedTaillightGeometry = new THREE.BoxGeometry(0.28, 0.06, 0.1);
        const sharedTaillightMaterial = new THREE.MeshBasicMaterial({ color: 0xff1a1a });
        const sharedMirrorGeometry = new THREE.BoxGeometry(0.08, 0.12, 0.15);
        const sharedMirrorMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.4, metalness: 0.5 });
        const sharedDoorLineGeometry = new THREE.BoxGeometry(0.01, carLength * 0.4, 0.35);
        const sharedDoorLineMaterial = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.8 });
        const sharedRockerGeometry = new THREE.BoxGeometry(carWidth * 0.96, carLength * 0.92, 0.12);
        const sharedRockerMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6, metalness: 0.3 });
        const sharedGlassMaterial = new THREE.MeshPhysicalMaterial({ color: 0x1a2a3a, roughness: 0.02, metalness: 0.1, transparent: true, opacity: 0.7, side: THREE.DoubleSide, envMapIntensity: 1.5 });
        const sharedWindshieldGeometry = new THREE.PlaneGeometry(carWidth * 0.78, 0.42);
        const sharedSideWindowGeometry = new THREE.PlaneGeometry(carLength * 0.44, 0.32);
        const sharedBodyGeometry = new THREE.BoxGeometry(carWidth * 0.92, carLength * 0.88, 0.45);
        const sharedCabinGeometry = new THREE.BoxGeometry(carWidth * 0.82, carLength * 0.48, 0.38);
        disposables.push(sharedTireGeometry, sharedTireMaterial, sharedRimGeometry, sharedRimMaterial, sharedBumperGeometry, sharedBumperMaterial, sharedHeadlightGeometry, sharedHeadlightMaterial, sharedTaillightGeometry, sharedTaillightMaterial, sharedMirrorGeometry, sharedMirrorMaterial, sharedDoorLineGeometry, sharedDoorLineMaterial, sharedRockerGeometry, sharedRockerMaterial, sharedGlassMaterial, sharedWindshieldGeometry, sharedSideWindowGeometry, sharedBodyGeometry, sharedCabinGeometry);

        for (let row = 0; row < parkingRows; row++) {

          for (let col = 0; col < parkingCols; col++) {

            if (Math.random() > 0.75) continue;

            const carX = startX + col * carWidth + carWidth / 2;

            const carY = startY + row * carLength + carLength / 2;

            const carColor = carColors[Math.floor(Math.random() * carColors.length)];



            const carGroup = new THREE.Group();

            carGroup.position.set(carX, carY, groundZ);



            const { map: paintMap, normalMap: paintNormal } = createCarPaintTexture(carColor);



            // Car body material with clearcoat (unique per car for color)

            const bodyMaterial = new THREE.MeshPhysicalMaterial({

              map: paintMap,

              normalMap: paintNormal,

              normalScale: new THREE.Vector2(0.3, 0.3),

              color: carColor,

              roughness: 0.15,

              metalness: 0.85,

              clearcoat: 1.0,

              clearcoatRoughness: 0.05,

              reflectivity: 1.0,

              envMapIntensity: 1.2,

            });



            // Main body (lower, sleek)

            const body = new THREE.Mesh(sharedBodyGeometry, bodyMaterial);

            body.position.z = 0.42;

            body.castShadow = true;

            body.receiveShadow = true;

            carGroup.add(body);

            disposables.push(bodyMaterial, paintMap, paintNormal);



            // Lower rocker panel

            const rocker = new THREE.Mesh(sharedRockerGeometry, sharedRockerMaterial);

            rocker.position.z = 0.22;

            rocker.castShadow = true;

            carGroup.add(rocker);



            // Cabin (sleek, low profile)

            const cabin = new THREE.Mesh(sharedCabinGeometry, bodyMaterial);

            cabin.position.z = 0.84;

            cabin.castShadow = true;

            carGroup.add(cabin);



            // Windshield (angled)

            const windshield = new THREE.Mesh(sharedWindshieldGeometry, sharedGlassMaterial);

            windshield.position.set(0, carLength * 0.24, 0.88);

            windshield.rotation.x = -Math.PI / 5;

            carGroup.add(windshield);



            // Rear window

            const rearWindow = new THREE.Mesh(sharedWindshieldGeometry, sharedGlassMaterial);

            rearWindow.position.set(0, -carLength * 0.24, 0.88);

            rearWindow.rotation.x = Math.PI / 5;

            carGroup.add(rearWindow);



            // Side windows

            const leftWindow = new THREE.Mesh(sharedSideWindowGeometry, sharedGlassMaterial);

            leftWindow.position.set(-carWidth * 0.41, 0, 0.86);

            leftWindow.rotation.y = Math.PI / 2;

            carGroup.add(leftWindow);



            const rightWindow = new THREE.Mesh(sharedSideWindowGeometry, sharedGlassMaterial);

            rightWindow.position.set(carWidth * 0.41, 0, 0.86);

            rightWindow.rotation.y = -Math.PI / 2;

            carGroup.add(rightWindow);



            // Wheels with rims

            const wheelPositions = [

              [-carWidth * 0.44, carLength * 0.3, 0.28],

              [carWidth * 0.44, carLength * 0.3, 0.28],

              [-carWidth * 0.44, -carLength * 0.3, 0.28],

              [carWidth * 0.44, -carLength * 0.3, 0.28],

            ];

            wheelPositions.forEach(([x, y, z]) => {

              const tire = new THREE.Mesh(sharedTireGeometry, sharedTireMaterial);

              tire.position.set(x, y, z);

              tire.rotation.x = Math.PI / 2;

              tire.castShadow = true;

              carGroup.add(tire);



              const rim = new THREE.Mesh(sharedRimGeometry, sharedRimMaterial);

              rim.position.set(x, y, z);

              // Z-up 场景：Cylinder 轴向本就是水平的 Y，与立起的轮胎同轴，无需旋转
              rim.castShadow = true;

              carGroup.add(rim);

            });



            // Front bumper

            const frontBumper = new THREE.Mesh(sharedBumperGeometry, sharedBumperMaterial);

            frontBumper.position.set(0, carLength * 0.46, 0.32);

            carGroup.add(frontBumper);



            // Rear bumper

            const rearBumper = new THREE.Mesh(sharedBumperGeometry, sharedBumperMaterial);

            rearBumper.position.set(0, -carLength * 0.46, 0.32);

            carGroup.add(rearBumper);



            // Headlights (rectangular, LED style)

            const headlightPositions = [

              [-carWidth * 0.32, carLength * 0.44, 0.45],

              [carWidth * 0.32, carLength * 0.44, 0.45],

            ];

            headlightPositions.forEach(([x, y, z]) => {

              const headlight = new THREE.Mesh(sharedHeadlightGeometry, sharedHeadlightMaterial);

              headlight.position.set(x, y, z);

              carGroup.add(headlight);

            });



            // Taillights (LED strip style)

            const taillightPositions = [

              [-carWidth * 0.32, -carLength * 0.44, 0.45],

              [carWidth * 0.32, -carLength * 0.44, 0.45],

            ];

            taillightPositions.forEach(([x, y, z]) => {

              const taillight = new THREE.Mesh(sharedTaillightGeometry, sharedTaillightMaterial);

              taillight.position.set(x, y, z);

              carGroup.add(taillight);

            });



            // Side mirrors

            const leftMirror = new THREE.Mesh(sharedMirrorGeometry, sharedMirrorMaterial);

            leftMirror.position.set(-carWidth * 0.48, carLength * 0.15, 0.75);

            carGroup.add(leftMirror);

            const rightMirror = new THREE.Mesh(sharedMirrorGeometry, sharedMirrorMaterial);

            rightMirror.position.set(carWidth * 0.48, carLength * 0.15, 0.75);

            carGroup.add(rightMirror);



            // Door lines (subtle detail)

            const leftDoorLine = new THREE.Mesh(sharedDoorLineGeometry, sharedDoorLineMaterial);

            leftDoorLine.position.set(-carWidth * 0.46, 0, 0.45);

            carGroup.add(leftDoorLine);

            const rightDoorLine = new THREE.Mesh(sharedDoorLineGeometry, sharedDoorLineMaterial);

            rightDoorLine.position.set(carWidth * 0.46, 0, 0.45);

            carGroup.add(rightDoorLine);



            scene.add(carGroup);

          }

        }



        // Add AAA quality fountain in central plaza (Z-up oriented)

        const fountainRadius = clamp(plazaSize * 0.12, 2.5, 5);

        const fountainGroup = new THREE.Group();

        fountainGroup.position.set(center.x, center.y, groundZ);



        const { map: stoneMap, normalMap: stoneNormal } = createStoneTexture();



        // Stone material with texture

        const stoneMaterial = new THREE.MeshPhysicalMaterial({

          map: stoneMap,

          normalMap: stoneNormal,

          normalScale: new THREE.Vector2(0.8, 0.8),

          color: 0x8a8a8a,

          roughness: 0.75,

          metalness: 0.15,

          clearcoat: 0.1,

          clearcoatRoughness: 0.8,

        });



        // Outer basin (circular pool with rim) - Z-up rotation

        const basinOuterGeometry = new THREE.CylinderGeometry(fountainRadius, fountainRadius, 0.6, 32);

        const basinOuter = new THREE.Mesh(basinOuterGeometry, stoneMaterial);

        basinOuter.position.z = 0.3;

        basinOuter.rotation.x = -Math.PI / 2; // Z-up rotation

        basinOuter.castShadow = true;

        basinOuter.receiveShadow = true;

        fountainGroup.add(basinOuter);

        disposables.push(basinOuterGeometry, stoneMaterial, stoneMap, stoneNormal);



        // Basin rim (torus) - already correctly oriented

        const rimGeometry = new THREE.TorusGeometry(fountainRadius, 0.18, 12, 32);

        const rimMaterial = new THREE.MeshPhysicalMaterial({

          map: stoneMap,

          normalMap: stoneNormal,

          normalScale: new THREE.Vector2(0.6, 0.6),

          color: 0x7a7a7a,

          roughness: 0.65,

          metalness: 0.2,

          clearcoat: 0.15,

        });

        const rim = new THREE.Mesh(rimGeometry, rimMaterial);

        rim.position.z = 0.62;

        // Z-up 场景：Torus 默认已水平，绕 X 旋转 90° 会立成竖圈
        rim.castShadow = true;

        fountainGroup.add(rim);

        disposables.push(rimGeometry, rimMaterial);



        // Inner water pool - Z-up rotation

        const waterPoolGeometry = new THREE.CylinderGeometry(fountainRadius * 0.85, fountainRadius * 0.85, 0.35, 32);

        const waterMaterial = new THREE.MeshPhysicalMaterial({

          color: 0x3a7a9a,

          roughness: 0.02,

          metalness: 0.05,

          // 真实折射（transmission）会触发昂贵的离屏折射渲染，改为廉价透明水面
          ior: 1.33,

          transparent: true,

          opacity: 0.8,

          thickness: 0.5,

          envMapIntensity: 1.5,

        });

        const waterPool = new THREE.Mesh(waterPoolGeometry, waterMaterial);

        waterPool.position.z = 0.38;

        waterPool.rotation.x = -Math.PI / 2; // Z-up rotation

        fountainGroup.add(waterPool);

        disposables.push(waterPoolGeometry, waterMaterial);



        // Center pedestal tier 1 - Z-up rotation

        const pedestal1Geometry = new THREE.CylinderGeometry(0.65, 0.75, 0.55, 20);

        const pedestal1 = new THREE.Mesh(pedestal1Geometry, stoneMaterial);

        pedestal1.position.z = 0.88;

        pedestal1.rotation.x = -Math.PI / 2; // Z-up rotation

        pedestal1.castShadow = true;

        fountainGroup.add(pedestal1);

        disposables.push(pedestal1Geometry);



        // Center pedestal tier 2 - Z-up rotation

        const pedestal2Geometry = new THREE.CylinderGeometry(0.45, 0.55, 0.45, 20);

        const pedestal2 = new THREE.Mesh(pedestal2Geometry, stoneMaterial);

        pedestal2.position.z = 1.38;

        pedestal2.rotation.x = -Math.PI / 2; // Z-up rotation

        pedestal2.castShadow = true;

        fountainGroup.add(pedestal2);

        disposables.push(pedestal2Geometry);



        // Top ornament (chrome sphere)

        const ornamentGeometry = new THREE.SphereGeometry(0.32, 24, 16);

        const ornamentMaterial = new THREE.MeshPhysicalMaterial({

          color: 0xdddddd,

          roughness: 0.08,

          metalness: 0.98,

          clearcoat: 1.0,

          clearcoatRoughness: 0.02,

          reflectivity: 1.0,

          envMapIntensity: 2.0,

        });

        const ornament = new THREE.Mesh(ornamentGeometry, ornamentMaterial);

        ornament.position.z = 1.75;

        ornament.castShadow = true;

        fountainGroup.add(ornament);

        disposables.push(ornamentGeometry, ornamentMaterial);



        // Water jets material

        const jetMaterial = new THREE.MeshPhysicalMaterial({

          color: 0x88ccff,

          roughness: 0.05,

          metalness: 0.0,

          // 真实折射（transmission）会触发昂贵的离屏折射渲染，改为廉价透明水柱
          transparent: true,

          opacity: 0.65,

          ior: 1.33,

          thickness: 0.3,

        });



        // Center jet (shooting up along Z-axis) - Z-up rotation

        const centerJetGeometry = new THREE.CylinderGeometry(0.05, 0.08, 1.4, 12);

        const centerJet = new THREE.Mesh(centerJetGeometry, jetMaterial);

        centerJet.position.z = 1.35;

        centerJet.rotation.x = -Math.PI / 2; // Z-up: cylinder points up

        fountainGroup.add(centerJet);

        disposables.push(centerJetGeometry);



        // Ring jets (shooting outward at angle) - Z-up rotation

        const ringJetCount = 8;

        const ringJetGeometry = new THREE.CylinderGeometry(0.035, 0.055, 0.9, 10);

        const ringJetAxis = new THREE.Vector3();

        disposables.push(ringJetGeometry, jetMaterial);

        for (let i = 0; i < ringJetCount; i++) {

          const angle = (i / ringJetCount) * Math.PI * 2;

          const jetRadius = fountainRadius * 0.5;

          const jetX = Math.cos(angle) * jetRadius;

          const jetY = Math.sin(angle) * jetRadius;

          const jet = new THREE.Mesh(ringJetGeometry, jetMaterial);

          jet.position.set(jetX, jetY, 0.9);

          // Z-up: base rotation to point up, then tilt outward

          jet.rotation.x = -Math.PI / 2;

          ringJetAxis.set(Math.cos(angle + Math.PI / 2), Math.sin(angle + Math.PI / 2), 0);

          jet.rotateOnWorldAxis(ringJetAxis, 0.45);

          fountainGroup.add(jet);

        }



        scene.add(fountainGroup);

        // 场景静态内容全部就绪后，按材质合并静态网格，把 draw call 压缩到几十个量级
        mergeSceneStaticMeshes(scene, disposables);

      }

    }

    const walkState = {

      position: spawnPoint.clone(),

      cameraYaw: 0,

      cameraPitch: 0.12,

      avatarYaw: 0,

      cameraLookAt: new THREE.Vector3(),

      cameraPrimed: false,

      stepPhase: 0,

      bobOffset: 0,

      isRunning: false,

      verticalVelocity: 0,

      baseZ: groundZ + 0.02,

      onGround: true,

      keys: new Set<string>(),

      dragging: false,

      pointerButtonDown: false,

      lastPointerX: 0,

      lastPointerY: 0,

      lastScanAt: 0,

      isFlyMode: false,

      isGhostMode: false,

    };

    const cruiseState = {

      active: false,

      segmentIndex: 0,

      segmentProgress: 0,

      inStay: false,

      stayElapsed: 0,

      startPos: new THREE.Vector3(),

      startYaw: 0,

      startPitch: 0,

      endPos: new THREE.Vector3(),

      endYaw: 0,

      endPitch: 0,

      lastProgress: -1,

      lastLabel: "",

    };

    const cruiseTargetVec = new THREE.Vector3();

    const computeYawPitchTo = (fromPos: THREE.Vector3, target: THREE.Vector3, aimHeight: number) => {

      const dx = target.x - fromPos.x;

      const dy = target.y - fromPos.y;

      const dz = target.z - (fromPos.z + aimHeight);

      const horizontalDist = Math.sqrt(dx * dx + dy * dy);

      const yaw = Math.atan2(dx, dy);

      const pitch = clamp(Math.atan2(dz, Math.max(horizontalDist, 0.001)), WALK_PITCH_MIN, WALK_PITCH_MAX);

      return { yaw, pitch };

    };

    const startCruise = () => {

      if (cruiseState.active) {

        return;

      }

      cruiseState.active = true;

      cruiseState.segmentIndex = 0;

      cruiseState.segmentProgress = 0;

      cruiseState.inStay = false;

      cruiseState.stayElapsed = 0;

      cruiseState.startPos.copy(walkState.position);

      cruiseState.startYaw = walkState.cameraYaw;

      cruiseState.startPitch = walkState.cameraPitch;

      const wp = AUTO_CRUISE_WAYPOINTS[0];

      cruiseState.endPos.set(wp.position[0], wp.position[1], wp.position[2]);

      cruiseTargetVec.set(wp.target[0], wp.target[1], wp.target[2]);

      const { yaw, pitch } = computeYawPitchTo(cruiseState.endPos, cruiseTargetVec, WALK_CAMERA_AIM_HEIGHT);

      cruiseState.endYaw = yaw;

      cruiseState.endPitch = pitch;

      cruiseState.lastProgress = -1;

      cruiseState.lastLabel = "";

      walkState.keys.clear();

      walkState.isFlyMode = false;

      walkState.isGhostMode = false;

      walkState.verticalVelocity = 0;

      walkState.onGround = true;

      setAutoCruiseActive(true);

    };

    const stopCruise = () => {

      if (!cruiseState.active) {

        return;

      }

      cruiseState.active = false;

      setAutoCruiseActive(false);

      setAutoCruiseProgress(0);

      setAutoCruiseLabel("");

    };

    autoCruiseControlRef.current = { start: startCruise, stop: stopCruise };

    let lastNearbyIssue: WalkIssuePoint | null = null;

    setNearbyIssueRef.current = (issue: WalkIssuePoint | null) => {

      setNearbyIssue(issue);

    };

    const updateNearbyIssue = () => {

      let nearestIssue: WalkIssuePoint | null = null;

      let nearestDist = AUTO_CRUISE_ISSUE_THRESHOLD;

      for (const issue of WALK_ISSUE_POINTS) {

        const dx = walkState.position.x - issue.position[0];

        const dy = walkState.position.y - issue.position[1];

        const dz = (walkState.position.z + WALK_CAMERA_AIM_HEIGHT) - issue.position[2];

        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < nearestDist) {

          nearestIssue = issue;

          nearestDist = dist;

        }

      }

      if (nearestIssue !== lastNearbyIssue) {

        lastNearbyIssue = nearestIssue;

        setNearbyIssueRef.current(nearestIssue);

      }

    };

    const updateCruise = (deltaSeconds: number) => {

      const wp = AUTO_CRUISE_WAYPOINTS[cruiseState.segmentIndex];

      if (!cruiseState.inStay) {

        cruiseState.segmentProgress += deltaSeconds / AUTO_CRUISE_TRANSITION_SECONDS;

        if (cruiseState.segmentProgress >= 1) {

          cruiseState.segmentProgress = 1;

          cruiseState.inStay = true;

          cruiseState.stayElapsed = 0;

        }

        const t = easeInOutCubic(cruiseState.segmentProgress);

        walkState.position.lerpVectors(cruiseState.startPos, cruiseState.endPos, t);

        walkState.cameraYaw = THREE.MathUtils.lerp(cruiseState.startYaw, cruiseState.endYaw, t);

        walkState.cameraPitch = THREE.MathUtils.lerp(cruiseState.startPitch, cruiseState.endPitch, t);

      } else {

        cruiseState.stayElapsed += deltaSeconds;

        walkState.position.copy(cruiseState.endPos);

        walkState.cameraYaw = cruiseState.endYaw;

        walkState.cameraPitch = cruiseState.endPitch;

        if (cruiseState.stayElapsed >= wp.staySeconds) {

          const nextIndex = (cruiseState.segmentIndex + 1) % AUTO_CRUISE_WAYPOINTS.length;

          cruiseState.segmentIndex = nextIndex;

          cruiseState.segmentProgress = 0;

          cruiseState.inStay = false;

          cruiseState.stayElapsed = 0;

          cruiseState.startPos.copy(walkState.position);

          cruiseState.startYaw = walkState.cameraYaw;

          cruiseState.startPitch = walkState.cameraPitch;

          const nextWp = AUTO_CRUISE_WAYPOINTS[nextIndex];

          cruiseState.endPos.set(nextWp.position[0], nextWp.position[1], nextWp.position[2]);

          cruiseTargetVec.set(nextWp.target[0], nextWp.target[1], nextWp.target[2]);

          const { yaw, pitch } = computeYawPitchTo(cruiseState.endPos, cruiseTargetVec, WALK_CAMERA_AIM_HEIGHT);

          cruiseState.endYaw = yaw;

          cruiseState.endPitch = pitch;

        }

      }

      const totalSegments = AUTO_CRUISE_WAYPOINTS.length;

      const baseProgress = cruiseState.segmentIndex / totalSegments;

      const segmentFraction = (cruiseState.inStay ? 1 : cruiseState.segmentProgress) / totalSegments;

      const progress = Math.round((baseProgress + segmentFraction) * 100);

      if (progress !== cruiseState.lastProgress) {

        cruiseState.lastProgress = progress;

        setAutoCruiseProgress(progress);

      }

      if (wp.label !== cruiseState.lastLabel) {

        cruiseState.lastLabel = wp.label;

        setAutoCruiseLabel(wp.label);

      }

    };

    const walkForward = new THREE.Vector3();

    const walkRight = new THREE.Vector3();

    const walkViewDirection = new THREE.Vector3();

    const walkAimOrigin = new THREE.Vector3();

    const walkCameraRay = new THREE.Ray();

    const walkCameraRayDirection = new THREE.Vector3();

    const walkCameraHitPoint = new THREE.Vector3();

    const walkMove = new THREE.Vector3();

    const flyMove = new THREE.Vector3();

    const walkCandidate = new THREE.Vector3();

    const walkSlideX = new THREE.Vector3();

    const walkSlideY = new THREE.Vector3();

    const walkProbePoint = new THREE.Vector3();

    const walkFrontProbePoint = new THREE.Vector3();

    const walkCameraTargetPosition = new THREE.Vector3();

    const walkCameraTargetLookAt = new THREE.Vector3();

    const raycaster = new THREE.Raycaster();

    const pointer = new THREE.Vector2();

    const selectedBounds = new THREE.Box3();

    const selectedBoundsHelper = new THREE.Box3Helper(selectedBounds, 0xfacc15);

    selectedBoundsHelper.visible = false;

    scene.add(selectedBoundsHelper);

    disposables.push(selectedBoundsHelper.geometry, selectedBoundsHelper.material as THREE.Material);

    let avatar: THREE.Group | null = null;

    let avatarRig: AvatarRig | null = null;

    let highlightedItem: SceneItem | null = null;

    let needsRender = true;

    let pointerDownX = 0;

    let pointerDownY = 0;

    let pointerDownButton = 0;

    let walkModeExiting = false;

    let lastMotionState: WalkMotionState = "idle";

    let lastHeadingDeg = -1;



    const setSelectedItem = (next: SceneItem | null) => {

      if (next) {

        selectedBounds.copy(next.bounds).expandByScalar(clamp(radius * 0.003, 0.035, 0.18));

        selectedBoundsHelper.visible = true;

      } else {

        selectedBoundsHelper.visible = false;

      }

      setSelectedElement(next?.element || null);

      needsRender = true;

    };

    clearSelectedItemRef.current = () => setSelectedItem(null);



    const pickSceneItem = (event: PointerEvent) => {

      const rect = renderer.domElement.getBoundingClientRect();

      if (rect.width <= 0 || rect.height <= 0) {

        return null;

      }

      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;

      pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);

      raycaster.setFromCamera(pointer, camera);

      const intersections = raycaster.intersectObjects(pickTargets, false);

      const hit = intersections[0];
      if (!hit) return null;
      const hitMesh = hit.object as THREE.Mesh;
      const elementIndexAttribute = hitMesh.geometry.getAttribute("elementIndex");
      if (elementIndexAttribute) {
        const faceIndex = hit.faceIndex ?? 0;
        const indexAttribute = hitMesh.geometry.getIndex();
        const vertexIndex = indexAttribute
          ? indexAttribute.getX(faceIndex * 3)
          : faceIndex * 3;
        return sceneItems[Math.round(elementIndexAttribute.getX(vertexIndex))] || null;
      }
      return (hit.object.userData.sceneItem as SceneItem | undefined) || null;

    };



    const setHighlightedItem = (next: SceneItem | null) => {

      if (highlightedItem === next) {

        return;

      }

      if (highlightedItem) {

        highlightedItem.material.emissive.setHex(0x000000);

        highlightedItem.material.emissiveIntensity = 0;

        highlightedItem.material.opacity = highlightedItem.baseOpacity;

        highlightedItem.material.needsUpdate = true;

      }

      highlightedItem = next;

      if (highlightedItem) {

        highlightedItem.material.emissive.setHex(isWalkMode ? 0x1d211b : 0xfacc15);

        highlightedItem.material.emissiveIntensity = isWalkMode ? 0.03 : 0.34;

        highlightedItem.material.opacity = isWalkMode

          ? highlightedItem.baseOpacity

          : Math.min(1, highlightedItem.baseOpacity + 0.18);

        highlightedItem.material.needsUpdate = true;

      }

      setNearbyElement(next?.element || null);

      needsRender = true;

    };



    const applyWalkMove = (move: THREE.Vector3) => {

      walkCandidate.set(

        clamp(walkState.position.x + move.x, walkBounds.minX, walkBounds.maxX),

        clamp(walkState.position.y + move.y, walkBounds.minY, walkBounds.maxY),

        walkState.position.z,

      );

      if (canStandAt(walkCandidate)) {

        walkState.position.copy(walkCandidate);

        return;

      }



      walkSlideX.set(

        clamp(walkState.position.x + move.x, walkBounds.minX, walkBounds.maxX),

        walkState.position.y,

        walkState.position.z,

      );

      walkSlideY.set(

        walkState.position.x,

        clamp(walkState.position.y + move.y, walkBounds.minY, walkBounds.maxY),

        walkState.position.z,

      );



      const tryXFirst = Math.abs(move.x) >= Math.abs(move.y);

      const first = tryXFirst ? walkSlideX : walkSlideY;

      const second = tryXFirst ? walkSlideY : walkSlideX;

      if (canStandAt(first)) {

        walkState.position.copy(first);

      } else if (canStandAt(second)) {

        walkState.position.copy(second);

      }

    };



    const animateAvatar = (deltaSeconds: number, moving: boolean) => {

      if (!avatarRig) {

        return;

      }

      const gaitSpeed = walkState.isRunning ? 10.8 : 7.4;

      walkState.stepPhase += deltaSeconds * (moving ? gaitSpeed : 2.2);

      const swing = moving ? Math.sin(walkState.stepPhase) : Math.sin(walkState.stepPhase) * 0.08;

      avatarRig.leftLeg.rotation.x = swing * 0.46;

      avatarRig.rightLeg.rotation.x = -swing * 0.46;

      avatarRig.leftArm.rotation.x = -swing * 0.34;

      avatarRig.rightArm.rotation.x = swing * 0.34;

      walkState.bobOffset = moving ? Math.abs(Math.sin(walkState.stepPhase * 2)) * 0.035 : 0;

    };



    const updateWalkCamera = (deltaSeconds = 1 / 60) => {

      if (!avatar) {

        return;

      }

      const firstPerson = walkCameraModeRef.current === "first";

      walkForward.set(Math.sin(walkState.cameraYaw), Math.cos(walkState.cameraYaw), 0);

      walkRight.set(walkForward.y, -walkForward.x, 0);

      avatar.visible = !firstPerson;

      avatar.position.set(walkState.position.x, walkState.position.y, walkState.position.z + walkState.bobOffset);

      avatar.rotation.z = -walkState.avatarYaw;



      const pitchCos = Math.cos(walkState.cameraPitch);

      walkViewDirection

        .set(

          Math.sin(walkState.cameraYaw) * pitchCos,

          Math.cos(walkState.cameraYaw) * pitchCos,

          Math.sin(walkState.cameraPitch),

        )

        .normalize();

      const aimHeight = firstPerson

        ? WALK_FIRST_PERSON_EYE_HEIGHT

        : (isCompactViewer ? WALK_MOBILE_CAMERA_AIM_HEIGHT : WALK_CAMERA_AIM_HEIGHT);

      walkAimOrigin.set(

        walkState.position.x,

      walkState.position.y,

      walkState.position.z + aimHeight + walkState.bobOffset * 0.25,

      );

      if (firstPerson) {

        walkCameraTargetPosition.copy(walkAimOrigin)

          .addScaledVector(walkViewDirection, WALK_FIRST_PERSON_FORWARD_OFFSET);

      } else {

        const cameraDistance = isCompactViewer

          ? (walkState.isRunning ? WALK_MOBILE_CAMERA_RUN_DISTANCE : WALK_MOBILE_CAMERA_DISTANCE)

          : (walkState.isRunning ? WALK_CAMERA_RUN_DISTANCE : WALK_CAMERA_DISTANCE);

        const shoulderOffset = isCompactViewer ? WALK_MOBILE_CAMERA_SHOULDER_OFFSET : WALK_CAMERA_SHOULDER_OFFSET;

        const verticalOffset = isCompactViewer ? WALK_MOBILE_CAMERA_VERTICAL_OFFSET : WALK_CAMERA_VERTICAL_OFFSET;

        const pitchLift = clamp(

          -Math.sin(walkState.cameraPitch) * (isCompactViewer ? 0.5 : 0.42),

          isCompactViewer ? -0.1 : -0.2,

          isCompactViewer ? 0.46 : 0.34,

        );

        walkCameraTargetPosition.copy(walkAimOrigin)

          .addScaledVector(walkForward, -cameraDistance)

          .addScaledVector(walkRight, shoulderOffset)

          .setZ(walkAimOrigin.z + verticalOffset + pitchLift + (walkState.isRunning ? 0.05 : 0));

        walkCameraRayDirection.copy(walkCameraTargetPosition).sub(walkAimOrigin);

        const desiredCameraDistance = walkCameraRayDirection.length();

        if (desiredCameraDistance > 0.001) {

          walkCameraRayDirection.multiplyScalar(1 / desiredCameraDistance);

          walkCameraRay.set(walkAimOrigin, walkCameraRayDirection);

          let nearestCameraHit = desiredCameraDistance;

          walkObstacles.forEach((box) => {

            const hit = walkCameraRay.intersectBox(box, walkCameraHitPoint);

            if (!hit) {

              return;

            }

            const hitDistance = hit.distanceTo(walkAimOrigin);

            if (hitDistance > 0.3 && hitDistance < nearestCameraHit) {

              nearestCameraHit = Math.max(hitDistance - WALK_CAMERA_COLLISION_BUFFER, 0.75);

            }

          });

          if (nearestCameraHit < desiredCameraDistance) {

            walkCameraTargetPosition.copy(walkAimOrigin)

              .addScaledVector(walkCameraRayDirection, nearestCameraHit);

          }

        }

      }

      walkCameraTargetLookAt.copy(walkAimOrigin)

        .addScaledVector(walkViewDirection, WALK_CAMERA_AIM_DISTANCE);

      if (!walkState.cameraPrimed || firstPerson) {

        camera.position.copy(walkCameraTargetPosition);

        walkState.cameraLookAt.copy(walkCameraTargetLookAt);

        walkState.cameraPrimed = true;

      } else {

        const smooth = easeFactor(deltaSeconds, firstPerson ? WALK_CAMERA_LERP * 1.35 : WALK_CAMERA_LERP);

        camera.position.lerp(walkCameraTargetPosition, smooth);

        walkState.cameraLookAt.lerp(walkCameraTargetLookAt, smooth);

      }

      const targetFov = (firstPerson ? WALK_CAMERA_FIRST_PERSON_FOV : (isCompactViewer ? WALK_MOBILE_CAMERA_FOV : WALK_CAMERA_THIRD_PERSON_FOV))

        + (walkState.isRunning ? WALK_CAMERA_RUN_FOV_BOOST : 0);

      const nextFov = THREE.MathUtils.lerp(camera.fov, targetFov, easeFactor(deltaSeconds, 12));

      if (Math.abs(nextFov - camera.fov) > 0.02) {

        camera.fov = nextFov;

        camera.updateProjectionMatrix();

      }

      camera.up.set(0, 0, 1);

      camera.lookAt(walkState.cameraLookAt);

    };



    const updateNearbyElement = (now: number) => {

      if (!isWalkMode || !avatar || now - walkState.lastScanAt < WALK_SCAN_INTERVAL_MS) {

        return;

      }

      walkState.lastScanAt = now;

      walkForward.set(Math.sin(walkState.cameraYaw), Math.cos(walkState.cameraYaw), 0);

      walkProbePoint.set(walkState.position.x, walkState.position.y, walkState.position.z + 1.15);

      walkFrontProbePoint

        .copy(walkProbePoint)

        .addScaledVector(walkForward, Math.min(WALK_PROXIMITY_RADIUS * 0.75, 1.6));

      const thresholdSq = WALK_PROXIMITY_RADIUS * WALK_PROXIMITY_RADIUS;

      let nearest: SceneItem | null = null;

      let nearestDistanceSq = thresholdSq;



      walkInspectableItems.forEach((item) => {

        const adjustedThresholdSq = isHorizontalSurface(item.element)

          ? Math.min(thresholdSq, 0.55 * 0.55)

          : thresholdSq;

        const distanceSq = Math.min(

          pointToBoxDistanceSq(walkProbePoint, item.bounds),

          pointToBoxDistanceSq(walkFrontProbePoint, item.bounds),

        );

        if (distanceSq <= adjustedThresholdSq && distanceSq < nearestDistanceSq) {

          nearest = item;

          nearestDistanceSq = distanceSq;

        }

      });

      setHighlightedItem(nearest);

      // Showroom exhibit proximity detection
      const showroom = builtShowroomRef.current;
      if (showroom && showroom.interactables.length > 0) {
        const exhibitThresholdSq = 2.4 * 2.4;
        let nearestExhibit: ShowroomInteractable | null = null;
        let nearestExhibitDistSq = exhibitThresholdSq;
        for (const interactable of showroom.interactables) {
          const dx = interactable.position.x - walkState.position.x;
          const dy = interactable.position.y - walkState.position.y;
          const dz = interactable.position.z - (walkState.position.z + 1.0);
          const distSq = dx * dx + dy * dy + dz * dz;
          if (distSq < nearestExhibitDistSq) {
            nearestExhibit = interactable;
            nearestExhibitDistSq = distSq;
          }
        }
        const prev = nearbyShowroomExhibitRef.current;
        if (prev !== nearestExhibit) {
          nearbyShowroomExhibitRef.current = nearestExhibit;
          setNearbyShowroomExhibit(nearestExhibit);
        }
        // Highlight the nearby exhibit mesh with emissive
        showroom.interactables.forEach((interactable) => {
          const mesh = interactable.mesh as THREE.Mesh;
          const mat = mesh.material as THREE.MeshPhysicalMaterial;
          if (!mat || !mat.emissive) return;
          if (interactable === nearestExhibit) {
            mat.emissive.setHex(interactable.zone.accentColor);
            mat.emissiveIntensity = 0.45;
          } else {
            mat.emissive.setHex(0x000000);
            mat.emissiveIntensity = 0;
          }
          mat.needsUpdate = true;
        });
      }

    };



    const releaseWalkInput = () => {

      walkState.keys.clear();

      walkState.dragging = false;

      walkState.pointerButtonDown = false;

      lastMotionState = "idle";

      setWalkMotionState("idle");

    };



    const releaseWalkPointer = () => {

      releaseWalkInput();

      if (document.pointerLockElement === renderer.domElement) {

        document.exitPointerLock();

      } else {

        setWalkPointerLocked(false);

      }

      renderer.domElement.style.cursor = "crosshair";

    };



    const exitWalkMode = () => {

      if (walkModeExiting) {

        return;

      }

      walkModeExiting = true;

      releaseWalkPointer();

      renderer.domElement.style.cursor = "default";

      setWalkPointerLocked(false);

      setViewMode("model");

    };



    const setPointerLockFallback = () => {

      setWalkPointerLocked(false);

      walkState.dragging = walkState.pointerButtonDown;

      renderer.domElement.style.cursor = walkState.pointerButtonDown ? "grabbing" : "crosshair";

    };



    const requestWalkPointerLock = () => {

      if (document.pointerLockElement === renderer.domElement) {

        return;

      }

      try {

        const lockRequest = renderer.domElement.requestPointerLock() as Promise<void> | void;

        if (lockRequest && typeof lockRequest.catch === "function") {

          lockRequest.catch(() => {

            setPointerLockFallback();

          });

        }

      } catch {

        setPointerLockFallback();

      }

    };

    walkPointerToggleRef.current = () => {
      if (document.pointerLockElement === renderer.domElement) {
        releaseWalkPointer();
      } else {
        requestWalkPointerLock();
      }
    };

    if (isWalkMode) {

      // 出生朝向：面向主展馆入口招牌

      const dx = (primaryHall ? primaryHall.center.x : center.x) - spawnPoint.x;

      const dy = (primaryHall ? primaryHall.bounds.min.y + 2.5 : center.y) - spawnPoint.y;

      const initialYaw = (Math.abs(dx) + Math.abs(dy) > 0.5)

        ? Math.atan2(dx, dy)

        : Math.PI * 0.25;

      walkState.cameraYaw = Number.isFinite(initialYaw) ? initialYaw : 0;

      walkState.avatarYaw = walkState.cameraYaw;

      const avatarBundle = createAvatar();

      avatarRig = avatarBundle;

      avatar = avatarBundle.avatar;

      disposables.push(...avatarBundle.disposables);

      scene.add(avatar);

      camera.fov = WALK_CAMERA_FIRST_PERSON_FOV;

      camera.near = 0.05;

      camera.updateProjectionMatrix();

      updateWalkCamera();

      renderer.domElement.style.cursor = "crosshair";

    }



    controls.enableDamping = !largePreview;

    controls.dampingFactor = 0.08;

    controls.target.copy(center);

    controls.minDistance = Math.max(radius * 0.08, 1);

    controls.maxDistance = radius * 12;



    if (!isWalkMode) {

      if (useZUp) {

        camera.position.set(

          center.x + radius * 1.6,

          center.y - radius * 1.6,

          center.z + radius * 1.2,

        );

      } else {

        camera.position.set(

          center.x + radius * 1.6,

          center.y + radius * 1.2,

          center.z + radius * 1.6,

        );

      }

      camera.lookAt(center);

    }



    const requestRender = () => {

      needsRender = true;

    };

    const onOrbitStart = () => {
      if (isWalkMode) return;
      applyPixelRatio(dragMinPixelRatio * adaptiveScale);
      needsRender = true;
    };
    const onOrbitEnd = () => {
      if (isWalkMode) return;
      applyPixelRatio(pixelRatio * adaptiveScale);
      needsRender = true;
    };
    controls.addEventListener("start", onOrbitStart);
    controls.addEventListener("end", onOrbitEnd);
    controls.addEventListener("change", requestRender);



    const isTypingTarget = () => {

      const active = document.activeElement as HTMLElement | null;

      if (!active) return false;

      if (active.getAttribute("contenteditable") === "true") {

        return true;

      }

      const tag = active.tagName.toLowerCase();

      if (tag === "textarea" || tag === "select") {

        return true;

      }

      if (tag !== "input") {

        return false;

      }

      const inputType = (active as HTMLInputElement).type;

      return ["text", "search", "number", "email", "password", "tel", "url", "date", "datetime-local", "month", "time", "week"].includes(inputType);

    };

    const onKeyDown = (event: KeyboardEvent) => {

      if (!isWalkMode) {

        return;

      }

      const key = event.key.toLowerCase();

      if (key === "escape" || event.code === "Escape") {

        event.preventDefault();

        if (showcaseActiveRef.current) {

          exitShowcase();

          return;

        }

        if (cruiseState.active) {

          stopCruise();

          return;

        }

        if (document.pointerLockElement === renderer.domElement) {

          releaseWalkPointer();

        } else {

          exitWalkMode();

        }

        return;

      }

      if (isTypingTarget()) {

        return;

      }

      if (cruiseState.active) {

        return;

      }

      if (key === "v") {

        event.preventDefault();

        setWalkCameraMode((mode) => (mode === "first" ? "third" : "first"));

        return;

      }

      if (key === "f") {

        event.preventDefault();

        walkState.isFlyMode = !walkState.isFlyMode;

        walkState.onGround = !walkState.isFlyMode;

        walkState.verticalVelocity = 0;

        return;

      }

      if (key === "g") {

        event.preventDefault();

        walkState.isGhostMode = !walkState.isGhostMode;

        return;

      }

      if (key === "e") {
        event.preventDefault();
        const nearby = nearbyShowroomExhibitRef.current;
        if (nearby) {
          setActiveShowroomExhibit(nearby);
        }
        return;
      }

      if (key === "t") {
        event.preventDefault();
        // Trigger guide dialogue for the nearest zone
        const showroom = builtShowroomRef.current;
        if (showroom && showroom.zoneMarkers.length > 0) {
          let nearestZone: ShowroomZone | null = null;
          let nearestZoneDistSq = 6 * 6;
          for (const marker of showroom.zoneMarkers) {
            const dx = marker.position.x - walkState.position.x;
            const dy = marker.position.y - walkState.position.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < nearestZoneDistSq) {
              nearestZone = marker.zone;
              nearestZoneDistSq = distSq;
            }
          }
          if (nearestZone) {
            setActiveGuideZone(nearestZone.id);
            setGuideLineIndex(0);
            setGuideVisible(true);
          } else {
            setGuideVisible(false);
          }
        }
        return;
      }

      if (key === "q") {
        event.preventDefault();
        // Close any open panel
        setActiveShowroomExhibit(null);
        setGuideVisible(false);
        return;
      }

      if (["w", "a", "s", "d", "shift", "control", " ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {

        event.preventDefault();

        walkState.keys.add(key);

      }

    };

    const onKeyUp = (event: KeyboardEvent) => {

      if (!isWalkMode) {

        return;

      }

      walkState.keys.delete(event.key.toLowerCase());

    };

    const onPointerDown = (event: PointerEvent) => {

      pointerDownX = event.clientX;

      pointerDownY = event.clientY;

      pointerDownButton = event.button;

      if (isWalkMode && showcaseActiveRef.current) {
        // 上帝视角：左键拖拽手动调整环绕角度与相机高度
        event.preventDefault();
        showcaseDragging = true;
        showcaseLastX = event.clientX;
        showcaseLastY = event.clientY;
        renderer.domElement.style.cursor = "grabbing";
        try {
          renderer.domElement.setPointerCapture(event.pointerId);
        } catch {
          // Some synthetic browser events do not expose a capturable pointer.
        }
        return;
      }

      if (!isWalkMode || showcaseActiveRef.current) {

        return;

      }

      event.preventDefault();

      if (event.button !== 0) {

        return;

      }

      walkState.pointerButtonDown = true;

      walkState.dragging = true;

      walkState.lastPointerX = event.clientX;

      walkState.lastPointerY = event.clientY;

      renderer.domElement.style.cursor = "grabbing";

      try {

        renderer.domElement.setPointerCapture(event.pointerId);

      } catch {

        // Some synthetic browser events do not expose a capturable pointer.

      }

      // 按住左键拖动即转视角；鼠标锁定改为 HUD 里的可选开关，不再点击画布就抢走光标

    };

    const applyWalkLook = (deltaX: number, deltaY: number) => {

      // 上帝视角期间冻结第一人称视角：鼠标移动不得把相机从环绕轨道拽回 walk 位置，否则画面闪烁
      if (showcaseActiveRef.current) {

        return;

      }

      walkState.cameraYaw = wrapRadians(walkState.cameraYaw + deltaX * WALK_MOUSE_SENSITIVITY_X);

      walkState.cameraPitch = clamp(

        walkState.cameraPitch - deltaY * WALK_MOUSE_SENSITIVITY_Y,

        WALK_PITCH_MIN,

        WALK_PITCH_MAX,

      );

      updateWalkCamera(1 / 60);

      needsRender = true;

    };

    const onPointerMove = (event: PointerEvent) => {

      if (!isWalkMode) {

        return;

      }

      if (showcaseActiveRef.current) {
        if (!showcaseDragging) {
          return;
        }
        event.preventDefault();
        const deltaX = event.clientX - showcaseLastX;
        const deltaY = event.clientY - showcaseLastY;
        showcaseLastX = event.clientX;
        showcaseLastY = event.clientY;
        // 横向拖拽旋转环绕角（跟手方向），纵向拖拽调整俯视高度
        showcaseAngle -= deltaX * 0.0045;
        showcaseHeightTarget = clamp(
          showcaseHeightTarget + deltaY * showcaseHeight * 0.0035,
          showcaseHeightMin,
          showcaseHeightMax,
        );
        needsRender = true;
        return;
      }

      const pointerLocked = document.pointerLockElement === renderer.domElement;

      if (pointerLocked || !walkState.dragging) {

        return;

      }

      event.preventDefault();

      const deltaX = event.clientX - walkState.lastPointerX;

      const deltaY = event.clientY - walkState.lastPointerY;

      walkState.lastPointerX = event.clientX;

      walkState.lastPointerY = event.clientY;

      if (deltaX || deltaY) {

        applyWalkLook(deltaX, deltaY);

      }

    };

    const onMouseMove = (event: MouseEvent) => {

      if (!isWalkMode || document.pointerLockElement !== renderer.domElement) {

        return;

      }

      applyWalkLook(event.movementX, event.movementY);

    };

    const onPointerUp = (event: PointerEvent) => {

      if (isWalkMode) {

        showcaseDragging = false;
        walkState.pointerButtonDown = false;

        const pointerLocked = document.pointerLockElement === renderer.domElement;

        walkState.dragging = pointerLocked;

        renderer.domElement.style.cursor = walkState.dragging ? "none" : "crosshair";

        try {

          renderer.domElement.releasePointerCapture(event.pointerId);

        } catch {

          // Pointer capture may already be gone after pointer lock transitions.

        }

        return;

      }

      const isPrimaryClick = pointerDownButton === 0

        && event.button === 0

        && Math.hypot(event.clientX - pointerDownX, event.clientY - pointerDownY) < 6;

      if (isPrimaryClick) {

        setSelectedItem(pickSceneItem(event));

      }

    };

    const onPointerLockChange = () => {

      if (!isWalkMode) {

        return;

      }

      const pointerLocked = document.pointerLockElement === renderer.domElement;

      walkState.dragging = pointerLocked;

      setWalkPointerLocked(pointerLocked);

      renderer.domElement.style.cursor = pointerLocked ? "none" : "crosshair";

      if (!pointerLocked) {

        releaseWalkInput();

      }

    };

    const onDocumentPointerUp = () => {

      if (!isWalkMode || document.pointerLockElement === renderer.domElement) {

        return;

      }

      walkState.pointerButtonDown = false;

      walkState.dragging = false;

      renderer.domElement.style.cursor = "crosshair";

    };

    const onContextMenu = (event: MouseEvent) => {

      if (!isWalkMode) {

        return;

      }

      event.preventDefault();

    };

    document.addEventListener("keydown", onKeyDown, true);

    document.addEventListener("keyup", onKeyUp, true);

    renderer.domElement.addEventListener("pointerdown", onPointerDown);

    renderer.domElement.addEventListener("pointermove", onPointerMove);

    renderer.domElement.addEventListener("pointerup", onPointerUp);

    renderer.domElement.addEventListener("pointerleave", onPointerUp);

    renderer.domElement.addEventListener("contextmenu", onContextMenu);

    // 上帝视角：滚轮控制环绕半径（远近），阻尼平滑
    const onShowcaseWheel = (event: WheelEvent) => {
      if (!showcaseActiveRef.current) {
        return;
      }
      event.preventDefault();
      const zoomFactor = Math.exp(event.deltaY * 0.0012);
      showcaseRadiusTarget = clamp(showcaseRadiusTarget * zoomFactor, showcaseRadiusMin, showcaseRadiusMax);
      needsRender = true;
    };
    renderer.domElement.addEventListener("wheel", onShowcaseWheel, { passive: false });

    document.addEventListener("mousemove", onMouseMove);

    document.addEventListener("pointerup", onDocumentPointerUp);

    document.addEventListener("pointerlockchange", onPointerLockChange);

    const onWindowBlur = () => {

      if (walkState.keys.size > 0) {

        walkState.keys.clear();

        lastMotionState = "idle";

        setWalkMotionState("idle");

      }

    };

    const onVisibilityChange = () => {

      if (document.hidden && walkState.keys.size > 0) {

        walkState.keys.clear();

        lastMotionState = "idle";

        setWalkMotionState("idle");

      }

    };

    window.addEventListener("blur", onWindowBlur);

    document.addEventListener("visibilitychange", onVisibilityChange);



    let lastFrameAt = performance.now();
    let lastStatsAt = performance.now();

    const animate = () => {

      frameId = window.requestAnimationFrame(animate);

      const now = performance.now();

      const deltaSeconds = Math.min((now - lastFrameAt) / 1000, 0.05);

      lastFrameAt = now;

      // ── 自适应分辨率（核显兜底）：持续掉帧逐级降低渲染倍率，恢复流畅后逐步回升。
      // 只在真实渲染的帧上计量（needsRender 关闭时空转帧不计）。30 帧慢 → 降 0.15，
      // 150 帧流畅 → 升 0.15，下限 0.55×，避免画质抖动。
      if (needsRender) {
        const frameMs = deltaSeconds * 1000;
        if (frameMs > 24) {
          adaptiveSlowFrames += 1;
          adaptiveFastFrames = 0;
        } else if (frameMs < 15) {
          adaptiveFastFrames += 1;
          adaptiveSlowFrames = 0;
        } else {
          adaptiveSlowFrames = 0;
          adaptiveFastFrames = 0;
        }
        if (adaptiveSlowFrames >= 30 && adaptiveScale > 0.55) {
          adaptiveScale = Math.max(0.55, adaptiveScale - 0.15);
          applyAdaptivePixelRatio();
          adaptiveSlowFrames = 0;
        } else if (adaptiveFastFrames >= 150 && adaptiveScale < 1) {
          adaptiveScale = Math.min(1, adaptiveScale + 0.15);
          applyAdaptivePixelRatio();
          adaptiveFastFrames = 0;
        }
      }

      // 上帝视角：相机绕展馆中心自动环绕
      if (showcaseActiveRef.current) {
        // 滚轮设定的半径与拖拽设定的高度向目标值平滑逼近
        const orbitSmoothing = Math.min(1, deltaSeconds * 5.5);
        showcaseRadiusCurrent += (showcaseRadiusTarget - showcaseRadiusCurrent) * orbitSmoothing;
        showcaseHeightCurrent += (showcaseHeightTarget - showcaseHeightCurrent) * orbitSmoothing;
        camera.position.set(
          showcaseCenter.x + Math.cos(showcaseAngle) * showcaseRadiusCurrent,
          showcaseCenter.y + Math.sin(showcaseAngle) * showcaseRadiusCurrent,
          showcaseCenter.z + showcaseHeightCurrent,
        );
        camera.lookAt(showcaseCenter);
        showcaseAngle += deltaSeconds * 0.28;
        needsRender = true;
      }

      if (isWalkMode && avatar && !showcaseActiveRef.current) {

        if (cruiseState.active) {

          updateCruise(deltaSeconds);

          const nextHeadingDeg = Math.round((THREE.MathUtils.radToDeg(walkState.cameraYaw) + 360) % 360);

          if (Math.abs(nextHeadingDeg - lastHeadingDeg) >= 3) {

            lastHeadingDeg = nextHeadingDeg;

            setWalkHeadingDeg(nextHeadingDeg);

          }

          walkState.avatarYaw = approachAngle(

            walkState.avatarYaw,

            walkState.cameraYaw,

            WALK_AVATAR_TURN_SPEED * deltaSeconds,

          );

          animateAvatar(deltaSeconds, true);

          updateWalkCamera(deltaSeconds);

          updateNearbyIssue();

          needsRender = true;

        } else {

          walkForward.set(Math.sin(walkState.cameraYaw), Math.cos(walkState.cameraYaw), 0).normalize();

          walkRight.set(walkForward.y, -walkForward.x, 0);

          walkMove.set(0, 0, 0);

          if (walkState.keys.has("w") || walkState.keys.has("arrowup")) walkMove.add(walkForward);

          if (walkState.keys.has("s") || walkState.keys.has("arrowdown")) walkMove.addScaledVector(walkForward, -1);

          if (walkState.keys.has("a") || walkState.keys.has("arrowleft")) walkMove.addScaledVector(walkRight, -1);

          if (walkState.keys.has("d") || walkState.keys.has("arrowright")) walkMove.add(walkRight);

          walkState.isRunning = walkState.keys.has("shift");

          const isMoving = walkMove.lengthSq() > 0;



          if (walkState.isFlyMode) {

            // Fly mode: WASD moves in camera direction, Space=up, Shift=down

            const flySpeed = FLY_SPEED * (walkState.keys.has("shift") && !walkState.keys.has("w") && !walkState.keys.has("s") && !walkState.keys.has("a") && !walkState.keys.has("d") ? FLY_RUN_MULTIPLIER : 1);

            flyMove.copy(walkMove);

            if (flyMove.lengthSq() > 0) {

              flyMove.normalize().multiplyScalar(flySpeed * deltaSeconds);

              walkState.position.x += flyMove.x;

              walkState.position.y += flyMove.y;

            }

            // Vertical movement: Space=up, Ctrl=down (or Shift when no horizontal movement)

            let flyVertical = 0;

            if (walkState.keys.has(" ")) flyVertical += 1;

            if (walkState.keys.has("control") || (walkState.keys.has("shift") && walkMove.lengthSq() === 0)) flyVertical -= 1;

            if (flyVertical !== 0) {

              walkState.position.z += flyVertical * FLY_VERTICAL_SPEED * deltaSeconds;

            }

            const nextMotionState: WalkMotionState = isMoving ? "run" : "idle";

            if (nextMotionState !== lastMotionState) {

              lastMotionState = nextMotionState;

              setWalkMotionState(nextMotionState);

            }

          } else {

            // Normal walk mode

            const nextMotionState: WalkMotionState = isMoving ? (walkState.isRunning ? "run" : "walk") : "idle";

            if (nextMotionState !== lastMotionState) {

              lastMotionState = nextMotionState;

              setWalkMotionState(nextMotionState);

            }

            if (walkMove.lengthSq() > 0) {

              walkMove.normalize().multiplyScalar(WALK_SPEED * (walkState.isRunning ? WALK_RUN_MULTIPLIER : 1) * deltaSeconds);

              if (walkState.isGhostMode) {

                // Ghost mode: no collision, move freely

                walkState.position.x += walkMove.x;

                walkState.position.y += walkMove.y;

              } else {

                applyWalkMove(walkMove);

              }

            }

            if (walkState.keys.has(" ") && walkState.onGround) {

              walkState.verticalVelocity = WALK_JUMP_SPEED;

              walkState.onGround = false;

            }

            if (!walkState.onGround || walkState.verticalVelocity > 0) {

              walkState.verticalVelocity -= WALK_GRAVITY * deltaSeconds;

              walkState.position.z += walkState.verticalVelocity * deltaSeconds;

              if (walkState.position.z <= walkState.baseZ) {

                walkState.position.z = walkState.baseZ;

                walkState.verticalVelocity = 0;

                walkState.onGround = true;

              }

            }

          }



          const nextHeadingDeg = Math.round((THREE.MathUtils.radToDeg(walkState.cameraYaw) + 360) % 360);

          if (Math.abs(nextHeadingDeg - lastHeadingDeg) >= 3) {

            lastHeadingDeg = nextHeadingDeg;

            setWalkHeadingDeg(nextHeadingDeg);

          }

          walkState.avatarYaw = approachAngle(

            walkState.avatarYaw,

            walkState.cameraYaw,

            WALK_AVATAR_TURN_SPEED * deltaSeconds,

          );

          animateAvatar(deltaSeconds, isMoving);

          updateWalkCamera(deltaSeconds);

          updateNearbyElement(now);

          updateNearbyIssue();

          needsRender = true;

        }

      }

      const changed = isWalkMode ? false : controls.update();

      // 展品缓慢旋转
      if (isWalkMode || showcaseActiveRef.current) {
        scene.traverse((obj) => {
          if (obj.userData?.spinning) {
            obj.rotation.z += deltaSeconds * 0.3;
          }
          const slewSpeed = obj.userData?.craneSlew;
          if (typeof slewSpeed === "number" && slewSpeed !== 0) {
            // 塔吊起重臂缓慢回转
            obj.rotation.z += deltaSeconds * slewSpeed;
          }
        });
        needsRender = true;
      }

      if (needsRender || changed) {

        needsRender = false;

        renderer.info.reset();

        if (composer) {

          composer.render();

        } else {

          renderer.render(scene, camera);

        }

      }

      if (now - lastStatsAt >= 1000) {
        lastStatsAt = now;
        setRenderStats({
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
        });

      }

    };

    animate();

    if (visualTestMode) {
      // TEMP DEBUG HOOK: 供浏览器性能测量使用（仅 visual-test 模式生效）
      (window as unknown as Record<string, unknown>).__viewer = {
        renderer,
        scene,
        camera,
        getLook: () => ({
          yaw: walkState.cameraYaw,
          pitch: walkState.cameraPitch,
          pos: { x: walkState.position.x, y: walkState.position.y, z: walkState.position.z },
        }),
        setLook: (yawDeg: number, pitchDeg: number) => {
          walkState.cameraYaw = THREE.MathUtils.degToRad(yawDeg);
          walkState.cameraPitch = THREE.MathUtils.degToRad(pitchDeg);
        },
        setPos: (x: number, y: number, z: number) => {
          walkState.position.set(x, y, z);
          walkState.baseZ = z;
          walkState.onGround = true;
        },
        fps: () => {
          let frames = 0;
          const start = performance.now();
          return new Promise((resolve) => {
            const tick = () => {
              frames += 1;
              const elapsed = (performance.now() - start) / 1000;
              if (elapsed < 2) {
                requestAnimationFrame(tick);
              } else {
                resolve({
                  fps: frames / elapsed,
                  calls: renderer.info.render.calls,
                  triangles: renderer.info.render.triangles,
                  elapsed,
                });
              }
            };
            requestAnimationFrame(tick);
          });
        },
        mergeStats: () => {
          const bucketSizes = [...walkMergeBuckets.values()].map((b) => b.entries.length).sort((a, b) => b - a);
          const bucketKeys = [...walkMergeBuckets.keys()];
          const modelBucketSizes = [...modelMergeBuckets.values()].map((b) => b.entries.length).sort((a, b) => b - a);
          const modelBucketKeys = [...modelMergeBuckets.keys()];
          return {
            elementCount: sceneItems.length,
            mergedMeshCount: mergedSceneMeshes.length,
            pickerTargetCount: pickTargets.length,
            bucketCount: walkMergeBuckets.size,
            bucketSizes: bucketSizes.slice(0, 15),
            sampleKeys: bucketKeys.slice(0, 12),
            modelBucketCount: modelMergeBuckets.size,
            modelBucketSizes: modelBucketSizes.slice(0, 15),
            modelSampleKeys: modelBucketKeys.slice(0, 12),
            pixelRatio: currentPixelRatio,
            sceneChildren: scene.children.length,
          };
        },
      };
    }



    const onResize = () => {

      const host = containerRef.current;

      if (!host) {

        return;

      }

      const nextWidth = Math.max(host.clientWidth, 1);

      const nextHeight = Math.max(host.clientHeight, 1);

      camera.aspect = nextWidth / nextHeight;

      camera.updateProjectionMatrix();

      renderer.setPixelRatio(currentPixelRatio);
      renderer.setSize(nextWidth, nextHeight);

      if (composer) {

        composer.setSize(nextWidth, nextHeight);

      }

      needsRender = true;

    };



    const resizeObserver = new ResizeObserver(onResize);

    resizeObserver.observe(container);

    window.addEventListener("resize", onResize);



    return () => {

      window.cancelAnimationFrame(frameId);

      window.removeEventListener("resize", onResize);

      document.removeEventListener("keydown", onKeyDown, true);

      document.removeEventListener("keyup", onKeyUp, true);

      renderer.domElement.removeEventListener("pointerdown", onPointerDown);

      renderer.domElement.removeEventListener("pointermove", onPointerMove);

      renderer.domElement.removeEventListener("pointerup", onPointerUp);

      renderer.domElement.removeEventListener("pointerleave", onPointerUp);

      renderer.domElement.removeEventListener("contextmenu", onContextMenu);

      renderer.domElement.removeEventListener("wheel", onShowcaseWheel);

      document.removeEventListener("mousemove", onMouseMove);

      document.removeEventListener("pointerup", onDocumentPointerUp);

      document.removeEventListener("pointerlockchange", onPointerLockChange);

      window.removeEventListener("blur", onWindowBlur);

      document.removeEventListener("visibilitychange", onVisibilityChange);

      if (document.pointerLockElement === renderer.domElement) {

        document.exitPointerLock();

      }

      setWalkPointerLocked(false);

      setAutoCruiseActive(false);

      setAutoCruiseProgress(0);

      setAutoCruiseLabel("");

      setNearbyIssue(null);

      autoCruiseControlRef.current = { start: () => {}, stop: () => {} };

      setNearbyIssueRef.current = () => {};

      resizeObserver.disconnect();

      controls.removeEventListener("change", requestRender);
      controls.removeEventListener("start", onOrbitStart);
      controls.removeEventListener("end", onOrbitEnd);

      clearSelectedItemRef.current = () => {};

      if (highlightedItem) {

        highlightedItem.material.emissive.setHex(0x000000);

        highlightedItem.material.emissiveIntensity = 0;

        highlightedItem.material.opacity = highlightedItem.baseOpacity;

        highlightedItem = null;

      }

      scene.clear();

      controls.dispose();

      disposables.forEach((item) => {

        if ("dispose" in item) {

          item.dispose();

        }

      });

      if (composer) {

        composer.dispose();

      }

      grid.geometry.dispose();

      if (Array.isArray(grid.material)) {

        grid.material.forEach((m) => m.dispose());

      } else {

        (grid.material as THREE.Material).dispose();

      }

      renderer.dispose();

      container.replaceChildren();

    };

  }, [isCompactViewer, orientationMode, previewElements, qualityMode, renderMode, viewMode]);

  const walkViewLabel = walkCameraMode === "first" ? "第一人称" : "第三人称";

  const qualityLabel = qualityMode === "cinematic" ? "影院" : qualityMode === "balanced" ? "均衡" : "流畅";

  const walkMotionLabel = walkMotionState === "run" ? "奔跑中" : walkMotionState === "walk" ? "行走中" : "静止";

  const walkPointerLabel = walkPointerLocked ? "鼠标已锁定" : "拖动鼠标转视角";

  const walkExitHint = walkPointerLocked ? "Esc 解锁" : "Esc 退出";


  const walkHeadingLabel = `${Math.round(walkHeadingDeg).toString().padStart(3, "0")} deg ${headingCardinal(walkHeadingDeg)}`;



  return (
    <div
      ref={hostRef}
      className={`ifc-walk-host${isCompactViewer ? " ifc-walk-host-compact" : ""}`}
      style={style}
    >
      <div ref={containerRef} className="ifc-walk-canvas" />

      {/* 顶部场景信息条（非紧凑、非导览模式） */}
      {!isCompactViewer && !presentationMode && !isWalkView && (
        <div className="ifc-walk-scene">
          <span className="material-symbols-outlined ifc-walk-scene-icon">deployed_code</span>
          <div style={{ minWidth: 0 }}>
            <div className="ifc-walk-scene-title">{sceneTitle}</div>
            <div className="ifc-walk-scene-sub">{elements.length} 个 IFC 构件</div>
          </div>
        </div>
      )}

      {/* 导览模式信息条 */}
      {presentationMode && (
        <div className="ifc-walk-scene" style={{ top: isCompactViewer ? 126 : 60 }}>
          <span className="material-symbols-outlined ifc-walk-scene-icon">deployed_code</span>
          <div style={{ minWidth: 0 }}>
            <div className="ifc-walk-scene-title">{sceneTitle}</div>
            <div className="ifc-walk-scene-sub">
              {elements.length} 个 IFC 构件{isWalkView ? ` - ${walkMotionLabel}` : ""}{isWalkView && nearbyElement ? " - 已识别" : ""}
            </div>
          </div>
        </div>
      )}

      {/* 上帝视角旋转展示指示层 */}
      {showcaseActive && (
        <div className="ifc-showcase-banner">
          <div className="ifc-showcase-banner-head">
            <span className="material-symbols-outlined ifc-showcase-spin">360</span>
            <span>上帝视角</span>
            <span className="ifc-showcase-banner-dot" />
            <span>旋转展示中</span>
          </div>
          <div className="ifc-showcase-banner-hint">自动环绕全馆 · 滚轮缩放远近 · 左键拖拽调整视角 · Esc 退出</div>
          <button
            type="button"
            className="ifc-showcase-exit"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => showcaseControlRef.current.exit()}
          >
            <span className="material-symbols-outlined">close</span>
            退出
          </button>
        </div>
      )}

      {/* 漫游模式专属 HUD */}
      {isWalkView && !showcaseActive && (
        <>
          {/* 中央十字准星 */}
          <div className="ifc-walk-crosshair">
            <span className="ifc-walk-crosshair-dot" />
          </div>

          {/* 右上工具栏 */}
          <div className="ifc-walk-tools">
            <div className="ifc-walk-tools-row">
              <button
                type="button"
                className={`ifc-walk-tool-btn${renderMode === "solid" ? " active" : ""}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => setRenderMode("solid")}
                title="实体渲染"
              >
                <span className="material-symbols-outlined">view_in_ar</span>
              </button>
              <button
                type="button"
                className={`ifc-walk-tool-btn${renderMode === "transparent" ? " active" : ""}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => setRenderMode("transparent")}
                title="透明渲染"
              >
                <span className="material-symbols-outlined">layers</span>
              </button>
              <button
                type="button"
                className={`ifc-walk-tool-btn${walkCameraMode === "first" ? " active" : ""}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => setWalkCameraMode("first")}
                title="第一人称"
              >
                <span className="material-symbols-outlined">photo_camera</span>
              </button>
              <button
                type="button"
                className={`ifc-walk-tool-btn${walkCameraMode === "third" ? " active" : ""}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => setWalkCameraMode("third")}
                title="第三人称"
              >
                <span className="material-symbols-outlined">supervisor_account</span>
              </button>
              <button
                type="button"
                className={`ifc-walk-tool-btn${showcaseActive ? " active" : ""}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => showcaseControlRef.current.toggle()}
                title={showcaseActive ? "退出上帝视角" : "上帝视角旋转展示"}
              >
                <span className="material-symbols-outlined">360</span>
              </button>
              <button
                type="button"
                className={`ifc-walk-tool-btn${autoCruiseActive ? " active" : ""}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={toggleAutoCruise}
                title={autoCruiseActive ? "停止自动巡航" : "自动巡航"}
              >
                <span className="material-symbols-outlined">my_location</span>
              </button>
              <button
                type="button"
                className="ifc-walk-tool-btn ifc-walk-tool-btn-danger"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={requestExitWalkMode}
                title="退出漫游"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="ifc-walk-tools-row">
              <Segmented<QualityMode>
                size="small"
                value={qualityMode}
                onChange={setQualityMode}
                options={[
                  { label: "影院", value: "cinematic" },
                  { label: "均衡", value: "balanced" },
                  { label: "流畅", value: "performance" },
                ]}
              />
            </div>
          </div>

          {/* 底部 HUD 状态栏 */}
          {!isCompactViewer && !showcaseActive && (
            <div className="ifc-walk-hud">
              <div className="ifc-walk-hud-main">
                <span className="ifc-walk-hud-status" style={{ color: "#e2e8f0" }}>
                  <span className="material-symbols-outlined" style={{ color: "#38bdf8" }}>videocam</span>
                  {walkViewLabel}
                </span>
                <button
                  type="button"
                  className="ifc-walk-hud-status"
                  style={{
                    color: walkPointerLocked ? "#86efac" : "#facc15",
                    cursor: "pointer",
                    background: "none",
                    border: "none",
                    font: "inherit",
                  }}
                  title={walkPointerLocked ? "解锁鼠标（恢复拖动视角）" : "锁定鼠标（FPS 模式）"}
                  onClick={() => walkPointerToggleRef.current?.()}
                >
                  <span className="material-symbols-outlined">{walkPointerLocked ? "lock" : "lock_open"}</span>
                  {walkPointerLabel}
                </button>
                <span className="ifc-walk-hud-status" style={{ color: walkMotionState === "run" ? "#f87171" : walkMotionState === "walk" ? "#7dd3fc" : "#64748b" }}>
                  <span className="material-symbols-outlined">directions_run</span>
                  {walkMotionLabel}
                </span>
                <span className="ifc-walk-hud-status" style={{ color: "#93c5fd" }}>
                  <span className="material-symbols-outlined">explore</span>
                  {walkHeadingLabel}
                </span>
                <span className="ifc-walk-hud-status" style={{ color: "#a78bfa" }}>
                  <span className="material-symbols-outlined">tune</span>
                  {qualityLabel} · {renderStats.calls} draws
                </span>
                <span className="ifc-walk-hud-status" style={{ color: "#94a3b8" }}>
                  <span className="material-symbols-outlined">deployed_code</span>
                  {(renderStats.triangles / 1000).toFixed(0)}k tris
                </span>
              </div>
              <div className="ifc-walk-hud-help">
                <button type="button" className="ifc-walk-help-btn" title="操作说明">
                  <span className="material-symbols-outlined">help</span>
                </button>
                <div className="ifc-walk-help-popover">
                  <div className="ifc-walk-help-title">漫游操作</div>
                  <div className="ifc-walk-help-row"><span className="ifc-walk-key wide">WASD</span>移动</div>
                  <div className="ifc-walk-help-row"><span className="ifc-walk-key wide">鼠标拖动</span>转视角</div>
                  <div className="ifc-walk-help-row"><span className="ifc-walk-key">Shift</span>奔跑</div>
                  <div className="ifc-walk-help-row"><span className="ifc-walk-key xwide">Space</span>跳跃 / 上升</div>
                  <div className="ifc-walk-help-row"><span className="ifc-walk-key">V</span>切换视图模式</div>
                  <div className="ifc-walk-help-row"><span className="ifc-walk-key">F</span>聚焦选中构件</div>
                  <div className="ifc-walk-help-row"><span className="ifc-walk-key">G</span>重置位置</div>
                  <div className="ifc-walk-help-row"><span className="ifc-walk-key">E</span>查看展品详情</div>
                  <div className="ifc-walk-help-row"><span className="ifc-walk-key">T</span>聆听讲解员</div>
                  <div className="ifc-walk-help-row"><span className="ifc-walk-key">Q</span>关闭面板</div>
                  <div className="ifc-walk-help-row"><span className="ifc-walk-key">Esc</span>{walkExitHint}</div>
                </div>
              </div>
            </div>
          )}

          {/* 自动巡航指示器 */}
          {autoCruiseActive && (
            <div className="ifc-walk-autopilot">
              <div className="ifc-walk-autopilot-head">
                <span className="material-symbols-outlined ifc-walk-autopilot-icon">navigation</span>
                <span className="ifc-walk-autopilot-title">自动巡航中</span>
                <span className="ifc-walk-autopilot-label">{autoCruiseLabel}</span>
              </div>
              <div className="ifc-walk-autopilot-bar">
                <div className="ifc-walk-autopilot-bar-fill" style={{ width: `${autoCruiseProgress}%` }} />
              </div>
              <div className="ifc-walk-autopilot-hint">再次点击按钮或按 Esc 退出</div>
            </div>
          )}

          {/* 构件问题标注卡片 */}
          {nearbyIssue && (
            <div className={`ifc-walk-issue ifc-walk-issue-${nearbyIssue.severity}`}>
              <div className="ifc-walk-issue-head">
                <span className="material-symbols-outlined ifc-walk-issue-icon">
                  {nearbyIssue.severity === "error" ? "error" : nearbyIssue.severity === "warning" ? "warning" : "info"}
                </span>
                <span className={`ifc-walk-issue-tag ifc-walk-issue-tag-${nearbyIssue.severity}`}>
                  {nearbyIssue.severity === "error" ? "严重" : nearbyIssue.severity === "warning" ? "警告" : "提示"}
                </span>
              </div>
              <div className="ifc-walk-issue-component">{nearbyIssue.component}</div>
              <div className="ifc-walk-issue-desc">{nearbyIssue.description}</div>
            </div>
          )}
        </>
      )}

      {/* 非漫游模式主工具栏 */}
      {showMainTools && (
        <div className="ifc-walk-tools" style={{ top: isCompactViewer ? 52 : 14, left: isCompactViewer ? 14 : undefined, right: 14, maxWidth: "calc(100% - 28px)" }}>
          <div className="ifc-walk-tools-row">
            <Segmented<ViewMode>
              size="small"
              value={viewMode}
              onChange={(value) => setViewMode(value)}
              options={[
                { label: "分解视图", value: "explode" },
                { label: "实体模型", value: "model" },
                { label: "分类网格", value: "grid" },
                { label: "漫游", value: "walk" },
              ]}
            />
            {isWalkView && (
              <Segmented<WalkCameraMode>
                size="small"
                value={walkCameraMode}
                onChange={(value) => setWalkCameraMode(value)}
                options={[
                  { label: "第一人称", value: "first" },
                  { label: "第三人称", value: "third" },
                ]}
              />
            )}
          </div>
          <div className="ifc-walk-tools-row">
            <Segmented<OrientationMode>
              size="small"
              value={orientationMode}
              onChange={(value) => setOrientationMode(value)}
              options={[
                { label: "原始方向", value: "raw" },
                { label: "Z轴朝上", value: "z-up" },
              ]}
            />
            <Segmented<RenderMode>
              size="small"
              value={renderMode}
              onChange={(value) => setRenderMode(value)}
              options={[
                { label: "透明", value: "transparent" },
                { label: "实体", value: "solid" },
              ]}
            />
            <button
              type="button"
              className={`ifc-walk-tool-btn${showcaseActive ? " active" : ""}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => showcaseControlRef.current.toggle()}
              title={showcaseActive ? "退出上帝视角" : "上帝视角旋转展示"}
            >
              <span className="material-symbols-outlined">360</span>
            </button>
          </div>
        </div>
      )}

      {/* 非漫游模式筛选栏 */}
      {showFilterTools && (
        <div className="ifc-walk-tools" style={{ top: 14, left: 14, right: isCompactViewer ? 14 : undefined, width: isCompactViewer ? "auto" : "min(420px, calc(100% - 360px))", padding: 8 }}>
          <Select
            mode="multiple"
            allowClear
            placeholder="全部构件"
            value={selectedTypes}
            onChange={setSelectedTypes}
            options={typeOptions}
            maxTagCount="responsive"
            style={{ width: "100%" }}
          />
          <div style={{ marginTop: 6, color: "#cbd5e1", fontSize: 12 }}>
            显示 {previewElements.length} / {filteredElements.length} 个构件
            {meshCount > 0 ? `，真实网格 ${meshCount}` : ""}
          </div>
        </div>
      )}

      {/* 紧凑模式工具切换按钮 */}
      {isCompactViewer && !presentationMode && !isWalkView && (
        <Tooltip title={walkToolsOpen ? "隐藏工具" : "显示工具"}>
          <Button
            type="text"
            size="small"
            aria-label={walkToolsOpen ? "隐藏工具" : "显示工具"}
            icon={walkToolsOpen ? <CloseOutlined /> : <SettingOutlined />}
            onClick={() => setWalkToolsOpen((open) => !open)}
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              zIndex: 6,
              color: "#e2e8f0",
              background: "rgba(8, 14, 24, 0.85)",
              border: "1px solid rgba(56, 189, 248, 0.25)",
            }}
          />
        </Tooltip>
      )}

      {/* 漫游模式 + 紧凑模式：虚拟摇杆 */}
      {isWalkView && isCompactViewer && (
        <div className="ifc-walk-joypad">
          <Button size="large" aria-label="Move forward" icon={<UpOutlined />} style={{ gridColumn: 2 }} {...walkControlPointer("w")} />
          <Button size="large" aria-label="Move left" icon={<LeftOutlined />} style={{ gridColumn: 1 }} {...walkControlPointer("a")} />
          <Button size="large" aria-label="Move back" icon={<DownOutlined />} style={{ gridColumn: 2 }} {...walkControlPointer("s")} />
          <Button size="large" aria-label="Move right" icon={<RightOutlined />} style={{ gridColumn: 3 }} {...walkControlPointer("d")} />
        </div>
      )}

      {/* 选中构件信息卡 */}
      {selectedElement && (
        <div className="ifc-walk-selected">
          <div className="ifc-walk-selected-head">
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="ifc-walk-selected-tag">已选构件</div>
              <div className="ifc-walk-selected-name" title={displayText(selectedElement.name || selectedElement.label || selectedElement.id)}>
                {displayText(selectedElement.name || selectedElement.label || selectedElement.id)}
              </div>
              <div className="ifc-walk-selected-type">
                {displayText(selectedElement.type || selectedElement.element_type || selectedElement.id)}
              </div>
            </div>
            <Tooltip title="Close">
              <Button
                type="text"
                aria-label="Close Component Info"
                icon={<CloseOutlined />}
                onClick={() => clearSelectedItemRef.current()}
                style={{ color: "#cbd5e1", flex: "0 0 auto" }}
              />
            </Tooltip>
          </div>
          <div className="ifc-walk-selected-rows">
            {selectedInfoRows.map(([label, value]) => (
              <div key={label} style={{ display: "contents" }}>
                <div className="label">{label}</div>
                <div className="value">{displayText(value)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 漫游模式附近构件识别卡 */}
      {viewMode === "walk" && nearbyElement && (() => {
        const nearbyRowLabels = new Set<string>(["IFC 类型", "材质", "工程量", "尺寸"]);
        const nearbyRows = buildElementInfoRows(nearbyElement)
          .filter(([label]) => typeof label === "string" && nearbyRowLabels.has(label))
          .slice(0, 6);
        const nearbyProfile = componentMaterialProfile(nearbyElement);
        const nearbyDescription = displayText(nearbyElement.description || nearbyElement.object_type || nearbyElement.predefined_type || "");
        return (
          <div className="ifc-walk-nearby">
            <div className="ifc-walk-nearby-head">
              <span
                className="ifc-walk-nearby-swatch"
                style={{ background: colorStyle(nearbyProfile.color, 0.95) }}
              />
              <div style={{ minWidth: 0 }}>
                <div className="ifc-walk-nearby-type">
                  {displayText(nearbyElement.label || nearbyElement.type)}
                </div>
                <div className="ifc-walk-nearby-sub">
                  {displayText(nearbyElement.type || nearbyElement.id)}
                </div>
              </div>
            </div>
            <div className="ifc-walk-nearby-name">
              {displayText(nearbyElement.name || nearbyElement.element_type || nearbyElement.id)}
            </div>
            {nearbyDescription && <div className="ifc-walk-nearby-desc">{nearbyDescription}</div>}
            <div className="ifc-walk-nearby-rows">
              {nearbyRows.map(([label, value]) => (
                <div key={label} style={{ display: "contents" }}>
                  <div className="label">{label}</div>
                  <div className="value">{displayText(value)}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* 数字展厅：附近展品提示 */}
      {viewMode === "walk" && nearbyShowroomExhibit && !activeShowroomExhibit && (
        <div
          className="ifc-walk-exhibit-hint"
          style={{
            position: "absolute",
            left: "50%",
            bottom: 140,
            transform: "translateX(-50%)",
            padding: "8px 18px",
            background: "rgba(15, 13, 10, 0.85)",
            border: `1px solid #${nearbyShowroomExhibit.zone.accentColor.toString(16).padStart(6, "0")}`,
            borderRadius: 8,
            color: "#f5e6c8",
            fontSize: 14,
            pointerEvents: "none",
            zIndex: 20,
            backdropFilter: "blur(6px)",
            boxShadow: "0 4px 18px rgba(0,0,0,0.5)",
          }}
        >
          <span style={{ color: `#${nearbyShowroomExhibit.zone.accentColor.toString(16).padStart(6, "0")}`, marginRight: 8 }}>
            【{nearbyShowroomExhibit.zone.name}】
          </span>
          {nearbyShowroomExhibit.exhibit.name}
          <span style={{ marginLeft: 12, padding: "2px 8px", background: "#c8a06a", color: "#1a1410", borderRadius: 4, fontWeight: 600 }}>
            按 E 查看详情
          </span>
        </div>
      )}

      {/* 数字展厅：展品详情面板 */}
      {viewMode === "walk" && activeShowroomExhibit && (
        <div
          style={{
            position: "absolute",
            right: 24,
            top: "50%",
            transform: "translateY(-50%)",
            width: 380,
            maxWidth: "calc(100vw - 48px)",
            padding: 20,
            background: "linear-gradient(160deg, rgba(26,20,16,0.96), rgba(15,13,10,0.96))",
            border: `1px solid #${activeShowroomExhibit.zone.accentColor.toString(16).padStart(6, "0")}`,
            borderRadius: 12,
            color: "#f5e6c8",
            zIndex: 30,
            backdropFilter: "blur(10px)",
            boxShadow: "0 12px 40px rgba(0,0,0,0.7)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: `#${activeShowroomExhibit.zone.accentColor.toString(16).padStart(6, "0")}`, letterSpacing: 1 }}>
                {activeShowroomExhibit.zone.name} · {activeShowroomExhibit.zone.subtitle}
              </div>
            </div>
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined />}
              onClick={() => setActiveShowroomExhibit(null)}
              style={{ color: "#a89878" }}
            />
          </div>
          <h3 style={{ margin: "0 0 8px", fontSize: 22, color: "#f5e6c8", fontWeight: 600 }}>
            {activeShowroomExhibit.exhibit.name}
          </h3>
          <div style={{ fontSize: 13, color: "#c8a06a", marginBottom: 14 }}>
            {activeShowroomExhibit.exhibit.era}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", fontSize: 13, marginBottom: 14 }}>
            <span style={{ color: "#a89878" }}>材质</span>
            <span style={{ color: "#d8c8a8" }}>{activeShowroomExhibit.exhibit.material}</span>
            <span style={{ color: "#a89878" }}>出处</span>
            <span style={{ color: "#d8c8a8" }}>{activeShowroomExhibit.exhibit.origin}</span>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.7, color: "#d8c8a8", borderTop: "1px solid rgba(200,160,106,0.3)", paddingTop: 12 }}>
            {activeShowroomExhibit.exhibit.description}
          </div>
          <div style={{ marginTop: 14, fontSize: 11, color: "#6a5a4a", textAlign: "right" }}>
            按 Q 关闭
          </div>
        </div>
      )}

      {/* 数字展厅：NPC 讲解员对话框 */}
      {viewMode === "walk" && guideVisible && activeGuideZone && (() => {
        const zone = getZoneById(activeGuideZone);
        if (!zone) return null;
        const lines = SHOWROOM_GUIDE_LINES[activeGuideZone] || [];
        const line = lines[guideLineIndex];
        const hasNext = guideLineIndex < lines.length - 1;
        return (
          <div
            style={{
              position: "absolute",
              left: 24,
              bottom: 100,
              width: 420,
              maxWidth: "calc(100vw - 48px)",
              padding: 18,
              background: "linear-gradient(160deg, rgba(26,20,16,0.96), rgba(15,13,10,0.96))",
              border: `1px solid #${zone.accentColor.toString(16).padStart(6, "0")}`,
              borderRadius: 12,
              color: "#f5e6c8",
              zIndex: 30,
              backdropFilter: "blur(10px)",
              boxShadow: "0 12px 40px rgba(0,0,0,0.7)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: `#${zone.themeColor.toString(16).padStart(6, "0")}`,
                  border: `2px solid #${zone.accentColor.toString(16).padStart(6, "0")}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 18,
                }}
              >
                🧭
              </div>
              <div>
                <div style={{ fontSize: 13, color: `#${zone.accentColor.toString(16).padStart(6, "0")}`, fontWeight: 600 }}>
                  {zone.name} · 讲解员
                </div>
                <div style={{ fontSize: 11, color: "#6a5a4a" }}>
                  第 {guideLineIndex + 1} / {lines.length} 段
                </div>
              </div>
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined />}
                onClick={() => setGuideVisible(false)}
                style={{ color: "#a89878", marginLeft: "auto" }}
              />
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.7, color: "#d8c8a8", minHeight: 60 }}>
              {line?.text || zone.intro}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
              <span style={{ fontSize: 11, color: "#6a5a4a" }}>按 T 切换 / 按 Q 关闭</span>
              {hasNext ? (
                <Button
                  size="small"
                  type="primary"
                  style={{ background: `#${zone.accentColor.toString(16).padStart(6, "0")}`, borderColor: "transparent" }}
                  onClick={() => setGuideLineIndex((i) => Math.min(i + 1, lines.length - 1))}
                >
                  下一段
                </Button>
              ) : (
                <span style={{ fontSize: 11, color: "#c8a06a" }}>讲解结束</span>
              )}
            </div>
          </div>
        );
      })()}

      {/* 预览数量提示 */}
      {elements.length > MAX_PREVIEW_ELEMENTS && (
        <div className="ifc-walk-preview-hint" style={{ top: isCompactViewer ? 170 : 70 }}>
          {`正在预览 ${MAX_PREVIEW_ELEMENTS} / ${elements.length} 个构件`}
        </div>
      )}
    </div>
  );
}
