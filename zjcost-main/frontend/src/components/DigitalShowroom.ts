/**
 * 丝路数字展馆
 * 主题：丝绸之路文明——从边塞到佛光、大漠（全部使用虚构古称，不含真实地名）
 * 风格：西域石窟、沙漠暖色调、波斯地毯、佛教艺术元素
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export interface ShowroomInteractable {
  mesh: THREE.Object3D;
  exhibit: ShowroomExhibit;
  zone: ShowroomZone;
  position: THREE.Vector3;
}

export interface BuiltShowroom {
  interactables: ShowroomInteractable[];
  zoneMarkers: { zone: ShowroomZone; position: THREE.Vector3 }[];
  guideNpcPosition: THREE.Vector3 | null;
}

export interface SceneItemLike {
  element: { type?: string; name?: string };
  bounds: THREE.Box3;
}

export type ExhibitShape =
  | "brick"
  | "tablet"
  | "weapon"
  | "pottery"
  | "textile"
  | "scroll"
  | "tablet_wood"
  | "coin"
  | "tool"
  | "sculpture"
  | "buddha_head"
  | "camel"
  | "merchant";

export interface ShowroomExhibit {
  id: string;
  zone: ShowroomZoneId;
  name: string;
  era: string;
  material: string;
  origin: string;
  description: string;
  shape: ExhibitShape;
  color: number;
  metalness: number;
  roughness: number;
}

export type ShowroomZoneId = "great_wall" | "milan" | "ruoqiang" | "entrance";

export interface ShowroomZone {
  id: ShowroomZoneId;
  name: string;
  subtitle: string;
  themeColor: number;
  accentColor: number;
  intro: string;
  exhibits: ShowroomExhibit[];
}

export const SHOWROOM_ZONES: ShowroomZone[] = [
  {
    id: "entrance",
    name: "丝路序厅",
    subtitle: "千年丝路 · 文明交汇",
    themeColor: 0x8b6914,
    accentColor: 0xdaa520,
    intro: "欢迎来到丝绸之路数字博物馆。本馆以边塞雄关、西域佛光、大漠古国三大展区，呈现两千年丝路文明的辉煌与交融。",
    exhibits: [],
  },
  {
    id: "great_wall",
    name: "边塞雄关展区",
    subtitle: "万里边墙 · 丝路屏障",
    themeColor: 0x8b4513,
    accentColor: 0xd4a574,
    intro:
      "边墙始建于春秋战国时期，历经诸朝修筑，绵延万里。它不仅是军事防御工程，更是丝绸之路的安全保障。本展区陈列边墙沿线出土的城砖、兵器、烽火台遗物，展现古代军事防御体系的宏伟与精巧。",
    exhibits: [
      {
        id: "gw_1",
        zone: "great_wall",
        name: "明代边墙城砖",
        era: "明代（1368-1644）",
        material: "青灰陶土",
        origin: "北境边墙遗址出土",
        description:
          "此砖以本地黄土烧制，质地坚实，侧面模印「万历六年某某工部」铭文。边墙城砖标准尺寸约40×20×10厘米，每砖重约25斤，由役夫肩扛至山脊砌筑。",
        shape: "brick",
        color: 0x7a6b5a,
        metalness: 0.0,
        roughness: 0.92,
      },
      {
        id: "gw_2",
        zone: "great_wall",
        name: "汉代铁戟",
        era: "汉代（前202-220）",
        material: "锻铁",
        origin: "西陲故关遗址",
        description:
          "戟为戈与矛的结合体，可刺可钩。此件通长1.6米，虽锈蚀严重，仍可见刃部淬火痕迹。汉代戍卒以此守卫边关，为边墙防线主要近战兵器。",
        shape: "weapon",
        color: 0x4a4a52,
        metalness: 0.85,
        roughness: 0.45,
      },
      {
        id: "gw_3",
        zone: "great_wall",
        name: "烽火台狼烟筒",
        era: "唐代（618-907）",
        material: "陶土",
        origin: "北漠烽燧遗址",
        description:
          "烽火台以烟、火为信号传递军情。此陶筒为燃放狼粪之容器，白天燃烟称「烽」，夜间举火称「燧」。一烽至下一烽约二里，全线传递不过数时辰。",
        shape: "pottery",
        color: 0x5c4a3a,
        metalness: 0.0,
        roughness: 0.88,
      },
      {
        id: "gw_4",
        zone: "great_wall",
        name: "戍卒木简",
        era: "汉代（前202-220）",
        material: "胡杨木",
        origin: "漠南边塞遗址",
        description:
          "此简记载戍卒名籍、粮饷配给与巡边日志。边塞汉简共出约三万枚，是研究汉代边塞军事、后勤、制度的珍贵第一手史料。",
        shape: "tablet_wood",
        color: 0x8b6f47,
        metalness: 0.0,
        roughness: 0.82,
      },
      {
        id: "gw_5",
        zone: "great_wall",
        name: "边墙守军铜印",
        era: "明代（1368-1644）",
        material: "青铜",
        origin: "北境边墙关隘",
        description:
          "印面刻「某某关守备之印」，为边墙守军将领印信。铜印方二寸，钮作伏兽形，是调兵、传令、关防之凭证，体现明代边墙军事指挥体系。",
        shape: "coin",
        color: 0x9a7b4a,
        metalness: 0.9,
        roughness: 0.35,
      },
    ],
  },
  {
    id: "milan",
    name: "西域佛光展区",
    subtitle: "佛光古城 · 丝路佛光",
    themeColor: 0x6b4226,
    accentColor: 0xc8a06a,
    intro:
      "佛光古城地处西域绿洲之滨，为汉代屯城故地，西域古国重镇。这里是佛教东传的重要驿站，出土的带翼天使壁画融合了希腊化艺术与佛教主题，是丝绸之路文明交汇的璀璨见证。",
    exhibits: [
      {
        id: "ml_1",
        zone: "milan",
        name: "佉卢文木牍",
        era: "魏晋（220-420）",
        material: "胡杨木",
        origin: "佛光古城遗址",
        description:
          "佉卢文为古代西域通行的文字之一。此木牍记录西域古国王政令与税收，正反两面书写，以绳封泥。佛光出土佉卢文文书数百件，是研究西域绿洲城邦的钥匙。",
        shape: "tablet_wood",
        color: 0x9c7a4e,
        metalness: 0.0,
        roughness: 0.8,
      },
      {
        id: "ml_2",
        zone: "milan",
        name: "佛光佛教壁画残片",
        era: "汉晋（前202-420）",
        material: "泥灰矿物颜料",
        origin: "佛光佛寺遗址",
        description:
          "此壁画描绘带翼天使形象，融合希腊化艺术与佛教主题，为佛光佛寺所独有。二十世纪初为西方考察者首次发现，被誉为「丝路东西方艺术交汇的见证」。",
        shape: "scroll",
        color: 0xb8860b,
        metalness: 0.1,
        roughness: 0.7,
      },
      {
        id: "ml_3",
        zone: "milan",
        name: "佛首残件",
        era: "魏晋（220-420）",
        material: "泥塑施彩",
        origin: "佛光佛寺遗址",
        description:
          "此佛首虽残，仍可见发髻高髻、面容慈祥之态。佛光佛寺是西域最早的佛教寺院遗址之一，其造像风格带有明显的希腊化艺术特征。",
        shape: "buddha_head",
        color: 0xc4a882,
        metalness: 0.0,
        roughness: 0.75,
      },
      {
        id: "ml_4",
        zone: "milan",
        name: "彩绘陶罐",
        era: "汉晋（前202-420）",
        material: "陶土矿物彩",
        origin: "佛光古城墓葬",
        description:
          "此罐侈口鼓腹，肩饰波浪纹与网格纹，红底黑彩。其形制融合中原与本地风格，为西域古国日常器皿，反映佛光居民的生活面貌与审美趣味。",
        shape: "pottery",
        color: 0xa0522d,
        metalness: 0.0,
        roughness: 0.85,
      },
      {
        id: "ml_5",
        zone: "milan",
        name: "丝绸残片",
        era: "汉晋（前202-420）",
        material: "蚕丝",
        origin: "佛光古城遗址",
        description:
          "此残片为平纹素绢，虽历经千年仍可见经纬细密。佛光地处丝路南道，东来丝绸经此西运诸国，此件或为过境商旅遗存。",
        shape: "textile",
        color: 0xc41e3a,
        metalness: 0.05,
        roughness: 0.6,
      },
    ],
  },
  {
    id: "ruoqiang",
    name: "大漠遗珍展区",
    subtitle: "大漠故城 · 沙海秘宝",
    themeColor: 0x8b7355,
    accentColor: 0xd2b48c,
    intro:
      "大漠故城地处沙海盆地东南缘，辖多座古城遗址。这里是丝路南道的咽喉要地，出土的「大漠先民」干尸、汉文文书、毛织品等，讲述着西域古国的神秘故事。",
    exhibits: [
      {
        id: "rq_1",
        zone: "ruoqiang",
        name: "大漠美女复原像",
        era: "距今约3800年",
        material: "数字复原",
        origin: "大漠故城墓地",
        description:
          "大漠先民干尸距今约3800年。此为数字复原像，复原其深目高鼻、长发披肩之貌，是西域最著名的古尸之一。",
        shape: "sculpture",
        color: 0xd2a679,
        metalness: 0.0,
        roughness: 0.65,
      },
      {
        id: "rq_2",
        zone: "ruoqiang",
        name: "大漠汉文文书",
        era: "魏晋（220-420）",
        material: "麻纸墨书",
        origin: "大漠古城遗址",
        description:
          "此文书记录西域长史府行政事务，含屯田、戍边、商税等内容。大漠出土汉文文书数百件，是研究中原王朝经略西域的珍贵档案。",
        shape: "scroll",
        color: 0xe8d8b8,
        metalness: 0.0,
        roughness: 0.75,
      },
      {
        id: "rq_3",
        zone: "ruoqiang",
        name: "汉代铜弩机",
        era: "汉代（前202-220）",
        material: "青铜",
        origin: "大漠沙丘古城",
        description:
          "弩机为弩之核心机件，含牙、悬刀、牛。此件铸造精良，刻有工官铭文。汉军以弩守卫西域屯田据点，射程远超游牧骑弓，是边防利器。",
        shape: "weapon",
        color: 0x5a6a5a,
        metalness: 0.9,
        roughness: 0.38,
      },
      {
        id: "rq_4",
        zone: "ruoqiang",
        name: "毛织斗篷残片",
        era: "距今约2000年",
        material: "羊毛",
        origin: "大漠墓地",
        description:
          "此斗篷以平纹织就，边缘饰穗。大漠先民着毛皮、毛织品御寒，此件反映当地畜牧纺织工艺，与中原丝织品形成鲜明对比，展现丝路多元文化。",
        shape: "textile",
        color: 0x6b4423,
        metalness: 0.0,
        roughness: 0.9,
      },
      {
        id: "rq_5",
        zone: "ruoqiang",
        name: "大漠彩陶钵",
        era: "距今约3000年",
        material: "陶土",
        origin: "大漠胡杨沟墓地",
        description:
          "此钵敞口圜底，饰折线纹与三角纹，红衣黑彩。其纹饰与东方彩陶相近，暗示史前时期东西方绿洲之间的文化联系。",
        shape: "pottery",
        color: 0xb5651d,
        metalness: 0.0,
        roughness: 0.87,
      },
    ],
  },
];

export interface ShowroomGuideLine {
  text: string;
}

export const SHOWROOM_GUIDE_LINES: Record<ShowroomZoneId, ShowroomGuideLine[]> = {
  entrance: [
    { text: "欢迎来到丝绸之路数字博物馆。这里将带您穿越千年，探寻边塞、佛光、大漠的文明印记。" },
    { text: "请沿金色地毯前行，开启您的丝路之旅。" },
  ],
  great_wall: [
    { text: "边塞展区——每一块城砖都承载着两千年的边关岁月。" },
    { text: "请留意那枚汉代铁戟——戍卒们正是手持它，在风雪中守望烽火。" },
    { text: "烽火台是边墙的「神经系统」，白天燃烟、夜间举火，军情半日可达千里。" },
  ],
  milan: [
    { text: "佛光古城展区——佛教东传的重要驿站，希腊艺术与印度文明在此相遇。" },
    { text: "那幅带翼天使壁画最为珍贵——它是丝路东西方艺术交融的明证。" },
    { text: "佉卢文木牍记录了西域古国的日常，让我们得以窥见两千年前绿洲城邦的运作。" },
  ],
  ruoqiang: [
    { text: "大漠遗珍展区——大漠深处的神秘古国，丝路南道的璀璨明珠。" },
    { text: "大漠美女距今已三千八百年，她的容貌诉说着远古东西方人群的交汇。" },
    { text: "这些汉文文书证明，中原王朝对西域的经略早在两千年前便已深入大漠。" },
  ],
};

export function getExhibitById(id: string): ShowroomExhibit | undefined {
  for (const zone of SHOWROOM_ZONES) {
    const found = zone.exhibits.find((e) => e.id === id);
    if (found) return found;
  }
  return undefined;
}

export function getZoneById(id: ShowroomZoneId): ShowroomZone | undefined {
  return SHOWROOM_ZONES.find((z) => z.id === id);
}

// ---------- 丝路主题材质 ----------

const SILK_ROAD_COLORS = {
  sand: 0xd4a574,
  sandDark: 0x8b7355,
  sandLight: 0xe8c89a,
  gold: 0xdaa520,
  goldDark: 0xb8860b,
  crimson: 0x8b0000,
  terracotta: 0xa0522d,
  pottery: 0x8b4513,
  jade: 0x2d5a3d,
  lapis: 0x1a3a5c,
  parchment: 0xf5deb3,
  ink: 0x2c1810,
};

function createSilkRoadTexture(kind: "carpet" | "arch" | "pillar" | "wall_mural" | "sand_floor"): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  const size = 512;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  if (kind === "carpet") {
    ctx.fillStyle = "#8b1a1a";
    ctx.fillRect(0, 0, size, size);
    
    const random = seededRandom(42);
    for (let i = 0; i < 8; i++) {
      ctx.strokeStyle = i % 2 === 0 ? "#daa520" : "#4a90a4";
      ctx.lineWidth = 3;
      const offset = i * 64;
      ctx.strokeRect(offset + 16, offset + 16, size - 32 - offset * 2, size - 32 - offset * 2);
    }
    
    const centerX = size / 2;
    const centerY = size / 2;
    for (let r = 40; r > 0; r -= 8) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
      ctx.fillStyle = r % 16 === 0 ? "#daa520" : "#8b1a1a";
      ctx.fill();
    }
    
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      const petalX = centerX + Math.cos(angle) * 60;
      const petalY = centerY + Math.sin(angle) * 60;
      ctx.beginPath();
      ctx.ellipse(petalX, petalY, 18, 10, angle, 0, Math.PI * 2);
      ctx.fillStyle = i % 2 === 0 ? "#daa520" : "#c41e3a";
      ctx.fill();
    }

    for (let i = 0; i < 200; i++) {
      ctx.fillStyle = random() > 0.5 ? "rgba(218,165,32,0.3)" : "rgba(139,26,26,0.3)";
      ctx.fillRect(random() * size, random() * size, 2, 2);
    }
  } else if (kind === "sand_floor") {
    ctx.fillStyle = "#c4a060";
    ctx.fillRect(0, 0, size, size);
    
    const random = seededRandom(123);
    for (let i = 0; i < 300; i++) {
      const x = random() * size;
      const y = random() * size;
      const alpha = 0.05 + random() * 0.1;
      ctx.fillStyle = `rgba(139, 115, 85, ${alpha})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 15 + random() * 40, 8 + random() * 20, random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.strokeStyle = "rgba(218, 165, 32, 0.15)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      const startY = i * 64 + 32;
      ctx.moveTo(0, startY);
      for (let x = 0; x <= size; x += 20) {
        ctx.lineTo(x, startY + Math.sin(x * 0.02 + i) * 8);
      }
      ctx.stroke();
    }
  } else if (kind === "wall_mural") {
    const gradient = ctx.createLinearGradient(0, 0, 0, size);
    gradient.addColorStop(0, "#6b4226");
    gradient.addColorStop(1, "#4a2c1a");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    
    ctx.fillStyle = "#c8a06a";
    ctx.fillRect(20, 20, size - 40, size - 80);
    
    ctx.strokeStyle = "#8b4513";
    ctx.lineWidth = 4;
    ctx.strokeRect(20, 20, size - 40, size - 80);
    
    ctx.fillStyle = "#5c3d2e";
    ctx.beginPath();
    ctx.arc(size / 2, size / 2 - 20, 60, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = "#8b6914";
    ctx.beginPath();
    ctx.arc(size / 2 - 20, size / 2 - 30, 8, 0, Math.PI * 2);
    ctx.arc(size / 2 + 20, size / 2 - 30, 8, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.strokeStyle = "#c8a06a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2 - 10, 20, 0.2, Math.PI - 0.2);
    ctx.stroke();
    
    ctx.fillStyle = "#daa520";
    ctx.font = "bold 28px 'Microsoft YaHei', serif";
    ctx.textAlign = "center";
    ctx.fillText("丝绸之路", size / 2, size - 40);
  } else if (kind === "pillar") {
    const grad = ctx.createLinearGradient(0, 0, size, 0);
    grad.addColorStop(0, "#8b7355");
    grad.addColorStop(0.3, "#c4a060");
    grad.addColorStop(0.5, "#daa520");
    grad.addColorStop(0.7, "#c4a060");
    grad.addColorStop(1, "#8b7355");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    
    ctx.strokeStyle = "rgba(139, 69, 19, 0.3)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 20; i++) {
      ctx.beginPath();
      const x = (i / 20) * size;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }
    
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = "rgba(218, 165, 32, 0.2)";
      ctx.fillRect(0, i * 50 + 10, size, 8);
    }
  } else if (kind === "arch") {
    ctx.fillStyle = "#6b4226";
    ctx.fillRect(0, 0, size, size);
    
    ctx.fillStyle = "#c8a06a";
    ctx.beginPath();
    ctx.moveTo(60, size);
    ctx.lineTo(60, 180);
    ctx.quadraticCurveTo(size / 2, 40, size - 60, 180);
    ctx.lineTo(size - 60, size);
    ctx.fill();
    
    ctx.strokeStyle = "#8b4513";
    ctx.lineWidth = 8;
    ctx.stroke();
    
    ctx.fillStyle = "#5c3d2e";
    for (let i = 0; i < 5; i++) {
      const x = 120 + i * 70;
      ctx.fillRect(x, 200, 20, size - 200);
    }
    
    ctx.fillStyle = "#daa520";
    ctx.beginPath();
    ctx.arc(size / 2, 120, 25, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 16;
  return texture;
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

// ---------- 3D 构件创建 ----------

const EXHIBIT_SCALE = 1.5;

function createExhibitGeometry(shape: ExhibitShape): THREE.BufferGeometry {
  const s = EXHIBIT_SCALE;
  switch (shape) {
    case "brick":
      return new THREE.BoxGeometry(0.5 * s, 0.24 * s, 0.14 * s);
    case "tablet":
      return new THREE.BoxGeometry(0.36 * s, 0.05 * s, 0.26 * s);
    case "tablet_wood":
      return new THREE.BoxGeometry(0.38 * s, 0.04 * s, 0.2 * s);
    case "weapon": {
      const shaft = new THREE.CylinderGeometry(0.025 * s, 0.025 * s, 1.0 * s, 10);
      shaft.rotateX(Math.PI / 2);
      shaft.translate(0, 0, -0.1 * s);
      const head = new THREE.ConeGeometry(0.06 * s, 0.22 * s, 12);
      head.rotateX(Math.PI / 2);
      head.translate(0, 0, 0.5 * s);
      const blade = new THREE.BoxGeometry(0.3 * s, 0.02 * s, 0.04 * s);
      blade.translate(0, 0, 0.35 * s);
      return mergeGeometries([shaft, head, blade]);
    }
    case "pottery": {
      const points: THREE.Vector2[] = [];
      const profile = [
        [0.00, 0.00], [0.14, 0.00], [0.16, 0.03], [0.18, 0.08],
        [0.20, 0.14], [0.22, 0.20], [0.20, 0.26], [0.17, 0.30],
        [0.15, 0.33], [0.14, 0.36], [0.16, 0.38],
      ];
      for (const [r, h] of profile) {
        points.push(new THREE.Vector2(r * s, h * s));
      }
      // Z-up 场景：Lathe 轴为 Y，rotateX(π/2) 后高度沿 Z 立起
      const potteryGeo = new THREE.LatheGeometry(points, 24);
      potteryGeo.rotateX(Math.PI / 2);
      return potteryGeo;
    }
    case "textile": {
      // Z-up 场景：织物立挂展示，平面法线朝水平
      const textileGeo = new THREE.PlaneGeometry(0.5 * s, 0.4 * s);
      textileGeo.rotateX(Math.PI / 2);
      return textileGeo;
    }
    case "scroll":
      return new THREE.BoxGeometry(0.4 * s, 0.03 * s, 0.3 * s);
    case "coin": {
      const outer = new THREE.CylinderGeometry(0.14 * s, 0.14 * s, 0.025 * s, 32);
      outer.rotateX(Math.PI / 2);
      return outer;
    }
    case "tool":
      return new THREE.BoxGeometry(0.28 * s, 0.1 * s, 0.08 * s);
    case "buddha_head": {
      const head = new THREE.SphereGeometry(0.18 * s, 24, 16);
      const crown = new THREE.SphereGeometry(0.08 * s, 12, 8);
      crown.translate(0, 0, 0.22 * s);
      const earL = new THREE.SphereGeometry(0.05 * s, 8, 6);
      earL.translate(-0.16 * s, 0, 0.02 * s);
      const earR = new THREE.SphereGeometry(0.05 * s, 8, 6);
      earR.translate(0.16 * s, 0, 0.02 * s);
      return mergeGeometries([head, crown, earL, earR]);
    }
    case "sculpture":
    default: {
      const head = new THREE.SphereGeometry(0.1 * s, 16, 12);
      head.translate(0, 0, 0.35 * s);
      const body = new THREE.CylinderGeometry(0.12 * s, 0.16 * s, 0.4 * s, 16);
      body.rotateX(Math.PI / 2);
      body.translate(0, 0, 0.05 * s);
      return mergeGeometries([head, body]);
    }
  }
}

function createExhibitMaterial(exhibit: ShowroomExhibit): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: exhibit.color,
    roughness: exhibit.roughness,
    metalness: exhibit.metalness,
    clearcoat: exhibit.metalness > 0.5 ? 0.8 : 0.4,
    clearcoatRoughness: 0.15,
    envMapIntensity: 1.6,
    // 织物等薄片展品是单面平面，必须双面渲染，否则背面整片消失
    side: THREE.DoubleSide,
  });
}

function createZoneLabelTexture(zone: ShowroomZone): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 320;
  const ctx = canvas.getContext("2d")!;
  
  const grad = ctx.createLinearGradient(0, 0, 0, 320);
  grad.addColorStop(0, "rgba(40, 25, 15, 0.9)");
  grad.addColorStop(0.5, "rgba(60, 35, 20, 0.85)");
  grad.addColorStop(1, "rgba(40, 25, 15, 0.9)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 320);
  
  ctx.strokeStyle = `#${zone.accentColor.toString(16).padStart(6, "0")}`;
  ctx.lineWidth = 4;
  ctx.strokeRect(20, 20, 984, 280);
  
  ctx.strokeStyle = `#${zone.themeColor.toString(16).padStart(6, "0")}`;
  ctx.lineWidth = 2;
  ctx.strokeRect(32, 32, 960, 256);
  
  ctx.fillStyle = `#${zone.accentColor.toString(16).padStart(6, "0")}`;
  ctx.fillRect(56, 80, 8, 160);
  
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(84, 100 + i * 50, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  
  ctx.fillStyle = "#f5deb3";
  ctx.font = "bold 72px 'Microsoft YaHei', 'KaiTi', serif";
  ctx.textBaseline = "middle";
  ctx.fillText(zone.name, 110, 130);
  
  ctx.fillStyle = `#${zone.accentColor.toString(16).padStart(6, "0")}`;
  ctx.font = "italic 32px 'Microsoft YaHei', 'KaiTi', serif";
  ctx.fillText(zone.subtitle, 112, 200);
  
  ctx.strokeStyle = "rgba(218, 165, 32, 0.3)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 10; i++) {
    ctx.beginPath();
    ctx.moveTo(800 + i * 20, 60);
    ctx.lineTo(820 + i * 20, 260);
    ctx.stroke();
  }
  
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 16;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createInfoPlaqueTexture(exhibit: ShowroomExhibit): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 560;
  canvas.height = 360;
  const ctx = canvas.getContext("2d")!;
  
  const grad = ctx.createLinearGradient(0, 0, 0, 360);
  grad.addColorStop(0, "#2c1810");
  grad.addColorStop(1, "#1a0f08");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 560, 360);
  
  ctx.strokeStyle = "#c8a06a";
  ctx.lineWidth = 4;
  ctx.strokeRect(12, 12, 536, 336);
  
  ctx.strokeStyle = "#8b6914";
  ctx.lineWidth = 2;
  ctx.strokeRect(22, 22, 516, 316);
  
  ctx.fillStyle = "#daa520";
  ctx.beginPath();
  ctx.moveTo(280, 8);
  ctx.lineTo(260, 28);
  ctx.lineTo(300, 28);
  ctx.closePath();
  ctx.fill();
  
  ctx.fillStyle = "#f5deb3";
  ctx.font = "bold 34px 'Microsoft YaHei', 'KaiTi', serif";
  ctx.textBaseline = "top";
  ctx.fillText(exhibit.name, 36, 40);
  
  ctx.fillStyle = "#daa520";
  ctx.font = "22px 'Microsoft YaHei', serif";
  ctx.fillText(exhibit.era, 36, 88);
  
  ctx.fillStyle = "#b8a080";
  ctx.font = "17px 'Microsoft YaHei', serif";
  ctx.fillText(`材质：${exhibit.material}`, 36, 124);
  ctx.fillText(`出处：${exhibit.origin}`, 36, 150);
  
  ctx.strokeStyle = "rgba(218, 165, 32, 0.3)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(36, 185);
  ctx.lineTo(524, 185);
  ctx.stroke();
  
  ctx.fillStyle = "#d4c4a8";
  ctx.font = "17px 'Microsoft YaHei', serif";
  const desc = exhibit.description;
  const maxWidth = 490;
  let y = 205;
  let line = "";
  for (let i = 0; i < desc.length; i += 1) {
    const test = line + desc[i];
    if (ctx.measureText(test).width > maxWidth) {
      ctx.fillText(line, 36, y);
      y += 26;
      line = desc[i];
      if (y > 330) break;
    } else {
      line = test;
    }
  }
  if (line && y <= 340) ctx.fillText(line, 36, y);
  
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 16;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createMuseumEntranceSign(scene: THREE.Scene, disposables: DisposableSceneResource[], position: THREE.Vector3, floorZ: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, "#7a4522");
  grad.addColorStop(0.5, "#96562b");
  grad.addColorStop(1, "#7a4522");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 512);
  
  ctx.strokeStyle = "#daa520";
  ctx.lineWidth = 8;
  ctx.strokeRect(24, 24, 976, 464);
  ctx.strokeStyle = "#8b6914";
  ctx.lineWidth = 3;
  ctx.strokeRect(40, 40, 944, 432);
  
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#daa520" : "#8b6914";
    ctx.beginPath();
    ctx.arc(80 + i * 124, 80, 12, 0, Math.PI * 2);
    ctx.fill();
  }
  
  ctx.fillStyle = "#f5deb3";
  ctx.font = "bold 88px 'Microsoft YaHei', 'KaiTi', serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("丝绸之路数字博物馆", 512, 180);
  
  ctx.fillStyle = "#daa520";
  ctx.font = "italic 36px 'Microsoft YaHei', 'KaiTi', serif";
  ctx.fillText("Silk Road Digital Museum", 512, 270);
  
  ctx.strokeStyle = "rgba(218, 165, 32, 0.4)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(200, 320);
  ctx.lineTo(824, 320);
  ctx.stroke();
  
  ctx.fillStyle = "#c8a06a";
  ctx.font = "28px 'Microsoft YaHei', serif";
  ctx.fillText("千年丝路 · 文明交汇 · 数字化呈现", 512, 380);
  
  ctx.fillStyle = "#8b6914";
  ctx.font = "24px 'Microsoft YaHei', serif";
  ctx.fillText("—— 边塞 · 佛光 · 大漠 ——", 512, 440);
  
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 16;
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
  const geo = new THREE.PlaneGeometry(4.5, 2.25);
  const sign = new THREE.Mesh(geo, mat);
  sign.position.set(position.x, position.y, floorZ + 2.8);
  // Z-up 场景：立起并后仰 30°，法线朝 -Y（面向入口来向）
  sign.rotation.x = Math.PI / 2 - Math.PI / 6;
  scene.add(sign);
  disposables.push(tex, mat, geo);
}

function createSilkRoadPillar(scene: THREE.Scene, disposables: DisposableSceneResource[], position: THREE.Vector3, floorZ: number, height: number = 3.2) {
  // Z-up 场景：rotateX(π/2) 将圆柱 Y 轴映射到 Z（竖直）
  const pillarGeo = new THREE.CylinderGeometry(0.18, 0.22, height, 16);
  pillarGeo.rotateX(Math.PI / 2);
  const pillarMat = new THREE.MeshStandardMaterial({
    color: SILK_ROAD_COLORS.sandDark,
    roughness: 0.6,
    metalness: 0.15,
  });
  const pillar = new THREE.Mesh(pillarGeo, pillarMat);
  pillar.position.set(position.x, position.y, floorZ + height / 2);
  pillar.castShadow = true;
  pillar.receiveShadow = true;
  scene.add(pillar);
  
  const capitalGeo = new THREE.BoxGeometry(0.45, 0.45, 0.2);
  const capitalMat = new THREE.MeshStandardMaterial({
    color: SILK_ROAD_COLORS.gold,
    roughness: 0.3,
    metalness: 0.7,
  });
  const capital = new THREE.Mesh(capitalGeo, capitalMat);
  capital.position.set(position.x, position.y, floorZ + height - 0.1);
  capital.castShadow = true;
  scene.add(capital);
  
  const baseGeo = new THREE.BoxGeometry(0.5, 0.5, 0.2);
  const base = new THREE.Mesh(baseGeo, pillarMat);
  base.position.set(position.x, position.y, floorZ + 0.1);
  base.receiveShadow = true;
  scene.add(base);
  
  disposables.push(pillarGeo, pillarMat, capitalGeo, capitalMat, baseGeo);
}

function createCamelDecoration(scene: THREE.Scene, disposables: DisposableSceneResource[], position: THREE.Vector3, floorZ: number, scale: number = 1) {
  const s = scale;
  // Z-up 场景：rotateZ(π/2) 将胶囊 Y 轴放平到 X，躯干水平
  const bodyGeo = new THREE.CapsuleGeometry(0.25 * s, 0.5 * s, 8, 16);
  bodyGeo.rotateZ(Math.PI / 2);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xb8860b,
    roughness: 0.8,
    metalness: 0.05,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.set(position.x, position.y, floorZ + 0.55 * s);
  body.castShadow = true;
  scene.add(body);
  
  const humpGeo = new THREE.SphereGeometry(0.18 * s, 12, 8);
  const hump1 = new THREE.Mesh(humpGeo, bodyMat);
  hump1.position.set(position.x - 0.12 * s, position.y, floorZ + 0.85 * s);
  hump1.castShadow = true;
  scene.add(hump1);
  const hump2 = new THREE.Mesh(humpGeo, bodyMat);
  hump2.position.set(position.x + 0.12 * s, position.y, floorZ + 0.85 * s);
  hump2.castShadow = true;
  scene.add(hump2);
  
  const legGeo = new THREE.CylinderGeometry(0.05 * s, 0.06 * s, 0.5 * s, 8);
  legGeo.rotateX(Math.PI / 2);
  [[-0.2, -0.12], [-0.2, 0.12], [0.2, -0.12], [0.2, 0.12]].forEach(([lx, ly]) => {
    const leg = new THREE.Mesh(legGeo, bodyMat);
    leg.position.set(position.x + lx * s, position.y + ly * s, floorZ + 0.25 * s);
    leg.castShadow = true;
    scene.add(leg);
  });
  
  // Z-up 场景：胶囊 Y 轴即竖直，绕 Z 向前（+X）倾斜；正角度会使顶端倒向 -X（与头相反）
  const neckGeo = new THREE.CapsuleGeometry(0.08 * s, 0.4 * s, 6, 10);
  neckGeo.rotateZ(-Math.PI / 6);
  const neck = new THREE.Mesh(neckGeo, bodyMat);
  neck.position.set(position.x + 0.35 * s, position.y, floorZ + 0.8 * s);
  neck.castShadow = true;
  scene.add(neck);
  
  const headGeo = new THREE.BoxGeometry(0.18 * s, 0.12 * s, 0.15 * s);
  const head = new THREE.Mesh(headGeo, bodyMat);
  head.position.set(position.x + 0.6 * s, position.y, floorZ + 1.0 * s);
  head.castShadow = true;
  scene.add(head);
  
  disposables.push(bodyGeo, bodyMat, humpGeo, legGeo, neckGeo, headGeo);
}

function createHangingLantern(scene: THREE.Scene, disposables: DisposableSceneResource[], position: THREE.Vector3, floorZ: number) {
  const lanternGeo = new THREE.SphereGeometry(0.2, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.7);
  const lanternMat = new THREE.MeshStandardMaterial({
    color: SILK_ROAD_COLORS.crimson,
    roughness: 0.5,
    metalness: 0.1,
    emissive: 0xff6622,
    emissiveIntensity: 0.8,
    side: THREE.DoubleSide,
  });
  const lantern = new THREE.Mesh(lanternGeo, lanternMat);
  lantern.position.set(position.x, position.y, floorZ + 2.6);
  scene.add(lantern);
  
  const tasselGeo = new THREE.ConeGeometry(0.04, 0.15, 8);
  tasselGeo.rotateX(Math.PI);
  const tasselMat = new THREE.MeshStandardMaterial({
    color: SILK_ROAD_COLORS.gold,
    roughness: 0.4,
    metalness: 0.6,
  });
  const tassel = new THREE.Mesh(tasselGeo, tasselMat);
  tassel.position.set(position.x, position.y, floorZ + 2.35);
  scene.add(tassel);

  disposables.push(lanternGeo, lanternMat, tasselGeo, tasselMat);
}

function createDisplayPedestal(scene: THREE.Scene, disposables: DisposableSceneResource[], position: THREE.Vector3, floorZ: number, zone: ShowroomZone) {
  const baseGeo = new THREE.BoxGeometry(0.8, 0.8, 0.08);
  const baseMat = new THREE.MeshPhysicalMaterial({
    color: SILK_ROAD_COLORS.sandDark,
    roughness: 0.5,
    metalness: 0.2,
    clearcoat: 0.3,
  });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.set(position.x, position.y, floorZ + 0.04);
  base.receiveShadow = true;
  scene.add(base);
  
  const pillarGeo = new THREE.BoxGeometry(0.6, 0.6, 0.65);
  const pillarMat = new THREE.MeshPhysicalMaterial({
    color: zone.themeColor,
    roughness: 0.45,
    metalness: 0.15,
    clearcoat: 0.5,
    clearcoatRoughness: 0.2,
  });
  const pillar = new THREE.Mesh(pillarGeo, pillarMat);
  pillar.position.set(position.x, position.y, floorZ + 0.4);
  pillar.castShadow = true;
  pillar.receiveShadow = true;
  scene.add(pillar);
  
  const topGeo = new THREE.BoxGeometry(0.7, 0.7, 0.06);
  const topMat = new THREE.MeshPhysicalMaterial({
    color: SILK_ROAD_COLORS.goldDark,
    roughness: 0.3,
    metalness: 0.4,
    clearcoat: 0.8,
    clearcoatRoughness: 0.1,
  });
  const top = new THREE.Mesh(topGeo, topMat);
  top.position.set(position.x, position.y, floorZ + 0.75);
  top.castShadow = true;
  top.receiveShadow = true;
  scene.add(top);
  
  disposables.push(baseGeo, baseMat, pillarGeo, pillarMat, topGeo, topMat);
}

/**
 * 玻璃展柜批量渲染器：所有展柜面板共享同一玻璃材质，按 5 种固定面板用
 * InstancedMesh 一次绘制全部展柜，把 5×N 个透明网格压缩为 5 次绘制。
 * InstancedMesh 对透明材质按实例到相机距离排序，保留正确的叠层顺序。
 */
