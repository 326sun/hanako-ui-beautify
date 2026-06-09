# Hanako UI Beautify 安装指南

美化 Hanako UI 字体和动效。应用前需用户确认，按步骤操作即可。

## 你需要知道的一句话

插件代码安装到：

```text
%USERPROFILE%\.hanako\plugins\hanako-ui-beautify
```

不要手动把插件复制到 `C:\Program Files\Hanako`。

## 普通用户安装步骤

**前提：电脑需要安装 Git 和 Node.js（版本 18 或更高）。**
没有 Node.js？用 Hanako 自带的 Node 替代：把下面命令里的 `npm install` 和 `npm run install-plugin` 替换为：

```powershell
& "$env:USERPROFILE\.hanako\current\node.exe" install.cjs
```

1. 关闭 Hanako。
2. 打开 PowerShell。
3. 复制下面命令：

```powershell
cd $env:USERPROFILE\Downloads
git clone https://github.com/326sun/Hanako-ui-beautify.git
cd Hanako-ui-beautify
npm install
npm run install-plugin
```

看到这些字样就表示插件代码安装成功：

```text
Installed to C:\Users\你的用户名\.hanako\plugins\hanako-ui-beautify
OK    manifest.json
OK    index.js
OK    tools/status.js
OK    node_modules/@electron/asar/package.json
```

4. 打开 Hanako。
5. 进入 `设置 -> 插件`。
6. 打开 `允许全权限插件`。
7. 启用 `Hanako UI Beautify`。

默认情况下，插件只检查状态，不会自动改 `app.asar`。要应用美化，请在 Hanako 中让 Agent 调用：

```text
hanako-ui-beautify_status
hanako-ui-beautify_apply
```

## 如果提示没有权限

Windows 安装在 `C:\Program Files` 下的软件通常需要管理员权限。可以选择：

1. 用管理员身份运行一次 Hanako，再调用 `hanako-ui-beautify_apply`。
2. 或者用管理员 PowerShell 启动 Hanako 后再执行 apply。

## 如果美化后 Hanako 打不开

先不要慌。插件每次应用前都会把原始 `app.asar` 备份到 `resources\.hana-beautify-backups\`，文件名形如 `app.asar.<哈希>.bak`。

下面这条命令会自动找到**最近一次**的备份并还原（把 `$res` 改成你的安装目录即可）。默认安装目录是 `C:\Program Files\Hanako`，旧版/部分渠道是 `C:\Program Files\HanaAgent`：

```powershell
# 默认：C:\Program Files\Hanako；旧版改成 C:\Program Files\HanaAgent
$res = "C:\Program Files\Hanako\resources"
$bak = Get-ChildItem "$res\.hana-beautify-backups\app.asar.*.bak" -ErrorAction SilentlyContinue |
       Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($bak) {
  Copy-Item $bak.FullName "$res\app.asar" -Force
  "已从 $($bak.Name) 还原"
} else {
  "没找到备份，检查 $res\.hana-beautify-backups\ 是否存在 .bak 文件"
}
```

> 提示：如果 Hanako 还能打开，直接让 Agent 调用 `hanako-ui-beautify_restore` 更稳妥——它会精确匹配你当前版本对应的备份。手动还原仅用于客户端已经打不开、无法调用工具的情况。
>
> 极旧版本可能只有单文件备份 `resources\app.asar.bak`（没有 `.hana-beautify-backups` 目录）。若上面的命令找不到备份，再尝试 `copy "$res\app.asar.bak" "$res\app.asar"`。

## 升级步骤

进入插件源码目录，执行：

```powershell
git pull
npm install
npm run install-plugin
```

安装脚本会替换：

```text
%USERPROFILE%\.hanako\plugins\hanako-ui-beautify
```

不会删除 Hanako 本体。

## 删除旧重复目录

如果你以前装过旧版，可能有旧目录：

```text
%USERPROFILE%\.hanako\plugins\hana-ui-beautify
```

可以删除：

```powershell
Remove-Item -Recurse -Force $env:USERPROFILE\.hanako\plugins\hana-ui-beautify -ErrorAction SilentlyContinue
```

保留新版目录：

```text
%USERPROFILE%\.hanako\plugins\hanako-ui-beautify
```

## 给 Agent 的安装检查清单

安装或升级时必须检查：

1. `manifest.json` 的 `id` 必须是 `hanako-ui-beautify`。
2. 插件目录必须是 `%USERPROFILE%\.hanako\plugins\hanako-ui-beautify`。
3. 若存在旧目录 `hana-ui-beautify`，删除旧目录。
4. `apply` 内部已做完整前置校验（路径、权限、已 applied），不需要先调 `status`。`apply` 失败时再用 `status` 诊断原因。
5. 不要强制 apply，除非用户明确要求。
6. restore 前后都要确认 asar 可读。
