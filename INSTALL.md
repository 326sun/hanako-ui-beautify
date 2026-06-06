# Hana UI Beautify 傻瓜安装教程

这个插件用于美化 Hanako UI 字体和动效。它会在你确认后修改 Hanako 的 `resources/app.asar`，所以请按步骤来。

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
git clone https://github.com/326sun/hanako-ui-beautify.git
cd hanako-ui-beautify
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
7. 启用 `Hana UI Beautify`。

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

先不要慌。插件会备份原始文件。根据你的安装路径选一条命令：

**如果安装在 `C:\Program Files\HanaAgent`（默认）：**

```powershell
copy "C:\Program Files\HanaAgent\resources\app.asar.bak" "C:\Program Files\HanaAgent\resources\app.asar"
```

**如果安装在 `C:\Program Files\Hanako`（旧版）：**

```powershell
copy "C:\Program Files\Hanako\resources\app.asar.bak" "C:\Program Files\Hanako\resources\app.asar"
```

如果不确定安装在哪个目录，检查 `resources\app.asar.bak` 在哪个路径下存在。

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
