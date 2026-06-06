# Hana UI Beautify

> **WARNING — Full-Access Plugin**
>
> This plugin modifies `resources/app.asar` inside the Hanako install directory.
> On Windows, `C:\Program Files\Hanako` typically requires **administrator permission**
> for writes. The plugin backs up `app.asar` to `app.asar.bak` before any change,
> but **always run the `restore` tool before uninstalling** — otherwise the visual
> patch persists after plugin removal.

Plugin-managed UI beautify pack for the [Hanako](https://github.com/liliMozi/openhanako) desktop app.

## What It Does

Replaces Hanako's default UI font with **HarmonyOS Sans SC** (鸿蒙黑体) and injects
unified motion tokens for smoother transitions. The entire operation is a reversible
CSS-only patch on `app.asar` — no JavaScript logic is touched.

- **Font replacement**: 4 weight-variant WOFF2 files (Light / Regular / Medium / Bold)
- **Motion tokens**: Apple Spring Animation easing curves for UI transitions
- **Reversible**: `apply` / `restore` tools with automatic backup

## Architecture

```
npm install ──→ install.cjs ──→ ~/.hanako/plugins/hana-ui-beautify/
                                      │
Hanako startup ──→ onload() ──→ auto-detect ──→ apply if clean
                                      │
Agent tools ──→ status / apply / restore ──→ beautify-core.js
                                      │
                                      └── @electron/asar ──→ app.asar CSS patch
```

The plugin does **not** require Hanako's renderer API. It manages the asset patch
directly via `@electron/asar`, which is why it needs full-access trust. The inline
CSS is appended to `styles.css` inside `app.asar` with `/* hana-beautify:begin */`
and `/* hana-beautify:end */` markers for clean removal.

## Install

```powershell
git clone https://github.com/326sun/hana-ui-beautify.git
cd hana-ui-beautify
npm install
npm run install-plugin
```

Then restart Hanako and enable from **Settings → Plugins**:

1. Toggle **Allow full-access plugins**
2. Enable **Hana UI Beautify**

If `C:\Program Files\Hanako\resources` is writable, the plugin auto-applies on
first load. Otherwise, run Hanako once as administrator or invoke the `apply`
tool from an elevated session.

## Tools

| Tool | Description |
|------|-------------|
| `status` | Check whether beautify is applied and whether the install directory is writable |
| `apply` | Apply (or force reapply) the beautify CSS patch |
| `restore` | Restore `app.asar` from `app.asar.bak` |

## Configuration

The plugin exposes two settings via Hanako's plugin configuration panel:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `autoApply` | boolean | `true` | Automatically apply beautify on plugin load |
| `hanakoInstallDir` | string | `C:\Program Files\Hanako` | Path to the Hanako installation |

## Uninstall

1. Run the `restore` tool to revert `app.asar`
2. Disable the plugin in Settings → Plugins
3. Delete `~/.hanako/plugins/hana-ui-beautify/`

If the plugin is already removed, manually copy `app.asar.bak` back to `app.asar`:

```powershell
copy C:\Program Files\Hanako\resources\app.asar.bak C:\Program Files\Hanako\resources\app.asar
```

## Font License

HarmonyOS Sans SC fonts are provided by **Huawei Device Co., Ltd.** under the
[HarmonyOS Sans Fonts License Agreement](https://gitee.com/openharmony/global_system_resources/blob/master/LICENSE_Fonts).
See [`fonts/LICENSE_Fonts`](./fonts/LICENSE_Fonts) for the full text.

By using this plugin you agree to:

- Retain the copyright notice and license in any copies
- Include a prominent notice that HarmonyOS Sans Fonts are used
- Not redistribute or sell the font files on a stand-alone basis

Font source: [OpenHarmony global_system_resources](https://gitee.com/openharmony/global_system_resources)

## Contributing

This plugin is part of the [`hanako-supplement`](https://github.com/326sun/hanako-supplement)
monorepo. Contributions are welcome:

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/your-feature`)
3. Commit your changes (`git commit -m 'feat: description'`)
4. Push to the branch (`git push origin feat/your-feature`)
5. Open a Pull Request

Before submitting, run:

```powershell
npm run check
```

The check script validates syntax for all source files. The plugin source is
ESM (`.js` with `"type": "module"` in `package.json`). The install script uses
CommonJS (`.cjs` extension) to avoid module resolution conflicts.

### Project Structure

```
hana-ui-beautify/
├── install.cjs          # Plugin installer (CommonJS)
├── package.json         # ESM declaration + @electron/asar dependency
├── manifest.json        # Hanako plugin manifest
├── index.js             # Plugin entry point (onload)
├── theme.css            # CSS patch (fonts + motion tokens)
├── fonts/               # HarmonyOS Sans SC WOFF2 files + LICENSE_Fonts
├── lib/
│   └── beautify-core.js # Core logic: apply, restore, status
└── tools/
    ├── status.js        # Agent tool: check beautify state
    ├── apply.js         # Agent tool: apply beautify
    └── restore.js       # Agent tool: restore original asar
```

## License

Plugin code: MIT. Font files: see [Font License](#font-license).