class GlassCaseBuilder {
  private scene: THREE.Scene;
  private disposables: DisposableSceneResource[];
  private positions: THREE.Vector3[] = [];
  private material: THREE.MeshPhysicalMaterial;

  constructor(scene: THREE.Scene, disposables: DisposableSceneResource[]) {
    this.scene = scene;
    this.disposables = disposables;
    this.material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.02,
      metalness: 0.0,
      // 真实折射（transmission）会触发昂贵的离屏折射渲染，改为廉价透明玻璃
      ior: 1.5,
      thickness: 0.03,
      transparent: true,
      opacity: 0.2,
      envMapIntensity: 1.4,
      side: THREE.DoubleSide,
    });
    disposables.push(this.material);
  }

  add(position: THREE.Vector3): void {
    this.positions.push(position.clone());
  }

  build(): void {
    const count = this.positions.length;
    if (count === 0) return;

    // 每个展柜由 5 块固定尺寸/偏移的面板组成（与旧 createGlassCase 完全一致）
    const panelDefs: { size: [number, number, number]; offset: [number, number, number] }[] = [
      { size: [0.03, 0.75, 0.95], offset: [0.36, 0, 1.1] },
      { size: [0.75, 0.03, 0.95], offset: [0, 0.36, 1.1] },
      { size: [0.75, 0.75, 0.85], offset: [0, 0, 1.52] },
      { size: [0.03, 0.75, 0.85], offset: [-0.36, 0, 1.1] },
      { size: [0.75, 0.03, 0.85], offset: [0, -0.36, 1.1] },
    ];

    const matrix = new THREE.Matrix4();
    panelDefs.forEach((def) => {
      const geo = new THREE.BoxGeometry(def.size[0], def.size[1], def.size[2]);
      const instanced = new THREE.InstancedMesh(geo, this.material, count);
      this.positions.forEach((pos, idx) => {
        matrix.makeTranslation(pos.x + def.offset[0], pos.y + def.offset[1], pos.z + def.offset[2]);
        instanced.setMatrixAt(idx, matrix);
      });
      instanced.instanceMatrix.needsUpdate = true;
      this.scene.add(instanced);
      this.disposables.push(geo, instanced);
    });
  }
}

