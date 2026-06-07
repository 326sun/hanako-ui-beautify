# Hana UI Beautify

不会安装时先看 [`INSTALL.md`](./INSTALL.md)。

Hanako 桌面应用的插件式 UI 美化包。通过可逆的 `app.asar` CSS 补丁，替换默认字体并注入统一动效曲线。

## 为什么做

Hanako 的 Electron 渲染层字体回退到系统默认（Windows 下通常是微软雅黑），缺乏统一的动效语言。这个插件提供了一种安全可逆的方式定制渲染层外观，不需要修改 Hanako 源码，也不需要每次升级后重新操作。

## 功能

- **鸿蒙黑体（HarmonyOS Sans SC）**：4 个字重 WOFF2（Light / Regular / Medium / Bold），带 `ascent-override` 锚定消除 FOUT 闪烁
- **Apple Spring Animation 缓动曲线**：三层过渡分层（交互元素 / 结构容器 / 弹出层），`prefers-reduced-motion: reduce` 自动关闭所有注入动画
- **可逆**：apply 前自动备份 `app.asar.bak`，restore 一键还原
- **安全**：重新打包后进行完整性校验（listPackage），部署后再做磁盘校验；校验失败自动从备份回滚
- **内联标记**：CSS 以 `/* hana-beautify:begin */` 和 `/* hana-beautify:end */` 包裹，便于干净移除和状态检测

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
| `hanakoInstallDir` | string | `C:\Program Files\Hanako` | Hanako 安装路径 |

默认不自动应用（`autoApply: false`），用户需手动调用 `apply` 或在设置中显式开启。

## 卸载

1. 执行 `restore` 还原 app.asar
2. 禁用并删除插件目录 `~/.hanako/plugins/hanako-ui-beautify/`

## 字体许可

HarmonyOS Sans SC 由华为终端有限公司提供，基于 [HarmonyOS Sans Fonts License](https://gitee.com/openharmony/global_system_resources/blob/master/LICENSE_Fonts) 授权。字体文件随插件分发，不修改、不重新打包。

## 许可证

插件代码：MIT。字体：见上。
