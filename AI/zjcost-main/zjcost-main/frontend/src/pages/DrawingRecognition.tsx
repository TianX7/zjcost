import { useEffect, useMemo, useRef, useState, type MouseEvent, type WheelEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Empty, Tag, Upload, message } from "antd";
import type { UploadProps } from "antd";
import { ArrowLeftOutlined, BuildOutlined, ClearOutlined, CloudUploadOutlined, DownloadOutlined } from "@ant-design/icons";
import { api } from "../api";
import ValuationReview from "../components/ValuationReview";
import FlowGuide from "../components/FlowGuide";
import Ifc3DViewer, { type Element3D } from "../components/Ifc3DViewer";
import CadCanvasViewer, { type CadCanvasViewerHandle, type CadGeometry, type CadRaster } from "../components/CadCanvasViewer";
import { ErrorBoundary } from "../components/ErrorBoundary";

type DrawingResult = Awaited<ReturnType<typeof api.getDrawingResult>>;

/** 解析会话缓存：切换页面后返回可恢复上次结果（结果过大时降级为仅存任务号，走后端取回） */
const DR_SESSION_KEY = "zjcost.dr.lastSession";

/** 演示用预置模型数据：田维东2.ifc 的构件网格预览（与 museum-complex.walk.json 同源） */
const MODEL_JSON_URL = `${import.meta.env.BASE_URL}models/museum-complex.walk.json`;
const MODEL_DISPLAY_NAME = "田维东2.ifc";
const MODEL_SCENE_TITLE = "田维东2 · 自动构建模型";

const MIN_DRAWING_SCALE = 0.6;
const MAX_DRAWING_SCALE = 10;

function clampDrawingScale(value: number) {
  return Math.min(MAX_DRAWING_SCALE, Math.max(MIN_DRAWING_SCALE, value));
}

