# Vibe Usage

Windows 应用，自动追踪 AI 编程工具的 Token 用量和费用。App 常驻系统托盘；数据同步到 [vibecafe.ai/usage](https://vibecafe.ai/usage)。

## 下载

从 [Releases](https://github.com/vibe-cafe/vibe-usage-windows/releases/latest) 下载 `VibeUsage-x.y.z-Windows-Setup.exe` 并运行（per-user 安装，无需管理员权限；缺少 WebView2 时安装器会自动下载）。

安装包由 Release workflow 通过 SignPath `Release` 策略提交 Authenticode 签名。Windows 仍可能因为新证书或下载量低显示 SmartScreen 声誉提示；如出现「Windows 已保护你的电脑」，点「更多信息」→「仍要运行」。

## 配置

本机订阅配额无需 Vibe Usage 账号即可使用。若还需要跨设备 Token/费用统计：

1. 打开 Vibe Usage，在订阅配额下方点击「登录并链接数据」
2. 浏览器自动打开 vibecafe.ai 审批页面 — 登录后确认验证码与 app 一致
3. 点击「确认链接」 — app 自动拿到 Key 并开始同步

配置与 CLI 共享 `%USERPROFILE%\.vibe-usage\config.json`，可与 `npx @vibe-cafe/vibe-usage` 共存。

## 功能

- 系统托盘常驻，点击托盘图标打开用量面板
- 后台每 30 分钟自动同步数据，也可手动「更新数据」
- 弹出窗口查看费用、总 Token、缓存 Token、趋势图表
- **订阅配额监控**：自动检测 Codex、Claude Code、Kimi Code、ZCode、Grok 与 Cursor，并允许最多选择两个显示；Cursor 当前明确标记为待接入
- Codex / Claude 使用只读原生适配；Kimi Code 使用官方 CLI 登录；Grok 只读官方 CLI 的结构化配额日志；ZCode 使用用户明确提供的 BigModel（国内）或 Z.ai（海外）Coding Plan Key
- ZCode Key 只保存在当前 Windows 用户的 Credential Manager 中，不写入设置文件、不回显，也不会跨区域试发
- 支持今天 / 24H / 7D / 30D / 90D / 自定义日期，以及终端 / 工具 / 模型 / 项目筛选
- 可在托盘图标显示今日费用和 Token 数
- 内置 [@vibe-cafe/vibe-usage](https://github.com/vibe-cafe/vibe-usage) CLI 与 Node 运行时，开箱即用，无需安装 Node.js
- 可在设置中为 Codex、Grok、Antigravity / AGY 添加多个 Multica 或其他隔离运行时目录；各工具默认目录仍会继续扫描
- 订阅配额读取对齐 macOS：Codex 优先读取实时官方用量、离线回退会话日志；Claude 使用无工具、无提示、无会话持久化的只读探测，不修改 Claude 状态栏配置
- workflow_dispatch 生成的外测包可导出严格脱敏的配额诊断；正式 tag Release 不编译诊断实现，设置入口也不会显示
- 发布构建从 npm `latest` 解析 CLI，再把解析出的确定版本内置进安装包；用户机器不会在运行时拉取或执行未随安装包验证的新代码
- 支持开机自启动、单实例、应用内检查更新

## 系统要求

- Windows 10 21H2+ / Windows 11，x64
- 无其他前置依赖（CLI 与 Node 22 运行时随应用捆绑）

## 从源码构建

```powershell
git clone https://github.com/vibe-cafe/vibe-usage-windows.git
cd vibe-usage-windows

# 首次：安装工具链 (Node 22 / Rust 1.88 / VS Build Tools)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-windows-build-env.ps1

pnpm install
pnpm run release:windows       # 产出 VibeUsage-<version>-Windows-Setup.exe + latest.json
pnpm run release:windows:test  # 产出带脱敏诊断的本地外测安装包，不生成发布清单
```

代码签名构建可通过环境变量提供证书：

- `WINDOWS_CODESIGN_PFX_BASE64` + `WINDOWS_CODESIGN_PFX_PASSWORD`：Base64 编码的 PFX 证书及密码
- `WINDOWS_CODESIGN_CERT_THUMBPRINT`：已安装到证书库的代码签名证书 thumbprint
- `WINDOWS_CODESIGN_TIMESTAMP_URL`：可选，默认 `http://timestamp.digicert.com`

开发调试：

```powershell
node scripts/vendor-cli.mjs    # 准备内置 CLI（一次即可）
pnpm tauri dev
```

## 测试

```bash
pnpm test                # 前端单测（formatters/aggregate/modelFamilies，与 Swift 实现对拍）
cargo test --workspace   # Rust 单测（配置迁移、产品发现/选择、配额桥、凭据边界等）
```

## 架构

```
前端 (React + Tailwind, WebView2)     ← 视觉 1:1 复刻 macOS SwiftUI 视图
  └─ invoke / events
Rust (Tauri 2)
  ├─ tray / panel        托盘 + 标准主窗口（显示/聚焦/隐藏到托盘）
  ├─ api_client          GET /api/usage、设备链接 code/poll
  ├─ sync_engine         spawn node <内置CLI> sync（120s 超时、CREATE_NO_WINDOW）
  ├─ scheduler           30 分钟定时同步 + 24h 更新检查
  ├─ rate_limits         Codex / Claude 原生读取 + Kimi / ZCode / Grok typed CLI bridge
  ├─ quota_product       只读本地发现 + 两项选择策略（Cursor 待接入）
  ├─ zcode_credentials   Windows Credential Manager 安全存储
  ├─ statusline_hook     仅安全退休旧版本能够证明归属的 Claude hook
  └─ updater             latest.json + SHA-256 校验 + NSIS 静默升级
内置资源
  ├─ resources/cli       vendored @vibe-cafe/vibe-usage（含 Windows 补丁, scripts/vendor-cli.mjs）
  └─ resources/node      node.exe 22 LTS（scripts/fetch-node.mjs, 构建时下载）
```

## 相关项目

- [vibe-usage-app](https://github.com/vibe-cafe/vibe-usage-app) — macOS 版（本项目的功能与视觉基准）
- [@vibe-cafe/vibe-usage](https://github.com/vibe-cafe/vibe-usage) — 命令行同步工具
- [vibecafe.ai/usage](https://vibecafe.ai/usage) — Web 仪表盘

## License

MIT
