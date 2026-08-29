# 跨电脑运行指南

## 零安装，离线也能跑

项目自带便携 Python 3.12 + Node.js 22（`tools/` 目录），**无需在系统上安装任何软件**，也不需要联网。

### 首次使用（有网）

1. 双击 `start_dev.bat`
2. 等它自动建 venv、装依赖、启动服务、打开浏览器 → 完成

### 首次使用（离线 / 内网）

> 离线时 pip/npm 无法下载依赖。请先在**有网的电脑**上运行一次 `start_dev.bat`，
> 让它装好 `backend/venv/` 和 `frontend/node_modules/`，然后连同项目一起拷贝到离线电脑。

1. 有网电脑：双击 `start_dev.bat`（自动装好一切）
2. 把整个项目文件夹拷贝到离线电脑
3. 离线电脑：双击 `start_dev.bat` → 直接启动，无需联网

### 后续启动

双击 `start_dev.bat` 即可，秒级启动。

---

## 杀毒软件 & 防火墙

### 为什么杀毒软件可能拦截？

便携版 `python.exe`、`node.exe` 不是"已签名的安装程序"，部分杀毒软件会：
- 误报为可疑程序（尤其是从 U 盘 / 网盘拷来的）
- 静默拦截 `pip install` / `npm install` 的文件写入
- 拦截子进程创建（导致 venv 创建失败）

> **本项目所有代码均在本地运行，不连接任何外部服务器**（仅在首次安装依赖时联网下载包）。

### 自动处理

`start_dev.bat` 会在启动时自动检测杀毒软件，并尝试将项目文件夹添加到 Windows Defender 排除列表（需管理员权限确认）。

### 手动处理

如果自动添加失败，请手动将项目文件夹加入杀毒白名单：

**Windows Defender**（管理员 PowerShell）：
```powershell
Add-MpPreference -ExclusionPath "C:\你的项目路径\zjcost-main"
```

**其他杀毒软件**（360、火绒、卡巴斯基等）：
1. 打开杀毒软件 → 设置 → 白名单/信任区
2. 添加项目文件夹路径
3. 或在首次启动时选择"允许"/"信任"弹窗

### 防火墙

本项目的服务运行在 `127.0.0.1`（本地回环），**Windows 防火墙不会拦截本地端口**。

如果需要局域网内其他电脑访问，则需要开放端口：
```cmd
netsh advfirewall firewall add rule name="筑衡后端" dir=in action=allow protocol=tcp localport=8098
netsh advfirewall firewall add rule name="筑衡前端" dir=in action=allow protocol=tcp localport=5173
```

---

## 拷贝项目到另一台电脑

最简单的方式：**把整个项目文件夹拷走**（U盘 / 网盘 / Git clone 都行）。

需要确保以下目录一并拷贝：

| 目录 | 说明 | 必须？ |
|------|------|--------|
| `tools/` | 便携 Python + Node.js | ✅ 必须（约 126 MB） |
| `backend/venv/` | Python 依赖 | ✅ 必须（约 380 MB，离线时） |
| `frontend/node_modules/` | Node.js 依赖 | ✅ 必须（约 265 MB，离线时） |
| `backend/` | 后端代码 | ✅ |
| `frontend/` | 前端代码 | ✅ |
| `.env` | 配置文件 | ✅ 首次会自动从 `.env.example` 生成 |

> 如果两台电脑都能联网，只需拷贝代码 + `tools/` 即可，venv 和 node_modules 会在首次启动时自动安装。

---

## 各脚本说明

| 脚本 | 用途 |
|------|------|
| `start_dev.bat` | 一键启动：自动建 venv / 装依赖 / 启动前后端 / 打开浏览器 |
| `portable_setup.bat` | 下载便携 Python + Node.js（已内置则跳过，无需重复运行） |
| `start_backend_8098.bat` | 仅启动后端 |
| `start_frontend_5173.bat` | 仅启动前端 |
| `dev_start.py` | Python 版启动脚本（macOS/Linux 也可用） |

---

## 访问地址

| 服务 | 地址 |
|------|------|
| 前端应用 | http://localhost:5173/zjcost/ |
| 后端 API | http://127.0.0.1:8098 |
| API 文档 | http://127.0.0.1:8098/docs |

---

## 配置说明

运行后会在项目根目录生成 `.env` 文件，关键配置项：

| 配置项 | 默认值 | 说明 |
|--------|-------|------|
| `DATABASE_URL` | `sqlite:///./valuation.db` | 默认 SQLite，无需额外安装数据库 |
| `ZH_PROVIDER` | `disabled` | 辅助处理器，关闭不影响其余功能 |
| `ZJCOST_AUTH_REQUIRED` | `false` | 是否启用登录认证，本地开发建议关闭 |

---

## 常见问题

**Q: 双击 bat 闪退？**
用 cmd 运行查看报错：Win+R → cmd → `cd /d 项目目录` → `start_dev.bat`

**Q: 离线电脑上提示依赖安装失败？**
需要先在有网电脑运行一次 `start_dev.bat`，让它装好 venv 和 node_modules，然后连同整个项目拷贝过去。

**Q: 杀毒软件报警/拦截？**
1. 将项目文件夹加入杀毒白名单（见上方"杀毒软件 & 防火墙"章节）
2. 首次启动时如果弹窗选择"允许"/"信任"
3. Windows Defender 可用脚本自动添加排除项

**Q: 端口被占用？**
```cmd
netstat -ano | findstr "8098"
taskkill /PID <进程ID> /F
```

**Q: 项目文件夹太大？**
- `tools/` (126 MB) — 便携运行时，离线必需
- `backend/venv/` (380 MB) — Python 依赖
- `frontend/node_modules/` (265 MB) — Node.js 依赖
- 如需压缩：在有网环境下可以删掉 venv/node_modules（约 -645 MB），到新电脑首次启动时自动重装

**Q: 如何彻底卸载便携版？**
删除 `tools/` 文件夹即可。便携版不写入系统注册表或系统目录。

**Q: 需要局域网其他人访问？**
默认只监听 127.0.0.1（本机），如需局域网访问需改 `--host 0.0.0.0` 并开放防火墙端口（见上方）。
