# Windows Codex 原生验收任务

本机负责代码整合和 PR；你负责 Windows 原生验证。请执行并留下证据，不以 Debug 启动代替 Release 安装验收。交接包的 `MANIFEST.json` 绑定 Windows/CLI 两个受测提交。Windows bundle 是移除 `artifacts/` 后的源码验收快照，清单另记原开发提交 `sourceCommit`；完整 Windows 开发历史留在本机，避免传输仓库内的旧安装器和浏览器历史副本。CLI bundle 保留对应源码提交及原始测试。

## 取得受测代码

在新的本地目录解压交接包，不覆盖上轮源码目录。先用 PowerShell 的 `Get-FileHash -Algorithm SHA256` 对照清单校验两个 bundle，然后运行：

```powershell
git clone -b fix/windows-acceptance .\vibe-usage-windows.bundle vibe-usage-windows
git clone -b fix/windows-acceptance .\vibe-usage-cli.bundle vibe-usage
git -C vibe-usage-windows rev-parse HEAD
git -C vibe-usage rev-parse HEAD
git -C vibe-usage-windows status --short
git -C vibe-usage status --short
```

两个 HEAD 必须与清单的各自 `commit` 一致，工作区初始应干净。Windows 的 `commit` 是验收快照，不是 `sourceCommit`；生成诊断时应记录实际验收 HEAD。不要执行 `vendor-cli.mjs` 拉取 npm latest，也不要把旧 `fd3ccd3` 目录的构建输出覆盖进来。

本轮 App 为 `0.5.13`；内置 CLI 为 `0.10.32-windows-acceptance.1` / `5387113efc20`（未发布的 Windows 修复版本），含可追溯的 Windows 补丁。外测更新轮询、手动检查、安装入口已经本地修复；OpenCode Windows 目录补丁适配上游重构。active 口径仍是已知限制，不要自行增加阈值、并行去重或改变历史数据。

## 本轮 P0 复测边界

原始 Windows 基线：验收快照 `32bb0db32a4a` / 开发提交 `78a6691`；CLI `4ab7b98e3e6c`，377 total / 359 pass / 8 fail / 10 skip，仍为 FAIL。8 个失败的修复设计和 10 个 skip 的逐项理由见 CLI checkout 的 `docs/WINDOWS_ACCEPTANCE.md`。报告把 #50 Claude 归因于 chmod 是误判，原始用例其实传入普通文件作为目录。

原始 GUI/安装态/诊断/恢复结论继续为 **reported by Windows, not independently reviewed**，待完整可校验证据包到达本机后才能更改。断网/睡眠、旧版升级、长期运行、跨配额重置、Claude/Grok/ZCode 正向验证保持 NOT RUN/BLOCKED，除非有新的实测证据。禁止购买账号；no_data 不算正向成功。active 算法不变。未签名是正式发布前置条件，不能视为本轮功能修复已解决。

1. 完整执行 CLI 与 vendored CLI 测试。预期仍有 377 项，Windows Node 22 的目标为 367 pass / 0 fail / 10 个带理由的 skip；这是复测目标，不是已取得结果。任何额外 skip 或 ACL setup/cleanup 失败都应调查，不能调低断言消红。
2. 用 Windows PowerShell 5.1 和 PowerShell 7（如已安装）执行路径回归。测试替换编译/签名命令以验证两个真实 wrapper 的路径传递；不替代真正 MSVC/NSIS 构建。
3. 真正长路径构建：在工作区路径至少 150 字符（仍留出源码文件路径空间）的新 clone 内，不设置 `CARGO_TARGET_DIR`，运行完整 release。必须自动选择短 target，源码位置保持不变；记录自动输出路径和成功产物。
4. 再用显式的短绝对 `CARGO_TARGET_DIR` 构建一次；确认用户路径被保留，安装器从该 target 复制出来。相对覆盖由自动化脚本覆盖。不要映射整个源码目录或手动修补脚本来获得通过。

## 自动化与构建

记录 Windows 版本、CPU 架构、Node/pnpm/Rust 版本及命令退出码。目标为 Windows x64、Node 22（需支持 node:sqlite）、pnpm 10、Rust 1.88、MSVC/Windows SDK。现有工具齐备时直接构建；缺少工具时可使用 `BUILD-WINDOWS-EXTERNAL-TEST.cmd` 准备环境并构建，系统权限提示由用户本人处理。

先在两个目录的父目录创建 `evidence`，将完整输出保存在本地。PowerShell 管道至 `Tee-Object` 后也要检查 `$LASTEXITCODE`；失败后保留日志，不继续宣布后续步骤通过。

```powershell
cd vibe-usage-windows
node scripts/check-version.mjs
powershell -NoProfile -File scripts/test-windows-build-paths.ps1
# 若已安装 PowerShell 7：pwsh -NoProfile -File scripts/test-windows-build-paths.ps1
pnpm install --frozen-lockfile
pnpm test
pnpm build
node scripts/fetch-node.mjs
cargo test --workspace
cargo test --workspace --features external-test-diagnostics
node scripts/test-vendored-cli.mjs --tests-from ..\vibe-usage
# CLI checkout 也执行 node --test，并保留独立日志
cargo test -p vibe-usage-app --features external-test-diagnostics credential_manager_roundtrip_isolated -- --ignored --nocapture
pnpm run release:windows:test
```

CLI runner 将同提交的 test/ 和 test-support/ 复制到临时目录，测试实际 vendored 的 `bin/src`，退出后清理；不会把测试塞进安装包。0 项测试必须判为未验证。若 Windows 的权限、符号链接、文件权限语义导致上游测试失败，记录具体用例和原因，不擅自跳过或改断言。

