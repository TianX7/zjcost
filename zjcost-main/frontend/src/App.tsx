import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { App as AntApp, Button, Card, ConfigProvider, Dropdown, Form, Input, Space, theme, Typography } from "antd";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { API_BASE, AUTH_LOGOUT_EVENT, getAuthToken, setAuthToken } from "./client";
import BigScreenShell from "./components/BigScreenShell";
import ScreenHeader from "./components/ScreenHeader";
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
const MergedOpsPage = lazy(() => import("./pages/FacilityOpsPages").then((m) => ({ default: m.MergedOpsPage })));
const DataResources = lazy(() => import("./pages/DataResources"));
const PricingAudit = lazy(() => import("./pages/PricingAudit"));
const SystemSettings = lazy(() => import("./pages/SystemSettings"));
const OldMaterialLibrary = lazy(() => import("./pages/OldMaterialLibrary"));
const DynamicControl = lazy(() => import("./pages/DynamicControl"));

interface NavItem {
  path: string;
  icon: string;
  label: string;
}

interface NavGroup {
  key: string;
  label: string;
  icon: string;
  items: NavItem[];
}

// 顶部一级模块：总览 / 造价 / 算量 / 运维 / 资源 / 系统
const NAV_GROUPS: NavGroup[] = [
  {
    key: "overview",
    label: "总览",
    icon: "grid_view",
    items: [{ path: "/dashboard", icon: "query_stats", label: "总控工作台" }],
  },
  {
    key: "cost",
    label: "造价",
    icon: "calculate",
    items: [
      { path: "/projects", icon: "folder_managed", label: "项目台账" },
      { path: "/pricing-audit", icon: "fact_check", label: "计价复核与审计" },
      { path: "/dynamic-control", icon: "monitoring", label: "动态管控" },
      { path: "/unit-price-analysis", icon: "price_change", label: "综合单价分析" },
    ],
  },
  {
    key: "quantity",
    label: "算量",
    icon: "square_foot",
    items: [
      { path: "/quantity-center", icon: "square_foot", label: "清单算量中心" },
      { path: "/drawings", icon: "draw", label: "图纸智能识别" },
      { path: "/ifc-parser", icon: "view_in_ar", label: "BIM 模型算量" },
    ],
  },
  {
    key: "ops",
    label: "运维",
    icon: "monitoring",
    items: [
      { path: "/facility-ops", icon: "monitoring", label: "光伏 · 中水 · 运维" },
      { path: "/ifc-walk-tour", icon: "directions_walk", label: "数字孪生漫游" },
    ],
  },
  {
    key: "resource",
    label: "资源",
    icon: "database",
    items: [
      { path: "/data-resources", icon: "database", label: "定额与价格库" },
      { path: "/old-materials", icon: "recycling", label: "旧材利用定额" },
    ],
  },
  {
    key: "system",
    label: "系统",
    icon: "tune",
    items: [{ path: "/settings", icon: "tune", label: "系统参数配置" }],
  },
];

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const pad2 = (value: number) => String(value).padStart(2, "0");

