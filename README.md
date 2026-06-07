<p align="center">
  <strong>Hana UI Beautify</strong><br>
  <sub>鸿蒙黑体 · Apple Spring Animation · 可逆安全</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.9-blue" alt="version">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license">
  <img src="https://img.shields.io/badge/platform-Hanako%20Agent%20v0.293%2B-orange" alt="platform">
  <img src="https://img.shields.io/badge/font-HarmonyOS%20Sans%20SC-lightgrey" alt="font">
</p>

---

## 这是什么

Hanako 插件。将 Electron 客户端的系统字体替换为**鸿蒙黑体（HarmonyOS Sans SC）**，用 **Apple Spring Animation 曲线**替换默认动效，让界面渲染和交互手感对齐 macOS / iOS 的流畅度。

通过直接修改 `app.asar` 实现，而非运行时注入——确保字体和动效在整个渲染生命周期内稳定生效，不依赖 JS 钩子或 DOM 注入时机。

---

## 目录

- [快速开始](#快速开始)
- [设计理念](#设计理念)
- [特性](#特性)
- [技术方案](#技术方案)
  - [asar 操作流程](#asar-操作流程)
  - [CSS 注入策略](#css-注入策略)
  - [字体加载](#字体加载)
  - [动效系统](#动效系统)
- [安全设计](#安全设计)
- [API](#api)
- [配置](#配置)
- [安装](#安装)
- [故障恢复](#故障恢复)
- [开发](#开发)

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

重启 Hanako 生效。不想用了：

```
hanako-ui-beautify_restore
```

---

## 设计理念

主流 UI 美化方案通常走两条路：**运行时 JS 注入**（创建 `<style>` 标签）或 **Electron 协议拦截**。两条路都有根本问题——JS 注入依赖 DOM 就绪时机，FOUC（无样式内容闪烁）无法消除；协议拦截需要主进程权限，插件拿不到。

这个插件选择第三条路：**构建期注入**。直接在 `app.asar` 的 `styles.css` 末尾追加主题 CSS，让字体声明在所有样式计算之前就已经存在于样式表中。代价是修改了宿主文件——这带来了额外的安全需求。

四个核心决策：

1. **字体选鸿蒙黑体**。中英文混排质量优于思源黑体，字重覆盖完整（300/400/500/700），`font-display: swap` 保证首屏不堵塞。
2. **动效用 Spring 曲线**。CSS `cubic-bezier()` 精确复现 iOS 的弹性阻尼感，不是简单的 `ease` / `ease-in-out`。
3. **分层过渡策略**。交互元素保留全属性过渡，结构容器只过渡 transform/opacity/border-color，避免首次渲染时 background-color 过渡产生大面积闪烁。
4. **不自动应用**。默认 `autoApply: false`，用户主动控制何时美化——因为这是不可逆的外观变更，应该是一个主动决策。

---

## 特性

- 🔤 **鸿蒙黑体** 四字重（Light / Regular / Medium / Bold），`local()` 优先，系统已有则零网络开销
- 🎬 **Spring Animation** 六条缓动曲线，覆盖弹出层、按压反馈、hover 位移
- 🏗️ **分层过渡** 交互元素和结构容器使用不同过渡属性集，避免渲染闪烁
- ♿ **无障碍** 检测 `prefers-reduced-motion: reduce`，系统开启减弱动效时自动跳过所有动画
- 🛡️ **安全可逆** 三次校验（源文件、打包产物、部署结果），失败自动回滚
- 📦 **标记注入** CSS 以 `/* hana-beautify:begin */` 包裹，`restore` 能干净剥离
- ⚡ **零依赖** 除 `@electron/asar` 外无外部依赖

---

## 技术方案

### asar 操作流程

```
原始 app.asar
  │
  ├─ [1] 备份 → .hana-beautify-backups/app.asar.<sha256>.bak
  │
  ├─ [2] 解包 → 临时目录
  │
  ├─ [3] 定位 styles.css（递归搜索，支持未来目录结构变化）
  │
  ├─ [4] 剥离旧注入（正则匹配 begin/end 标记块）
  │
  ├─ [5] 追加 theme.css + 字体文件
  │
  ├─ [6] 重新打包 → 临时 asar
  │
  ├─ [7] 校验临时 asar 可读性
  │
  ├─ [8] 覆盖 app.asar
  │
  └─ [9] 校验部署结果 → 失败则从备份自动回滚
```

每一步失败后的行为不同：备份阶段失败（权限不足）直接报错，打包阶段失败原文件不受影响，部署阶段失败自动回滚。锁文件（`.hana-beautify.lock`）防止并发操作。

### CSS 注入策略

不创建新文件，直接追加到 `styles.css` 末尾。选择这个位置的原因：

- `styles.css` 是 Electron 主渲染进程的核心样式表，在所有组件之前加载
- 追加到末尾意味着 `@font-face` 声明在所有规则之前被解析，`@layer` 覆盖在后
- 标记块格式：`/* hana-beautify:begin */ ... /* hana-beautify:end */`，内嵌来源哈希（`hana-beautify:source-sha256=<hex>`），用于 `restore` 时校验清除完整性

### 字体加载

```css
@font-face {
  font-family: 'HarmonyOS Sans SC';
  src: local('HarmonyOS Sans SC'), local('HarmonyOS_Sans_SC'),
       url('./fonts/harmonyos-sans-sc-regular.woff2') format('woff2');
  font-display: swap;
}
```

- `local()` 双名匹配：覆盖 HarmonyOS 官方和社区两种本地字体名
- `font-display: swap`：字体未加载时先用系统回退字体，避免白屏
- 以 `./themes/fonts/` 的相对路径注入 asar，引用注入到同目录的 woff2 文件

字体文件来自 [OpenHarmony 全局系统资源](https://gitee.com/openharmony/global_system_resources)，基于 HarmonyOS Sans Fonts License。

### 动效系统

六条缓动曲线，每条对应一种交互语义：

| Token | 曲线 | 用途 |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | 元素出现 / 展开 |
| `--ease-in` | `cubic-bezier(0.32, 0, 0.67, 0)` | 元素消失 / 收起 |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | 属性过渡 |
| `--ease-smooth` | `cubic-bezier(0.37, 0, 0.16, 1)` | 平滑切换 |
| `--ease-out-back` | `cubic-bezier(0.2, 1.12, 0.32, 1)` | 弹性出现 |
| (press) | `transform: scale(0.985)` | 按压反馈 |

三级时长：`--duration-instant` 0.14s / `--duration-fast` 0.22s / `--duration-slow` 0.36s。

元素分层过渡策略——交互元素（按钮、链接、输入框）过渡全属性（background-color, color, border-color, box-shadow, opacity, transform, filter）；结构容器（侧边栏、消息卡片、弹出菜单）只过渡 border-color, box-shadow, opacity, transform, filter，排除 background-color 和 color。这是因为结构容器首次渲染时可能从初始态过渡到终态，background/color 过渡会导致大范围可见闪烁。

---

## 安全设计

### 三层校验

| 阶段 | 校验项 | 失败行为 |
|---|---|---|
| 打包前 | 源 `app.asar` 可被 `asar.listPackage()` 读取 | 拒绝操作 |
| 打包后 | 临时 asar 可被 `asar.listPackage()` 读取 | 丢弃临时文件，原文件未被修改 |
| 部署后 | 已部署 `app.asar` 可被 `asar.listPackage()` 读取 | 自动回滚备份 |

### 备份策略

- 首次 `apply` 创建备份：`resources/.hana-beautify-backups/app.asar.<sha256>.bak`
- 基于源文件 SHA256 命名，同一版本重复 `apply` 不会产生重复备份
- 向后兼容旧版备份路径：`resources/app.asar.bak`
- `restore` 优先匹配 `sourceHash` 对应的备份，找不到则用最新备份

### 并发保护

锁文件 `resources/.hana-beautify.lock`，10 分钟超时自动解除。防止多个 Hanako 实例或 Agent 操作冲突。

### 干净还原

`stripPreviousInjection()` 用正则匹配标记块，同时移除 `@import url('./themes/hana-beautify.css')` 语句（兼容旧版注入格式）。还原后 `styles.css` 与原始文件逐字节一致（gzip 压缩可能导致空格差异，但功能等价）。

---

## API

三个工具，Agent 和用户均可直接调用。

| 工具 | 用途 |
|---|---|
| `hanako-ui-beautify_status` | 诊断当前状态（已应用 / 权限不足 / 需重启） |
| `hanako-ui-beautify_apply` | 应用美化补丁（已应用时可加 `force` 重装） |
| `hanako-ui-beautify_restore` | 从备份恢复原始界面 |

### status

返回人类可读的 summary 和结构化诊断数据：

```json
{
  "applied": true,
  "markerApplied": true,
  "assetsPresent": true,
  "canWrite": true,
  "needsAdmin": false,
  "needsRestart": false,
  "sourceHash": "abc123...",
  "backups": ["app.asar.abc123.bak"],
  "fontFiles": ["harmonyos-sans-sc-regular.woff2", "..."],
  "asarFontCount": 4,
  "summary": "✅ 已美化"
}
```

### apply

```json
// 正常应用
{}

// 强制重新应用（已美化状态下）
{ "force": true }

// 指定 Hanako 安装目录
{ "hanakoInstallDir": "D:\\Hanako" }
```

前置条件检查顺序：`app.asar` 存在 → 有写入权限 → 未被其他实例锁定 → 源文件可被 asar 读取。任一失败立即报错，原文件不受影响。

### restore

```json
// 默认使用 sourceHash 匹配的备份
{}

// 指定备份文件
{ "backupPath": "C:\\...\\app.asar.abc123.bak" }
```

---

## 配置

两项配置，在 Hanako 设置 → 插件中调整。

| 键 | 默认 | 说明 |
|---|---|---|
| `autoApply` | `false` | 启动时自动应用美化 |
| `hanakoInstallDir` | `C:\Program Files\Hanako` | Hanako 安装目录（自动检测，可以手动指定） |

> 推荐保持 `autoApply: false`。这是一次性操作，不需要每次启动都检查。

---

## 安装

### 依赖

- Hanako Agent ≥ v0.293.0
- Node.js ≥ 18
- 插件权限：全权限（`full-access`）
- **Windows**：`C:\Program Files\Hanako` 默认需要管理员权限才能写入 → 首次 `apply` 需以管理员身份运行 Hanako
- **macOS**：应用目录通常可写，无需提权

### 步骤

```powershell
git clone https://github.com/326sun/hanako-ui-beautify.git
cd hanako-ui-beautify
npm install
npm run install-plugin
```

启用插件后，立即调用 `hanako-ui-beautify_apply`。重启 Hanako 生效。

升级：

```powershell
git pull
npm install
npm run install-plugin
```

更多细节见 [INSTALL.md](./INSTALL.md)。

---

## 故障恢复

美化后 Hanako 打不开？手动恢复：

```powershell
# 默认路径
copy "C:\Program Files\Hanako\resources\app.asar.bak" "C:\Program Files\Hanako\resources\app.asar"

# 或新版备份路径
copy "C:\Program Files\Hanako\resources\.hana-beautify-backups\app.asar.<哈希>.bak" "C:\Program Files\Hanako\resources\app.asar"
```

如果插件还在但没 restore：直接在 Hanako 里让 Agent 调用 `hanako-ui-beautify_restore`。如果插件已删，手动复制备份文件。

---

## 开发

```powershell
npm install
npm test
```

测试覆盖 `escapeRegExp`、`stripPreviousInjection`、路径解析、备份哈希匹配逻辑。

```
hanako-ui-beautify/
├── index.js               # 插件入口，autoApply 逻辑
├── lib/
│   ├── beautify-core.js    # apply/restore/status 核心实现
│   └── hana-runtime-compat.js  # Pi 框架兼容层
├── theme.css               # 主题 CSS（字体 + 动效 tokens）
├── fonts/                  # 鸿蒙黑体 woff2（四字重）
├── tools/                  # 独立工具脚本（status/apply/restore/install）
└── manifest.json           # 插件声明
```

---

## License

代码 MIT。鸿蒙黑体基于 [HarmonyOS Sans Fonts License](https://gitee.com/openharmony/global_system_resources/blob/master/LICENSE_Fonts)。
