# Changelog

## 0.3.1

- 安全策略改为自适应：优先尝试 Hanako runtime CSS 注入；没有运行时注入能力时，才在无 ASAR integrity 保护的旧版本上使用 ASAR transform。
- 检测到 Electron ASAR integrity metadata 时拒绝修改 `app.asar`，避免美化后 Hanako 无法启动。
- `asar-utils` 的通用 list/extract/createPackage 操作接入官方 `@electron/asar`，保留自定义 `transformPackage` 用于安全地替换已有文件并保留 header metadata。
- `status` 增加 `asarCompatibility`、`runtimeCss`、`supportedStrategies`、`bestStrategy` 和 `selectorReport`，用于判断不同 Hanako 版本的适配状态。

## 0.2.0

- beautify-core 重写：补丁注入逻辑重构，路径替换和 asar 处理更稳健
- restore 工具修复

## 0.1.9

- `buildInlineThemeCss` 路径替换改用正则，匹配 `url(./fonts/`、`url('./fonts/`、`url("./fonts/` 三种格式
- `resolvePaths` 使用 `PID-timestamp` 唯一临时目录名，解决并发 apply 时的冲突
- `defaultHanakoDir` 支持 macOS/Linux 候选路径，不再仅限 Windows
- `getStatus` 新增 `needsAdmin`、`actionRequired`、`summary` 字段
- `applyBeautify` 在备份源 asar 前校验其完整性，防止备份损坏文件
- `index.js` autoApply 分支先同步写 state，onunload 清除定时器后状态不丢失
- `package.json` scripts.check 移除不存在的 `install.cjs`

## 0.1.8

- `restoreBeautify` 加备份 asar 完整性校验
- `autoApply` 默认值改为 `false`
- `state.json` 承担缓存角色（`pluginVersion` + `asarMtimeMs`）
- `initPluginVersion`：运行时从 manifest.json 延迟读取版本号
- 过渡分层策略：交互元素保留完整过渡，结构容器仅 transform/opacity/border-color
- 尊重 `prefers-reduced-motion`

## 0.1.1

- 首个发布版本