function createCarpetPath(scene: THREE.Scene, disposables: DisposableSceneResource[], start: THREE.Vector3, end: THREE.Vector3, floorZ: number) {
  const dir = new THREE.Vector3().subVectors(end, start);
  const dist = dir.length();
  dir.normalize();
  
  const carpetTex = createSilkRoadTexture("carpet");
  carpetTex.repeat.set(dist / 2, 1);
  const carpetMat = new THREE.MeshStandardMaterial({
    map: carpetTex,
    roughness: 0.85,
    metalness: 0.0,
  });
  // Z-up 场景：Plane 默认在 XY 水平面，仅需绕 Z 对齐走向
  const carpetGeo = new THREE.PlaneGeometry(dist, 1.8);
  const carpet = new THREE.Mesh(carpetGeo, carpetMat);
  carpet.rotation.z = Math.atan2(dir.y, dir.x);
  carpet.position.set(
    (start.x + end.x) / 2,
    (start.y + end.y) / 2,
    floorZ + 0.015
  );
  carpet.receiveShadow = true;
  scene.add(carpet);
  disposables.push(carpetTex, carpetMat, carpetGeo);
}

function createSeatBench(scene: THREE.Scene, disposables: DisposableSceneResource[], position: THREE.Vector3, floorZ: number, rotation: number = 0) {
  const woodMat = new THREE.MeshStandardMaterial({
    color: 0x5c3d2e,
    roughness: 0.7,
    metalness: 0.05,
  });
  
  const seatGeo = new THREE.BoxGeometry(1.2, 0.5, 0.1);
  const seat = new THREE.Mesh(seatGeo, woodMat);
  seat.position.set(position.x, position.y, floorZ + 0.45);
  seat.rotation.z = rotation;
  seat.castShadow = true;
  seat.receiveShadow = true;
  scene.add(seat);
  
  const legGeo = new THREE.BoxGeometry(0.08, 0.08, 0.45);
  [[-0.5, -0.2], [-0.5, 0.2], [0.5, -0.2], [0.5, 0.2]].forEach(([lx, ly]) => {
    const leg = new THREE.Mesh(legGeo, woodMat);
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    leg.position.set(
      position.x + lx * cos - ly * sin,
      position.y + lx * sin + ly * cos,
      floorZ + 0.22
    );
    leg.castShadow = true;
    scene.add(leg);
  });
  
  const cushionGeo = new THREE.BoxGeometry(1.0, 0.4, 0.08);
  const cushionMat = new THREE.MeshStandardMaterial({
    color: SILK_ROAD_COLORS.crimson,
    roughness: 0.9,
    metalness: 0.0,
  });
  const cushion = new THREE.Mesh(cushionGeo, cushionMat);
  cushion.position.set(position.x, position.y, floorZ + 0.52);
  cushion.rotation.z = rotation;
  scene.add(cushion);
  
  disposables.push(woodMat, seatGeo, legGeo, cushionGeo, cushionMat);
}

