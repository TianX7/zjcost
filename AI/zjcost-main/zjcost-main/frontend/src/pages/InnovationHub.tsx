import type { CSSProperties, ReactNode } from "react";
import { Tag } from "antd";
import PageHeader from "../components/PageHeader";

/* ─────────────────────────────────────────────────────────────
 * 创新成果大屏总览：汇报第 4~7 段话术的可演示落地页
 * ① 五大创新点 ② 应用价值（工程/经济/可持续）③ 校企协同 ④ 项目总结
 * 纯静态展示，任何演示环境可开。
 * ───────────────────────────────────────────────────────────── */

interface Innovation {
  no: string;
  icon: string;
  color: string;
  title: string;
  sub: string;
  points: string[];
  chips: { label: string; color: string }[];
}

const INNOVATIONS: Innovation[] = [
  {
    no: "01",
    icon: "solar_power",
    color: "#38bdf8",
    title: "光伏建筑一体化三模块清单计价法",
    sub: "填补文保工程计价方法空白",
    points: ["光伏板材 / 支架 / 并网三模块清单化", "文保措施费显性化写入清单，一目了然", "估算偏差从 22% 收敛到 1.5% 以内"],
    chips: [
      { label: "估算偏差 22% → ≤1.5%", color: "#38bdf8" },
      { label: "文保措施费显性化", color: "#2dd4bf" },
    ],
  },
  {
    no: "02",
    icon: "automation",
    color: "#a78bfa",
    title: "AI 辅助绿色计价工作流",
    sub: "识图 · 算量 · 组价 · 复核审计全流程贯通",
    points: ["AI 自动匹配定额、荒漠调价系数自动套用、复核留痕", "贴合荒漠实际：运距 180km、技工日单价高 35%", "从图纸到成果报表一站式贯通"],
    chips: [
      { label: "组价效率提升 60%", color: "#a78bfa" },
      { label: "运距 180km · 技工日单价高 35%", color: "#f97316" },
    ],
  },
  {
    no: "03",
    icon: "recycling",
    color: "#34d399",
    title: "循环材料三级计价＋AI 损耗预测",
    sub: "回收价 · 加工价 · 运输价三级可追溯",
    points: ["三级价格逐级可追溯，审计争议 0 项", "旧砖综合单价 2.15 元/块", "损耗预测与传统经验值互证，偏差 ≤ 0.5 个百分点"],
    chips: [
      { label: "旧砖 2.15 元/块", color: "#fbbf24" },
      { label: "损耗偏差 ≤0.5pp", color: "#34d399" },
      { label: "审计争议 0 项", color: "#2dd4bf" },
    ],
  },
  {
    no: "04",
    icon: "monitoring",
    color: "#fbbf24",
    title: "零基预算＋全周期动态造价管控",
    sub: "每笔支出重新论证必要性",
    points: ["实测消耗量数据为论证基线", "四源数据关联、量价双控", "事后被动纠偏 → 事前主动防控"],
    chips: [
      { label: "施工成本偏差 1.3%", color: "#fbbf24" },
      { label: "预警提前 7~14 天", color: "#f97316" },
      { label: "变更响应 1.5 天", color: "#38bdf8" },
      { label: "支付审核准确率 99.2%", color: "#34d399" },
    ],
  },
  {
    no: "05",
    icon: "database",
    color: "#f97316",
    title: "荒漠特殊工艺补充定额与模板资产库",
    sub: "七项 AI 辅助技术能力链沉淀于筑衡",
    points: ["五项补充定额按 GS 编码入库", "编制方法可追溯：实测 · 测定 · 论证 · 类比 · 组合", "光伏三模块清单＋中水专项清单模板"],
    chips: [
      { label: "GS 编码入库 ×5", color: "#f97316" },
      { label: "财政评审“有据可查”", color: "#38bdf8" },
    ],
  },
];

const KPI_ITEMS = [
  { icon: "bolt", color: "#38bdf8", value: "60%", label: "组价效率提升", sub: "AI 自动匹配定额 · 荒漠调价系数自动套用" },
  { icon: "fact_check", color: "#34d399", value: "99.2%", label: "支付审核准确率", sub: "AI 支付校验 · 全程留痕" },
  { icon: "monitoring", color: "#fbbf24", value: "≤1.3%", label: "施工成本偏差", sub: "零基预算 · 量价双控" },
  { icon: "storm", color: "#f97316", value: "7~14 天", label: "风险预警提前", sub: "事前主动防控 · 变更响应 1.5 天" },
  { icon: "percent", color: "#a78bfa", value: "≤0.5pp", label: "损耗预测偏差", sub: "与传统经验值互证" },
  { icon: "payments", color: "#fbbf24", value: "2.15 元", label: "旧砖综合单价", sub: "元/块 · 三级可追溯" },
  { icon: "tune", color: "#38bdf8", value: "22%→1.5%", label: "估算偏差收敛", sub: "光伏三模块清单计价法" },
  { icon: "dataset", color: "#34d399", value: "7.5 年", label: "静态回收期", sub: "增量投资 12.8 万元 · 年净收益 1.7 万" },
];

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 style={{ margin: "2px 0 12px", fontSize: 15, color: "#e2e8f0" }}>{children}</h3>;
}

