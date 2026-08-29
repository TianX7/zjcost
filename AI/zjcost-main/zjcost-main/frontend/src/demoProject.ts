import { api, type Project } from "./api";

const DEMO_BOQ_ITEMS = [
  {
    code: "010401003001",
    name: "框架柱混凝土 C30",
    characteristics: "柱类型: 框架柱; 混凝土强度等级: C30; 泵送商品混凝土",
    unit: "m³",
    quantity: 86,
    division: "混凝土及钢筋混凝土工程",
  },
  {
    code: "010403002001",
    name: "矩形梁混凝土 C30",
    characteristics: "梁类型: 框架梁; 混凝土强度等级: C30; 泵送商品混凝土",
    unit: "m³",
    quantity: 142,
    division: "混凝土及钢筋混凝土工程",
  },
  {
    code: "010405001001",
    name: "有梁板混凝土 C30",
    characteristics: "板厚: 120mm; 混凝土强度等级: C30",
    unit: "m³",
    quantity: 235,
    division: "混凝土及钢筋混凝土工程",
  },
  {
    code: "010515001001",
    name: "现浇构件钢筋 HRB400",
    characteristics: "钢筋种类: HRB400; 直径综合",
    unit: "t",
    quantity: 64,
    division: "钢筋工程",
  },
  {
    code: "030404017001",
    name: "配电箱安装",
    characteristics: "规格: 落地/嵌入综合; 含接线调试",
    unit: "台",
    quantity: 18,
    division: "电气设备安装工程",
  },
];

export async function createDemoProject(): Promise<Project> {
  const project = await api.createProject({
    name: `筑衡演示项目 ${new Date().toLocaleDateString("zh-CN")}`,
    region: "默认区域",
    project_type: "公共建筑",
    budget: 3200000,
    owner: "演示用户",
    standard_type: "GB/T50500-2024",
    description: "用于验证图纸识别、IFC 自动套定额、全过程计价和审计流水线的本地演示项目。",
  });

  for (const item of DEMO_BOQ_ITEMS) {
    await api.createBoqItem(project.id, item);
  }

  try {
    await api.autoValuate(project.id);
    await api.calculate(project.id);
  } catch {
    // The demo project is still useful if matching/calculation requires more data.
  }

  return project;
}
