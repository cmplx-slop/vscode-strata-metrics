# Strata Metrics for VS Code

Live status of a [Strata](https://github.com/Niko1221/Strata) inference engine in your VS Code
status bar — engine state, token speeds, GPU load and more at a glance, with a full metrics
panel one click away.

![license](https://img.shields.io/badge/license-MIT-blue.svg)
![vscode](https://img.shields.io/badge/VS%20Code-%5E1.85.0-blue?logo=visualstudiocode)
![platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)

## What you get

The status bar item updates every couple of seconds:

```
⬤ idle
⟳ generating | 116.8 t/s | avg 110 | prefill 85 t/s | gpu 43%    ← emerald text, spinning icon
⊘ Strata offline                                                 ← yellow background
```

Segments with no current value collapse automatically, so an idle engine shows just the state.
Clicking the item opens a full metrics view mirroring Strata's own **Monitor** tab: state card,
sparkline metric cards (speed, GPU, VRAM, temp, power, PCIe, CPU, disk), context fill,
conversation cache, and a recent-requests table with prefill t/s and VRAM hit rates.

## Requirements

- VS Code `^1.85.0`
- A running Strata server exposing the JSON metrics endpoint
  (default: `GET http://127.0.0.1:8080/metrics`)

## Installation

Not on the Marketplace (yet) — install from a VSIX:

```bash
git clone https://github.com/cmplx-slop/vscode-strata-metrics
cd vscode-strata-metrics
npm install
npm run build                       # compile + package → vscode-strata-<version>.vsix
code --install-extension vscode-strata-*.vsix
```

Or in VS Code: **Extensions view → ⋯ → Install from VSIX…**

## Quick start

1. Start Strata (`strata launch`).
2. If the server was started with an API key: `F1` → **Strata: Set API Key (Bearer Token)** —
   the key is stored in VS Code's encrypted secret storage and sent as
   `Authorization: Bearer <key>`.
3. The status bar line appears within a couple of seconds; click it for the full panel.

## Commands

| Command | What it does |
| --- | --- |
| `Strata: Show Full Metrics` | Open the metrics panel (same as clicking the status bar item). |
| `Strata: Set Metrics Endpoint` | Change the endpoint URL. |
| `Strata: Set API Key (Bearer Token)` | Store or remove the Bearer token in secret storage. |
| `Strata: Choose Status Bar Format` | Pick a status bar line preset. |
| `Strata: Refresh Metrics Now` | Poll immediately. |

## Settings

### Connection

| Setting | Default | Description |
| --- | --- | --- |
| `strata.enabled` | `true` | Show the status bar item / start polling. |
| `strata.endpoint` | `http://127.0.0.1:8080/metrics` | JSON metrics endpoint URL. |
| `strata.refreshIntervalSeconds` | `2` | Poll interval. |
| `strata.requestTimeoutSeconds` | `4` | Per-request timeout. |
| `strata.apiKey` | `""` | Fallback Bearer token (plaintext). Prefer `Strata: Set API Key`, which uses encrypted secret storage. |

### Status bar

| Setting | Default | Description |
| --- | --- | --- |
| `strata.statusBar.format` | ``${phase} \| ${gen} t/s \| avg ${gen_avg} \| prefill ${pre} t/s \| gpu ${gpu}%`` | Line template — see below. |
| `strata.statusBar.alignment` | `left` | `right` pins the item to the right side. |
| `strata.statusBar.priority` | `105` | Ordering (higher = further left). Built-in editor items sit at 100–100.5, so the default places Strata before Ln/Col and language. |
| `strata.statusBar.splitIcon` | `false` | `true` renders the state icon as its own small item so the spin animation is not restarted by text updates. `false` merges the icon into the text. |
| `strata.statusBar.activeStyle` | `color` | `color` (text/icon in `activeColor`), `warning` (yellow background), or `spin` (icon animation only). |
| `strata.statusBar.activeColor` | `#34d399` | CSS color used while the engine is non-idle (empty string disables). |

### Customizing the status bar line

Segments separated by ` | ` are dropped when any placeholder inside them has no value —
that is why idle renders as just `idle`.

| Placeholder | Meaning | | Placeholder | Meaning |
| --- | --- | --- | --- | --- |
| `${state}` | engine state | | `${ctx}` / `${ctxmax}` | tokens in slots / max context |
| `${phase}` | current phase (null while idle) | | `${queued}` / `${running}` | request queue / running |
| `${gen}` | decode speed now (t/s) | | `${model}` | model name |
| `${gen_avg}` | avg speed of this/last request | | `${hit}` | prompt cache hit rate (%) |
| `${pre}` | prefill speed (t/s) | | `${acc}` | draft acceptance (%) |
| `${gpu}` | GPU load (%) | | `${icon}` | state-driven codicon¹ |
| `${vram}` | VRAM used (%) | | `${power}` / `${temp}` | watts / °C |
| `${cpu}` / `${ram}` | CPU / RAM load (%) | | | |

¹ Auto-prepended when `splitIcon: false`; set `splitIcon: true` to move it to its own item
(smooth spin) — then remove it from your format.

Any VS Code [codicon](https://code.visualstudio.com/api/references/icons-in-labels) works in
the template, e.g. `$(device-chip)`, `$(server)`, `$(rocket)`.
`${dec}` still works as a legacy alias for `${gen_avg}`.

```jsonc
"strata.statusBar.format": "${phase}"                                                        // minimal
"strata.statusBar.format": "${phase} | ${gen} t/s | avg ${gen_avg} | prefill ${pre} t/s | gpu ${gpu}%"  // standard (default)
"strata.statusBar.format": "gpu ${gpu}% | ${power} W | ${temp}°C | cpu ${cpu}%"              // hardware only
"strata.statusBar.format": "${icon} $(vm-active) ${model} | ctx ${ctx} / ${ctxmax}"          // merged icon + context
```

## Behaviour notes

- **Auth**: on `401/403` the status item tooltip tells you the token is missing/wrong.
  After a few consecutive failures the item shows **Strata offline** instead of stale numbers.
- **Colors are scoped to the item**: while non-idle the text/icon is drawn in `activeColor`
  (default emerald `#34d399`). Custom *backgrounds* per item are rejected by VS Code (it
  whitelists only `statusBarItem.errorBackground` / `warningBackground`), so `activeStyle`
  offers `warning` as the alternative. Errors show a red background, offline a yellow one.
- `live.state` follows the engine's monitor states: `idle`, `reading`, `generating`, `queued`, `error`.
- `hardware.gpu_util` is accepted as either a `0..1` fraction or a `0..100` percentage.
- The metrics panel keeps auto-refreshing while it is open.

## Development

```bash
npm install
npm run compile      # tsc -> out/
npm run watch        # incremental
npm run selftest     # template/rendering selftest on a synthetic fixture
npm run build        # compile + vsce package -> vscode-strata-<version>.vsix (gitignored)
```

Press `F5` (Run Extension) to launch an Extension Development Host with the extension loaded.
Debug attach config: `.vscode/launch.json`.

## Related

- [Strata](https://github.com/Niko1221/Strata) — the inference engine this extension monitors.

## License

MIT — see [LICENSE](LICENSE).
