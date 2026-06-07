# Hana UI Beautify

不会安装时先看 [`INSTALL.md`](./INSTALL.md)。

> **全权限插件** — 此插件修改 Hanako 安装目录下的 `resources/app.asar`。
> 修改前会自动备份 `app.asar.bak`，卸载前执行 `restore` 即可还原。

[Hanako](https://github.com/liliMozi/openhanako) 的插件式 UI 美化包。

## 功能

将 Hanako 默认 UI 字体替换为 **HarmonyOS Sans SC（鸿蒙黑体）**，注入统一动效曲线。
整个操作是对 `app.asar` 的可逆 CSS 补丁。

- **字体替换**：4 个字重 WOFF2（Light / Regular / Medium / Bold），带 `ascent-override` 锚定消除 FOUT 闪烁
- **动效**：Apple Spring Animation 缓动曲线，三层过渡分层（交互元素 / 结构容器 / 弹出层），避免设置页面首次渲染闪烁
- **无障碍**：`prefers-reduced-motion: reduce` 自动关闭所有注入动画
- **可逆**：`apply` / `restore` 工具，自动备份，打包后完整性校验

## 架构

```
Hanako 启动 ──→ onload() ──→ 自动检测 ──→ 未注入则 apply
Agent 工具 ──→ status / apply / restore ──→ beautify-core.js
                                           └── @electron/asar → app.asar CSS 补丁
```

内联 CSS 以 `/* hana-beautify:begin */` 和 `/* hana-beautify:end */` 标记，便于干净移除。

## 安装

```powershell
git clone https://github.com/326sun/hanako-ui-beautify.git
cd hanako-ui-beautify
npm install
npm run install-plugin
```

重启 Hanako，设置 → 插件 → 启用 **Hana UI Beautify**。

## 工具

| 工具 | 说明 |
|------|------|
| `status` | 检查美化状态、字体文件、可写权限 |
| `apply` | 应用（或强制重新应用）美化补丁 |
| `restore` | 从备份恢复原始 app.asar |

## 配置

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `autoApply` | boolean | false | 启动后自动应用美化 |
| `hanakoInstallDir` | string | `C:\Program Files\HanaAgent` | Hanako 安装路径 |

## 卸载

1. 执行 `restore` 还原 app.asar
2. 禁用并删除插件目录

## 字体许可

HarmonyOS Sans SC 由华为终端有限公司提供，基于 [HarmonyOS Sans Fonts License](https://gitee.com/openharmony/global_system_resources/blob/master/LICENSE_Fonts) 授权。

## 许可证

插件代码：MIT。字体：见上方许可。