function formatClock(date: Date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function formatDate(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${WEEKDAYS[date.getDay()]}`;
}


const PAGE_TITLES: Record<string, { title: string; hint: string }> = {
  "/dashboard": { title: "总控工作台", hint: "先处理影响计价结果的事项" },
  "/projects": { title: "项目台账", hint: "管理工程项目及其当前状态" },
  "/quantity-center": { title: "清单算量中心", hint: "整理工程量并形成可计价清单" },
  "/drawings": { title: "图纸智能识别", hint: "导入图纸并识别为结构化数据" },
  "/ifc-parser": { title: "BIM 模型算量", hint: "解析BIM模型提取工程量并自动套价" },
  "/pv-power": { title: "光伏发电监测", hint: "屋面光伏系统发电功率、收益与碳减排实时测算" },
  "/water-reuse": { title: "净水与中水回用", hint: "净水处理与中水回用双系统运行监测" },
  "/facility-ops": { title: "光伏 · 中水 · 运维", hint: "运营期三大专题合并视图：发电监测 / 水处理回用 / 设施运维" },
  "/pricing-audit": { title: "计价复核与审计", hint: "核对价格、定额与风险项" },
  "/dynamic-control": { title: "动态管控", hint: "从造价到运维：四源关联、偏差对比、支付校验、风险模拟与后评估" },
  "/data-resources": { title: "定额与价格库", hint: "维护计价基础数据" },
  "/old-materials": { title: "旧材利用定额", hint: "遗址修复材料定额清单：当地回收 / 原材料复现" },
  "/unit-price-analysis": { title: "综合单价分析", hint: "分析综合单价构成与合理性" },
  "/settings": { title: "系统参数配置", hint: "管理规则、权限与系统参数" },
};

function AppTopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const hasToken = Boolean(getAuthToken());
  const { tourMode, toggleTourMode } = useTourMode();
  const [now, setNow] = useState(() => new Date());

  // 实时时钟：每秒刷新
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(`${path}/`);
  const isGroupActive = (items: NavItem[]) => items.some((item) => isActive(item.path));

  return (
    <header className="app-topbar">
      <a
        href="/dashboard"
        className="app-topbar-brand"
        onClick={(event) => {
          event.preventDefault();
          navigate("/dashboard");
        }}
      >
        <span className="app-topbar-brand-mark">
          <span className="material-symbols-outlined">architecture</span>
        </span>
        <span className="app-topbar-brand-text">
          <strong>筑衡</strong>
          <span>全过程工程造价协同管控平台</span>
        </span>
      </a>

      <nav className="app-topbar-nav">
        {NAV_GROUPS.map((group) => {
          const active = isGroupActive(group.items);
          const direct = group.items.length === 1 && group.key === "overview";

          if (direct) {
            const item = group.items[0];
            return (
              <button
                key={group.key}
                type="button"
                className={`app-topbar-link${active ? " active" : ""}`}
                onClick={() => navigate(item.path)}
                title={item.label}
              >
                <span className="material-symbols-outlined">{group.icon}</span>
                <span>{group.label}</span>
              </button>
            );
          }

          const menuItems = group.items.map((item) => ({
            key: item.path,
            icon: <span className="material-symbols-outlined">{item.icon}</span>,
            label: item.label,
          }));

          return (
            <Dropdown
              key={group.key}
              trigger={["click"]}
              placement="bottomLeft"
              rootClassName="app-topbar-dropdown"
              menu={{
                items: menuItems,
                selectedKeys: group.items.filter((item) => isActive(item.path)).map((item) => item.path),
                onClick: ({ key }) => navigate(key),
              }}
            >
              <button type="button" className={`app-topbar-link${active ? " active" : ""}`}>
                <span className="material-symbols-outlined">{group.icon}</span>
                <span>{group.label}</span>
                <span className="material-symbols-outlined app-topbar-caret">expand_more</span>
              </button>
            </Dropdown>
          );
        })}
      </nav>

      <div className="app-topbar-status">
        <div className="app-topbar-clock" aria-label="实时时间">
          <span className="app-topbar-clock-time">{formatClock(now)}</span>
          <span className="app-topbar-clock-date">{formatDate(now)}</span>
        </div>
        <span className="app-topbar-divider" aria-hidden="true" />
        <button
          type="button"
          className={`app-topbar-action${tourMode ? " active" : ""}`}
          onClick={toggleTourMode}
          title={tourMode ? "退出导览模式" : "进入导览模式"}
        >
          <span className="material-symbols-outlined">{tourMode ? "play_circle" : "slideshow"}</span>
          <span className="app-topbar-action-text">{tourMode ? "导览中 · 点击退出" : "导览模式"}</span>
        </button>
        {hasToken && (
          <button
            type="button"
            className="app-topbar-action"
            onClick={() => {
              setAuthToken("");
              window.location.reload();
            }}
            title="退出登录"
          >
            <span className="material-symbols-outlined">logout</span>
            <span className="app-topbar-action-text">退出登录</span>
          </button>
        )}
      </div>
    </header>
  );
}

function WorkspaceHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const page = Object.entries(PAGE_TITLES).find(([path]) => location.pathname === path || location.pathname.startsWith(`${path}/`))?.[1]
    ?? { title: "项目工作台", hint: "" };

  return (
    <ScreenHeader
      eyebrow="筑衡 / 工程造价工作台"
      title={page.title}
      subtitle={page.hint}
      actions={
        <Space size={8}>
          <Button icon={<span className="material-symbols-outlined">search</span>} onClick={() => navigate("/projects")}>查找项目</Button>
          <Button type="primary" icon={<span className="material-symbols-outlined">add</span>} onClick={() => navigate("/projects")}>新建项目</Button>
        </Space>
      }
    />
  );
}

function PageTransition({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <div key={location.pathname} className="page-transition">
      {children}
    </div>
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

function RouteFallback() {
  const location = useLocation();
  // 进漫游页时分包加载的那一下：用同主题过渡屏，避免白闪/底色跳变
  if (location.pathname.startsWith("/ifc-walk-tour")) {
    return (
      <div className="walk-tour-root" style={{ width: "100vw", height: "100vh", background: "#0d1f3c", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="walk-tour-loading-card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", marginBottom: 6 }}>数字孪生漫游</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>正在进入漫游…</div>
        </div>
      </div>
    );
  }
  return <div className="page-container">正在加载...</div>;
}

function ModalFxGuard() {
  useEffect(() => {
    const id = "zh-modal-fx-js";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
.ant-modal-content {
  background: linear-gradient(165deg, #224e87, #1a3d6a) !important;
  border: 1px solid rgba(80, 160, 255, 0.45) !important;
  box-shadow: inset 0 1px 0 rgba(140, 200, 255, 0.20), 0 24px 64px rgba(0, 0, 0, 0.55), 0 0 42px rgba(90, 220, 255, 0.45) !important;
  animation: zh-modal-glow 3s ease-in-out infinite !important;
}
.ant-modal-content::before {
  content: ""; position: absolute; top: 0; left: -60%; right: -60%; height: 3px; z-index: 4; pointer-events: none;
  background: linear-gradient(90deg, transparent, #7de9ff, transparent);
  animation: zh-modal-scan 3s ease-in-out infinite;
}
.ant-modal-content::after {
  content: ""; position: absolute; inset: 0; z-index: 4; pointer-events: none;
  background:
    linear-gradient(#7de9ff 1px, transparent 1px) 0 0 / 34px 34px no-repeat,
    linear-gradient(90deg, #7de9ff 1px, transparent 1px) 0 0 / 34px 34px no-repeat,
    linear-gradient(#7de9ff 1px, transparent 1px) 100% 100% / 34px 34px no-repeat,
    linear-gradient(90deg, #7de9ff 1px, transparent 1px) 100% 100% / 34px 34px no-repeat;
}
@keyframes zh-modal-glow {
  0%, 100% { box-shadow: inset 0 1px 0 rgba(140, 200, 255, 0.20), 0 24px 64px rgba(0, 0, 0, 0.55), 0 0 28px rgba(90, 220, 255, 0.35); }
  50% { box-shadow: inset 0 1px 0 rgba(140, 200, 255, 0.24), 0 24px 64px rgba(0, 0, 0, 0.55), 0 0 52px rgba(125, 233, 255, 0.65); }
}
@keyframes zh-modal-scan {
  0%, 100% { transform: translateX(-30%); opacity: 0.3; }
  50% { transform: translateX(30%); opacity: 1; }
}
    `.trim();
    document.head.appendChild(style);
  }, []);
  return null;
}