function createGrottoArch(scene: THREE.Scene, disposables: DisposableSceneResource[], position: THREE.Vector3, floorZ: number, width: number = 3.5, height: number = 3.5) {
  const archTex = createSilkRoadTexture("arch");
  const archMat = new THREE.MeshStandardMaterial({
    map: archTex,
    color: 0x8b6914,
    roughness: 0.75,
    metalness: 0.1,
  });
  
  const leftPillarGeo = new THREE.BoxGeometry(0.5, 0.5, height);
  const leftPillar = new THREE.Mesh(leftPillarGeo, archMat);
  leftPillar.position.set(position.x - width / 2 + 0.25, position.y, floorZ + height / 2);
  leftPillar.castShadow = true;
  leftPillar.receiveShadow = true;
  scene.add(leftPillar);
  
  const rightPillarGeo = new THREE.BoxGeometry(0.5, 0.5, height);
  const rightPillar = new THREE.Mesh(rightPillarGeo, archMat);
  rightPillar.position.set(position.x + width / 2 - 0.25, position.y, floorZ + height / 2);
  rightPillar.castShadow = true;
  rightPillar.receiveShadow = true;
  scene.add(rightPillar);
  
  const topBeamGeo = new THREE.BoxGeometry(width, 0.5, 0.5);
  const topBeam = new THREE.Mesh(topBeamGeo, archMat);
  topBeam.position.set(position.x, position.y, floorZ + height - 0.25);
  topBeam.castShadow = true;
  topBeam.receiveShadow = true;
  scene.add(topBeam);
  
  const archCurvePoints: THREE.Vector2[] = [];
  const archRadius = width / 2 - 0.5;
  for (let i = 0; i <= 24; i++) {
    const angle = Math.PI * (i / 24);
    archCurvePoints.push(new THREE.Vector2(
      Math.cos(angle) * archRadius,
      Math.sin(angle) * archRadius * 0.6 + height - 0.5
    ));
  }
  // Z-up 场景：rotateX(π/2) 后跨度沿 X、高度沿 Z、进深沿 Y，与门柱对齐
  const archCurveGeo = new THREE.LatheGeometry(archCurvePoints, 16, 0, Math.PI);
  archCurveGeo.rotateX(Math.PI / 2);
  archCurveGeo.translate(position.x, position.y, 0);
  const archCurve = new THREE.Mesh(archCurveGeo, archMat);
  archCurve.castShadow = true;
  scene.add(archCurve);
  
  const goldMat = new THREE.MeshStandardMaterial({
    color: SILK_ROAD_COLORS.gold,
    roughness: 0.3,
    metalness: 0.7,
  });
  const ornamentGeo = new THREE.SphereGeometry(0.15, 16, 12);
  const centerOrnament = new THREE.Mesh(ornamentGeo, goldMat);
  centerOrnament.position.set(position.x, position.y, floorZ + height - 0.1);
  centerOrnament.castShadow = true;
  scene.add(centerOrnament);
  
  disposables.push(archTex, archMat, leftPillarGeo, rightPillarGeo, topBeamGeo, archCurveGeo, goldMat, ornamentGeo);
}

