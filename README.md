# Hana UI Beautify Plugin

> **WARNING — Full-Access Plugin**
>
> This plugin modifies `resources/app.asar` inside the Hanako install directory.
> On Windows, `C:\Program Files\Hanako` typically requires **administrator permission**
> for writes. The apply/restore logic backs up `app.asar` to `app.asar.bak` before
> any change, but **run the `restore` tool before uninstalling the plugin** —
> otherwise the visual patch may remain even after the plugin is removed.

Plugin-managed UI beautify pack for official Hanako.

It installs as a community plugin and, when enabled, automatically tries to apply:

- HarmonyOS Sans SC UI fonts.
- Unified motion tokens and smoother transition timing.
- A reversible `app.asar` CSS patch with backup.

## Install

```powershell
npm install
npm run install-plugin
```

Then restart Hanako and enable it from Settings > Plugins:

1. Enable `Allow full-access plugins`.
2. Enable `Hana UI Beautify`.

## Important

Hanako's current community plugin API does not expose live global CSS injection for the main renderer. This plugin therefore manages the same reversible renderer asset patch that the standalone beautify installer uses.

If Hanako is installed under `C:\Program Files\Hanako`, Windows may require administrator permission before the plugin can write `resources/app.asar`. When write permission is available, enabling the plugin applies the patch automatically. Restart Hanako after the first apply.

## Tools

- `status`: check whether beautify is applied and whether the install directory is writable.
- `apply`: apply or reapply the beautify patch.
- `restore`: restore `app.asar` from `app.asar.bak`.

## Font License

HarmonyOS Sans SC fonts are provided by Huawei Device Co., Ltd. under the
HarmonyOS Sans Fonts License Agreement. See `fonts/LICENSE_Fonts` for the full text.

Key obligations:
- Retain the copyright notice and license in any copies.
- Make a prominent notice in the software that HarmonyOS Sans Fonts are used.
- Fonts may not be redistributed or sold on a stand-alone basis.

Font source: <https://gitee.com/openharmony/global_system_resources>

## Uninstall

1. Run the plugin's `restore` tool to revert `app.asar`.
2. Disable or delete `~/.hanako/plugins/hana-ui-beautify/`.

If the restore tool is unavailable (plugin already removed), copy
`C:\Program Files\Hanako\resources\app.asar.bak` back to `app.asar` manually.