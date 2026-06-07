# Hana UI Beautify

不会装？先看 [`INSTALL.md`](./INSTALL.md)。

**把 Hanako 的系统默认字体换成鸿蒙黑体，让界面动效像苹果设备一样流畅。** 可逆、安全，不影响升级。

## 做什么

- 字体换成 **HarmonyOS Sans SC**（鸿蒙黑体），4 个字重齐全
- 按钮、面板、弹窗的过渡动画换成 Apple Spring Animation 曲线，不卡不顿
- 如果你系统开了"减弱动态效果"，插件自动跳过所有动画

## 装

```powershell
git clone https://github.com/326sun/hanako-ui-beautify.git
cd hanako-ui-beautify
npm install
npm run install-plugin
```

重启 Hanako，设置 → 插件 → 启用 **Hana UI Beautify**。

> Windows 下 `C:\Program Files\Hanako` 默认需要管理员权限才能写入。插件装好后调用 `apply` 工具，或在设置页面手动点应用。

## 工具

| 工具 | 做什么 |
|------|--------|
| `status` | 看美化状态（已美化/需管理员/未应用），返回人类可读的 summary |
| `apply` | 应用美化补丁（已应用时可加 `force` 重装） |
| `restore` | 一键还原到原始界面 |

## 测试

```powershell
npm run test        # 13 个单元测试（路径替换、注入剥离、正则转义）
```

## 安全设计

- 应用前自动备份 `app.asar.bak`
- 重新打包后校验完整性，损坏自动回滚
- CSS 补丁以 `/* hana-beautify:begin */` 标记包裹，`restore` 能干净移除
- 默认不自动应用（`autoApply: false`），你主动控制何时美化

## 卸

1. 先调 `restore` 还原
2. 设置里禁用插件，删 `~/.hanako/plugins/hanako-ui-beautify/`

如果插件已删但还没 restore：手动把 `app.asar.bak` 复制回 `app.asar` 就行。

## 字体

鸿蒙黑体由华为提供，基于 [HarmonyOS Sans Fonts License](https://gitee.com/openharmony/global_system_resources/blob/master/LICENSE_Fonts)。详见 `fonts/LICENSE_Fonts`。

代码 MIT，字体见许可。