function createStupa(scene: THREE.Scene, disposables: DisposableSceneResource[], position: THREE.Vector3, floorZ: number, scale: number = 1) {
  const s = scale;
  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0xc4a060,
    roughness: 0.8,
    metalness: 0.05,
  });
  const goldMat = new THREE.MeshStandardMaterial({
    color: SILK_ROAD_COLORS.gold,
    roughness: 0.25,
    metalness: 0.8,
    emissive: 0x443300,
    emissiveIntensity: 0.15,
  });
  
  const baseGeo = new THREE.CylinderGeometry(0.6 * s, 0.7 * s, 0.3 * s, 8);
  baseGeo.rotateX(Math.PI / 2);
  const base = new THREE.Mesh(baseGeo, stoneMat);
  base.position.set(position.x, position.y, floorZ + 0.15 * s);
  base.castShadow = true;
  base.receiveShadow = true;
  scene.add(base);
  
  const domeGeo = new THREE.SphereGeometry(0.5 * s, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.7);
  const dome = new THREE.Mesh(domeGeo, stoneMat);
  dome.position.set(position.x, position.y, floorZ + 0.3 * s + 0.35 * s);
  dome.castShadow = true;
  scene.add(dome);
  
  const harmikaGeo = new THREE.BoxGeometry(0.3 * s, 0.3 * s, 0.15 * s);
  const harmika = new THREE.Mesh(harmikaGeo, goldMat);
  harmika.position.set(position.x, position.y, floorZ + 0.3 * s + 0.7 * s);
  harmika.castShadow = true;
  scene.add(harmika);
  
  const spireGeo = new THREE.ConeGeometry(0.12 * s, 0.6 * s, 8);
  spireGeo.rotateX(Math.PI / 2);
  const spire = new THREE.Mesh(spireGeo, goldMat);
  spire.position.set(position.x, position.y, floorZ + 0.3 * s + 0.85 * s + 0.3 * s);
  spire.castShadow = true;
  scene.add(spire);
  
  for (let i = 0; i < 5; i++) {
    // Z-up 场景：Torus 默认在 XY 水平面，相轮应水平叠放
    const ringGeo = new THREE.TorusGeometry(0.15 * s - i * 0.02 * s, 0.015 * s, 8, 16);
    const ring = new THREE.Mesh(ringGeo, goldMat);
    ring.position.set(position.x, position.y, floorZ + 0.3 * s + 0.85 * s + i * 0.1 * s);
    scene.add(ring);
  }
  
  disposables.push(stoneMat, goldMat, baseGeo, domeGeo, harmikaGeo, spireGeo);
}