function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="content-card" style={style}>
      <div className="content-card-body">{children}</div>
    </div>
  );
}

export default function InnovationHub() {
  return (
    <div className="page-container">
      <PageHeader
        icon="workspace_premium"
        title="成果总览 · 五大创新"
        subtitle="四项技能凝练为五大创新点，落地于筑衡平台；以工程、经济、可持续三重价值与人才成效，交出一份真实可演示的答卷。"
      />

      {/* 关键成果 KPI */}
      <div>
        <SectionTitle>关键成果数据</SectionTitle>
        <div className="kpi-grid">
          {KPI_ITEMS.map((k) => (
            <div className="kpi-card" key={k.label}>
              <div className="kpi-card-icon" style={{ color: k.color }}>
                <span className="material-symbols-outlined">{k.icon}</span>
              </div>
              <div className="kpi-card-body">
                <span className="kpi-card-label">{k.label}</span>
                <div style={{ fontSize: 22, fontWeight: 700, color: k.color, lineHeight: 1.25 }}>{k.value}</div>
                <span className="kpi-card-sub" style={{ display: "block", fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>{k.sub}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 五大创新 */}
      <div>
        <SectionTitle>五大创新点</SectionTitle>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {INNOVATIONS.map((inn) => (
            <Card key={inn.no} style={{ flex: 1, minWidth: 216, maxWidth: 268, background: "linear-gradient(180deg, rgba(19,45,82,0.5), var(--bg-surface))" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span className="material-symbols-outlined" style={{ color: inn.color, fontSize: 26 }}>{inn.icon}</span>
                <span style={{ fontSize: 22, fontWeight: 800, color: "rgba(226,232,240,0.28)", letterSpacing: 1 }}>{inn.no}</span>
                <div style={{ flex: 1 }} />
                <Tag color={inn.color}>创新 {inn.no.replace(/^0/, "")}</Tag>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", lineHeight: 1.35, marginBottom: 2 }}>{inn.title}</div>
              <div style={{ fontSize: 12, color: inn.color, marginBottom: 10 }}>{inn.sub}</div>
              <ul style={{ margin: "0 0 10px", paddingLeft: 16, color: "#94a3b8", fontSize: 12.5, lineHeight: 1.75 }}>
                {inn.points.map((p) => <li key={p}>{p}</li>)}
              </ul>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {inn.chips.map((c) => (
                  <span key={c.label} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, border: `1px solid ${c.color}55`, color: c.color, background: `${c.color}14` }}>
                    {c.label}
                  </span>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* 应用价值三价值 */}
      <div>
        <SectionTitle>应用价值：工程 · 经济 · 可持续</SectionTitle>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Card style={{ flex: 1, minWidth: 260 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span className="material-symbols-outlined" style={{ color: "#38bdf8" }}>engineering</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0" }}>工程应用</span>
            </div>
            <ul style={{ margin: 0, paddingLeft: 16, color: "#94a3b8", fontSize: 13, lineHeight: 1.85 }}>
              <li>五项荒漠补充定额与专项清单模板 → 财政评审参考依据，缓解“无据可依”</li>
              <li>三模块清单法＋AI 计价工作流用于投标报价，组价效率提升 60%</li>
              <li>零基预算＋动态管控实现全周期投资控制：成本偏差 ≤1.5%，预警提前 7~14 天</li>
            </ul>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
              {["荒漠文旅项目", "老旧小区修缮", "文化遗产保护"].map((t) => (
                <span key={t} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, border: "1px solid #38bdf855", color: "#38bdf8", background: "#38bdf814" }}>{t}</span>
              ))}
            </div>
          </Card>
          <Card style={{ flex: 1, minWidth: 260 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span className="material-symbols-outlined" style={{ color: "#34d399" }}>savings</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0" }}>经济效益</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#34d399", marginBottom: 8 }}>
              年净收益 1.7 万元 <span style={{ fontSize: 12, fontWeight: 400, color: "#64748b" }}>静态回收期 7.5 年</span>
            </div>
            <ul style={{ margin: 0, paddingLeft: 16, color: "#94a3b8", fontSize: 13, lineHeight: 1.85 }}>
              <li>建设期循环材料节约 3.2 万元</li>
              <li>运营期光伏年收益 1.2 万元＋中水回用年节约 0.5 万元</li>
              <li>光伏与中水增量投资约 12.8 万元</li>
              <li>降低无效支出 5% ~ 8%</li>
            </ul>
          </Card>
          <Card style={{ flex: 1, minWidth: 260 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span className="material-symbols-outlined" style={{ color: "#a78bfa" }}>eco</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0" }}>可持续性</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#a78bfa", marginBottom: 8 }}>
              年减碳 15 吨 <span style={{ fontSize: 12, fontWeight: 400, color: "#64748b" }}>年节水 2000 吨</span>
            </div>
            <ul style={{ margin: 0, paddingLeft: 16, color: "#94a3b8", fontSize: 13, lineHeight: 1.85 }}>
              <li>循环材料占比 35%~55%，建筑垃圾减量 4 吨</li>
              <li>光伏年发电 2.82 万度，契合“双碳”与智能建造趋势</li>
              <li>可逆式低扰动施工，最大程度保护遗址本体</li>
            </ul>
          </Card>
        </div>
      </div>

      {/* 校企协同与人才成效 */}
      <div>
        <SectionTitle>校企协同与人才成效</SectionTitle>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Card style={{ flex: 1, minWidth: 320 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span className="material-symbols-outlined" style={{ color: "#fbbf24" }}>groups</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0" }}>校企协同 · 五步贯穿、四步闭环</span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              {["一线需求选题", "企业岗位实践", "遗址现场踏勘", "模板资产沉淀", "企业成果验收"].map((s, i) => (
                <div key={s} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 8, border: "1px solid #fbbf2455", color: "#fbbf24", background: "#fbbf2414" }}>{s}</span>
                  {i < 4 && <span className="material-symbols-outlined" style={{ fontSize: 14, color: "#64748b" }}>arrow_forward</span>}
                </div>
              ))}
            </div>
            <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.8 }}>
              企业造价工程师与校内专业教师全程双导师指导；从一线真实工程需求选题，到企业参与行业适用性验收评估——校企协同贯穿项目始终、首尾闭环。
            </div>
          </Card>
          <div style={{ flex: 1.6, minWidth: 420, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            {[
              { icon: "precision_manufacturing", color: "#38bdf8", title: "技能落地", lines: ["BIM 计量误差 15% → 0.8%", "AI 损耗预测偏差 ≤0.5pp", "支付审核准确率 99.2%"] },
              { icon: "insights", color: "#34d399", title: "能力成长", lines: ["四类特殊工况：高盐·高温差·高风沙·缺水", "给排水 / 消防 / 生态回用三大系统", "四十余类清单项全部转化为可套价工程量"] },
              { icon: "workspace_premium", color: "#f97316", title: "职业素养", lines: ["诚信执业 · 工匠精神贯穿始终", "盐温沙水每个参数背后都是安全底线", "每一次取值都关乎工程质量"] },
              { icon: "rocket_launch", color: "#a78bfa", title: "成果转化", lines: ["可复制模板跨场景推广：口袋公园·文化遗产保护", "“疆废生金”省级金奖＋中央引导资金支持", "AI 计价平台＋VR 漫游→实训教学评价标准案例"] },
            ].map((b) => (
              <Card key={b.title}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span className="material-symbols-outlined" style={{ color: b.color, fontSize: 20 }}>{b.icon}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>{b.title}</span>
                </div>
                <ul style={{ margin: 0, paddingLeft: 16, color: "#94a3b8", fontSize: 12.5, lineHeight: 1.8 }}>
                  {b.lines.map((l) => <li key={l}>{l}</li>)}
                </ul>
              </Card>
            ))}
          </div>
        </div>
      </div>

      {/* 总结条 */}
      <div
        style={{
          borderRadius: 14,
          padding: "18px 22px",
          background: "linear-gradient(115deg, rgba(19,45,82,0.75), rgba(56,130,246,0.18))",
          border: "1px solid rgba(56,189,248,0.3)",
        }}
      >
        <div style={{ fontSize: 14, color: "#fde68a", fontWeight: 700, marginBottom: 6 }}>
          塞垣新筑 · 从课堂到遗址的逻辑闭环
        </div>
        <div style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.8 }}>
          从一线痛点出发，以校企协同“五步贯穿、四步闭环”工作法为纽带，以 BIM 数字化建模与 AI 辅助计价为技术路径，输出五大创新与可复制成果，交出了工程、经济、可持续三重价值与人才成效的答卷——筑的不仅是荒漠驿站，更是文化遗产守护与智能绿色建造的人才之基。
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>感谢各位评委、各位专家的倾听！</div>
      </div>
    </div>
  );
}