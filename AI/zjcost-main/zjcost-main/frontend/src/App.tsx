import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { App as AntApp, Button, Card, ConfigProvider, Form, Input, Space, theme, Typography } from "antd";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { API_BASE, AUTH_LOGOUT_EVENT, getAuthToken, setAuthToken } from "./client";
import TourGuide from "./components/TourGuide";
import ParticleBackdrop from "./components/ParticleBackdrop";
import { TourModeProvider, useTourMode } from "./tourMode";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const ProjectList = lazy(() => import("./pages/ProjectList"));
const ProjectDetail = lazy(() => import("./pages/ProjectDetail"));
const UnitPriceAnalysis = lazy(() => import("./pages/UnitPriceAnalysis"));
const DrawingRecognition = lazy(() => import("./pages/DrawingRecognition"));
const IfcParser = lazy(() => import("./pages/IfcParser"));
const WalkVerify = lazy(() => import("./WalkVerify"));
const QuantityCenter = lazy(() => import("./pages/QuantityCenter"));
const PvPowerPage = lazy(() => import("./pages/FacilityOpsPages").then((m) => ({ default: m.PvPowerPage })));
const WaterReusePage = lazy(() => import("./pages/FacilityOpsPages").then((m) => ({ default: m.WaterReusePage })));
const FacilityOpsPage = lazy(() => import("./pages/FacilityOpsPages").then((m) => ({ default: m.FacilityOpsPage })));
const DataResources = lazy(() => import("./pages/DataResources"));
const PricingAudit = lazy(() => import("./pages/PricingAudit"));
const SystemSettings = lazy(() => import("./pages/SystemSettings"));
const OldMaterialLibrary = lazy(() => import("./pages/OldMaterialLibrary"));
const DynamicControl = lazy(() => import("./pages/DynamicControl"));

const NAV_ITEMS = [
  { path: "/dashboard", icon: "query_stats", label: "总控工作台" },
  { path: "/projects", icon: "folder_managed", label: "项目台账" },
  { path: "/quantity-center", icon: "square_foot", label: "清单算量中心" },
  { path: "/drawings", icon: "draw", label: "图纸智能识别" },
  { path: "/ifc-parser", icon: "view_in_ar", label: "BIM 模型算量" },
  { path: "/pv-power", icon: "solar_power", label: "光伏发电监测" },
  { path: "/water-reuse", icon: "water_drop", label: "净水与中水回用" },
  { path: "/facility-ops", icon: "build_circle", label: "设施运维管理" },
  { path: "/ifc-walk-tour", icon: "directions_walk", label: "数字孪生漫游" },
  { path: "/data-resources", icon: "database", label: "定额与价格库" },
  { path: "/old-materials", icon: "recycling", label: "旧材利用定额" },
  { path: "/unit-price-analysis", icon: "price_change", label: "综合单价分析" },
  { path: "/pricing-audit", icon: "calculate", label: "计价复核与审计" },
  { path: "/dynamic-control", icon: "monitoring", label: "动态管控" },
  { path: "/settings", icon: "tune", label: "系统参数配置" },
];


const PAGE_TITLES: Record<string, { title: string; hint: string }> = {
  "/dashboard": { title: "总控工作台", hint: "先处理影响计价结果的事项" },
  "/projects": { title: "项目台账", hint: "管理工程项目及其当前状态" },
  "/quantity-center": { title: "清单算量中心", hint: "整理工程量并形成可计价清单" },
  "/drawings": { title: "图纸智能识别", hint: "导入图纸并识别为结构化数据" },
  "/ifc-parser": { title: "BIM 模型算量", hint: "解析BIM模型提取工程量并自动套价" },
  "/pv-power": { title: "光伏发电监测", hint: "屋面光伏系统发电功率、收益与碳减排实时测算" },
  "/water-reuse": { title: "净水与中水回用", hint: "净水处理与中水回用双系统运行监测" },
  "/facility-ops": { title: "设施运维管理", hint: "设备健康监测、维保工单与分项能耗分析" },
  "/pricing-audit": { title: "计价复核与审计", hint: "核对价格、定额与风险项" },
  "/dynamic-control": { title: "动态管控", hint: "从造价到运维：四源关联、偏差对比、支付校验、风险模拟与后评估" },
  "/data-resources": { title: "定额与价格库", hint: "维护计价基础数据" },
  "/old-materials": { title: "旧材利用定额", hint: "遗址修复材料定额清单：当地回收 / 原材料复现" },
  "/unit-price-analysis": { title: "综合单价分析", hint: "分析综合单价构成与合理性" },
  "/settings": { title: "系统参数配置", hint: "管理规则、权限与系统参数" },
};

function AppSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const hasToken = Boolean(getAuthToken());
  const { tourMode, toggleTourMode } = useTourMode();

  return (
    <aside className="app-sidebar">
      <div className="app-sidebar-top">
        <a
          href="/dashboard"
          className="app-sidebar-brand"
          onClick={(event) => {
            event.preventDefault();
            navigate("/dashboard");
          }}
        >
          <div className="app-sidebar-brand-icon">
            <span className="material-symbols-outlined">architecture</span>
          </div>
          <div className="app-sidebar-brand-text">
            <h1>筑衡</h1>
            <p>全过程工程造价协同管控平台</p>
          </div>
        </a>

        <nav className="app-sidebar-nav">
          {NAV_ITEMS.map((item) => {
            const active = location.pathname.startsWith(item.path);
            return (
              <a
                key={item.path}
                href={item.path}
                className={`app-sidebar-link${active ? " active" : ""}`}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(item.path);
                }}
              >
                <span className="material-symbols-outlined">{item.icon}</span>
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>
      </div>

      {hasToken && (
        <>
          <button
            type="button"
            className={`app-sidebar-tour-toggle${tourMode ? " active" : ""}`}
            onClick={toggleTourMode}
            title={tourMode ? "退出导览模式" : "进入导览模式"}
          >
            <span className="material-symbols-outlined">{tourMode ? "play_circle" : "slideshow"}</span>
            <span>{tourMode ? "导览中 · 点击退出" : "导览模式"}</span>
          </button>
          <Button
            type="text"
            className="app-sidebar-link"
            icon={<span className="material-symbols-outlined">logout</span>}
            onClick={() => {
              setAuthToken("");
              window.location.reload();
            }}
          >
            退出登录
          </Button>
        </>
      )}
    </aside>
  );
}

function WorkspaceHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const page = Object.entries(PAGE_TITLES).find(([path]) => location.pathname === path || location.pathname.startsWith(`${path}/`))?.[1]
    ?? { title: "项目工作台", hint: "" };

  return (
    <header className="workspace-header">
      <div>
        <div className="workspace-eyebrow">筑衡 / 工程造价工作台</div>
        <h2>{page.title}</h2>
        {page.hint && <p>{page.hint}</p>}
      </div>
      <Space size={8}>
        <Button icon={<span className="material-symbols-outlined">search</span>} onClick={() => navigate("/projects")}>查找项目</Button>
        <Button type="primary" icon={<span className="material-symbols-outlined">add</span>} onClick={() => navigate("/projects")}>新建项目</Button>
      </Space>
    </header>
  );
}