function createPrayerFlags(scene: THREE.Scene, disposables: DisposableSceneResource[], start: THREE.Vector3, end: THREE.Vector3, floorZ: number) {
  const flagColors = [0x8b0000, 0x006400, 0xffff00, 0xffffff, 0x0000ff];
  const ropeMat = new THREE.MeshStandardMaterial({
    color: 0x8b4513,
    roughness: 0.9,
    metalness: 0.0,
  });
  
  const dir = new THREE.Vector3().subVectors(end, start);
  const dist = dir.length();
  dir.normalize();
  const midPoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  const sag = 0.5;
  
  // Z-up 场景：圆柱 Y 轴本就水平，绕 Z 对齐方向即可
  const ropeGeo = new THREE.CylinderGeometry(0.015, 0.015, dist, 8);
  const rope = new THREE.Mesh(ropeGeo, ropeMat);
  rope.position.set(midPoint.x, midPoint.y, floorZ + 2.8 - sag / 2);
  rope.rotation.z = Math.atan2(dir.y, dir.x) - Math.PI / 2;
  scene.add(rope);
  
  const flagCount = Math.floor(dist / 0.4);
  for (let i = 0; i < flagCount; i++) {
    const t = (i + 0.5) / flagCount;
    const flagX = start.x + dir.x * dist * t;
    const flagY = start.y + dir.y * dist * t;
    const sagOffset = Math.sin(t * Math.PI) * sag;
    
    const flagGeo = new THREE.PlaneGeometry(0.25, 0.3);
    const flagMat = new THREE.MeshStandardMaterial({
      color: flagColors[i % flagColors.length],
      roughness: 0.85,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(flagX, flagY, floorZ + 2.8 - sagOffset);
    // Z-up 场景：先立起旗面，再绕 Z 对齐绳向并微摆模拟风动
    flag.rotation.order = "ZYX";
    flag.rotation.z = Math.atan2(dir.y, dir.x) + Math.sin(t * Math.PI * 2) * 0.2;
    flag.rotation.x = Math.PI / 2;
    scene.add(flag);
    disposables.push(flagGeo, flagMat);
  }
  
  disposables.push(ropeMat, ropeGeo);
}

function createMerchantFigure(scene: THREE.Scene, disposables: DisposableSceneResource[], position: THREE.Vector3, floorZ: number, rotation: number = 0, scale: number = 1) {
  const s = scale;
  const robeMat = new THREE.MeshStandardMaterial({
    color: 0x8b4513,
    roughness: 0.85,
    metalness: 0.0,
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xd2a679,
    roughness: 0.7,
    metalness: 0.0,
  });
  const turbanMat = new THREE.MeshStandardMaterial({
    color: 0xf5f5dc,
    roughness: 0.9,
    metalness: 0.0,
  });
  
  const bodyGeo = new THREE.CylinderGeometry(0.15 * s, 0.2 * s, 0.8 * s, 12);
  bodyGeo.rotateX(Math.PI / 2);
  const body = new THREE.Mesh(bodyGeo, robeMat);
  body.position.set(position.x, position.y, floorZ + 0.4 * s);
  body.castShadow = true;
  scene.add(body);
  
  const headGeo = new THREE.SphereGeometry(0.12 * s, 12, 10);
  const head = new THREE.Mesh(headGeo, skinMat);
  head.position.set(position.x, position.y, floorZ + 0.95 * s);
  head.castShadow = true;
  scene.add(head);
  
  const turbanGeo = new THREE.SphereGeometry(0.14 * s, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6);
  const turban = new THREE.Mesh(turbanGeo, turbanMat);
  turban.position.set(position.x, position.y, floorZ + 1.0 * s);
  turban.castShadow = true;
  scene.add(turban);
  
  const armGeo = new THREE.CapsuleGeometry(0.04 * s, 0.3 * s, 4, 8);
  armGeo.rotateZ(Math.PI / 6);
  const leftArm = new THREE.Mesh(armGeo, robeMat);
  leftArm.position.set(position.x - 0.18 * s, position.y, floorZ + 0.6 * s);
  leftArm.castShadow = true;
  scene.add(leftArm);
  
  const armGeo2 = new THREE.CapsuleGeometry(0.04 * s, 0.3 * s, 4, 8);
  armGeo2.rotateZ(-Math.PI / 6);
  const rightArm = new THREE.Mesh(armGeo2, robeMat);
  rightArm.position.set(position.x + 0.18 * s, position.y, floorZ + 0.6 * s);
  rightArm.castShadow = true;
  scene.add(rightArm);
  
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  [body, head, turban, leftArm, rightArm].forEach(mesh => {
    const px = mesh.position.x - position.x;
    const py = mesh.position.y - position.y;
    mesh.position.x = position.x + px * cos - py * sin;
    mesh.position.y = position.y + px * sin + py * cos;
    mesh.rotation.z = rotation;
  });
  
  disposables.push(robeMat, skinMat, turbanMat, bodyGeo, headGeo, turbanGeo, armGeo, armGeo2);
}

function createSandFloor(scene: THREE.Scene, disposables: DisposableSceneResource[], bounds: THREE.Box3, floorZ: number) {
  const sandTex = createSilkRoadTexture("sand_floor");
  const size = bounds.getSize(new THREE.Vector3());
  sandTex.repeat.set(size.x / 4, size.y / 4);
  
  const sandMat = new THREE.MeshStandardMaterial({
    map: sandTex,
    color: 0xd4a574,
    roughness: 0.9,
    metalness: 0.0,
  });
  
  // Z-up 场景：Plane 默认水平，无需旋转
  const sandGeo = new THREE.PlaneGeometry(size.x * 0.95, size.y * 0.95);
  const sand = new THREE.Mesh(sandGeo, sandMat);
  sand.position.set(
    (bounds.min.x + bounds.max.x) / 2,
    (bounds.min.y + bounds.max.y) / 2,
    floorZ + 0.008
  );
  sand.receiveShadow = true;
  scene.add(sand);
  disposables.push(sandTex, sandMat, sandGeo);
}

function addRopeBarriers(
  scene: THREE.Scene,
  disposables: DisposableSceneResource[],
  center: THREE.Vector3,
  radius: number,
  floorZ: number,
  postCount = 6,
  ropeColor: number = SILK_ROAD_COLORS.gold,
): void {
  // Z-up 场景：rotateX(π/2) 将圆柱 Y 轴映射到 Z（竖直立柱）
  const postGeo = new THREE.CylinderGeometry(0.03, 0.035, 0.7, 12);
  postGeo.rotateX(Math.PI / 2);
  const postMat = new THREE.MeshPhysicalMaterial({
    color: SILK_ROAD_COLORS.goldDark,
    metalness: 0.85,
    roughness: 0.25,
    clearcoat: 0.6,
  });
  const ropeMat = new THREE.MeshStandardMaterial({
    color: ropeColor,
    roughness: 0.5,
    metalness: 0.3,
    emissive: new THREE.Color(ropeColor).multiplyScalar(0.1),
  });
  disposables.push(postGeo, postMat, ropeMat);

  for (let i = 0; i < postCount; i += 1) {
    const a1 = (i / postCount) * Math.PI * 2;
    const a2 = ((i + 1) % postCount / postCount) * Math.PI * 2;
    const p1 = new THREE.Vector3(center.x + Math.cos(a1) * radius, center.y + Math.sin(a1) * radius, floorZ + 0.35);
    const p2 = new THREE.Vector3(center.x + Math.cos(a2) * radius, center.y + Math.sin(a2) * radius, floorZ + 0.35);

    const post = new THREE.Mesh(postGeo, postMat);
    post.position.copy(p1);
    post.castShadow = true;
    scene.add(post);

    const topDecorGeo = new THREE.SphereGeometry(0.04, 8, 6);
    const topDecor = new THREE.Mesh(topDecorGeo, postMat);
    topDecor.position.set(p1.x, p1.y, floorZ + 0.72);
    scene.add(topDecor);

    const ropeVec = new THREE.Vector3().subVectors(p2, p1);
    const ropeLen = ropeVec.length();
    // Z-up 场景：圆柱 Y 轴本就水平，绕 Z 对齐两柱方向
    const ropeGeo = new THREE.CylinderGeometry(0.012, 0.012, ropeLen, 8);
    const rope = new THREE.Mesh(ropeGeo, ropeMat);
    rope.position.copy(p1).add(ropeVec.multiplyScalar(0.5));
    rope.rotation.z = Math.atan2(p2.y - p1.y, p2.x - p1.x) - Math.PI / 2;
    scene.add(rope);
  }
}

// ---------- 主构建函数 ----------

export interface DisposableSceneResource {
  dispose: () => void;
}

export function buildDigitalShowroom(
  scene: THREE.Scene,
  disposables: DisposableSceneResource[],
  clusterCenter: THREE.Vector3,
  clusterSize: THREE.Vector3,
  clusterBounds: THREE.Box3,
  floorZ: number,
  zoneIndices?: number[],
  withEntranceSign = true,
): BuiltShowroom {
  const interactables: ShowroomInteractable[] = [];
  const zoneMarkers: { zone: ShowroomZone; position: THREE.Vector3 }[] = [];
  const guideNpcPosition = clusterCenter.clone();
  const glassCases = new GlassCaseBuilder(scene, disposables);

  const zonesToBuild = zoneIndices
    ? zoneIndices.map((i) => SHOWROOM_ZONES[i]).filter(Boolean)
    : SHOWROOM_ZONES.filter(z => z.id !== "entrance");

  const safeMargin = 2.0;
  const availX = Math.max(0.1, (clusterBounds.max.x - clusterBounds.min.x) * 0.45 - safeMargin);
  const availY = Math.max(0.1, (clusterBounds.max.y - clusterBounds.min.y) * 0.45 - safeMargin);
  
  // 仅主展馆（首个 hall）创建入口招牌，避免多馆重复
  if (withEntranceSign) {
    const entrancePos = new THREE.Vector3(clusterCenter.x, clusterBounds.min.y + 2.5, floorZ);
    createMuseumEntranceSign(scene, disposables, entrancePos, floorZ);
  }
  
  createSandFloor(scene, disposables, clusterBounds, floorZ);
  
  const archPositions = [
    new THREE.Vector3(clusterCenter.x, clusterBounds.min.y + 4, floorZ),
    new THREE.Vector3(clusterCenter.x, clusterBounds.max.y - 4, floorZ),
  ];
  archPositions.forEach((pos) => {
    createGrottoArch(scene, disposables, pos, floorZ, 4.0, 3.8);
  });
  
  const stupaPositions = [
    new THREE.Vector3(clusterBounds.min.x + 3, clusterCenter.y, floorZ),
    new THREE.Vector3(clusterBounds.max.x - 3, clusterCenter.y, floorZ),
  ];
  stupaPositions.forEach((pos, i) => {
    createStupa(scene, disposables, pos, floorZ, i === 0 ? 1.0 : 0.85);
  });
  
  const pillarPositions = [
    new THREE.Vector3(clusterBounds.min.x + 1.5, clusterBounds.min.y + 1.5, floorZ),
    new THREE.Vector3(clusterBounds.max.x - 1.5, clusterBounds.min.y + 1.5, floorZ),
    new THREE.Vector3(clusterBounds.min.x + 1.5, clusterBounds.max.y - 1.5, floorZ),
    new THREE.Vector3(clusterBounds.max.x - 1.5, clusterBounds.max.y - 1.5, floorZ),
  ];
  pillarPositions.forEach(pos => createSilkRoadPillar(scene, disposables, pos, floorZ));
  
  const lanternPositions = [
    new THREE.Vector3(clusterCenter.x - 3, clusterCenter.y, floorZ),
    new THREE.Vector3(clusterCenter.x + 3, clusterCenter.y, floorZ),
    new THREE.Vector3(clusterCenter.x, clusterCenter.y - 2, floorZ),
    new THREE.Vector3(clusterCenter.x, clusterCenter.y + 2, floorZ),
  ];
  lanternPositions.forEach(pos => createHangingLantern(scene, disposables, pos, floorZ));
  
  createCamelDecoration(scene, disposables, new THREE.Vector3(clusterBounds.min.x + 2.5, clusterBounds.min.y + 3, floorZ), floorZ, 1.1);
  createCamelDecoration(scene, disposables, new THREE.Vector3(clusterBounds.max.x - 2.5, clusterBounds.min.y + 3, floorZ), floorZ, 0.9);
  
  createMerchantFigure(scene, disposables, new THREE.Vector3(clusterBounds.min.x + 4, clusterBounds.min.y + 3.5, floorZ), floorZ, Math.PI / 6, 0.95);
  createMerchantFigure(scene, disposables, new THREE.Vector3(clusterBounds.max.x - 4, clusterBounds.min.y + 3.5, floorZ), floorZ, -Math.PI / 6, 0.9);
  
  createPrayerFlags(
    scene,
    disposables,
    new THREE.Vector3(clusterBounds.min.x + 2, clusterCenter.y, floorZ),
    new THREE.Vector3(clusterBounds.max.x - 2, clusterCenter.y, floorZ),
    floorZ
  );
  
  createSeatBench(scene, disposables, new THREE.Vector3(clusterBounds.min.x + 2, clusterBounds.max.y - 2, floorZ), floorZ, Math.PI / 4);
  createSeatBench(scene, disposables, new THREE.Vector3(clusterBounds.max.x - 2, clusterBounds.max.y - 2, floorZ), floorZ, -Math.PI / 4);

  const zoneOffsets: THREE.Vector3[] = [];
  if (zonesToBuild.length === 1) {
    zoneOffsets.push(new THREE.Vector3(0, availY * 0.3, 0));
  } else if (zonesToBuild.length === 2) {
    if (availX >= availY) {
      zoneOffsets.push(new THREE.Vector3(-availX * 0.5, 0, 0));
      zoneOffsets.push(new THREE.Vector3(availX * 0.5, 0, 0));
    } else {
      zoneOffsets.push(new THREE.Vector3(0, availY * 0.2, 0));
      zoneOffsets.push(new THREE.Vector3(0, -availY * 0.3, 0));
    }
  } else {
    const r = Math.min(availX, availY) * 0.6;
    zoneOffsets.push(new THREE.Vector3(0, r * 0.5, 0));
    zoneOffsets.push(new THREE.Vector3(-r * 0.866, -r * 0.35, 0));
    zoneOffsets.push(new THREE.Vector3(r * 0.866, -r * 0.35, 0));
  }

  const roomRingRadius = Math.min(Math.min(clusterSize.x, clusterSize.y) * 0.22, 1.3);

  zonesToBuild.forEach((zone, buildIndex) => {
    const zoneIndex = SHOWROOM_ZONES.indexOf(zone);
    const offset = zoneOffsets[buildIndex] || new THREE.Vector3(0, 0, 0);
    const zoneCenter = clusterCenter.clone().add(offset);
    zoneCenter.x = THREE.MathUtils.clamp(zoneCenter.x, clusterBounds.min.x + safeMargin, clusterBounds.max.x - safeMargin);
    zoneCenter.y = THREE.MathUtils.clamp(zoneCenter.y, clusterBounds.min.y + safeMargin + 1, clusterBounds.max.y - safeMargin);
    zoneCenter.z = floorZ;

    const labelTexture = createZoneLabelTexture(zone);
    const labelGeometry = new THREE.PlaneGeometry(2.2, 0.68);
    const labelMaterial = new THREE.MeshBasicMaterial({
      map: labelTexture,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
    });
    const label = new THREE.Mesh(labelGeometry, labelMaterial);
    label.position.set(zoneCenter.x, zoneCenter.y, floorZ + 2.6);
    // Z-up 场景：立起并后仰约 20°，便于平视阅读
    label.rotation.x = Math.PI / 2 - 0.35;
    scene.add(label);
    disposables.push(labelTexture, labelGeometry, labelMaterial);

    const ringGeometry = new THREE.RingGeometry(roomRingRadius + 0.1, roomRingRadius + 0.35, 48);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: zone.accentColor,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.position.set(zoneCenter.x, zoneCenter.y, floorZ + 0.012);
    scene.add(ring);
    disposables.push(ringGeometry, ringMaterial);

    const innerRingGeo = new THREE.RingGeometry(roomRingRadius - 0.1, roomRingRadius + 0.05, 48);
    const innerRingMat = new THREE.MeshBasicMaterial({
      color: zone.themeColor,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
    });
    const innerRing = new THREE.Mesh(innerRingGeo, innerRingMat);
    innerRing.position.set(zoneCenter.x, zoneCenter.y, floorZ + 0.01);
    scene.add(innerRing);
    disposables.push(innerRingGeo, innerRingMat);

    zoneMarkers.push({ zone, position: zoneCenter.clone() });

    const exhibitCount = zone.exhibits.length;
    const arcRadius = Math.min(1.0, roomRingRadius - 0.15);
    zone.exhibits.forEach((exhibit, exhibitIndex) => {
      const angle = (exhibitIndex / exhibitCount) * Math.PI * 2 - Math.PI / 2 + zoneIndex * 0.3;
      const ex = zoneCenter.x + Math.cos(angle) * arcRadius;
      const ey = zoneCenter.y + Math.sin(angle) * arcRadius;

      createDisplayPedestal(scene, disposables, new THREE.Vector3(ex, ey, floorZ), floorZ, zone);

      const exhibitGeometry = createExhibitGeometry(exhibit.shape);
      const exhibitMaterial = createExhibitMaterial(exhibit);
      const exhibitMesh = new THREE.Mesh(exhibitGeometry, exhibitMaterial);
      exhibitMesh.position.set(ex, ey, floorZ + 0.85);
      exhibitMesh.castShadow = true;
      exhibitMesh.receiveShadow = true;
      exhibitMesh.userData.exhibitId = exhibit.id;
      exhibitMesh.userData.zoneId = zone.id;
      exhibitMesh.userData.spinning = true;
      scene.add(exhibitMesh);
      disposables.push(exhibitGeometry, exhibitMaterial);

      if (exhibit.shape === "textile" || exhibit.shape === "scroll" || exhibit.shape === "tablet_wood" || exhibit.shape === "coin") {
        glassCases.add(new THREE.Vector3(ex, ey, floorZ));
      }

      const spotLight = new THREE.SpotLight(0xffd700, 0.8, 5, Math.PI / 5, 0.5, 1.2);
      spotLight.position.set(ex, ey, floorZ + 2.2);
      spotLight.target.position.set(ex, ey, floorZ + 0.85);
      spotLight.castShadow = false;
      scene.add(spotLight);
      scene.add(spotLight.target);
      disposables.push(spotLight);

      const plaqueTexture = createInfoPlaqueTexture(exhibit);
      const plaqueMat = new THREE.MeshBasicMaterial({
        map: plaqueTexture,
        transparent: true,
        side: THREE.DoubleSide,
      });
      const plaqueGeometry = new THREE.PlaneGeometry(0.55, 0.36);
      const plaque = new THREE.Mesh(plaqueGeometry, plaqueMat);
      const plaqueAngle = angle + Math.PI;
      const plaqueDist = arcRadius + 0.75;
      plaque.position.set(
        zoneCenter.x + Math.cos(plaqueAngle) * plaqueDist,
        zoneCenter.y + Math.sin(plaqueAngle) * plaqueDist,
        floorZ + 0.6,
      );
      // Z-up 场景：立起并微后仰，绕 Z 使牌面朝向外侧参观者
      plaque.rotation.order = "ZYX";
      plaque.rotation.x = Math.PI / 2 - 0.3;
      plaque.rotation.z = plaqueAngle + Math.PI / 2;
      scene.add(plaque);
      disposables.push(plaqueTexture, plaqueMat, plaqueGeometry);

      interactables.push({
        mesh: exhibitMesh,
        exhibit,
        zone,
        position: exhibitMesh.position.clone(),
      });
    });

    addRopeBarriers(scene, disposables, zoneCenter, roomRingRadius + 0.4, floorZ, 8, zone.accentColor);
    
    createCarpetPath(
      scene,
      disposables,
      new THREE.Vector3(clusterCenter.x, clusterBounds.min.y + 4, floorZ),
      zoneCenter,
      floorZ
    );
  });

  const ambientLight = new THREE.PointLight(0xffd4a3, 0.6, 14, 1.5);
  ambientLight.position.set(clusterCenter.x, clusterCenter.y, floorZ + 4);
  scene.add(ambientLight);
  disposables.push(ambientLight);

  // 展柜全部收集完毕后，用 InstancedMesh 批量生成，减少透明网格的 draw call
  glassCases.build();

  return { interactables, zoneMarkers, guideNpcPosition };
}

const MURAL_TITLES: Record<ShowroomZoneId, string[]> = {
  entrance: ["丝路商旅图", "大漠驼铃", "西域诸国", "使者往来", "丝路繁华"],
  great_wall: ["边墙晨光", "漠南烽燧", "雄关漫道", "古道西风", "边塞长歌"],
  milan: ["佛光佛塔", "希腊化造像", "丝路商队", "佉卢文书", "西域乐舞"],
  ruoqiang: ["大漠故城", "沙海遗珍", "胡杨沟墓", "胡杨千载", "丝路南道"],
};

function createMuralTexture(zone: ShowroomZone, title: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 400;
  const ctx = canvas.getContext("2d")!;
  
  const bgGrad = ctx.createLinearGradient(0, 0, 0, 400);
  bgGrad.addColorStop(0, `#${zone.themeColor.toString(16).padStart(6, "0")}`);
  bgGrad.addColorStop(1, "#2c1810");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 640, 400);
  
  ctx.fillStyle = "rgba(218, 165, 32, 0.1)";
  for (let i = 0; i < 640; i += 40) {
    for (let j = 0; j < 400; j += 40) {
      if ((i + j) % 80 === 0) {
        ctx.fillRect(i, j, 20, 20);
      }
    }
  }
  
  ctx.strokeStyle = "#8b4513";
  ctx.lineWidth = 6;
  ctx.strokeRect(12, 12, 616, 376);
  ctx.strokeStyle = "#daa520";
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 24, 592, 352);
  
  ctx.fillStyle = "rgba(245, 222, 179, 0.15)";
  ctx.beginPath();
  ctx.moveTo(0, 280);
  for (let x = 0; x <= 640; x += 30) {
    ctx.lineTo(x, 280 - Math.sin(x * 0.02) * 40 - Math.random() * 20);
  }
  ctx.lineTo(640, 400);
  ctx.lineTo(0, 400);
  ctx.closePath();
  ctx.fill();
  
  ctx.fillStyle = "#f5deb3";
  ctx.font = "bold 44px 'Microsoft YaHei', 'KaiTi', serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(title, 320, 200);
  
  ctx.fillStyle = "rgba(218, 165, 32, 0.4)";
  ctx.font = "24px 'Microsoft YaHei', serif";
  ctx.fillText("丝路遗珍", 320, 300);
  
  ctx.fillStyle = "#0f0a05";
  ctx.fillRect(0, 340, 640, 60);
  ctx.fillStyle = `#${zone.accentColor.toString(16).padStart(6, "0")}`;
  ctx.font = "22px 'Microsoft YaHei', serif";
  ctx.fillText(zone.name, 320, 370);
  
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  return tex;
}

