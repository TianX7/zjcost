# 筑衡（zjcost）架构设计

## 总体分层

```
┌─────────────────────────────────────────────────────┐
│ 前端 React 19 + TypeScript + Ant Design（Vite 构建）  │
│ 页面层 / 业务组件 / API 客户端（client.ts 统一出入口） │
└───────────────────────┬─────────────────────────────┘
                        │ REST (JSON)
┌───────────────────────▼─────────────────────────────┐
│ 后端 FastAPI（main.py 自动发现并注册 46 个路由模块）    │
│ 路由层 → 服务层（pricing_engine / *_service）         │
│         → ORM（SQLAlchemy）→ SQLite                   │
├─────────────────────────────────────────────────────┤
│ 辅助 Handler 框架（app/assistant/）                   │
│ Orchestrator → 专业 Handler → PluginRegistry 工具     │
│ Provider 层对接 OpenAI 兼容推理服务，未配置时优雅降级    │
└─────────────────────────────────────────────────────┘
```

## 目录结构

| 路径 | 职责 |
|------|------|
| `frontend/src/pages/` | 页面组件（工作台、项目、图纸、计价审计、数据资源等） |
| `frontend/src/components/` | 业务组件（项目工作区 Tab、三维视图、导览等） |
| `frontend/src/client.ts` | API 客户端统一入口（鉴权、错误处理、导览快照开关） |
| `backend/app/api/routes/` | 路由模块（项目、清单、绑定、计价、图纸、IFC、任务等） |
| `backend/app/services/` | 业务逻辑（计价引擎、图纸分析、IFC 解析、任务存储等） |
| `backend/app/models/` | SQLAlchemy ORM 模型 |
| `backend/app/assistant/framework/` | Handler 框架核心（推理循环、模型路由、插件注册） |
| `backend/app/assistant/agents/` | Orchestrator 与专业 Handler（configs 支持热加载） |
| `backend/app/assistant/tools/` | 领域工具（定额检索、绑定、计算、批量操作等） |
| `backend/alembic/` | 数据库迁移 |
| `packaging/` / `portable_setup.bat` | 便携版打包（内置 Python/Node 运行时，离线可用） |

## 核心业务流

```
图纸识别（DXF/DWG）──→ 构件清单建议 ──→ 项目清单（BOQ）
IFC 模型解析（BIM）──→ 构件算量  ──↗        │
                                    定额绑定（候选/系数/批量）
                                          ↓
                              计价引擎（确定性纯函数）
                        人材机直接费 + 管理费/利润/规费/税金 + 措施费
                                          ↓
                        金额溯源（provenance）/ 校验 / 审计流水线
                                          ↓
                        快照与回滚 / 差异对比 / Excel、PDF 报表导出
```

## 关键设计决策

1. **确定性计价引擎**：`pricing_engine.py` 为无副作用纯函数，同样的输入必得同样的输出，
   每一笔金额都可通过 provenance 回溯到定额、价格与费率来源。
2. **快照与回滚**：项目状态可序列化为快照（snapshots），支持一键回滚（undo）与版本差异导出。
3. **后台任务双轨存储**：识别/解析任务的活跃状态驻内存、结果经 `task_store` 异步落库；
   服务重启后 `_get_task` 从 DB 恢复，lifespan 启动清扫将遗留"进行中"任务标记为失败。
4. **辅助框架优雅降级**：未配置推理服务 Provider 时（`ZH_PROVIDER=disabled`），
   平台全部核心功能可用，仅辅助能力提示未配置，不阻塞主流程。
5. **离线优先**：种子定额库、参考价格与便携运行时随仓库分发，断网环境可完整运行；
   价格抓取调度器（price_fetch）作为可选增强。

## 数据库

SQLite（`DATABASE_URL` 可切换 PostgreSQL）。核心表：projects、boq_items、
quota_items（定额库）、bindings（定额绑定）、material_prices、snapshots、
background_tasks、audit_logs 及辅助框架的 memory / trace 表。
迁移统一走 Alembic；`main.py` 启动时仅做开发环境便利性建表与列修补。
