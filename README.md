# Hana UI Beautify

不会安装、看不懂插件应该放哪里时，先看 [`INSTALL.md`](./INSTALL.md)。那是一份面向普通用户和其他 Agent 的傻瓜安装教程。

> **警告 — 全权限插件**
>
> 此插件会修改 Hanako 安装目录下的 `resources/app.asar`。
> 在 Windows 上，`C:\Program Files\HanaAgent`（或旧版 `C:\Program Files\Hanako`）通常需要**管理员权限**才能写入。
> 插件在修改前会将 `app.asar` 备份为 `app.asar.bak`，
> 但**卸载前务必先执行 `restore` 工具**——否则视觉补丁会在删除插件后残留。

[Hanako](https://github.com/liliMozi/openhanako) 桌面应用的插件式 UI 美化包。

## 功能

将 Hanako 默认 UI 字体替换为 **HarmonyOS Sans SC（鸿蒙黑体）**，并注入统一动效曲线，
让界面过渡更流畅。整个操作是对 `app.asar` 的可逆 CSS 补丁，不触碰任何 JS 逻辑。

- **字体替换**：4 个字重 WOFF2 文件（Light / Regular / Medium / Bold）
- **动效标记**：Apple Spring Animation 缓动曲线
- **可逆操作**：`apply` / `restore` 工具，自动备份

## 架构

```
npm install ──→ install.cjs ──→ ~/.hanako/plugins/hanako-ui-beautify/
                                      │
Hanako 启动 ──→ onload() ──→ 自动检测 ──→ 未注入则 apply
                                      │
Agent 工具 ──→ status / apply / restore ──→ beautify-core.js
                                      │
                                      └── @electron/asar ──→ app.asar CSS 补丁
```

插件不依赖 Hanako 的渲染器 API，而是通过 `@electron/asar` 直接管理资源补丁，
因此需要全权限信任。内联 CSS 以 `/* hana-beautify:begin */` 和
`/* hana-beautify:end */` 标记追加到 `app.asar` 内的 `styles.css` 末尾，便于干净移除。

## 安装

```powershell
git clone https://github.com/326sun/hanako-ui-beautify.git
cd hanako-ui-beautify
npm install
npm run install-plugin
```

重启 Hanako，在 **设置 → 插件** 中：

1. 打开 **允许全权限插件**
2. 启用 **Hana UI Beautify**

默认配置下，插件启用后只检查状态，不会立刻修改 `app.asar`。直接调用 `apply` 工具应用补丁即可（内部已做完整前置校验）。
若你在配置中打开 `autoApply`，插件会在启动后把 apply 放到后台执行，避免阻塞插件加载。

如果 `C:\Program Files\HanaAgent\resources` 可写，`apply` 可直接执行；否则需要以管理员身份运行一次 Hanako，
或从提权会话调用 `apply` 工具。旧安装路径 `C:\Program Files\Hanako` 仍会被自动探测。

## 工具

| 工具 | 说明 |
|------|------|
| `status` | 检查美化是否已应用、安装目录是否可写 |
| `apply` | 应用（或强制重新应用）美化 CSS 补丁 |
| `restore` | 从 `app.asar.bak` 恢复原始 `app.asar` |

## 配置

插件在 Hanako 的插件配置面板中暴露两个设置项：

| 键 | 类型 | 默认值 | 说明 |
|-----|------|--------|------|
| `autoApply` | 布尔 | `false` | 插件加载后在后台自动应用美化 |
| `hanakoInstallDir` | 字符串 | `C:\Program Files\HanaAgent` | Hanako 安装路径；未配置时会自动探测旧版 `Hanako` 路径 |

## 卸载

1. 执行 `restore` 工具还原 `app.asar`
2. 在 设置 → 插件 中禁用插件
3. 删除 `~/.hanako/plugins/hanako-ui-beautify/`

如果插件已被删除，手动将 `app.asar.bak` 复制回 `app.asar`：

```powershell
# 默认安装路径
copy C:\Program Files\HanaAgent\resources\app.asar.bak C:\Program Files\HanaAgent\resources\app.asar
# 旧版安装路径
copy C:\Program Files\Hanako\resources\app.asar.bak C:\Program Files\Hanako\resources\app.asar
```

## 字体许可

HarmonyOS Sans SC 字体由**华为终端有限公司**提供，基于
[HarmonyOS Sans Fonts License Agreement](https://gitee.com/openharmony/global_system_resources/blob/master/LICENSE_Fonts) 授权。
详见 [`fonts/LICENSE_Fonts`](./fonts/LICENSE_Fonts)。

使用此插件即表示你同意：

- 在任何副本中保留版权声明和许可协议
- 在软件中显著声明使用了 HarmonyOS Sans 字体
- 不得以独立形式重新分发或销售字体文件

字体来源：[OpenHarmony global_system_resources](https://gitee.com/openharmony/global_system_resources)

## 参与贡献

此插件属于 [`hanako-supplement`](https://github.com/326sun/hanako-supplement) 系列。
欢迎提交贡献：

1. Fork 本仓库
2. 创建特性分支（`git checkout -b feat/你的特性`）
3. 提交修改（`git commit -m 'feat: 简短描述'`）
4. 推送到分支（`git push origin feat/你的特性`）
5. 发起 Pull Request

提交前请运行：

```powershell
npm run check
```

此命令校验所有源文件的语法。插件源码使用 ESM（`.js` 文件配合 `package.json` 中的
`"type": "module"`），安装脚本使用 CommonJS（`.cjs` 扩展名）。

### 项目结构

```
hanako-ui-beautify/
├── install.cjs          # 插件安装器（CommonJS）
├── package.json         # ESM 声明 + @electron/asar 依赖
├── manifest.json        # Hanako 插件清单
├── index.js             # 插件入口（onload）
├── theme.css            # CSS 补丁（字体 + 动效标记）
├── fonts/               # HarmonyOS Sans SC WOFF2 文件 + LICENSE_Fonts
├── lib/
│   └── beautify-core.js # 核心逻辑：apply / restore / status
└── tools/
    ├── status.js        # Agent 工具：检查美化状态
    ├── apply.js         # Agent 工具：应用美化
    └── restore.js       # Agent 工具：恢复原始 asar
```

## 许可证

插件代码：MIT。字体文件：见[字体许可](#字体许可)。