export default function App() {
  return (
    <ErrorBoundary>
      <ConfigProvider
        theme={{
          algorithm: theme.darkAlgorithm,
          token: {
            colorPrimary: "#3d8bff",
            borderRadius: 10,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif',
            colorBgContainer: "#132d52",
            colorBgElevated: "#1a3d6a",
            colorBorder: "rgba(80, 160, 255, 0.16)",
            colorText: "#e2e8f0",
            colorTextSecondary: "#94a3b8",
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
            Modal: { contentBg: "#152f56", headerBg: "#152f56", titleColor: "#e2e8f0" },
            Drawer: { colorBgElevated: "#152f56" },
            Collapse: { colorBgContainer: "rgba(19, 45, 82, 0.55)", headerBg: "rgba(22, 51, 94, 0.4)" },
            Tag: { borderRadiusSM: 4 },
          },
        }}
      >
        <AntApp>
          <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <TourModeProvider>
            <ModalFxGuard />
            <AuthGate>
              <Suspense fallback={<RouteFallback />}>
                <Routes>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/ifc-walk-tour" element={<WalkVerify />} />
                  <Route
                    path="/*"
                    element={
                      <div className="app-layout">
                        <ParticleBackdrop />
                        <div className="tech-glow-line" />
                        <div className="tech-corner tech-corner--tl" />
                        <div className="tech-corner tech-corner--br" />
                        <div className="tech-dots" />
                        <AppTopBar />
                        <main className="app-main">
                          <WorkspaceHeader />
                          <BigScreenShell
                            footer={
                              <>
                                <span>系统运行正常 · 本地部署 · 数据不出内网</span>
                                <span>筑衡 ZH COST · 全过程工程造价协同管控平台</span>
                              </>
                            }
                          >
                          <PageTransition>
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
                            <Route path="/facility-ops" element={<MergedOpsPage />} />
                            <Route path="/pv-power" element={<Navigate to="/facility-ops?tab=pv" replace />} />
                            <Route path="/water-reuse" element={<Navigate to="/facility-ops?tab=water" replace />} />
                            <Route path="/tasks" element={<Navigate to="/settings" replace />} />
                            <Route path="/rules" element={<Navigate to="/settings" replace />} />
                            <Route path="/settings" element={<SystemSettings />} />
                            <Route path="*" element={<Navigate to="/dashboard" replace />} />
                          </Routes>
                          </PageTransition>
                          </BigScreenShell>
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