凭据测试为显式 ignored 测试，只使用随机服务名前缀和虚构值，验证原生 Credential Manager 创建/读取/更新/两区域分离/删除，并安排异常清理。Windows 应实际执行 1 项；其他平台无法替代。不要在应用设置里用虚构 Key 覆盖已有凭据来模拟这项测试。

构建产物应为根目录 `VibeUsage-0.5.13-Windows-External-Test-Setup.exe`。新的 appBuild 应为 `windows-acceptance-<Unix 秒>`，appCommit 必须为本轮实际 clone HEAD。记录大小、SHA-256、Authenticode 状态；未签名要如实记录，不更换证书或关闭系统保护。安装后运行的进程路径必须来自安装目录，不能是 `target/debug`。窗口标题可能仍为 Vibe Usage，单凭标题不能确认构建身份。

## GUI 与真实账号

先记录已安装的正式/外测 App、账号关联状态与配额选择；保留现有配置，结束后恢复测试改动。外测安装身份独立，但用量账号配置和 ZCode 正式凭据仍共享。避免“重置配置”，不要删除用户日志、账户文件或已有 Key。不要公开原始日志、会话内容、完整 Key/Token/Cookie。

逐项记录 PASS / FAIL / BLOCKED / NOT RUN 与证据：

1. **安装及基本窗口**：安装新外测包、启动、退出、再次启动；托盘单击、关闭窗口隐藏到托盘、重开设置、两个实例启动时的行为；布局无裁切。确认已有正式安装未被覆盖。
2. **更新隔离**：设置显示“外测版不检查更新”，无可点击的检查按钮或更新横幅；运行上述 external feature 测试确认没有网络请求。不要真的下载/安装生产更新来试探隔离。
3. **构建身份**：通过设置导出诊断，检查最新事件的 appCommit、cliCommit、cliVersion、buildKind；应对应清单、`0.10.32-windows-acceptance.1`、`external-test`。旧历史事件不能代表当前构建。
4. **产品选择**：0/1/2 张卡，第三项替换最早选择，全部取消后重启仍为空；仅选某产品时不会触发不相关产品请求；无数据/缺登录提示不会一直转圈。
5. **实际配额**：已有 Kimi 登录可再次正向验证。Grok 有官方 billing 日志才应显示配额，`no_data` 不等于读取成功，禁止为了造数据修改真实日志。Cursor 只需验证待接入提示。Claude/Codex 各自实测；已发现不等于已登录或正向配额通过。缺账号/订阅就记 BLOCKED，继续其他项目。
6. **ZCode**：隔离凭据测试先通过；如用户有对应 Coding Plan，由用户在本机亲自填写区域 Key，再观察刷新和重启持久化。不要在聊天索取 Key，不跨区域试发；缺 Key 不阻塞其他测试，不代购订阅。
7. **用量仪表盘**：实际同步完成，今天/24H/7D/30D/90D/自定义等待加载结束，四类筛选与清除、费用/Token/活跃图表、单位切换、滚动、长名字显示。报告数值及口径；不要将累计会话 active 宣称为人的使用时长。
8. **恢复场景**：观察进程启动后短暂断网/恢复、睡眠/唤醒后的重试与数据显示。先让用户选择不打断其他工作的时机，不改系统代理或全局防火墙。区分缓存和实时数据，截图包含数据时间提示。长期运行或跨配额重置没到条件就记 NOT RUN。
9. **安装器收尾**：仅对本轮独立外测安装做重装/卸载/再安装，确认正式 App 和共享配置仍在。不要用生产安装包升级外测。没有可用旧版外测安装器时，旧版本迁移单列 NOT RUN，不把同版本重装当升级。

## 发现问题时

先稳定复现并记录精确步骤、预期/实际、版本和脱敏日志。Windows 专属的小范围缺陷可在当前 `fix/windows-acceptance` 分支追加修复，补有意义的回归并只重跑受影响检查；验收 baseline 和修复后的结果分开列。共享 CLI active 算法、数据采集/隐私、身份去重、产品默认行为、发布版本由本机统一处理，提出建议即可。

修改源代码后重新构建并测试新安装包，报告新 HEAD/补丁 SHA 与安装包 SHA，不能沿用旧身份宣称通过。仅提交明确的源码文件；不提交 `node_modules`、`dist`、`target`、Node 二进制、账号文件和日志。不要推送、开 PR、发布 npm 或 Release。

交付 `evidence/REPORT.md`：

- 清单版本、实际 HEAD、Windows/工具链、安装包路径/SHA/签名及运行路径。
- 每个命令的执行结果、通过/失败/跳过数、对应本地日志文件。
- GUI 测试表和必要截图，真实 provider 各自结果与数据时间。
- 已知问题、缺少的前置条件、未覆盖项目；不可只写“106 项通过”。
- 配置恢复结果。如有补丁，提供 `git diff <清单中的 Windows HEAD> --binary` 或带新增提交的 Git bundle，便于本机整合；外发前检查无凭据。

任务完成标准是让每个项目有可核查的结论。缺少订阅、签名或时间条件要明确列出，不能承诺零 bug。

请交付完整 `evidence/`：报告引用的全部日志、裁剪/脱敏后的 GUI 截图、原始脱敏诊断 JSONL、安装包（或可访问位置），以及覆盖所有文件和安装包的 SHA256SUMS.txt。不要外发带其他桌面应用信息或 Key 片段的原始截图。