function percentFromResult(result: DrawingResult | null) {
  if (!result) return 0;
  if (result.status === "error") return 0;
  if (result.valuation_progress_percent) return result.valuation_progress_percent;
  if (result.status === "done") return 100;
  if (result.status === "processing") return result.progress_percent ?? 35;
  return 0;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function confTag(value: number | undefined) {
  const v = Math.round(Number(value ?? 0) * 100);
  if (v >= 90) return <Tag color="green" className="dr-conf-tag">{v}%</Tag>;
  if (v >= 75) return <Tag color="blue" className="dr-conf-tag">{v}%</Tag>;
  return <Tag color="orange" className="dr-conf-tag">{v}%</Tag>;
}

function DisciplinePlaceholderSVG({ discipline }: { discipline: string }) {
  // 共享定义：渐变、填充图案
  const commonDefs = (
    <defs>
      <linearGradient id="wall-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#1e3a5f" stopOpacity="0.4" />
        <stop offset="100%" stopColor="#0f1e30" stopOpacity="0.2" />
      </linearGradient>
      <linearGradient id="scan-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#38bdf8" stopOpacity="0" />
        <stop offset="50%" stopColor="#38bdf8" stopOpacity="0.5" />
        <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
      </linearGradient>
      <pattern id="wall-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="6" stroke="#1e3a5f" strokeWidth="0.6" opacity="0.5" />
      </pattern>
      <pattern id="earth-hatch" patternUnits="userSpaceOnUse" width="5" height="5">
        <line x1="0" y1="5" x2="5" y2="0" stroke="#475569" strokeWidth="0.4" opacity="0.4" />
      </pattern>
    </defs>
  );

  // 扫描动效带
  const scanLine = <rect x="140" y="120" width="920" height="60" fill="url(#scan-grad)" opacity="0.5">
    <animate attributeName="y" values="120;620;120" dur="7s" repeatCount="indefinite" />
    <animate attributeName="opacity" values="0;0.5;0" dur="7s" repeatCount="indefinite" />
  </rect>;

  // 标准图框标题栏（施工图样式）
  const titleBlock = (
    <>
      <g stroke="#1e3a5f" strokeWidth="1" fill="none" opacity="0.6">
        <rect x="140" y="710" width="920" height="50" />
        <line x1="140" y1="735" x2="1060" y2="735" />
        <line x1="340" y1="710" x2="340" y2="760" />
        <line x1="640" y1="710" x2="640" y2="760" />
        <line x1="840" y1="710" x2="840" y2="760" />
      </g>
      <g fill="#64748b" fontSize="9" fontFamily="ui-monospace, monospace" opacity="0.7">
        <text x="150" y="725">项目名称</text>
        <text x="150" y="750" fill="#94a3b8">滨江科创中心 · 标准层平面图</text>
        <text x="350" y="725">图号</text>
        <text x="350" y="750" fill="#94a3b8">建施-001</text>
        <text x="650" y="725">比例</text>
        <text x="650" y="750" fill="#94a3b8">1:100</text>
        <text x="850" y="725">日期</text>
        <text x="850" y="750" fill="#94a3b8">2026-06-20</text>
      </g>
    </>
  );

  // 轴网系统（三道尺寸标注 + 轴号）
  const axes = (
    <>
      {/* 轴线（点划线） */}
      <g stroke="#1e3a5f" strokeWidth="0.8" opacity="0.55" strokeDasharray="14 4 2 4">
        <line x1="140" y1="280" x2="1060" y2="280" />
        <line x1="140" y1="440" x2="1060" y2="440" />
        <line x1="140" y1="600" x2="1060" y2="600" />
        <line x1="380" y1="120" x2="380" y2="680" />
        <line x1="620" y1="120" x2="620" y2="680" />
        <line x1="860" y1="120" x2="860" y2="680" />
      </g>
      {/* 轴号圆圈 */}
      <g fill="none" stroke="#38bdf8" strokeWidth="1" opacity="0.7">
        <circle cx="140" cy="100" r="11" /><circle cx="380" cy="100" r="11" />
        <circle cx="620" cy="100" r="11" /><circle cx="860" cy="100" r="11" />
        <circle cx="1060" cy="100" r="11" />
        <circle cx="118" cy="120" r="11" /><circle cx="118" cy="280" r="11" />
        <circle cx="118" cy="440" r="11" /><circle cx="118" cy="600" r="11" />
        <circle cx="118" cy="680" r="11" />
      </g>
      <g fill="#38bdf8" fontSize="10" fontFamily="ui-monospace, monospace" opacity="0.85" textAnchor="middle" dominantBaseline="central">
        <text x="140" y="100">A</text><text x="380" y="100">B</text>
        <text x="620" y="100">C</text><text x="860" y="100">D</text>
        <text x="1060" y="100">E</text>
        <text x="118" y="120">1</text><text x="118" y="280">2</text>
        <text x="118" y="440">3</text><text x="118" y="600">4</text>
        <text x="118" y="680">5</text>
      </g>
    </>
  );

  // 三道尺寸标注（建筑规范：总尺寸 + 轴线尺寸 + 细部尺寸）
  const dimensions = (
    <g stroke="#475569" strokeWidth="0.6" fill="#64748b" fontSize="9" fontFamily="ui-monospace, monospace" opacity="0.7">
      {/* 第一道：细部尺寸（最靠近图框） */}
      <line x1="140" y1="60" x2="380" y2="60" />
      <line x1="140" y1="56" x2="140" y2="64" /><line x1="380" y1="56" x2="380" y2="64" />
      <text x="260" y="54" textAnchor="middle">3600</text>
      <line x1="380" y1="60" x2="620" y2="60" />
      <line x1="620" y1="56" x2="620" y2="64" />
      <text x="500" y="54" textAnchor="middle">3600</text>
      <line x1="620" y1="60" x2="860" y2="60" />
      <line x1="860" y1="56" x2="860" y2="64" />
      <text x="740" y="54" textAnchor="middle">3600</text>
      <line x1="860" y1="60" x2="1060" y2="60" />
      <line x1="1060" y1="56" x2="1060" y2="64" />
      <text x="960" y="54" textAnchor="middle">3000</text>
      {/* 第二道：轴线尺寸 */}
      <line x1="140" y1="78" x2="380" y2="78" />
      <line x1="140" y1="74" x2="140" y2="82" /><line x1="380" y1="74" x2="380" y2="82" />
      <text x="260" y="72" textAnchor="middle">3600</text>
      <line x1="380" y1="78" x2="620" y2="78" />
      <line x1="620" y1="74" x2="620" y2="82" />
      <text x="500" y="72" textAnchor="middle">3600</text>
      <line x1="620" y1="78" x2="860" y2="78" />
      <line x1="860" y1="74" x2="860" y2="82" />
      <text x="740" y="72" textAnchor="middle">3600</text>
      <line x1="860" y1="78" x2="1060" y2="78" />
      <line x1="1060" y1="74" x2="1060" y2="82" />
      <text x="960" y="72" textAnchor="middle">3000</text>
      {/* 第三道：总尺寸 */}
      <line x1="140" y1="92" x2="1060" y2="92" />
      <line x1="140" y1="88" x2="140" y2="96" /><line x1="1060" y1="88" x2="1060" y2="96" />
      <text x="600" y="86" textAnchor="middle">13800</text>
      {/* 竖向尺寸 */}
      <line x1="98" y1="120" x2="98" y2="280" />
      <line x1="94" y1="120" x2="102" y2="120" /><line x1="94" y1="280" x2="102" y2="280" />
      <text x="92" y="200" textAnchor="middle" transform="rotate(-90 92 200)">2400</text>
      <line x1="98" y1="280" x2="98" y2="440" />
      <line x1="94" y1="440" x2="102" y2="440" />
      <text x="92" y="360" textAnchor="middle" transform="rotate(-90 92 360)">2400</text>
      <line x1="98" y1="440" x2="98" y2="600" />
      <line x1="94" y1="600" x2="102" y2="600" />
      <text x="92" y="520" textAnchor="middle" transform="rotate(-90 92 520)">2400</text>
      <line x1="98" y1="600" x2="98" y2="680" />
      <text x="92" y="640" textAnchor="middle" transform="rotate(-90 92 640)">1200</text>
    </g>
  );

  // 标高符号
  const elevationMarks = (
    <g fill="#64748b" stroke="#475569" strokeWidth="0.6" fontSize="9" fontFamily="ui-monospace, monospace" opacity="0.75">
      <path d="M 240 690 L 250 680 L 260 690" fill="none" />
      <text x="252" y="695" textAnchor="middle">±0.000</text>
      <path d="M 720 690 L 730 680 L 740 690" fill="none" />
      <text x="732" y="695" textAnchor="middle">+3.000</text>
    </g>
  );

  // 外墙（双线 240mm）+ 内墙（双线 120mm）
  const walls = (
    <>
      {/* 外墙双线 */}
      <g stroke="#3b82f6" fill="none" opacity="0.75">
        <rect x="140" y="120" width="920" height="560" fill="url(#wall-hatch)" stroke="none" opacity="0.3" />
        <rect x="140" y="120" width="920" height="560" strokeWidth="2" />
        <rect x="146" y="126" width="908" height="548" strokeWidth="1.2" opacity="0.6" />
      </g>
      {/* 内墙双线 */}
      <g stroke="#3b82f6" strokeWidth="1" opacity="0.6">
        <line x1="380" y1="126" x2="380" y2="278" /><line x1="386" y1="126" x2="386" y2="278" />
        <line x1="380" y1="442" x2="380" y2="598" /><line x1="386" y1="442" x2="386" y2="598" />
        <line x1="620" y1="282" x2="620" y2="438" /><line x1="626" y1="282" x2="626" y2="438" />
        <line x1="860" y1="442" x2="860" y2="678" /><line x1="866" y1="442" x2="866" y2="678" />
        <line x1="146" y1="440" x2="378" y2="440" /><line x1="146" y1="446" x2="378" y2="446" />
        <line x1="622" y1="600" x2="858" y2="600" /><line x1="622" y1="606" x2="858" y2="606" />
      </g>
    </>
  );

  switch (discipline) {
    case "water":
      return (
        <svg className="dr-cad-placeholder" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid meet">
          {commonDefs}
          {walls}
          {axes}
          {dimensions}
          {elevationMarks}
          {/* 给水管（蓝色实线） */}
          <g stroke="#0ea5e9" strokeWidth="1.4" fill="none" opacity="0.85">
            <path d="M 200 200 L 320 200 L 320 360 L 460 360" />
            <path d="M 460 360 L 460 480 L 540 480" />
            <path d="M 680 200 L 680 360 L 820 360 L 820 480" />
            <path d="M 200 560 L 380 560 L 380 640 L 540 640" />
            <path d="M 680 560 L 820 560 L 820 640 L 980 640" />
          </g>
          {/* 排水管（绿色虚线） */}
          <g stroke="#22c55e" strokeWidth="1.4" fill="none" opacity="0.8" strokeDasharray="6 3">
            <path d="M 540 480 L 540 540 L 380 540 L 380 660 L 200 660" />
            <path d="M 820 480 L 820 540 L 980 540 L 980 660" />
          </g>
          {/* 立管符号（圆圈带标注） */}
          <g fill="none" stroke="#0ea5e9" strokeWidth="1.2" opacity="0.9">
            <circle cx="320" cy="200" r="8" /><circle cx="680" cy="200" r="8" />
            <circle cx="380" cy="660" r="8" stroke="#22c55e" /><circle cx="980" cy="660" r="8" stroke="#22c55e" />
          </g>
          <g fill="#0ea5e9" fontSize="8" fontFamily="ui-monospace, monospace" opacity="0.9" textAnchor="middle">
            <text x="320" y="203">JL-1</text><text x="680" y="203">JL-2</text>
          </g>
          <g fill="#22c55e" fontSize="8" fontFamily="ui-monospace, monospace" opacity="0.9" textAnchor="middle">
            <text x="380" y="663">PL-1</text><text x="980" y="663">PL-2</text>
          </g>
          {/* 卫生器具标准图例 */}
          <g stroke="#64748b" strokeWidth="0.8" fill="none" opacity="0.7">
            {/* 马桶 */}
            <ellipse cx="460" cy="380" rx="18" ry="14" /><rect x="446" y="362" width="28" height="8" rx="2" />
            <ellipse cx="820" cy="380" rx="18" ry="14" /><rect x="806" y="362" width="28" height="8" rx="2" />
            {/* 洗手盆 */}
            <rect x="500" y="460" width="40" height="24" rx="3" /><circle cx="520" cy="472" r="2" />
            <rect x="860" y="460" width="40" height="24" rx="3" /><circle cx="880" cy="472" r="2" />
            {/* 浴缸 */}
            <rect x="220" y="500" width="80" height="40" rx="6" /><circle cx="285" cy="520" r="3" />
            {/* 地漏 */}
            <circle cx="540" cy="540" r="6" /><line x1="534" y1="540" x2="546" y2="540" /><line x1="540" y1="534" x2="540" y2="546" />
            <circle cx="820" cy="540" r="6" /><line x1="814" y1="540" x2="826" y2="540" /><line x1="820" y1="534" x2="820" y2="546" />
            {/* 洗衣机 */}
            <rect x="220" y="580" width="60" height="50" rx="3" /><circle cx="250" cy="605" r="14" />
            {/* 水表 */}
            <circle cx="200" cy="200" r="6" /><text x="200" y="220" fontSize="7" fill="#0ea5e9">水表</text>
            {/* 阀门 */}
            <path d="M 320 200 L 326 196 L 320 200 L 326 204" fill="#0ea5e9" />
          </g>
          {/* 管径标注 */}
          <g fill="#0ea5e9" fontSize="8" fontFamily="ui-monospace, monospace" opacity="0.85">
            <text x="280" y="195">DN25</text>
            <text x="700" y="195">DN25</text>
            <text x="400" y="555" fill="#22c55e">DN100</text>
            <text x="900" y="555" fill="#22c55e">DN100</text>
          </g>
          {/* 房间标注 */}
          <g fill="#94a3b8" fontSize="10" fontFamily="ui-monospace, monospace" opacity="0.7" textAnchor="middle">
            <text x="260" y="350">卫生间</text>
            <text x="740" y="350">卫生间</text>
            <text x="260" y="470">主卧</text>
            <text x="740" y="470">次卧</text>
          </g>
          {scanLine}{titleBlock}
        </svg>
      );
    case "electrical":
      return (
        <svg className="dr-cad-placeholder" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid meet">
          {commonDefs}
          {walls}
          {axes}
          {dimensions}
          {elevationMarks}
          {/* 强电线路（红色实线） */}
          <g stroke="#ef4444" strokeWidth="1" fill="none" opacity="0.8">
            <path d="M 200 200 L 380 200 L 380 280 L 620 280 L 620 200 L 860 200" />
            <path d="M 380 440 L 380 560 L 620 560 L 620 440" />
            <path d="M 860 440 L 860 560 L 980 560" />
            <path d="M 200 600 L 380 600 L 380 660 L 620 660" />
            <path d="M 860 600 L 980 600 L 980 660" />
          </g>
          {/* 弱电线路（蓝色虚线） */}
          <g stroke="#3b82f6" strokeWidth="0.8" fill="none" opacity="0.7" strokeDasharray="4 2">
            <path d="M 200 240 L 620 240 L 620 360 L 860 360" />
            <path d="M 380 480 L 620 480 L 620 600" />
          </g>
          {/* 配电箱 */}
          <g stroke="#ef4444" strokeWidth="1.2" fill="rgba(239,68,68,0.08)" opacity="0.9">
            <rect x="190" y="190" width="24" height="36" />
            <line x1="190" y1="202" x2="214" y2="202" />
            <line x1="190" y1="214" x2="214" y2="214" />
          </g>
          <g fill="#ef4444" fontSize="8" fontFamily="ui-monospace, monospace" opacity="0.9" textAnchor="middle">
            <text x="202" y="240">AL-1</text>
          </g>
          {/* 弱电箱 */}
          <g stroke="#3b82f6" strokeWidth="1" fill="rgba(59,130,246,0.08)" opacity="0.85">
            <rect x="190" y="230" width="20" height="20" />
          </g>
          <g fill="#3b82f6" fontSize="7" fontFamily="ui-monospace, monospace" opacity="0.9" textAnchor="middle">
            <text x="200" y="262">AW-1</text>
          </g>
          {/* 灯具（圆圈+十字） */}
          <g stroke="#fbbf24" strokeWidth="1" fill="none" opacity="0.85">
            <circle cx="260" cy="360" r="12" /><line x1="248" y1="360" x2="272" y2="360" /><line x1="260" y1="348" x2="260" y2="372" />
            <circle cx="500" cy="360" r="12" /><line x1="488" y1="360" x2="512" y2="360" /><line x1="500" y1="348" x2="500" y2="372" />
            <circle cx="740" cy="360" r="12" /><line x1="728" y1="360" x2="752" y2="360" /><line x1="740" y1="348" x2="740" y2="372" />
            <circle cx="960" cy="360" r="12" /><line x1="948" y1="360" x2="972" y2="360" /><line x1="960" y1="348" x2="960" y2="372" />
            <circle cx="260" cy="520" r="10" /><line x1="250" y1="520" x2="270" y2="520" /><line x1="260" y1="510" x2="260" y2="530" />
            <circle cx="500" cy="520" r="10" /><line x1="490" y1="520" x2="510" y2="520" /><line x1="500" y1="510" x2="500" y2="530" />
            <circle cx="740" cy="520" r="10" /><line x1="730" y1="520" x2="750" y2="520" /><line x1="740" y1="510" x2="740" y2="530" />
            <circle cx="960" cy="520" r="10" /><line x1="950" y1="520" x2="970" y2="520" /><line x1="960" y1="510" x2="960" y2="530" />
          </g>
          {/* 开关（单联/双联） */}
          <g stroke="#ef4444" strokeWidth="1" fill="none" opacity="0.9">
            <circle cx="380" cy="300" r="5" /><line x1="380" y1="295" x2="384" y2="291" />
            <circle cx="620" cy="300" r="5" /><line x1="620" y1="295" x2="624" y2="291" /><line x1="620" y1="295" x2="616" y2="291" />
            <circle cx="380" cy="460" r="5" /><line x1="380" y1="455" x2="384" y2="451" />
            <circle cx="860" cy="460" r="5" /><line x1="860" y1="455" x2="864" y2="451" /><line x1="860" y1="455" x2="856" y2="451" />
          </g>
          {/* 插座（半圆+短线） */}
          <g stroke="#ef4444" strokeWidth="1" fill="none" opacity="0.85">
            <path d="M 250 400 A 6 6 0 0 1 262 400" /><line x1="250" y1="400" x2="262" y2="400" /><line x1="253" y1="404" x2="253" y2="406" /><line x1="259" y1="404" x2="259" y2="406" />
            <path d="M 490 400 A 6 6 0 0 1 502 400" /><line x1="490" y1="400" x2="502" y2="400" /><line x1="493" y1="404" x2="493" y2="406" /><line x1="499" y1="404" x2="499" y2="406" />
            <path d="M 730 400 A 6 6 0 0 1 742 400" /><line x1="730" y1="400" x2="742" y2="400" /><line x1="733" y1="404" x2="733" y2="406" /><line x1="739" y1="404" x2="739" y2="406" />
            <path d="M 950 400 A 6 6 0 0 1 962 400" /><line x1="950" y1="400" x2="962" y2="400" /><line x1="953" y1="404" x2="953" y2="406" /><line x1="959" y1="404" x2="959" y2="406" />
            <path d="M 250 560 A 6 6 0 0 1 262 560" /><line x1="250" y1="560" x2="262" y2="560" /><line x1="253" y1="564" x2="253" y2="566" /><line x1="259" y1="564" x2="259" y2="566" />
            <path d="M 730 560 A 6 6 0 0 1 742 560" /><line x1="730" y1="560" x2="742" y2="560" /><line x1="733" y1="564" x2="733" y2="566" /><line x1="739" y1="564" x2="739" y2="566" />
          </g>
          {/* 回路编号 */}
          <g fill="#ef4444" fontSize="7" fontFamily="ui-monospace, monospace" opacity="0.9">
            <text x="300" y="195">WL1</text>
            <text x="640" y="195">WL2</text>
            <text x="400" y="435">WL3</text>
            <text x="880" y="435">WL4</text>
            <text x="220" y="595">WL5</text>
            <text x="880" y="595">WL6</text>
          </g>
          <g fill="#3b82f6" fontSize="7" fontFamily="ui-monospace, monospace" opacity="0.85">
            <text x="300" y="235">WD1</text>
            <text x="400" y="475">WD2</text>
          </g>
          {/* 房间标注 */}
          <g fill="#94a3b8" fontSize="10" fontFamily="ui-monospace, monospace" opacity="0.7" textAnchor="middle">
            <text x="260" y="340">客厅</text>
            <text x="500" y="340">餐厅</text>
            <text x="740" y="340">主卧</text>
            <text x="960" y="340">次卧</text>
            <text x="260" y="500">厨房</text>
            <text x="500" y="500">卫生间</text>
            <text x="740" y="500">书房</text>
            <text x="960" y="500">阳台</text>
          </g>
          {scanLine}{titleBlock}
        </svg>
      );
    case "hvac":
      return (
        <svg className="dr-cad-placeholder" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid meet">
          {commonDefs}
          {walls}
          {axes}
          {dimensions}
          {elevationMarks}
          {/* 送风管（双线绿色） */}
          <g stroke="#22c55e" strokeWidth="1.2" fill="none" opacity="0.85">
            {/* 主干送风管 */}
            <rect x="180" y="180" width="680" height="24" fill="none" />
            <line x1="180" y1="180" x2="860" y2="180" /><line x1="180" y1="204" x2="860" y2="204" />
            <line x1="180" y1="180" x2="180" y2="204" /><line x1="860" y1="180" x2="860" y2="204" />
            {/* 支管1 */}
            <rect x="260" y="204" width="16" height="120" fill="none" />
            <line x1="260" y1="204" x2="276" y2="204" /><line x1="260" y1="324" x2="276" y2="324" />
            <line x1="260" y1="204" x2="260" y2="324" /><line x1="276" y1="204" x2="276" y2="324" />
            {/* 支管2 */}
            <rect x="500" y="204" width="16" height="120" fill="none" />
            <line x1="500" y1="204" x2="516" y2="204" /><line x1="500" y1="324" x2="516" y2="324" />
            <line x1="500" y1="204" x2="500" y2="324" /><line x1="516" y1="204" x2="516" y2="324" />
            {/* 支管3 */}
            <rect x="740" y="204" width="16" height="120" fill="none" />
            <line x1="740" y1="204" x2="756" y2="204" /><line x1="740" y1="324" x2="756" y2="324" />
            <line x1="740" y1="204" x2="740" y2="324" /><line x1="756" y1="204" x2="756" y2="324" />
            {/* 回风管 */}
            <rect x="180" y="560" width="680" height="24" fill="none" />
            <line x1="180" y1="560" x2="860" y2="560" /><line x1="180" y1="584" x2="860" y2="584" />
            <line x1="180" y1="560" x2="180" y2="584" /><line x1="860" y1="560" x2="860" y2="584" />
          </g>
          {/* 回风管（蓝色虚线） */}
          <g stroke="#3b82f6" strokeWidth="1" fill="none" opacity="0.7" strokeDasharray="6 3">
            <line x1="268" y1="324" x2="268" y2="560" />
            <line x1="508" y1="324" x2="508" y2="560" />
            <line x1="748" y1="324" x2="748" y2="560" />
          </g>
          {/* 风口（方形散流器） */}
          <g stroke="#22c55e" strokeWidth="0.8" fill="none" opacity="0.85">
            <rect x="252" y="316" width="32" height="10" /><line x1="256" y1="316" x2="256" y2="326" /><line x1="260" y1="316" x2="260" y2="326" /><line x1="264" y1="316" x2="264" y2="326" /><line x1="268" y1="316" x2="268" y2="326" /><line x1="272" y1="316" x2="272" y2="326" /><line x1="276" y1="316" x2="276" y2="326" /><line x1="280" y1="316" x2="280" y2="326" />
            <rect x="492" y="316" width="32" height="10" /><line x1="496" y1="316" x2="496" y2="326" /><line x1="500" y1="316" x2="500" y2="326" /><line x1="504" y1="316" x2="504" y2="326" /><line x1="508" y1="316" x2="508" y2="326" /><line x1="512" y1="316" x2="512" y2="326" /><line x1="516" y1="316" x2="516" y2="326" /><line x1="520" y1="316" x2="520" y2="326" />
            <rect x="732" y="316" width="32" height="10" /><line x1="736" y1="316" x2="736" y2="326" /><line x1="740" y1="316" x2="740" y2="326" /><line x1="744" y1="316" x2="744" y2="326" /><line x1="748" y1="316" x2="748" y2="326" /><line x1="752" y1="316" x2="752" y2="326" /><line x1="756" y1="316" x2="756" y2="326" /><line x1="760" y1="316" x2="760" y2="326" />
          </g>
          {/* 风机盘管 */}
          <g stroke="#22c55e" strokeWidth="1" fill="rgba(34,197,94,0.08)" opacity="0.9">
            <rect x="240" y="440" width="56" height="28" rx="2" />
            <line x1="248" y1="440" x2="248" y2="468" /><line x1="256" y1="440" x2="256" y2="468" /><line x1="264" y1="440" x2="264" y2="468" /><line x1="272" y1="440" x2="272" y2="468" /><line x1="280" y1="440" x2="280" y2="468" /><line x1="288" y1="440" x2="288" y2="468" />
            <rect x="480" y="440" width="56" height="28" rx="2" />
            <line x1="488" y1="440" x2="488" y2="468" /><line x1="496" y1="440" x2="496" y2="468" /><line x1="504" y1="440" x2="504" y2="468" /><line x1="512" y1="440" x2="512" y2="468" /><line x1="520" y1="440" x2="520" y2="468" /><line x1="528" y1="440" x2="528" y2="468" />
            <rect x="720" y="440" width="56" height="28" rx="2" />
            <line x1="728" y1="440" x2="728" y2="468" /><line x1="736" y1="440" x2="736" y2="468" /><line x1="744" y1="440" x2="744" y2="468" /><line x1="752" y1="440" x2="752" y2="468" /><line x1="760" y1="440" x2="760" y2="468" /><line x1="768" y1="440" x2="768" y2="468" />
          </g>
          {/* 空调机组 */}
          <g stroke="#22c55e" strokeWidth="1.2" fill="rgba(34,197,94,0.12)" opacity="0.9">
            <rect x="180" y="160" width="80" height="40" rx="3" />
            <line x1="200" y1="160" x2="200" y2="200" /><line x1="220" y1="160" x2="220" y2="200" /><line x1="240" y1="160" x2="240" y2="200" />
          </g>
          {/* 冷媒管（红色虚线） */}
          <g stroke="#ef4444" strokeWidth="0.8" fill="none" opacity="0.7" strokeDasharray="3 2">
            <path d="M 268 440 L 268 380 L 200 380 L 200 200" />
            <path d="M 508 440 L 508 380 L 220 380" />
            <path d="M 748 440 L 748 380 L 260 380" />
          </g>
          {/* 冷凝水管（蓝色点线） */}
          <g stroke="#3b82f6" strokeWidth="0.6" fill="none" opacity="0.6" strokeDasharray="2 2">
            <path d="M 268 468 L 268 540 L 200 540" />
            <path d="M 508 468 L 508 540 L 200 540" />
            <path d="M 748 468 L 748 540 L 200 540" />
          </g>
          {/* 标注 */}
          <g fill="#22c55e" fontSize="8" fontFamily="ui-monospace, monospace" opacity="0.9">
            <text x="220" y="155">AHU-1</text>
            <text x="268" y="435" textAnchor="middle">FCU-1</text>
            <text x="508" y="435" textAnchor="middle">FCU-2</text>
            <text x="748" y="435" textAnchor="middle">FCU-3</text>
            <text x="520" y="175">送风主管 500×320</text>
            <text x="520" y="555">回风主管 400×250</text>
          </g>
          {/* 房间标注 */}
          <g fill="#94a3b8" fontSize="10" fontFamily="ui-monospace, monospace" opacity="0.7" textAnchor="middle">
            <text x="260" y="380">办公室</text>
            <text x="500" y="380">会议室</text>
            <text x="740" y="380">接待室</text>
            <text x="260" y="520">储物间</text>
            <text x="500" y="520">走廊</text>
            <text x="740" y="520">设备间</text>
          </g>
          {scanLine}{titleBlock}
        </svg>
      );
    case "fire":
      return (
        <svg className="dr-cad-placeholder" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid meet">
          {commonDefs}
          {walls}
          {axes}
          {dimensions}
          {elevationMarks}
          {/* 喷淋管线（红色实线） */}
          <g stroke="#ef4444" strokeWidth="1.2" fill="none" opacity="0.85">
            {/* 主干管 */}
            <path d="M 200 200 L 980 200" />
            <path d="M 200 360 L 980 360" />
            <path d="M 200 520 L 980 520" />
            <path d="M 200 640 L 980 640" />
            {/* 立管连接 */}
            <line x1="200" y1="200" x2="200" y2="640" />
            <line x1="980" y1="200" x2="980" y2="640" />
            {/* 支管 */}
            <line x1="320" y1="200" x2="320" y2="360" />
            <line x1="540" y1="200" x2="540" y2="360" />
            <line x1="760" y1="200" x2="760" y2="360" />
            <line x1="320" y1="360" x2="320" y2="520" />
            <line x1="540" y1="360" x2="540" y2="520" />
            <line x1="760" y1="360" x2="760" y2="520" />
            <line x1="320" y1="520" x2="320" y2="640" />
            <line x1="540" y1="520" x2="540" y2="640" />
            <line x1="760" y1="520" x2="760" y2="640" />
          </g>
          {/* 喷头（标准符号：圆圈+Y型） */}
          <g stroke="#ef4444" strokeWidth="0.8" fill="none" opacity="0.9">
            <g><circle cx="320" cy="240" r="5" /><line x1="316" y1="244" x2="320" y2="240" /><line x1="324" y1="244" x2="320" y2="240" /></g>
            <g><circle cx="540" cy="240" r="5" /><line x1="536" y1="244" x2="540" y2="240" /><line x1="544" y1="244" x2="540" y2="240" /></g>
            <g><circle cx="760" cy="240" r="5" /><line x1="756" y1="244" x2="760" y2="240" /><line x1="764" y1="244" x2="760" y2="240" /></g>
            <g><circle cx="320" cy="400" r="5" /><line x1="316" y1="404" x2="320" y2="400" /><line x1="324" y1="404" x2="320" y2="400" /></g>
            <g><circle cx="540" cy="400" r="5" /><line x1="536" y1="404" x2="540" y2="400" /><line x1="544" y1="404" x2="540" y2="400" /></g>
            <g><circle cx="760" cy="400" r="5" /><line x1="756" y1="404" x2="760" y2="400" /><line x1="764" y1="404" x2="760" y2="400" /></g>
            <g><circle cx="320" cy="560" r="5" /><line x1="316" y1="564" x2="320" y2="560" /><line x1="324" y1="564" x2="320" y2="560" /></g>
            <g><circle cx="540" cy="560" r="5" /><line x1="536" y1="564" x2="540" y2="560" /><line x1="544" y1="564" x2="540" y2="560" /></g>
            <g><circle cx="760" cy="560" r="5" /><line x1="756" y1="564" x2="760" y2="560" /><line x1="764" y1="564" x2="760" y2="560" /></g>
          </g>
          {/* 烟感探测器（方形+三角） */}
          <g stroke="#fbbf24" strokeWidth="0.8" fill="rgba(251,191,36,0.1)" opacity="0.85">
            <rect x="250" y="280" width="14" height="14" /><line x1="250" y1="280" x2="264" y2="294" /><line x1="264" y1="280" x2="250" y2="294" />
            <rect x="470" y="280" width="14" height="14" /><line x1="470" y1="280" x2="484" y2="294" /><line x1="484" y1="280" x2="470" y2="294" />
            <rect x="690" y="280" width="14" height="14" /><line x1="690" y1="280" x2="704" y2="294" /><line x1="704" y1="280" x2="690" y2="294" />
            <rect x="910" y="280" width="14" height="14" /><line x1="910" y1="280" x2="924" y2="294" /><line x1="924" y1="280" x2="910" y2="294" />
            <rect x="250" y="440" width="14" height="14" /><line x1="250" y1="440" x2="264" y2="454" /><line x1="264" y1="440" x2="250" y2="454" />
            <rect x="470" y="440" width="14" height="14" /><line x1="470" y1="440" x2="484" y2="454" /><line x1="484" y1="440" x2="470" y2="454" />
            <rect x="690" y="440" width="14" height="14" /><line x1="690" y1="440" x2="704" y2="454" /><line x1="704" y1="440" x2="690" y2="454" />
            <rect x="910" y="440" width="14" height="14" /><line x1="910" y1="440" x2="924" y2="454" /><line x1="924" y1="440" x2="910" y2="454" />
          </g>
          {/* 温感探测器（方形+T型） */}
          <g stroke="#f59e0b" strokeWidth="0.8" fill="rgba(245,158,11,0.1)" opacity="0.85">
            <rect x="380" y="280" width="14" height="14" /><line x1="387" y1="280" x2="387" y2="294" /><line x1="383" y1="284" x2="391" y2="284" />
            <rect x="600" y="280" width="14" height="14" /><line x1="607" y1="280" x2="607" y2="294" /><line x1="603" y1="284" x2="611" y2="284" />
            <rect x="820" y="280" width="14" height="14" /><line x1="827" y1="280" x2="827" y2="294" /><line x1="823" y1="284" x2="831" y2="284" />
          </g>
          {/* 消火栓（矩形+对角线） */}
          <g stroke="#ef4444" strokeWidth="1" fill="rgba(239,68,68,0.1)" opacity="0.9">
            <rect x="160" y="240" width="24" height="32" /><line x1="160" y1="240" x2="184" y2="272" /><line x1="184" y1="240" x2="160" y2="272" />
            <rect x="996" y="240" width="24" height="32" /><line x1="996" y1="240" x2="1020" y2="272" /><line x1="1020" y1="240" x2="996" y2="272" />
            <rect x="160" y="560" width="24" height="32" /><line x1="160" y1="560" x2="184" y2="592" /><line x1="184" y1="560" x2="160" y2="592" />
            <rect x="996" y="560" width="24" height="32" /><line x1="996" y1="560" x2="1020" y2="592" /><line x1="1020" y1="560" x2="996" y2="592" />
          </g>
          {/* 手动报警按钮（方形+圆点） */}
          <g stroke="#ef4444" strokeWidth="0.8" fill="rgba(239,68,68,0.15)" opacity="0.9">
            <rect x="170" y="400" width="16" height="16" /><circle cx="178" cy="408" r="3" fill="#ef4444" />
            <rect x="994" y="400" width="16" height="16" /><circle cx="1002" cy="408" r="3" fill="#ef4444" />
          </g>
          {/* 喷淋立管 */}
          <g fill="none" stroke="#ef4444" strokeWidth="1.2" opacity="0.9">
            <circle cx="200" cy="200" r="7" /><circle cx="980" cy="200" r="7" />
          </g>
          <g fill="#ef4444" fontSize="7" fontFamily="ui-monospace, monospace" opacity="0.9" textAnchor="middle">
            <text x="200" y="203">ZP-1</text><text x="980" y="203">ZP-2</text>
          </g>
          {/* 管径标注 */}
          <g fill="#ef4444" fontSize="8" fontFamily="ui-monospace, monospace" opacity="0.9">
            <text x="500" y="195">DN150</text>
            <text x="500" y="355">DN100</text>
            <text x="500" y="515">DN80</text>
            <text x="500" y="635">DN50</text>
          </g>
          {/* 图例标注 */}
          <g fill="#94a3b8" fontSize="8" fontFamily="ui-monospace, monospace" opacity="0.8">
            <text x="257" y="270" fill="#fbbf24">烟感</text>
            <text x="387" y="270" fill="#f59e0b">温感</text>
            <text x="172" y="285">消火栓</text>
            <text x="172" y="445">手报</text>
          </g>
          {/* 房间标注 */}
          <g fill="#94a3b8" fontSize="10" fontFamily="ui-monospace, monospace" opacity="0.7" textAnchor="middle">
            <text x="430" y="340">办公区</text>
            <text x="650" y="340">会议区</text>
            <text x="430" y="500">仓储区</text>
            <text x="650" y="500">走廊</text>
          </g>
          {scanLine}{titleBlock}
        </svg>
      );
    default: // architecture
      return (
        <svg className="dr-cad-placeholder" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid meet">
          {commonDefs}
          {walls}
          {axes}
          {dimensions}
          {elevationMarks}
          {/* 门（标准建筑符号：门弧+门扇） */}
          <g stroke="#fbbf24" strokeWidth="1.2" fill="none" opacity="0.85">
            {/* 入户门 */}
            <path d="M 380 126 A 38 38 0 0 1 418 164" /><line x1="380" y1="126" x2="380" y2="164" />
            {/* 卧室门 */}
            <path d="M 620 282 A 36 36 0 0 0 584 318" /><line x1="620" y1="282" x2="584" y2="282" />
            {/* 卫生间门 */}
            <path d="M 860 442 A 34 34 0 0 1 894 476" /><line x1="860" y1="442" x2="860" y2="476" />
            {/* 厨房门 */}
            <path d="M 620 600 A 32 32 0 0 1 652 632" /><line x1="620" y1="600" x2="620" y2="632" />
            {/* 阳台推拉门 */}
            <line x1="680" y1="126" x2="800" y2="126" strokeWidth="2" />
            <line x1="680" y1="130" x2="740" y2="130" /><line x1="740" y1="134" x2="800" y2="134" />
          </g>
          {/* 窗户（四线表示） */}
          <g stroke="#38bdf8" strokeWidth="0.8" opacity="0.75">
            {/* C1 客厅窗 */}
            <line x1="200" y1="120" x2="320" y2="120" /><line x1="200" y1="124" x2="320" y2="124" /><line x1="200" y1="128" x2="320" y2="128" />
            {/* C2 餐厅窗 */}
            <line x1="440" y1="120" x2="560" y2="120" /><line x1="440" y1="124" x2="560" y2="124" /><line x1="440" y1="128" x2="560" y2="128" />
            {/* C3 主卧窗 */}
            <line x1="680" y1="120" x2="800" y2="120" /><line x1="680" y1="124" x2="800" y2="124" /><line x1="680" y1="128" x2="800" y2="128" />
            {/* C4 卫生间窗 */}
            <line x1="140" y1="200" x2="140" y2="280" /><line x1="144" y1="200" x2="144" y2="280" /><line x1="148" y1="200" x2="148" y2="280" />
            {/* C5 厨房窗 */}
            <line x1="860" y1="600" x2="860" y2="680" /><line x1="864" y1="600" x2="864" y2="680" /><line x1="868" y1="600" x2="868" y2="680" />
          </g>
          {/* 家具洁具（标准图例） */}
          <g stroke="#64748b" strokeWidth="0.8" fill="none" opacity="0.55">
            {/* 客厅：沙发+茶几+电视柜 */}
            <rect x="180" y="320" width="120" height="40" rx="4" /><line x1="210" y1="320" x2="210" y2="360" /><line x1="250" y1="320" x2="250" y2="360" />
            <rect x="200" y="380" width="80" height="30" rx="2" />
            <rect x="180" y="430" width="100" height="20" rx="2" />
            {/* 餐厅：餐桌+餐椅 */}
            <ellipse cx="500" cy="360" rx="40" ry="24" />
            <rect x="460" y="330" width="20" height="12" rx="2" /><rect x="520" y="330" width="20" height="12" rx="2" />
            <rect x="460" y="384" width="20" height="12" rx="2" /><rect x="520" y="384" width="20" height="12" rx="2" />
            {/* 主卧：床+床头柜+衣柜 */}
            <rect x="180" y="480" width="100" height="80" rx="3" />
            <rect x="190" y="490" width="80" height="25" rx="2" /><line x1="230" y1="490" x2="230" y2="515" />
            <rect x="180" y="470" width="30" height="20" rx="2" /><rect x="250" y="470" width="30" height="20" rx="2" />
            <rect x="290" y="480" width="40" height="80" rx="2" /><line x1="290" y1="520" x2="330" y2="520" />
            {/* 卫生间：马桶+洗手盆+淋浴 */}
            <ellipse cx="700" cy="490" rx="18" ry="14" /><rect x="686" y="472" width="28" height="8" rx="2" />
            <rect x="740" y="475" width="40" height="24" rx="3" /><circle cx="760" cy="487" r="2" />
            <rect x="680" y="520" width="60" height="40" rx="2" /><line x1="680" y1="540" x2="740" y2="540" strokeDasharray="3 2" />
            {/* 厨房：橱柜+灶台+水槽+冰箱 */}
            <rect x="700" y="620" width="140" height="40" /><line x1="740" y1="620" x2="740" y2="660" /><line x1="780" y1="620" x2="780" y2="660" />
            <circle cx="720" cy="640" r="6" /><circle cx="745" cy="640" r="6" />
            <rect x="795" y="625" width="30" height="30" rx="2" /><line x1="800" y1="630" x2="820" y2="650" /><line x1="820" y1="630" x2="800" y2="650" />
            <rect x="830" y="620" width="30" height="40" rx="2" /><line x1="830" y1="635" x2="860" y2="635" />
          </g>
          {/* 房间名称标注 */}
          <g fill="#94a3b8" fontSize="11" fontFamily="ui-monospace, monospace" opacity="0.75" textAnchor="middle">
            <text x="260" y="370">客厅</text>
            <text x="500" y="400">餐厅</text>
            <text x="230" y="540">主卧</text>
            <text x="740" y="540">卫生间</text>
            <text x="770" y="670">厨房</text>
          </g>
          {/* 门窗编号 */}
          <g fill="#38bdf8" fontSize="8" fontFamily="ui-monospace, monospace" opacity="0.85">
            <text x="260" y="115">C1</text>
            <text x="500" y="115">C2</text>
            <text x="740" y="115">C3</text>
            <text x="130" y="245" transform="rotate(-90 130 245)">C4</text>
            <text x="880" y="645" transform="rotate(-90 880 645)">C5</text>
            <text x="400" y="120">M1</text>
            <text x="610" y="278">M2</text>
            <text x="870" y="438">M3</text>
            <text x="630" y="596">M4</text>
          </g>
          {/* 指北针 */}
          <g stroke="#64748b" strokeWidth="0.8" fill="none" opacity="0.6">
            <circle cx="1020" cy="160" r="20" />
            <path d="M 1020 140 L 1014 175 L 1020 170 L 1026 175 Z" fill="#64748b" opacity="0.7" />
            <text x="1020" y="135" fontSize="9" fill="#64748b" textAnchor="middle">N</text>
          </g>
          {/* 剖切符号 */}
          <g stroke="#ef4444" strokeWidth="1" fill="none" opacity="0.7">
            <line x1="140" y1="400" x2="1060" y2="400" strokeDasharray="4 2" />
            <text x="135" y="404" fontSize="10" fill="#ef4444" textAnchor="end">1</text>
            <text x="1065" y="404" fontSize="10" fill="#ef4444">1</text>
            <path d="M 130 395 L 140 400 L 130 405" /><path d="M 1070 395 L 1060 400 L 1070 405" />
          </g>
          {scanLine}{titleBlock}
        </svg>
      );
  }
}

function moneyShort(value: number | null | undefined) {
  if (value == null) return "-";
  if (value >= 10000) return `${(value / 10000).toFixed(1)} 万`;
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
}

type BottomTab = "components" | "boq" | "valuation" | "diagnostics" | null;

const DISCIPLINES = [
  { key: "architecture", icon: "architecture", label: "建筑" },
  { key: "water", icon: "water_drop", label: "给排水" },
  { key: "electrical", icon: "bolt", label: "电气" },
  { key: "hvac", icon: "hvac", label: "暖通" },
  { key: "fire", icon: "local_fire_department", label: "消防" },
] as const;

/** 轻量化三维立体识别动效：由若干透视拉伸的线框体块构成建筑体量，配合扫描平面快速复原空间结构观感 */
function Recognition3DOverlay() {
  const volumes = [
    { x: 46, z: 24, w: 34, h: 30, d: 26 },
    { x: 16, z: 34, w: 22, h: 18, d: 20 },
    { x: 74, z: 30, w: 20, h: 40, d: 22 },
    { x: 52, z: 60, w: 40, h: 22, d: 16 },
  ];
  return (
    <div className="dr-3d-overlay" aria-hidden="true">
      <div className="dr-3d-floor" />
      <div className="dr-3d-scene">
        {volumes.map((v, i) => (
          <div
            key={i}
            className="dr-3d-volume"
            style={{
              left: `${v.x}%`,
              top: `${v.z}%`,
              width: `${v.w}%`,
              height: `${v.d}%`,
              animationDelay: `${i * 0.35}s`,
              ["--voh" as string]: v.h,
            }}
          >
            <span className="dr-3d-face dr-3d-front" />
            <span className="dr-3d-face dr-3d-right" />
            <span className="dr-3d-face dr-3d-top" />
          </div>
        ))}
      </div>
      <div className="dr-3d-scan" />
    </div>
  );
}

/** 自动构建模型进度动效：复用识别阶段的 3D 体块扫描动画，叠加居中进度卡片 */
function BuildingModelOverlay({ progress, modelName }: { progress: number; modelName: string }) {
  const steps = [
    { label: "解析图纸构件", min: 0 },
    { label: "匹配 BIM 构件库", min: 30 },
    { label: "定位基础与轴网", min: 62 },
    { label: "准备施工模拟", min: 85 },
  ];
  const currentIndex = steps.reduce((acc, s, i) => (progress >= s.min ? i : acc), 0);
  return (
    <div className="dr-build-wrap">
      <Recognition3DOverlay />
      <div className="dr-build-card">
        <div className="dr-build-card-icon">
          <span className="material-symbols-outlined">view_in_ar</span>
        </div>
        <h2>正在自动构建模型</h2>
        <p>正在基于识别结果生成 {modelName} 的三维模型</p>
        <div className="dr-build-progress">
          <div className="dr-build-track">
            <div className="dr-build-fill" style={{ width: `${Math.round(progress)}%` }} />
          </div>
          <strong>{Math.round(progress)}%</strong>
        </div>
        <div className="dr-build-steps">
          {steps.map((s, i) => (
            <span
              key={s.label}
              className={`dr-build-step${progress >= s.min ? " done" : ""}${i === currentIndex ? " current" : ""}`}
            >
              <span className="dr-build-step-dot">
                <span className="material-symbols-outlined">
                  {progress >= s.min ? "check" : i === currentIndex ? "sync" : "radio_button_unchecked"}
                </span>
              </span>
              {s.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DrawingRecognition() {
  const navigate = useNavigate();
  const [taskId, setTaskId] = useState("");
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<DrawingResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadSimPct, setUploadSimPct] = useState(0);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [revealIndex, setRevealIndex] = useState(0);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [bottomTab, setBottomTab] = useState<BottomTab>(null);
  const [activeDiscipline, setActiveDiscipline] = useState<string>("architecture");
  const [modelView, setModelView] = useState<"drawing" | "building" | "model">("drawing");
  const [modelProgress, setModelProgress] = useState(0);
  const [modelElements, setModelElements] = useState<Element3D[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const revealTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const buildTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const buildTokenRef = useRef(0);
  const dragStartRef = useRef({ pointerX: 0, pointerY: 0, viewX: 0, viewY: 0 });
  const dragRafRef = useRef<number | null>(null);
  const dragLatestRef = useRef<{ dx: number; dy: number } | null>(null);
  const stageTransformRef = useRef<HTMLDivElement | null>(null);
  const cadViewerRef = useRef<CadCanvasViewerHandle | null>(null);
  const viewRef = useRef(view);
  const lastGestureTsRef = useRef(0);
  const zoomSettleTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (revealTimerRef.current) clearInterval(revealTimerRef.current);
      if (buildTimerRef.current) clearInterval(buildTimerRef.current);
      if (dragRafRef.current != null) cancelAnimationFrame(dragRafRef.current);
    };
  }, []);

  // 会话恢复：切走再回来时还原上次的解析结果（缓存优先，仅存任务号时走后端取回）
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    // 注意：StrictMode 开发模式下 effect 会“挂载-清理-再挂载”，
    // 若用 cancelled 标记取消异步取回，第二次挂载又被 restoredRef 跳过，结果永远丢失，
    // 因此这里不做取消，任其完成。
    try {
      const raw = sessionStorage.getItem(DR_SESSION_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { taskId?: string; fileName?: string; result?: DrawingResult | null };
        if (saved.fileName) setFileName(saved.fileName);
        if (saved.taskId) setTaskId(saved.taskId);
        if (saved.result) {
          setResult(saved.result);
          const discKeyMap: Record<string, string> = { civil: "architecture", water: "water", electrical: "electrical", hvac: "hvac", fire: "fire" };
          const topDisc = (saved.result.disciplines ?? []).find((d) => discKeyMap[d.key]);
          if (topDisc) setActiveDiscipline(discKeyMap[topDisc.key]);
          if (saved.result.valuation?.project_id) setBottomTab("valuation");
          else if (saved.result.components?.length) setBottomTab("components");
          message.info("已恢复上次的图纸解析结果");
        } else if (saved.taskId) {
          void api.getDrawingResult(saved.taskId).then((data) => {
            if (data) {
              setResult(data);
              message.info("已恢复上次的图纸解析结果");
            }
          }).catch(() => undefined);
        }
      }
    } catch { /* 忽略缓存读取失败 */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 会话持久化：任务号 / 文件名 / 结果变化时写入；上传中跳过以免覆盖旧缓存
  useEffect(() => {
    if ((!taskId && !result) || uploading) return;
    try {
      sessionStorage.setItem(DR_SESSION_KEY, JSON.stringify({ taskId, fileName, result }));
    } catch {
      try { sessionStorage.setItem(DR_SESSION_KEY, JSON.stringify({ taskId, fileName })); } catch { /* 忽略配额超限 */ }
    }
  }, [taskId, fileName, result, uploading]);

  // 缩放/平移视图同步：状态变化时直写 DOM transform。
  // 混合策略（兼顾核显性能与清晰度）：滚轮/拖拽手势后的 180ms 内用 3D 变换走
  // GPU 合成层（缩放零重绘，不卡）；停止后由 settle 定时器切回 2D 变换，浏览器
  // 按最终比例重新光栅化 SVG，放大恢复清晰。
  useEffect(() => {
    viewRef.current = view;
    const node = stageTransformRef.current;
    if (!node) return;
    const interacting = performance.now() - lastGestureTsRef.current < 180;
    if (zoomSettleTimerRef.current != null) {
      clearTimeout(zoomSettleTimerRef.current);
      zoomSettleTimerRef.current = null;
    }
    if (interacting) {
      node.style.willChange = "transform";
      node.style.transform = `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`;
      zoomSettleTimerRef.current = window.setTimeout(() => {
        zoomSettleTimerRef.current = null;
        node.style.willChange = "";
        const v = viewRef.current;
        node.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.scale})`;
      }, 200);
    } else {
      node.style.willChange = "";
      node.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    }
  }, [view]);

  useEffect(() => () => {
    if (zoomSettleTimerRef.current != null) clearTimeout(zoomSettleTimerRef.current);
  }, []);

  useEffect(() => {
    if (revealTimerRef.current) clearInterval(revealTimerRef.current);
    const count = result?.components?.length ?? 0;
    if (!count || (!result?.preview_svg_hd && !result?.preview_svg && !result?.cad_geometry?.bbox)) {
      setRevealIndex(0);
      return;
    }
    setRevealIndex(0);
    // 解析完成后一次性显示全部高亮，避免持续操作大量 SVG 节点造成卡顿
    if (result?.status === "done") {
      setRevealIndex(count);
      return;
    }
    // 拖动期间暂停 reveal 动画，避免拖动时 setInterval 触发 DOM 操作导致掉帧
    if (dragging) return;
    revealTimerRef.current = setInterval(() => {
      setRevealIndex((current) => {
        if (current >= count) {
          if (revealTimerRef.current) clearInterval(revealTimerRef.current);
          return current;
        }
        return current + 1;
      });
    }, result.status === "processing" ? 420 : 240);
    return () => {
      if (revealTimerRef.current) clearInterval(revealTimerRef.current);
    };
  }, [result?.components?.length, result?.preview_svg, result?.preview_svg_hd, result?.cad_geometry, result?.status, dragging]);

  useEffect(() => {
    setView({ scale: 1, x: 0, y: 0 });
    setDragging(false);
  }, [taskId]);

  const [svgMountReady, setSvgMountReady] = useState(false);
  useEffect(() => {
    if (result?.status === "done" && (result.preview_svg_hd || result.preview_svg || result.cad_geometry?.bbox)) {
      const timer = window.setTimeout(() => setSvgMountReady(true), 350);
      return () => window.clearTimeout(timer);
    }
    setSvgMountReady(false);
    return undefined;
  }, [result?.status, result?.preview_svg, result?.preview_svg_hd, result?.cad_geometry]);

  // 内置 CAD 快速看图（WebGL）几何数据：优先于 SVG 预览使用，
  // 数万图元一次 draw call 渲染，缩放平移不卡顿
  const cadGeometry = useMemo<CadGeometry | null>(() => {
    if (result?.status === "processing") return null;
    if (!svgMountReady) return null;
    const geo = result?.cad_geometry;
    if (!geo || !geo.bbox) return null;
    return geo;
  }, [result?.cad_geometry, result?.status, svgMountReady]);

  // ezdxf 专业绘图引擎渲染的高清原图：优先于 WebGL 几何模式显示
  const cadRaster = useMemo<CadRaster | null>(() => {
    if (result?.status === "processing") return null;
    if (!svgMountReady) return null;
    const r = result?.cad_raster;
    if (!r || !r.data_url) return null;
    return r;
  }, [result?.cad_raster, result?.status, svgMountReady]);

  const previewSvg = useMemo(() => {
    // 解析进行中不挂载预览 SVG：大图纸的预览有上万图元，边解析边渲染会拖死主线程。
    // 完成后由分帧挂载（svgChunkMount effect）逐块插入，避免一次性 innerHTML 卡死。
    if (result?.status === "processing") return "";
    if (!svgMountReady) return "";
    const hd = result?.preview_svg_hd || "";
    const sd = result?.preview_svg || "";
    // 高清版超过 4.5MB 时退回标清版（分帧也扛不住的超大图，牺牲清晰度保流畅）
    if (hd.length > 4_500_000 && sd) return sd;
    return hd || sd;
  }, [result?.preview_svg, result?.preview_svg_hd, result?.status, svgMountReady]);

  // 有可显示的图纸内容（WebGL 看图优先，SVG 兜底）
  const hasDrawing = cadGeometry != null || cadRaster != null || previewSvg !== "";

  // 预览挂载：常规图直接 innerHTML（源头已压缩，节点数可控）；
  // 超大 SVG（>800KB 兜底）走 Blob URL + <img> 光栅化，避免数万节点拖死渲染。
  const svgHostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;
    if (!previewSvg) {
      host.innerHTML = "";
      return;
    }
    if (previewSvg.length > 800_000) {
      let blobUrl = "";
      try {
        const blob = new Blob([previewSvg], { type: "image/svg+xml;charset=utf-8" });
        blobUrl = URL.createObjectURL(blob);
      } catch {
        blobUrl = "";
      }
      if (blobUrl) {
        host.innerHTML = "";
        const img = document.createElement("img");
        img.src = blobUrl;
        img.alt = "图纸预览";
        img.className = "dr-svg-bitmap";
        img.draggable = false;
        host.appendChild(img);
        return () => {
          img.src = "";
          URL.revokeObjectURL(blobUrl);
        };
      }
    }
    host.innerHTML = previewSvg;
    return () => {
      host.innerHTML = "";
    };
  }, [previewSvg]);

  // 直接操作 DOM 推进高亮 reveal
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;
    const groups = host.querySelectorAll<SVGElement>(".dr-recognition-highlight");
    groups.forEach((node, index) => {
      const visible = index < revealIndex;
      const current = index === revealIndex - 1;
      node.classList.toggle("is-visible", visible);
      node.classList.toggle("is-current", current);
    });
  }, [revealIndex, previewSvg]);

  const poll = (id: string) => {
    if (timerRef.current) clearInterval(timerRef.current);
    let componentsShown = false;
    let failures = 0;
    // 完整结果（含数 MB 预览 SVG）只在识别完成与计价完成时各拉一次；
    // 识别完成后计价仍在进行期间，若每 1.2s 都重拉完整结果，7MB 下载+解析
    // 会反复打满主线程，页面表现为卡死。中间轮询一律用轻量数据。
    let fullFetched = false;
    let finalFetched = false;
    timerRef.current = setInterval(async () => {
      try {
        const data = await api.getDrawingResult(id, false);
        failures = 0;
        const recognitionDone = data.status === "done" || data.status === "error";
        const valuationDone = data.valuation_status === "done" || data.valuation_status === "error" || data.valuation_status === "skipped";
        if (data.status !== "processing" && !fullFetched) {
          fullFetched = true;
          setResult(await api.getDrawingResult(id));
        } else if (recognitionDone && valuationDone && !finalFetched) {
          finalFetched = true;
          setResult(await api.getDrawingResult(id));
        } else if (data.status === "processing") {
          setResult(data);
        } else {
          // 识别已完成：只同步计价进度字段，不重复挂载大 SVG
          setResult((prev) => prev ? {
            ...prev,
            valuation: data.valuation ?? prev.valuation,
            valuation_status: data.valuation_status,
            valuation_progress: data.valuation_progress,
            valuation_progress_percent: data.valuation_progress_percent,
            valuation_error: data.valuation_error,
          } : data);
        }
        if (recognitionDone && !componentsShown && data.components?.length > 0) {
          setBottomTab("components");
          // 解析结果包含给排水/电气/暖通/消防等安装专业时，自动切换到对应专业底图
          const discKeyMap: Record<string, string> = { civil: "architecture", water: "water", electrical: "electrical", hvac: "hvac", fire: "fire" };
          const topDisc = (data.disciplines ?? []).find((d) => discKeyMap[d.key]);
          if (topDisc) setActiveDiscipline(discKeyMap[topDisc.key]);
          componentsShown = true;
        }
        if (recognitionDone && valuationDone) {
          if (timerRef.current) clearInterval(timerRef.current);
          if (data.status === "done") {
            const projectId = data.valuation?.project_id;
            const created = data.valuation?.boq_items_created ?? data.boq_suggestions?.length ?? 0;
            const matched = data.valuation?.matched ?? 0;
            if (projectId) {
              message.success(`图纸识别完成，已自动创建项目并匹配定额：清单 ${created} 条，已匹配定额 ${matched} 条`);
              setBottomTab("valuation");
            } else if (data.valuation_error) {
              message.warning(`图纸识别完成，但自动计价未成功：${data.valuation_error}`);
            } else {
              message.success("图纸识别完成，可查看构件和清单建议");
            }
          } else {
            message.error(data.error || data.valuation_error || "图纸解析失败");
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "查询图纸解析任务失败";
        if (msg.includes("任务不存在")) {
          // 后端重启会丢失任务，明确告知而不是无限轮询
          if (timerRef.current) clearInterval(timerRef.current);
          message.error("解析任务已丢失（后端服务可能重启过），请重新上传图纸");
          return;
        }
        // 瞬时错误容忍：连续 5 次失败才放弃，避免一次网络抖动中断跟踪
        failures += 1;
        if (failures >= 5) {
          if (timerRef.current) clearInterval(timerRef.current);
          message.error(msg);
        }
      }
    }, 1200);
  };

  const uploadProps: UploadProps = {
    accept: ".dwg,.dxf,.pdf,.png,.jpg,.jpeg",
    showUploadList: false,
    beforeUpload: async (file) => {
      if (file.size > 100 * 1024 * 1024) {
        message.error("图纸文件超过 100MB 上限，请压缩或拆分后再上传");
        return Upload.LIST_IGNORE;
      }
      setUploading(true);
      setFileName(file.name);
      setResult(null);
      setRevealIndex(0);
      setUploadSimPct(0);
      // 0-100 平滑上传进度模拟：上传期间渐进逼近 92%，完成后补齐到 100%
      let sim = 0;
      setUploadSimPct(0);
      const simTimer = setInterval(() => {
        sim = Math.min(92, sim + Math.max(0.6, (92 - sim) * 0.06));
        setUploadSimPct(Math.round(sim));
      }, 90);
      try {
        const res = await api.uploadDrawing(file);
        clearInterval(simTimer);
        setUploadSimPct(100);
        setTaskId(res.taskId);
        message.success("图纸已上传，正在解析并生成计价项目");
        poll(res.taskId);
      } catch (err) {
        clearInterval(simTimer);
        message.error(err instanceof Error ? err.message : "上传失败");
      } finally {
        setTimeout(() => setUploading(false), 300);
      }
      return false;
    },
  };

  const exportResult = async () => {
    if (!taskId) return;
    try {
      const blob = await api.exportDrawingResult(taskId);
      downloadBlob(blob, `drawing-result-${taskId}.xlsx`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "导出失败");
    }
  };

  const resetView = () => setView({ scale: 1, x: 0, y: 0 });
  const zoomBy = (delta: number) => setView((c) => ({ ...c, scale: clampDrawingScale(c.scale + delta) }));

  const loadModelElements = async (token: number) => {
    try {
      const res = await fetch(MODEL_JSON_URL);
      if (token !== buildTokenRef.current) return;
      if (!res.ok) throw new Error(`模型数据加载失败 (${res.status})`);
      const raw = (await res.json()) as { elements?: Element3D[] };
      if (token !== buildTokenRef.current) return;
      const elements = Array.isArray(raw.elements) ? raw.elements : [];
      if (!elements.length) throw new Error("模型数据为空");
      setModelElements(elements);
      setModelProgress(100);
      setModelView("model");
    } catch (err) {
      if (token !== buildTokenRef.current) return;
      message.error(err instanceof Error ? err.message : "模型构建失败");
      setModelView("drawing");
    }
  };

  const startModelBuild = () => {
    if (modelView !== "drawing" || result?.status !== "done" || !hasDrawing) return;
    buildTokenRef.current += 1;
    const token = buildTokenRef.current;
    if (buildTimerRef.current) clearInterval(buildTimerRef.current);
    let buildSteps = 0;
    setBottomTab(null);
    setPanelOpen(false);
    setModelView("building");
    setModelProgress(0);
    buildTimerRef.current = setInterval(() => {
      buildSteps += 1;
      const next = Math.min(96, Math.round((buildSteps / 12) * 96));
      setModelProgress(next);
      if (next >= 96) {
        if (buildTimerRef.current) {
          clearInterval(buildTimerRef.current);
          buildTimerRef.current = null;
        }
        void loadModelElements(token);
      }
    }, 320);
  };

  const exitModel = () => {
    buildTokenRef.current += 1;
    if (buildTimerRef.current) {
      clearInterval(buildTimerRef.current);
      buildTimerRef.current = null;
    }
    setModelView("drawing");
    setModelProgress(0);
    setPanelOpen(true);
  };

  const stageRef = useRef<HTMLDivElement | null>(null);

  const handleCanvasWheel = (event: WheelEvent<HTMLDivElement>) => {
    // CAD 看图组件自带滚轮缩放，这里不接管
    if (modelView !== "drawing" || !previewSvg || cadGeometry || cadRaster) return;
    event.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    // 以鼠标位置为锚点缩放，放大后鼠标下的图纸点保持在原位
    const rect = stage.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const factor = event.deltaY > 0 ? 0.88 : 1.12;
    lastGestureTsRef.current = performance.now();
    setView((c) => {
      const nextScale = clampDrawingScale(c.scale * factor);
      if (nextScale === c.scale) return c;
      const ratio = nextScale / c.scale;
      return {
        scale: nextScale,
        x: px - (px - c.x) * ratio,
        y: py - (py - c.y) * ratio,
      };
    });
  };

  const handleCanvasMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    // CAD 看图组件自带拖拽平移，这里不接管
    if (modelView !== "drawing" || !previewSvg || cadGeometry || cadRaster || event.button !== 0) return;
    setDragging(true);
    dragStartRef.current = { pointerX: event.clientX, pointerY: event.clientY, viewX: view.x, viewY: view.y };
    dragLatestRef.current = { dx: 0, dy: 0 };
  };

  const handleCanvasMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const s = dragStartRef.current;
    dragLatestRef.current = { dx: event.clientX - s.pointerX, dy: event.clientY - s.pointerY };
    if (dragRafRef.current != null) return;
    dragRafRef.current = requestAnimationFrame(() => {
      dragRafRef.current = null;
      lastGestureTsRef.current = performance.now();
      const delta = dragLatestRef.current;
      if (!delta) return;
      const base = dragStartRef.current;
      const next = { ...viewRef.current, x: base.viewX + delta.dx, y: base.viewY + delta.dy };
      viewRef.current = next;
      // 拖拽期间直接写 DOM，绕过 React 渲染；松手后一次性同步回状态。
      // 这里故意用 3D translate：拖拽走 GPU 合成层纯平移（纹理已按当前缩放比例光栅化，
      // 不会糊），避免每帧全量重绘大 SVG 造成卡顿；松手后视图同步 effect 会切回 2D 变换。
      const node = stageTransformRef.current;
      if (node) node.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.scale})`;
    });
  };

  const stopDragging = () => {
    if (!dragging) return;
    if (dragRafRef.current != null) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    const delta = dragLatestRef.current;
    if (delta) {
      const base = dragStartRef.current;
      setView((c) => ({ ...c, x: base.viewX + delta.dx, y: base.viewY + delta.dy }));
    }
    dragLatestRef.current = null;
    setDragging(false);
  };

  const resetSession = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    buildTokenRef.current += 1;
    if (buildTimerRef.current) {
      clearInterval(buildTimerRef.current);
      buildTimerRef.current = null;
    }
    sessionStorage.removeItem(DR_SESSION_KEY);
    setSvgMountReady(false);
    setTaskId("");
    setFileName("");
    setResult(null);
    setRevealIndex(0);
    setBottomTab(null);
    setModelView("drawing");
    setModelProgress(0);
    setView({ scale: 1, x: 0, y: 0 });
    message.info("已清空解析结果，可重新上传图纸");
  };

  const progress = uploading && !result ? Math.max(uploadSimPct, 1) : percentFromResult(result);
  const currentComponent = result?.components?.[Math.max(0, Math.min(revealIndex - 1, (result?.components?.length ?? 1) - 1))];
  const compCount = result?.components?.length ?? 0;
  const boqCount = result?.boq_suggestions?.length ?? 0;
  const diagCount = result?.diagnostics?.length ?? 0;

  const COMPONENT_COLORS: Record<string, string> = {
    "框架柱": "#2563eb", "构造柱": "#3b82f6", "圈梁": "#60a5fa",
    "框架梁": "#059669", "连梁": "#10b981", "过梁": "#34d399",
    "剪力墙": "#d97706", "墙": "#f59e0b",
    "楼板": "#7c3aed", "板": "#8b5cf6",
    "基础": "#db2777", "楼梯": "#0d9488",
    "门": "#f97316", "窗": "#38bdf8",
    "钢筋": "#dc2626",
    "消防管道": "#dc2626", "喷淋头": "#ef4444", "消火栓": "#dc2626", "消防设备器具": "#f43f5e",
    "给排水管道": "#0ea5e9", "阀门": "#0284c7", "卫生洁具": "#14b8a6",
    "电气配管": "#f59e0b", "电缆电线": "#eab308", "电缆桥架": "#d97706", "电气设备器具": "#fb923c",
    "通风风管": "#6366f1", "暖通设备": "#8b5cf6", "风管部件": "#6366f1",
    "防水层": "#0891b2", "保温隔热层": "#0d9488", "涂料": "#eab308",
    "吊顶": "#a3a3a3", "楼地面": "#78716c", "墙面抹灰": "#d6d3d1",
    "防雷接地": "#facc15", "弱电系统": "#fbbf24",
    "阳台": "#a855f7", "雨篷": "#c084fc",
    "管道支架": "#64748b", "土方工程": "#92400e",
    "脚手架": "#78350f", "模板工程": "#854d0e",
  };

  const componentSummary = useMemo(() => {
    if (!result?.components?.length) return [];
    const summary: Record<string, { type: string; count: number; quantity: number; unit: string }> = {};
    for (const c of result.components) {
      if (!summary[c.type]) {
        summary[c.type] = { type: c.type, count: 0, quantity: 0, unit: c.unit };
      }
      summary[c.type].count += c.count;
      summary[c.type].quantity += c.quantity_estimate || 0;
    }
    return Object.values(summary).sort((a, b) => b.count - a.count);
  }, [result?.components]);

  type DrawingComponent = NonNullable<DrawingResult["components"]>[number];
  const componentsByType = useMemo(() => {
    const grouped = new Map<string, DrawingComponent[]>();
    for (const component of result?.components ?? []) {
      const list = grouped.get(component.type);
      if (list) {
        list.push(component);
      } else {
        grouped.set(component.type, [component]);
      }
    }
    return grouped;
  }, [result?.components]);

  return (
    <div className="dr-root">
      {/* 顶部工具栏 */}
      <header className="dr-topbar">
        <div className="dr-topbar-left">
          <span className="material-symbols-outlined dr-topbar-icon">architecture</span>
          <div>
            <h1 className="dr-topbar-title">图纸解析套价</h1>
            {modelView !== "drawing" ? (
              <span className="dr-topbar-file">{fileName || MODEL_DISPLAY_NAME}</span>
            ) : fileName ? (
              <span className="dr-topbar-file">{fileName}</span>
            ) : (
              <span className="dr-topbar-sub">DWG · DXF · PDF · PNG</span>
            )}
          </div>
        </div>
        <div className="dr-topbar-actions">
          <Upload {...uploadProps}>
            <Button type="primary" icon={<CloudUploadOutlined />} loading={uploading}>上传</Button>
          </Upload>
          {result?.status === "done" && hasDrawing && (
            <Button
              type={modelView === "drawing" ? "primary" : "default"}
              icon={modelView === "drawing" ? <BuildOutlined /> : <ArrowLeftOutlined />}
              loading={modelView === "building"}
              onClick={modelView === "drawing" ? startModelBuild : exitModel}
            >
              {modelView === "drawing" ? "自动构建模型" : modelView === "building" ? "构建中..." : "返回图纸"}
            </Button>
          )}
          {(taskId || result) && (
            <Button icon={<ClearOutlined />} onClick={resetSession}>重新开始</Button>
          )}
          <Button icon={<DownloadOutlined />} disabled={!taskId || result?.status !== "done"} onClick={exportResult}>导出</Button>
          {result?.valuation?.project_id && (
            <Button type="primary" ghost onClick={() => navigate(`/projects/${result.valuation!.project_id}`)}>进入项目</Button>
          )}
        </div>
      </header>

      {/* 全屏图纸区 */}
      <div
        ref={stageRef}
        className={`dr-stage${dragging ? " is-dragging" : ""}`}
        onWheel={handleCanvasWheel}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={stopDragging}
        onMouseLeave={stopDragging}
      >
        {modelView === "drawing" ? (
          <>
        <div className="dr-stage-grid" />

        {(uploading || result?.status === "processing") && <Recognition3DOverlay />}

        {/* 顶部专业切换工具条（常驻） */}
        <div className="dr-cad-toolbar">
          {DISCIPLINES.map((disc) => {
            const parsed = (result?.disciplines ?? []).some(
              (d) => d.key === (disc.key === "architecture" ? "civil" : disc.key),
            );
            return (
              <button
                key={disc.key}
                type="button"
                className={`dr-cad-tool${activeDiscipline === disc.key ? " active" : ""}`}
                onClick={() => setActiveDiscipline(disc.key)}
                title={parsed ? "解析结果包含该专业" : undefined}
              >
                <span className="material-symbols-outlined">{disc.icon}</span>
                {disc.label}
                {parsed && <i className="dr-cad-tool-dot" />}
              </button>
            );
          })}
        </div>

        {cadGeometry || cadRaster ? (
          /* 内置 CAD 快速看图：优先专业绘图引擎渲染的高清原图，
             WebGL 几何模式兜底；自带滚轮缩放/拖拽平移/双击复位 */
          <ErrorBoundary inline title="CAD 快速看图初始化失败">
            <CadCanvasViewer
              ref={cadViewerRef}
              geometry={cadGeometry ?? { bbox: null, groups: {}, highlights: [], texts: [] }}
              raster={cadRaster}
              revealIndex={revealIndex}
              revealTotal={compCount}
              className="dr-cad-viewer-host"
            />
          </ErrorBoundary>
        ) : previewSvg ? (
          <div ref={stageTransformRef} className="dr-stage-transform" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
            <div
              ref={svgHostRef}
              className={`dr-svg-preview is-hd is-revealing${result?.status === "processing" ? " is-fast" : ""}${result?.status === "done" ? " is-done" : ""}`}
            />
          </div>
        ) : (
          <div className="dr-cad-empty">
            <div className="dr-cad-grid" />
            <div className="dr-cad-vignette" />

            {/* 专业切换底图 */}
            <DisciplinePlaceholderSVG discipline={activeDiscipline} />

            {/* 十字光标 */}
            <div className="dr-cad-crosshair">
              <span className="dr-cad-cross-h" />
              <span className="dr-cad-cross-v" />
            </div>

            {/* 状态栏 */}
            <div className="dr-cad-statusbar">
              <span><span className="material-symbols-outlined">grid_on</span>坐标: 0.000, 0.000</span>
              <span><span className="material-symbols-outlined">straighten</span>单位: mm</span>
              <span><span className="material-symbols-outlined">layers</span>图层: 0</span>
              <span><span className="material-symbols-outlined">aspect_ratio</span>比例: 1:100</span>
              <span className="dr-cad-status-wait"><span className="material-symbols-outlined">hourglass_empty</span>等待图纸</span>
            </div>

            {/* 中央上传提示（解析中隐藏，避免挡住底图） */}
            <div className={`dr-cad-empty-hint${uploading || (progress > 0 && result?.status !== "done") ? " is-parsing" : ""}`}>
              <div className="dr-cad-hint-icon">
                <span className="material-symbols-outlined">upload_file</span>
              </div>
              <strong>上传图纸开始辅助解析</strong>
              <p>支持建筑、给排水、电气、暖通、消防全专业图纸，自动识别构件并套价</p>
              <Upload {...uploadProps}>
                <Button type="primary" size="large" icon={<CloudUploadOutlined />} loading={uploading}>
                  选择图纸文件
                </Button>
              </Upload>
              <div className="dr-cad-hint-steps">
                <span><span className="material-symbols-outlined">looks_one</span>识别构件</span>
                <span className="dr-cad-hint-arrow"><span className="material-symbols-outlined">arrow_forward</span></span>
                <span><span className="material-symbols-outlined">looks_two</span>生成清单</span>
                <span className="dr-cad-hint-arrow"><span className="material-symbols-outlined">arrow_forward</span></span>
                <span><span className="material-symbols-outlined">looks_3</span>匹配定额</span>
              </div>
              <div className="dr-cad-hint-formats">
                <span>DWG</span><span>DXF</span><span>PDF</span><span>PNG</span>
              </div>
            </div>
          </div>
        )}

        {/* 缩放控件（仅 SVG 预览模式；CAD 看图组件自带缩放控制） */}
        {previewSvg && !cadGeometry && !cadRaster && (
          <div className="dr-zoom-bar" onMouseDown={(e) => e.stopPropagation()}>
            <button type="button" className="dr-zoom-btn" onClick={() => zoomBy(-0.2)}><span className="material-symbols-outlined">zoom_out</span></button>
            <strong>{Math.round(view.scale * 100)}%</strong>
            <button type="button" className="dr-zoom-btn" onClick={() => zoomBy(0.2)}><span className="material-symbols-outlined">zoom_in</span></button>
            <span className="dr-zoom-sep" />
            <button type="button" className="dr-zoom-btn" onClick={resetView}><span className="material-symbols-outlined">fit_screen</span></button>
          </div>
        )}

        {/* 图纸复位（CAD 看图模式） */}
        {(cadGeometry || cadRaster) && (
          <div className="dr-zoom-bar" onMouseDown={(e) => e.stopPropagation()}>
            <button type="button" className="dr-zoom-btn" onClick={() => cadViewerRef.current?.reset()} title="图纸复位">
              <span className="material-symbols-outlined">fit_screen</span>
            </button>
            <strong>复位</strong>
          </div>
        )}

        {/* 左上 KPI 浮层 */}
        <div className="dr-float-kpi">
          <div className="dr-float-kpi-item">
            <span className="material-symbols-outlined">widgets</span>
            <strong>{compCount}</strong><em>构件</em>
          </div>
          <div className="dr-float-kpi-item">
            <span className="material-symbols-outlined">list_alt</span>
            <strong>{boqCount}</strong><em>清单</em>
          </div>
          <div className="dr-float-kpi-item">
            <span className="material-symbols-outlined">link</span>
            <strong>{result?.valuation?.matched ?? 0}</strong><em>定额</em>
          </div>
          <div className="dr-float-kpi-item highlight">
            <span className="material-symbols-outlined">request_quote</span>
            <strong>{moneyShort(result?.valuation?.grand_total)}</strong><em>造价</em>
          </div>
        </div>

        {/* 解析进度：底部细条，不遮挡底图 */}
        {(progress > 0 || uploading) && result?.status !== "done" && (
          <div className="dr-float-progress is-parsing">
            <div className="dr-float-progress-head">
              <span>{uploading ? "上传中..." : result?.progress || result?.valuation_progress || "解析中"}</span>
              <strong>{progress}%</strong>
            </div>
            <div className="dr-progress-track dr-progress-track-flow">
              <div className="dr-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            {currentComponent && (
              <div className="dr-float-reveal">
                <span className="material-symbols-outlined">auto_awesome_motion</span>
                {currentComponent.type} {currentComponent.spec || ""}
              </div>
            )}
          </div>
        )}

        {/* 右侧面板切换按钮 */}
        <button
          type="button"
          className={`dr-panel-toggle${panelOpen ? " is-open" : ""}`}
          onClick={() => setPanelOpen((v) => !v)}
          title={panelOpen ? "收起面板" : "展开面板"}
        >
          <span className="material-symbols-outlined">{panelOpen ? "chevron_right" : "chevron_left"}</span>
        </button>

        {/* 右侧信息面板 */}
        {panelOpen && (
          <aside className="dr-float-panel">
            <div className="dr-float-panel-scroll">
              <div className="dr-zh-card">
                <div className="dr-zh-card-head">
                  <h3><span className="material-symbols-outlined">fact_check</span>解析状态</h3>
                  <span className={`dr-confidence-badge ${result?.status === "error" ? "error" : result?.status === "done" ? "real" : "working"}`}>
                    {result?.status === "done" ? "完成" : result?.status === "error" ? "失败" : taskId ? "解析中" : "待上传"}
                  </span>
                </div>
                <p className="dr-summary">{result?.summary || "待上传"}</p>
              </div>

              {result?.quality_score && (
                <div className="dr-zh-card dr-quality-card">
                  <div className="dr-zh-card-head">
                    <h3><span className="material-symbols-outlined">verified</span>解析质量</h3>
                    <span className={`dr-quality-level level-${result.quality_score.level}`}>{result.quality_score.level} 级</span>
                  </div>
                  <div className="dr-quality-score-row">
                    <div className="dr-quality-score-ring">
                      <span className="dr-quality-score-num">{result.quality_score.score}</span>
                      <span className="dr-quality-score-unit">分</span>
                    </div>
                    <div className="dr-quality-metrics">
                      <div className="dr-quality-metric"><span>覆盖</span><strong>{Math.round(result.quality_score.coverage * 100)}%</strong></div>
                      <div className="dr-quality-metric"><span>置信</span><strong>{result.quality_score.avg_confidence}%</strong></div>
                      <div className="dr-quality-metric"><span>完整</span><strong>{Math.round(result.quality_score.completeness * 100)}%</strong></div>
                      <div className="dr-quality-metric"><span>规格</span><strong>{Math.round(result.quality_score.spec_extraction_rate * 100)}%</strong></div>
                    </div>
                  </div>
                  {result.quality_score.issues.length > 0 && (
                    <ul className="dr-quality-issues">
                      {result.quality_score.issues.map((issue, i) => (
                        <li key={i}><span className="material-symbols-outlined">warning</span>{issue}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {result?.disciplines && result.disciplines.length > 0 && (
                <div className="dr-zh-card dr-discipline-card">
                  <div className="dr-zh-card-head">
                    <h3><span className="material-symbols-outlined">category</span>专业</h3>
                    <span className="dr-discipline-count">{result.disciplines.length}</span>
                  </div>
                  <div className="dr-discipline-list">
                    {result.disciplines.map((d) => (
                      <div key={d.key} className={`dr-discipline-item disc-${d.key}`}>
                        <span className="dr-discipline-dot" />
                        <span className="dr-discipline-name">{d.name}</span>
                        <span className="dr-discipline-ratio">{Math.round(d.ratio * 100)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {componentSummary.length > 0 && (
                <div className="dr-zh-card dr-component-summary-card">
                  <div className="dr-zh-card-head">
                    <h3><span className="material-symbols-outlined">widgets</span>构件汇总</h3>
                    <span className="dr-discipline-count">{compCount}类</span>
                  </div>
                  <div className="dr-component-summary-list">
                    {componentSummary.slice(0, 12).map((item) => (
                      <div key={item.type} className="dr-component-summary-item">
                        <span
                          className="dr-component-dot"
                          style={{ backgroundColor: COMPONENT_COLORS[item.type] || "#64748b" }}
                        />
                        <span className="dr-component-name">{item.type}</span>
                        <span className="dr-component-count">{item.count}个</span>
                        <span className="dr-component-qty">
                          {item.quantity > 0 ? `${item.quantity.toFixed(1)}${item.unit}` : ""}
                        </span>
                      </div>
                    ))}
                    {componentSummary.length > 12 && (
                      <div className="dr-component-more">还有 {componentSummary.length - 12} 类构件...</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}

        {/* 底部 Tab 触发条 */}
        <div className="dr-bottom-bar">
          <button type="button" className={`dr-bottom-tab${bottomTab === "components" ? " active" : ""}`} onClick={() => setBottomTab(bottomTab === "components" ? null : "components")}>
            <span className="material-symbols-outlined">widgets</span>构件 <em>{compCount}</em>
          </button>
          <button type="button" className={`dr-bottom-tab${bottomTab === "boq" ? " active" : ""}`} onClick={() => setBottomTab(bottomTab === "boq" ? null : "boq")}>
            <span className="material-symbols-outlined">list_alt</span>清单 <em>{boqCount}</em>
          </button>
          <button type="button" className={`dr-bottom-tab${bottomTab === "valuation" ? " active" : ""}`} onClick={() => setBottomTab(bottomTab === "valuation" ? null : "valuation")}>
            <span className="material-symbols-outlined">request_quote</span>计价
          </button>
          <button type="button" className={`dr-bottom-tab${bottomTab === "diagnostics" ? " active" : ""}`} onClick={() => setBottomTab(bottomTab === "diagnostics" ? null : "diagnostics")}>
            <span className="material-symbols-outlined">bug_report</span>诊断 <em>{diagCount}</em>
          </button>
        </div>

        {/* 底部抽屉 */}
        {bottomTab && (
          <div className="dr-drawer" onMouseDown={(e) => e.stopPropagation()}>
            <div className="dr-drawer-head">
              <h3>{bottomTab === "components" ? "识别构件" : bottomTab === "boq" ? "清单建议" : bottomTab === "valuation" ? "计价复核" : "诊断信息"}</h3>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {bottomTab === "valuation" && result?.valuation?.project_id && (
                  <Button
                    type="primary"
                    size="small"
                    onClick={() => navigate(`/projects/${result?.valuation?.project_id}`)}
                  >
                    进入项目
                  </Button>
                )}
                <button type="button" className="dr-drawer-close" onClick={() => setBottomTab(null)}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
            </div>
            <div className="dr-drawer-body">
              {bottomTab === "components" && (
                compCount === 0 ? <Empty description="暂无识别构件" /> : (
                  <div className="dr-table-wrap">
                    <table className="dr-data-table">
                      <thead><tr><th style={{ width: 44 }} /><th>类型</th><th style={{ width: 70 }}>数量</th><th>规格</th><th style={{ width: 60 }}>单位</th><th style={{ width: 100 }}>工程量</th><th style={{ width: 80 }}>置信度</th><th>说明</th></tr></thead>
                      <tbody>
                        {componentSummary.map((grp) => {
                          const open = expandedGroups[grp.type] ?? false;
                          const items = componentsByType.get(grp.type) ?? [];
                          const rowKey = `grp-${grp.type}`;
                          return [
                            <tr key={rowKey} className="dr-group-row" onClick={() => setExpandedGroups((m) => ({ ...m, [grp.type]: !open }))}>
                              <td>
                                <button type="button" className="dr-group-toggle" aria-label={open ? "收起" : "展开"}>
                                  <span className="material-symbols-outlined">{open ? "remove" : "add"}</span>
                                </button>
                              </td>
                              <td>
                                <span className="dr-component-dot" style={{ backgroundColor: COMPONENT_COLORS[grp.type] || "#64748b" }} />
                                <span className="dr-cell-type">{grp.type}</span>
                              </td>
                              <td>{grp.count}</td>
                              <td className="dr-cell-spec">共 {items.length} 类明细</td>
                              <td>{grp.unit}</td>
                              <td className="dr-cell-num">{grp.quantity > 0 ? grp.quantity.toFixed(2) : "-"}</td>
                              <td className="dr-cell-note" colSpan={2}>{open ? "点击收起" : "点击展开明细"}</td>
                            </tr>,
                            ...(open
                              ? items.map((c) => (
                                  <tr key={c.id} className="dr-detail-row">
                                    <td />
                                    <td><span className="dr-cell-type" style={{ marginLeft: 8 }}>{c.type}</span></td>
                                    <td>{c.count}</td>
                                    <td className="dr-cell-spec">{c.spec || "-"}</td>
                                    <td>{c.unit}</td>
                                    <td className="dr-cell-num">{c.quantity_estimate}</td>
                                    <td>{confTag(c.confidence)}</td>
                                    <td className="dr-cell-note">{c.calc_note || "-"}</td>
                                  </tr>
                                ))
                              : []),
                          ];
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              )}
              {bottomTab === "boq" && (
                boqCount === 0 ? <Empty description="暂无清单建议" /> : (
                  <div className="dr-table-wrap">
                    <table className="dr-data-table">
                      <thead><tr><th style={{ width: 120 }}>编码</th><th>名称</th><th style={{ width: 60 }}>单位</th><th style={{ width: 100 }}>工程量</th><th>特征</th><th style={{ width: 80 }}>置信度</th></tr></thead>
                      <tbody>
                        {(result?.boq_suggestions ?? []).map((b) => (
                          <tr key={b.source_component_id}>
                            <td className="dr-cell-code">{b.suggested_code}</td>
                            <td><span className="dr-cell-type">{b.suggested_name}</span></td>
                            <td>{b.suggested_unit}</td>
                            <td className="dr-cell-num">{b.suggested_quantity}</td>
                            <td className="dr-cell-spec">{b.characteristics || "-"}</td>
                            <td>{confTag(b.confidence)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
              {bottomTab === "valuation" && <ValuationReview valuation={result?.valuation} />}
              {bottomTab === "diagnostics" && (
                <div className="dr-diag-card">
                  <p className="dr-diag-summary">{result?.summary ?? "暂无解析摘要"}</p>
                  <div className="dr-diag-tags">
                    {(result?.diagnostics ?? []).map((item, i) => <Tag key={i}>{item}</Tag>)}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
          </>
        ) : modelView === "building" ? (
          <BuildingModelOverlay progress={modelProgress} modelName={fileName || MODEL_DISPLAY_NAME} />
        ) : (
          <div className="dr-model-host">
            <ErrorBoundary title="3D 视图无法显示" inline>
              <Ifc3DViewer elements={modelElements} sceneTitle={fileName ? `${fileName} · 自动构建模型` : MODEL_SCENE_TITLE} initialViewMode="model" buildAnimation />
            </ErrorBoundary>
          </div>
        )}
      </div>
      <FlowGuide current="drawings" />
    </div>
  );
}