export function addShowroomMurals(
  scene: THREE.Scene,
  disposables: DisposableSceneResource[],
  hallBounds: THREE.Box3,
  hallCenter: THREE.Vector3,
  floorZ: number,
  zone: ShowroomZone,
  wallItems: SceneItemLike[],
): void {
  const titles = MURAL_TITLES[zone.id] || MURAL_TITLES.entrance;

  const walls = wallItems
    .filter((item) => {
      const size = item.bounds.getSize(new THREE.Vector3());
      const center = item.bounds.getCenter(new THREE.Vector3());
      return (
        size.z > 1.5
        && Math.max(size.x, size.y) > 0.3
        && center.z > floorZ + 0.5
        && center.z < floorZ + 5
        && center.x >= hallBounds.min.x - 0.5
        && center.x <= hallBounds.max.x + 0.5
        && center.y >= hallBounds.min.y - 0.5
        && center.y <= hallBounds.max.y + 0.5
      );
    })
    .sort((a, b) => {
      const ca = a.bounds.getCenter(new THREE.Vector3());
      const cb = b.bounds.getCenter(new THREE.Vector3());
      const da = Math.hypot(ca.x - hallCenter.x, ca.y - hallCenter.y);
      const db = Math.hypot(cb.x - hallCenter.x, cb.y - hallCenter.y);
      return da - db;
    });

  walls.slice(0, titles.length).forEach((wall, index) => {
    const wallCenter = wall.bounds.getCenter(new THREE.Vector3());
    const wallSize = wall.bounds.getSize(new THREE.Vector3());

    const isXWall = wallSize.x >= wallSize.y;
    const wallNormal = new THREE.Vector3(
      isXWall ? (wallCenter.x < hallCenter.x ? 1 : -1) : 0,
      isXWall ? 0 : (wallCenter.y < hallCenter.y ? 1 : -1),
      0,
    );

    const maxMuralWidth = 2.8;
    const maxMuralHeight = 2.0;
    const paintW = isXWall
      ? Math.min(wallSize.x * 0.7, maxMuralWidth)
      : Math.min(wallSize.y * 0.7, maxMuralWidth);
    const paintH = Math.min(wallSize.z * 0.55, maxMuralHeight);

    const texture = createMuralTexture(zone, titles[index] || titles[0]);
    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.7,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
    const frameMat = new THREE.MeshStandardMaterial({
      color: SILK_ROAD_COLORS.goldDark,
      roughness: 0.3,
      metalness: 0.6,
    });
    const geo = new THREE.PlaneGeometry(paintW, paintH);
    const mesh = new THREE.Mesh(geo, mat);
    const frameGeo = new THREE.BoxGeometry(paintW + 0.12, paintH + 0.12, 0.06);
    const frame = new THREE.Mesh(frameGeo, frameMat);

    mesh.position.set(
      wallCenter.x + wallNormal.x * 0.12,
      wallCenter.y + wallNormal.y * 0.12,
      floorZ + 1.6,
    );
    frame.position.copy(mesh.position);
    frame.position.z -= 0.04;
    
    mesh.lookAt(
      wallCenter.x + wallNormal.x * 10,
      wallCenter.y + wallNormal.y * 10,
      floorZ + 1.6,
    );
    frame.rotation.copy(mesh.rotation);
    
    scene.add(frame);
    scene.add(mesh);

    disposables.push(geo, mat, texture, frameGeo, frameMat);
  });
}

