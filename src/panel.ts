/**
 * Full metrics view: a webview panel mirroring Strata's own Monitor tab
 * (state card, sparkline metric cards, context fill, conversation cache,
 * recent requests). Re-rendered on every successful poll while open.
 */
import * as vscode from 'vscode';
import { ENGINE_STATES, fmtBytes, fmtNum, gpuLoadPercent } from './format';
import type { MetricsPayload } from './types';

// state badge row order is the canonical engine state list
const STATE_BADGES: readonly string[] = ENGINE_STATES;

export class MetricsPanel {
    private panel: vscode.WebviewPanel | undefined;

    constructor(private readonly endpoint: () => string) {}

    show(data: MetricsPayload | null, error: string | undefined, lastUpdate: Date | null): void {
        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                'strataMetrics',
                'Strata Metrics',
                vscode.ViewColumn.Beside,
                { enableScripts: false, retainContextWhenHidden: true }
            );
            this.panel.onDidDispose(() => (this.panel = undefined));
        }
        this.panel.webview.html = this.renderHtml(data, error, lastUpdate);
    }

    update(data: MetricsPayload | null, error: string | undefined, lastUpdate: Date | null): void {
        if (this.panel) this.show(data, error, lastUpdate);
    }

    private renderHtml(data: MetricsPayload | null, error: string | undefined, lastUpdate: Date | null): string {
        const body = data ? this.renderData(data) : `<p class="error">No metrics available yet.</p>`;
        const errBar = error
            ? `<p class="error">Last request failed: ${esc(error)} (endpoint: ${esc(this.endpoint())})</p>`
            : '';
        const stamp = lastUpdate ? `Last update: ${esc(lastUpdate.toLocaleTimeString())}` : 'Never updated';
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<title>Strata Metrics</title>
<style>
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 0 1.2em 2em 1.2em;
  }
  h1 { font-size: 1.4em; margin: 0.6em 0 0.2em; }
  h2 { font-size: 1.1em; margin: 1.1em 0 0.3em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 0.2em; }
  .meta { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  .error { color: var(--vscode-errorForeground); }
  .muted { color: var(--vscode-descriptionForeground); }
  .card {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    background: var(--vscode-editor-inactiveSelectionBackground);
    padding: 0.7em 0.9em;
    margin: 0.45em 0;
  }
  .card-title { font-weight: 600; display: block; margin-bottom: 0.35em; }
  .badges { float: right; }
  .badge {
    display: inline-block; margin-left: 0.4em; padding: 0.1em 0.6em;
    border: 1px solid var(--vscode-panel-border); border-radius: 999px;
    font-size: 0.85em; color: var(--vscode-descriptionForeground);
  }
  .badge[data-on] { color: var(--vscode-foreground); border-color: var(--vscode-focusBorder); }
  .badge[data-on="generating"], .badge[data-on="reading"] { color: var(--vscode-charts-yellow); }
  .badge[data-on="error"] { color: var(--vscode-errorForeground); }
  .row { display: flex; justify-content: space-between; gap: 1em; margin: 0.25em 0; }
  .bar { height: 6px; border-radius: 3px; background: var(--vscode-panel-border); overflow: hidden; margin: 0.3em 0 0.5em; }
  .bar > div { height: 100%; border-radius: 3px; background: var(--vscode-progressBar-background); }
  .bar[data-tone="warn"] > div { background: var(--vscode-charts-yellow); }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.6em; }
  .m-label { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  .m-value { font-size: 1.5em; margin: 0.1em 0; }
  .m-value small { font-size: 0.6em; color: var(--vscode-descriptionForeground); }
  .m-sub { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
  .spark { width: 100%; height: 34px; margin-top: 0.3em; color: var(--vscode-charts-blue); display: block; }
  .spark[data-tone="warn"] { color: var(--vscode-charts-yellow); }
  table { border-collapse: collapse; margin: 0.3em 0 0.6em; width: 100%; }
  th, td { text-align: left; padding: 0.25em 0.8em 0.25em 0; vertical-align: top; }
  th { color: var(--vscode-descriptionForeground); font-weight: 600; border-bottom: 1px solid var(--vscode-panel-border); }
  td.num, th.num { text-align: right; }
  td.k { color: var(--vscode-descriptionForeground); white-space: nowrap; width: 16em; }
  tr.active td { color: var(--vscode-textLink-foreground); font-weight: 600; }
  dl.facts { display: grid; grid-template-columns: max-content 1fr; gap: 0.2em 1em; margin: 0.3em 0; }
  dl.facts dt { color: var(--vscode-descriptionForeground); }
  dl.facts dd { margin: 0; }
  .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 0 1.5em; }
  .table-wrap { overflow-x: auto; }
</style>
</head>
<body>
<h1>Strata Metrics</h1>
<p class="meta">${esc(stamp)} &middot; ${esc(this.endpoint())}</p>
${errBar}
${body}
</body>
</html>`;
    }

    private renderData(d: MetricsPayload): string {
        const eng = d.engine;
        const live = d.live;
        const hw = d.hardware;
        const hist = d.history ?? {};
        const cc = d.conversation_cache;
        const totals = d.totals;
        const hws = d.hardware_static ?? {};

        const state = (live.state ?? 'idle').toLowerCase();
        const gpu = gpuLoadPercent(hw.gpu_util) ?? 0;
        const ctxUsed = (live.slots ?? []).reduce((s, x) => s + (x.held_tokens || 0), 0);
        const ctxMax = eng.max_context || 1;

        // ---- state card (mirrors .state-card) ----
        const badges = STATE_BADGES.map(
            (s) => `<span class="badge"${s === state ? ` data-on="${s}">` : '>'}${cap(s)}</span>`
        ).join('');
        const phase = live.phase ? esc(String(live.phase)) : cap(state);
        const stateDetail =
            live.generated != null
                ? `${(live.generated ?? 0).toLocaleString()} tokens · ${fmtNum(live.tok_s ?? 0)} tok/s`
                : live.running > 0
                  ? `${live.running} running`
                  : 'nothing running';
        const promptPct =
            live.prompt_total && live.prompt_read != null
                ? Math.min(100, (live.prompt_read / live.prompt_total) * 100)
                : 0;

        const stateCard = `
<div class="card">
  <span class="badges">${badges}</span>
  <span class="card-title">Model state</span>
  <div class="row"><span>${phase}</span><span class="muted">${esc(stateDetail)}</span></div>
  <div class="bar"><div style="width: ${promptPct.toFixed(1)}%;"></div></div>
  <table>
    <thead><tr><th>Slot</th><th>State</th><th class="num">Held tokens</th></tr></thead>
    <tbody>${(live.slots ?? [])
        .map(
            (s) =>
                `<tr${s.state !== 'idle' ? ' class="active"' : ''}><td>${s.slot}</td><td>${esc(
                    s.state
                )}</td><td class="num">${(s.held_tokens ?? 0).toLocaleString()}</td></tr>`
        )
        .join('')}</tbody>
  </table>
  <p class="muted">running ${live.running} · queued ${live.queued} · waiting ${live.waiting} ·
     admitting ${live.admitting} · parallel ${live.parallel} · outside slots ${live.outside_slots}</p>
</div>`;

        // ---- metric cards with sparklines (mirror .metrics) ----
        const perGpu = (sel: (g: MetricsPayload['hardware']['gpus'][number]) => string): string =>
            (hw.gpus ?? []).map((g, i) => `GPU ${g.index} ${sel(g)}`).join(' · ');

        const card = (
            label: string,
            value: string,
            unit: string,
            sub: string,
            series: number[] | undefined,
            tone = ''
        ): string =>
            `<div class="card"><span class="m-label">${esc(label)}</span>
  <div class="m-value">${value}${unit ? `<small> ${unit}</small>` : ''}</div>
  <div class="m-sub">${esc(sub)}</div>${sparkline(series, tone)}</div>`;

        const metricCards = `<div class="cards">
${card('Speed', `${fmtNum(hw.tok_s || live.tok_s || 0)}`, 't/s',
    live.prefill_tok_s_mean ? `prefill this request ${fmtNum(live.prefill_tok_s_mean)} t/s` : 'Decode now',
    hist.tok_s)}
${card('GPU load', String(Math.round(gpu)), '%',
    perGpu((g) => `${Math.round(gpuLoadPercent(g.util) ?? 0)}%`), hist.gpu_util)}
${card('VRAM', fmtBytes(hw.gpu_mem_used), `/ ${fmtBytes(hw.gpu_mem_total)}`,
    perGpu((g) => `${fmtNum(g.mem_used / 2 ** 30, 1)} GB`), hist.gpu_mem_used)}
${card('GPU temp', String(Math.round(hw.gpu_temp ?? 0)), '°C',
    perGpu((g) => `${g.temp}°`), hist.gpu_temp, 'warn')}
${card('Power', fmtNum(hw.gpu_power ?? 0), 'W',
    hw.gpu_power_limit ? `of ${fmtNum(hw.gpu_power_limit)} W limit` : '', hist.gpu_power)}
${card('PCIe', `Gen${hw.gpu_pcie_gen ?? '-'}${hw.gpu_pcie_gen_max && hw.gpu_pcie_gen !== hw.gpu_pcie_gen_max ? ` (max Gen${hw.gpu_pcie_gen_max})` : ''}`,
    hw.gpu_pcie_width ? `x${hw.gpu_pcie_width}` : '',
    `rx ${fmtNum(hw.gpu_pcie_rx_mb ?? 0, 1)} MB/s · tx ${fmtNum(hw.gpu_pcie_tx_mb ?? 0, 1)} MB/s`,
    hist.gpu_pcie_rx_mb, 'info')}
${card('CPU', String(Math.round(hw.cpu ?? 0)), '%',
    [hws.cpu_name, hws.cores != null && `${hws.cores} cores · ${hws.threads} threads`].filter(Boolean).join(' · '),
    hist.cpu)}
${card('Disk read', fmtNum(hw.disk_read_mb ?? 0), 'MB/s', `write ${fmtNum(hw.disk_write_mb ?? 0)} MB/s`, hist.disk_read_mb)}
</div>`;

        // ---- context fill + bars (mirror .ctx-card) ----
        const ctxPct = (ctxUsed / ctxMax) * 100;
        const tempBar = Math.min(100, hw.gpu_temp ?? 0);
        const ctxCard = `
<div class="card">
  <span class="card-title">Context fill</span>
  <div class="row"><span class="m-value" style="font-size:1.2em">${Math.round(ctxPct)}%</span>
    <span class="muted">${shortNum(ctxUsed)} / ${shortNum(ctxMax)}</span></div>
  <div class="bar"><div style="width: ${Math.min(100, ctxPct).toFixed(1)}%;"></div></div>
  <div class="row"><span>Experts in VRAM</span><span class="muted">${(eng.expert_slots ?? 0).toLocaleString()} · ${fmtNum((eng.expert_cache_mib ?? 0) / 1024, 1)} GB</span></div>
  <div class="row"><span>System RAM</span><span class="muted">${fmtBytes(hw.ram_used)} / ${fmtBytes(hw.ram_total)}</span></div>
  <div class="bar"><div style="width: ${((hw.ram_used / (hw.ram_total || 1)) * 100).toFixed(1)}%;"></div></div>
  <div class="row"><span>GPU temperature</span><span class="muted">${hw.gpu_temp ?? '-'} °C</span></div>
  <div class="bar" data-tone="warn"><div style="width: ${tempBar}%;"></div></div>
</div>`;

        // ---- recent requests (mirror .req-card) ----
        const reqRows = (d.requests ?? [])
            .slice(0, 12)
            .map((r) => {
                const t = new Date((r.time ?? 0) * 1000);
                const prefillTs =
                    r.prompt_ms && r.prompt_read != null ? r.prompt_read / (r.prompt_ms / 1000) : null;
                const pcie = r.pcie_share;
                return `<tr>
  <td>${esc(t.toLocaleTimeString())}</td>
  <td><span class="badge">${esc(cap(String(r.finish ?? 'done')))}</span></td>
  <td class="num">${(r.prompt_tokens ?? 0).toLocaleString()}</td>
  <td class="num">${(r.reused ?? 0).toLocaleString()}</td>
  <td class="num">${(r.output_tokens ?? 0).toLocaleString()}</td>
  <td class="num">${prefillTs !== null ? Math.round(prefillTs).toLocaleString() : '-'}</td>
  <td class="num">${fmtNum(r.decode_tok_s ?? 0)}</td>
  <td class="num">${((r.hit_rate ?? 0) * 100).toFixed(1)}%${pcie ? ` <span class="muted">+${(pcie * 100).toFixed(1)}% PCIe</span>` : ''}</td>
  <td class="num">${fmtNum(r.duration_s ?? 0)} s</td>
</tr>`;
            })
            .join('');

        const readTokens = (totals.prompt_tokens ?? 0) - (totals.reused ?? 0);
        const readTs = totals.prompt_ms ? readTokens / (totals.prompt_ms / 1000) : 0;
        const writeTs = totals.decode_ms ? (totals.output_tokens ?? 0) / (totals.decode_ms / 1000) : 0;
        const since = new Date((totals.since ?? 0) * 1000);
        const totalsLine = `Since ${esc(since.toLocaleString())}: ${totals.requests?.toLocaleString()} requests ·
${readTokens.toLocaleString()} prompt tokens read at ${fmtNum(readTs)} tok/s
(${totals.reused?.toLocaleString()} reused) · ${totals.output_tokens?.toLocaleString()} written at ${fmtNum(writeTs)} tok/s`;

        const reqCard = `
<div class="card">
  <span class="card-title">Recent requests (latest ${Math.min(12, (d.requests ?? []).length)} of ${d.requests_kept ?? (d.requests ?? []).length})</span>
  <div class="table-wrap">
  <table>
    <thead><tr><th>Time</th><th>Status</th><th class="num">Prompt</th><th class="num">Reused</th><th class="num">Output</th>
      <th class="num" title="New prompt tokens per second, excluding reused cache tokens">Prefill t/s</th>
      <th class="num">Decode t/s</th>
      <th class="num" title="Share of routed experts already in VRAM while decoding">VRAM hit rate</th>
      <th class="num">Duration</th></tr></thead>
    <tbody>${reqRows}</tbody>
  </table>
  </div>
  <p class="muted">${totalsLine}</p>
</div>`;

        // ---- conversation cache (mirror .cc-card) ----
        const ccReusePct = totals.prompt_tokens ? ((totals.reused ?? 0) / totals.prompt_tokens) * 100 : 0;
        const lastEvent = cc.last_event
            ? `${cap(String(cc.last_event))} ${shortNum(cc.last_tokens ?? 0)} tokens, ${esc(age(String(cc.last_at ?? 0), d.time))}`
            : '-';
        const ccCard = `
<div class="card">
  <span class="card-title">Conversation cache</span>
  <p class="muted">${cc.requests_reused?.toLocaleString()} of ${cc.requests?.toLocaleString()} requests reused part of their prompt</p>
  <div class="row"><span>Parked conversations</span><span class="muted">${cc.parked} / ${cc.slots}</span></div>
  <div class="bar"><div style="width: ${((cc.parked / (cc.slots || 1)) * 100).toFixed(0)}%;"></div></div>
  <div class="row"><span>Their memory (RAM)</span><span class="muted">${fmtBytes(cc.bytes)} / ${fmtNum(cc.budget_mib / 1024, 1)} GB</span></div>
  <div class="bar"><div style="width: ${Math.min(100, (cc.bytes / (cc.budget_mib * 2 ** 20)) * 100).toFixed(1)}%;"></div></div>
  <dl class="facts">
    <dt>Last request</dt><dd>${(cc.last_reused ?? 0).toLocaleString()} of ${(cc.last_prompt ?? 0).toLocaleString()} prompt tokens reused</dd>
    <dt>Reused since start</dt><dd>${(cc.reused_tokens ?? 0).toLocaleString()} tokens (${Math.round(ccReusePct)}% of all prompt tokens)</dd>
    <dt>Parked / restored</dt><dd>${cc.parks} / ${cc.restores} · ${cc.evictions} evicted</dd>
    <dt>Last switch</dt><dd>${esc(lastEvent)}</dd>
  </dl>
</div>`;

        // ---- engine facts (mirror About facts-engine) ----
        const engineCard = `
<div class="cols">
<div class="card"><span class="card-title">Model and engine</span>
  <dl class="facts">
    <dt>Model</dt><dd>${esc(eng.model)}</dd>
    <dt>Engine version</dt><dd>${esc(String(eng.version))}</dd>
    <dt>Context</dt><dd>${ctxMax.toLocaleString()} tokens</dd>
    <dt>KV cache</dt><dd>${esc(String(eng.kv))}</dd>
    <dt>VRAM free</dt><dd>${(eng.vram_free_mib ?? 0).toLocaleString()} MiB</dd>
    <dt>Batch slots / parallel</dt><dd>${eng.batch_slots ?? '-'} / ${live.parallel}</dd>
    <dt>Spec decode (spec/mtp/lookup)</dt><dd>${eng.spec ?? '-'} / ${eng.mtp_max ?? '-'} / ${eng.lookup ?? '-'}</dd>
    <dt>Expert cache</dt><dd>${fmtNum((eng.expert_cache_mib ?? 0) / 1024, 1)} GB (${(eng.expert_slots ?? 0).toLocaleString()} slots)</dd>
    <dt>Images</dt><dd>${eng.images ? 'yes' : 'no'}</dd>
  </dl>
</div>
<div class="card"><span class="card-title">Model Runner</span>
  <dl class="facts">
    <dt>GPUs</dt><dd>${esc(String(hws.gpu_name ?? (hw.gpus ?? []).map((g) => g.name).join(' + ')))}</dd>
    <dt>GPU count</dt><dd>${hws.gpu_count ?? hw.gpus?.length ?? '-'}</dd>
    <dt>CPU</dt><dd>${esc(String(hws.cpu_name ?? '-'))}</dd>
    <dt>Cores / threads</dt><dd>${hws.cores ?? '-'} / ${hws.threads ?? '-'}</dd>
  </dl>
</div>
</div>`;

        return `${stateCard}<h2>Live metrics</h2>${metricCards}<div class="cols">${ctxCard}${reqCard}</div>${ccCard}<h2>Engine</h2>${engineCard}`;
    }
}

/** Tiny inline SVG sparkline from a history series (no scripts needed). */
function sparkline(values: number[] | undefined, tone = ''): string {
    if (!values || values.length < 2) return '';
    const max = Math.max(...values);
    if (!(max > 0)) return '';
    const pts = values
        .map((v, i) => {
            const x = ((i / (values.length - 1)) * 100).toFixed(2);
            const y = (30 - (v / max) * 26).toFixed(2);
            return `${x},${y}`;
        })
        .join(' ');
    return `<svg class="spark"${tone ? ` data-tone="${tone}"` : ''} viewBox="0 0 100 32" preserveAspectRatio="none">
<polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}

function cap(s: string): string {
    return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function shortNum(n: number): string {
    if (n >= 1024 * 1024) return `${fmtNum(n / (1024 * 1024), 1)}M`;
    if (n >= 1024) return `${Math.round(n / 1024)}K`;
    return String(n);
}

function age(lastAt: string, now: number): string {
    const at = Number(lastAt);
    if (!Number.isFinite(at) || !Number.isFinite(now)) return '';
    const s = Math.max(0, now - at);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    return `${Math.round(s / 3600)} h ago`;
}

function esc(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