function AuthGate({ children }: { children: ReactNode }) {
  const { message } = AntApp.useApp();
  const authRequired = import.meta.env.VITE_AUTH_REQUIRED !== "false";
  const [authed, setAuthed] = useState<boolean>(() => !authRequired || Boolean(getAuthToken()));
  const [submitting, setSubmitting] = useState(false);
  const location = useLocation();
  const { tourMode } = useTourMode();

  useEffect(() => {
    if (!authRequired) return;
    const onLogout = () => setAuthed(false);
    window.addEventListener(AUTH_LOGOUT_EVENT, onLogout);
    return () => window.removeEventListener(AUTH_LOGOUT_EVENT, onLogout);
  }, [authRequired]);

  const handleLogin = async (values: { username: string; password: string }) => {
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.detail === "string" ? data.detail : "登录失败");
      }
      const data = await res.json();
      setAuthToken(data.access_token || "");
      setAuthed(true);
      message.success("登录成功");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  };

  if (authed) {
    // WalkVerify 全屏页面不显示导览（避免遮挡 3D HUD）
    const isWalkTour = location.pathname.startsWith("/ifc-walk-tour");
    return (
      <>
        {children}
        {tourMode && !isWalkTour && <TourGuide />}
      </>
    );
  }

  return (
    <div className="app-auth-screen">
      <Card className="app-auth-card">
        <Typography.Title level={3}>登录筑衡</Typography.Title>
        <Form layout="vertical" onFinish={handleLogin}>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: "请输入用户名" }]}>
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={submitting}>
            登录
          </Button>
        </Form>
      </Card>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ConfigProvider
        theme={{
          algorithm: theme.darkAlgorithm,
          token: {
            colorPrimary: "#3d8bff",
            borderRadius: 8,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif',
            colorBgContainer: "#132d52",
            colorBgElevated: "#1a3d6a",
            colorBorder: "rgba(80, 160, 255, 0.30)",
            colorText: "#e2e8f0",
            colorTextSecondary: "#9db8dd",
            colorBgLayout: "#0d1f3c",
            controlHeight: 36,
            colorBgTextHover: "rgba(64, 150, 255, 0.08)",
            colorBgTextActive: "rgba(64, 150, 255, 0.14)",
          },
          components: {
            Card: { colorBgContainer: "rgba(19, 45, 82, 0.68)", colorBorderSecondary: "rgba(80, 160, 255, 0.25)" },
            Input: {
              colorBgContainer: "rgba(11, 26, 48, 0.65)",
              activeBorderColor: "#4096ff",
              hoverBorderColor: "rgba(64, 150, 255, 0.45)",
            },
            Select: { colorBgContainer: "rgba(11, 26, 48, 0.65)" },
            Table: {
              colorBgContainer: "rgba(19, 45, 82, 0.55)",
              headerBg: "rgba(26, 61, 106, 0.65)",
              rowHoverBg: "rgba(61, 139, 255, 0.12)",
            },
            Modal: { contentBg: "#152f56", headerBg: "#152f56" },
            Drawer: { colorBgElevated: "#152f56" },
            Collapse: { colorBgContainer: "rgba(19, 45, 82, 0.55)", headerBg: "rgba(22, 51, 94, 0.4)" },
            Tag: { borderRadiusSM: 4 },
          },
        }}
      >
        <AntApp>
          <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <TourModeProvider>
            <AuthGate>
              <Suspense fallback={<div className="page-container">正在加载...</div>}>
                <Routes>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/ifc-walk-tour" element={<WalkVerify />} />
                  <Route
                    path="/*"
                    element={
                      <div className="app-layout">
                        <ParticleBackdrop />
                        <div className="tech-scanline" />
                        <div className="tech-glow-line" />
                        <div className="tech-corner tech-corner--tl" />
                        <div className="tech-corner tech-corner--br" />
                        <div className="tech-dots" />
                        <AppSidebar />
                        <main className="app-main">
                          <WorkspaceHeader />
                          <Routes>
                            <Route path="/dashboard" element={<Dashboard />} />
                            <Route path="/zh-command" element={<Navigate to="/dashboard" replace />} />
                            <Route path="/lifecycle" element={<Navigate to="/dashboard" replace />} />
                            <Route path="/projects" element={<ProjectList />} />
                            <Route path="/projects/:id" element={<ProjectDetail />} />
                            <Route path="/pricing-audit" element={<PricingAudit />} />
                            <Route path="/dynamic-control" element={<DynamicControl />} />
                            <Route path="/pricing" element={<Navigate to="/pricing-audit" replace />} />
                            <Route path="/audit" element={<Navigate to="/pricing-audit" replace />} />
                            <Route path="/reports" element={<Navigate to="/pricing-audit" replace />} />
                            <Route path="/unit-price-analysis" element={<UnitPriceAnalysis />} />
                            <Route path="/pricing/analysis/:projectId/:boqItemId" element={<UnitPriceAnalysis />} />
                            <Route path="/data-resources" element={<DataResources />} />
                            <Route path="/old-materials" element={<OldMaterialLibrary />} />
                            <Route path="/quota-library" element={<Navigate to="/data-resources" replace />} />
                            <Route path="/price-management" element={<Navigate to="/data-resources" replace />} />
                            <Route path="/knowledge-graph" element={<Navigate to="/data-resources" replace />} />
                            <Route path="/quantity-center" element={<QuantityCenter />} />
                            <Route path="/drawings" element={<DrawingRecognition />} />
                            <Route path="/drawings/:projectId" element={<DrawingRecognition />} />
                            <Route path="/ifc-parser" element={<IfcParser />} />
                            <Route path="/pv-power" element={<PvPowerPage />} />
                            <Route path="/water-reuse" element={<WaterReusePage />} />
                            <Route path="/facility-ops" element={<FacilityOpsPage />} />
                            <Route path="/tasks" element={<Navigate to="/settings" replace />} />
                            <Route path="/rules" element={<Navigate to="/settings" replace />} />
                            <Route path="/settings" element={<SystemSettings />} />
                            <Route path="*" element={<Navigate to="/dashboard" replace />} />
                          </Routes>
                        </main>
                      </div>
                    }
                  />
                </Routes>
              </Suspense>
            </AuthGate>
            </TourModeProvider>
          </BrowserRouter>
        </AntApp>
      </ConfigProvider>
    </ErrorBoundary>
  );
}