export function addHallGuideArrows(
  scene: THREE.Scene,
  disposables: DisposableSceneResource[],
  zoneMarkers: { zone: ShowroomZone; position: THREE.Vector3 }[],
  floorZ: number,
): void {
  if (zoneMarkers.length < 2) return;

  const arrowGeo = new THREE.ConeGeometry(0.15, 0.4, 3);
  arrowGeo.rotateX(Math.PI / 2);
  const arrowMat = new THREE.MeshBasicMaterial({
    color: SILK_ROAD_COLORS.gold,
    transparent: true,
    opacity: 0.75,
    side: THREE.DoubleSide,
  });
  disposables.push(arrowGeo, arrowMat);

  // 收集所有箭头的位姿，统一用 InstancedMesh 一次绘制（透明实例按距离排序）
  const transforms: { pos: THREE.Vector3; target: THREE.Vector3 }[] = [];
  for (let i = 0; i < zoneMarkers.length - 1; i += 1) {
    const start = zoneMarkers[i].position;
    const end = zoneMarkers[i + 1].position;
    const dir = new THREE.Vector3().subVectors(end, start);
    const dist = dir.length();
    if (dist < 0.2) continue;
    dir.normalize();

    const step = 0.9;
    const count = Math.max(1, Math.floor(dist / step));
    for (let j = 1; j < count; j += 1) {
      const t = j / count;
      const pos = new THREE.Vector3().lerpVectors(start, end, t);
      transforms.push({
        // 圆锥半径 0.15 且横躺指向路径方向，抬高到半径以上避免半埋进地面
        pos: new THREE.Vector3(pos.x, pos.y, floorZ + 0.16),
        target: new THREE.Vector3(pos.x + dir.x, pos.y + dir.y, floorZ + 0.16),
      });
    }
  }

  if (transforms.length === 0) return;
  const instanced = new THREE.InstancedMesh(arrowGeo, arrowMat, transforms.length);
  const dummy = new THREE.Object3D();
  transforms.forEach(({ pos, target }, idx) => {
    dummy.position.copy(pos);
    dummy.lookAt(target);
    dummy.updateMatrix();
    instanced.setMatrixAt(idx, dummy.matrix);
  });
  instanced.instanceMatrix.needsUpdate = true;
  scene.add(instanced);
  disposables.push(instanced);
}
