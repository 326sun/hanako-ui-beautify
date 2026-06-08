<p align="center">
  <strong>Hana UI Beautify</strong><br>
  <sub>鸿蒙黑体 · Apple Spring Animation · 自适应注入 · 可逆安全</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.3.3-blue" alt="version">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license">
  <img src="https://img.shields.io/badge/platform-Hanako%20Agent%20v0.293%2B-orange" alt="platform">
  <img src="https://img.shields.io/badge/node-%E2%89%A518-brightgreen" alt="node">
  <img src="https://img.shields.io/badge/font-HarmonyOS%20Sans%20SC-lightgrey" alt="font">
  <img src="https://img.shields.io/badge/tests-22%2F22-success" alt="tests">
</p>

---

## 这是什么

Hanako 插件。将 Electron 客户端的系统字体替换为**鸿蒙黑体（HarmonyOS Sans SC）**，用 **Apple Spring Animation 曲线**替换默认动效。

v0.3.0 引入自适应策略：优先使用零文件修改的运行时 CSS 注入；仅在旧版 Hanako 无运行时注入能力时，才降级到安全的 ASAR transform。macOS 代码签名环境下自动阻塞 ASAR 路径，防止 Gatekeeper 拦截。

---

## 快速开始

```powershell
git clone https://github.com/326sun/hanako-ui-beautify.git
cd hanako-ui-beautify
npm install
npm run install-plugin
```

在 Hanako 设置中启用插件，然后让 Agent 执行：

```
hanako-ui-beautify_apply
```

重启 Hanako 生效。恢复：

```
hanako-ui-beautify_restore
```

---

## 自适应策略

美化应用按优先级尝试三种策略：

| 优先级 | 策略 | 文件修改 | 适用场景 |
|---|---|---|---|
| 1 | **运行时 CSS 注入** | 零修改 | 新版 Hanako 支持 `ctx.renderer.insertCSS` |
| 2 | **ASAR transform** | 修改 `app.asar` | 旧版 Hanako，无 Electron ASAR integrity |
| 3 | **阻塞** | 拒绝操作 | macOS 代码签名 / Electron integrity metadata |

`status` 工具会报告当前环境的最佳策略。在支持运行时注入的版本上，美化不需要管理员权限。

---

## 特性

- 🔤 **鸿蒙黑体** 四字重（Light / Regular / Medium / Bold），`local()` 优先 → `font-display: swap` 浏览器按需下载
- 🎬 **Spring Animation** 六条缓动曲线，三条时长层级，复现 iOS 弹性阻尼感
- 🏗️ **分层过渡** 交互元素全属性过渡，结构容器仅 transform/opacity/border-color，消除首帧大面积闪烁
- ♿ **无障碍** 检测 `prefers-reduced-motion: reduce`，系统开启减弱动效时跳过全部动画
- 🛡️ **安全可逆** 源/产物/部署三次校验 + 自动回滚；锁文件防并发；备份按 SHA256 命名去重
- 🍎 **macOS 感知** 检测代码签名 → 阻塞 ASAR 路径 → 引导运行时注入，避免 Gatekeeper 拦截
- 📦 **轻量依赖** 仅 `@electron/asar` 提供格式兼容的 ASAR 读写，核心 transform 自研

---

## API

| 工具 | 用途 |
|---|---|
| `hanako-ui-beautify_status` | 诊断：已应用/策略可用性/权限/签名状态 |
| `hanako-ui-beautify_apply` | 应用美化（支持 force / strategy / probeRuntimeCss） |
| `hanako-ui-beautify_restore` | 从备份恢复原始界面 |

---

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `autoApply` | `false` | 启动时自动应用 |
| `strategy` | `auto` | 应用策略：auto / runtime / asar |
| `probeRuntimeCss` | `false` | 探测未公开的运行时 CSS 通道 |
| `hanakoInstallDir` | `C:\Program Files\Hanako` | 安装目录（自动检测，可手动指定） |

---

## 安全设计

### 三层校验

| 阶段 | 校验 | 失败行为 |
|---|---|---|
| 打包前 | 源 asar 可读 + 渲染器文件完整 | 拒绝操作 |
| 打包后 | 临时 asar 可读 + 美化标记存在 + 渲染器健康 | 丢弃临时文件 |
| 部署后 | 已部署 asar 可读 + 标记完整 | 自动回滚备份 |

### 并发保护

锁文件 `.hana-beautify.lock`，10 分钟超时。`publishAtomically` 使用同卷 rename，防止跨卷复制留下半个文件。

### ASAR 完整性检测

检测 Electron `integrity` metadata 和 macOS `_CodeSignature`，存在时拒绝修改 `app.asar`。

---

## 安装

依赖：Hanako Agent ≥ v0.293.0 / Node.js ≥ 18 / `full-access` 插件权限。

Windows 上 `C:\Program Files\Hanako` 默认需管理员权限 → 自 v0.3.0 起，支持运行时注入的版本不再需要提权。

```powershell
git clone https://github.com/326sun/hanako-ui-beautify.git
cd hanako-ui-beautify
npm install
npm run install-plugin
```

升级：`git pull && npm install && npm run install-plugin`

---

## 故障恢复

美化后 Hanako 打不开：

```powershell
# 默认备份路径
copy "C:\Program Files\Hanako\resources\.hana-beautify-backups\app.asar.<hash>.bak" "C:\Program Files\Hanako\resources\app.asar"
```

---

## 开发

```
hanako-ui-beautify/
├── index.js                # 插件入口，autoApply 逻辑
├── lib/
│   ├── beautify-core.js     # apply/restore/status 核心实现
│   ├── adaptive-beautify.js # 自适应策略选择（runtime → asar → blocked）
│   ├── asar-utils.js         # ASAR 读写（委托 @electron/asar + 自定义 transformPackage）
│   ├── runtime-css.js        # 运行时 CSS 注入（多通道降级探测）
│   └── hana-runtime-compat.js # Pi 框架兼容层
├── theme.css                # 主题 CSS（字体 + motion tokens + 分层过渡）
├── fonts/                   # 鸿蒙黑体 woff2
├── tools/                   # status / apply / restore 工具
├── tests/                   # 22 项测试
└── manifest.json
```

```powershell
npm install
npm run check   # 语法检查
npm test        # 22 项测试
```

---

## License

代码 MIT。鸿蒙黑体基于 [HarmonyOS Sans Fonts License](https://gitee.com/openharmony/global_system_resources/blob/master/LICENSE_Fonts)。
