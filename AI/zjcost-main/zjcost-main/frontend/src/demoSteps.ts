/**
 * 筑衡 — 比赛现场演示导览脚本
 *
 * 每个步骤定义：目标路由、标题、讲解要点、预计停留时长
 * 演示者通过浮动控制面板或键盘快捷键（← →）切换步骤
 */

export interface DemoStep {
  /** 步骤序号（从 1 开始） */
  index: number;
  /** 目标路由 */
  route: string;
  /** 步骤标题 */
  title: string;
  /** 讲解要点（2-4 条，每条一句话） */
  points: string[];
  /** 预计停留时长（秒） */
  duration: number;
  /** 步骤图标（Material Symbols 名称） */
  icon: string;
}

export const DEMO_STEPS: DemoStep[] = [
  {
    index: 1,
    route: "/dashboard",
    title: "总控工作台",
    points: [
      "全过程工程造价协同管控平台 — 筑衡",
      "KPI 指标实时反映项目造价、计价进度、审计状态",
      "12 步造价流程进度条，点击可直达对应模块",
    ],
    duration: 60,
    icon: "query_stats",
  },
  {
    index: 2,
    route: "/projects",
    title: "项目台账",
    points: [
      "集中管理所有造价项目，支持按状态、类型筛选",
      "点击「创建演示项目」可一键生成含完整清单的示例项目",
      "进入项目详情即可展开清单管理、定额绑定、计价计算",
    ],
    duration: 45,
    icon: "folder_managed",
  },
  {
    index: 3,
    route: "/drawings",
    title: "图纸辅助识别",
    points: [
      "上传 DWG / DXF / PDF 图纸，自动识别构件并生成清单",
      "支持建筑、给排水、电气、暖通、消防五大专业",
      "识别完成后自动创建计价项目，无缝衔接后续流程",
    ],
    duration: 90,
    icon: "drawing",
  },
  {
    index: 4,
    route: "/pricing-audit",
    title: "清单计价",
    points: [
      "自动套用定额库，匹配市场价，生成综合单价",
      "支持人工调整、批量套定额、单价分析",
      "计价结果实时汇总，造价构成一目了然",
    ],
    duration: 75,
    icon: "calculate",
  },
  {
    index: 5,
    route: "/pricing-audit",
    title: "审计复核",
    points: [
      "辅助审计管线自动校验清单完整性、定额合理性、价格合规性",
      "标记风险项并给出修正建议",
      "复核通过后进入成果输出阶段",
    ],
    duration: 60,
    icon: "fact_check",
  },
  {
    index: 6,
    route: "/pricing-audit",
    title: "成果报表",
    points: [
      "一键生成造价成果报表，含清单、计价、材料汇总",
      "支持导出，满足交付归档要求",
      "全过程数据可追溯，符合审计规范",
    ],
    duration: 45,
    icon: "description",
  },
  {
    index: 7,
    route: "/ifc-walk-demo",
    title: "IFC 三维漫游核查",
    points: [
      "加载 IFC 模型，第一人称漫游核查建筑构件",
      "点击构件查看类型、材质、工程量信息",
      "可视化核对造价成果与设计模型的一致性",
    ],
    duration: 75,
    icon: "deployed_code",
  },
];

/** 演示总时长（秒） */
export const DEMO_TOTAL_DURATION = DEMO_STEPS.reduce((sum, s) => sum + s.duration, 0);
