/**
 * Pure formatting helpers: no vscode imports, so they can be unit tested
 * against a raw metrics dump (see src/selftest.ts).
 */
import type { MetricsPayload } from './types';

/** Values available to the status bar template. null = "not available right now". */
export type TemplateValues = Record<string, string | null>;

// Strata's monitor shows state badges: idle | reading | generating | queued | error
// (live.state can also carry engine-internal names like thinking/prefilling).
export const ENGINE_STATES = ['idle', 'reading', 'generating', 'queued', 'error'] as const;

/**
 * Default status bar template. Single source of truth: package.json's
 * strata.statusBar.format default, FORMAT_PRESETS and the selftest all use this.
 */
export const DEFAULT_FORMAT =
    '${phase} | ${gen} t/s | avg ${gen_avg} | prefill ${pre} t/s | gpu ${gpu}%';

const ACTIVE_STATES = new Set([
    'reading',
    'thinking',
    'generating',
    'prefilling',
    'decoding',
    'processing',
    'admitting',
]);

export function isErrorState(state: string | null | undefined): boolean {
    return (state ?? '').toLowerCase() === 'error';
}

/** State-driven codicon for the `${icon}` placeholder. */
export function pickIcon(state: string | null | undefined): string {
    const s = (state ?? 'idle').toLowerCase();
    if (s === 'error') return '$(error)';
    if (s === 'queued') return '$(clock)';
    if (s === 'reading' || s === 'prefilling') return '$(book)';
    if (isActiveState(s)) return '$(sync~spin)';
    return '$(circle-filled)';
}

export function isActiveState(state: string | null | undefined): boolean {
    if (!state) return false;
    return ACTIVE_STATES.has(state.toLowerCase());
}

/** Formats a number with at most one decimal place, dropping a trailing ".0". */
export function fmtNum(n: number, decimals = 1): string {
    if (!Number.isFinite(n)) return '-';
    const factor = Math.pow(10, decimals);
    const r = Math.round(n * factor) / factor;
    return String(r);
}

export function fmtBytes(bytes: number): string {
    if (!Number.isFinite(bytes)) return '-';
    const gib = bytes / (1024 * 1024 * 1024);
    if (gib >= 1) return `${fmtNum(gib, 1)} GiB`;
    const mib = bytes / (1024 * 1024);
    return `${fmtNum(mib, 0)} MiB`;
}

/**
 * gpu_util may be reported as a 0..1 fraction or a 0..100 percentage.
 * Values <= 1 are treated as fractions (0 is still 0 either way).
 */
export function gpuLoadPercent(util: number | undefined): number | null {
    if (util === undefined || util === null || !Number.isFinite(util)) return null;
    return util <= 1 ? util * 100 : util;
}

/** Extracts all template placeholders from a raw metrics payload. */
export function extractValues(data: MetricsPayload | null): TemplateValues {
    if (!data) return { state: null };

    const live = data.live ?? ({} as MetricsPayload['live']);
    const hw = data.hardware ?? ({} as MetricsPayload['hardware']);
    const eng = data.engine ?? ({} as MetricsPayload['engine']);
    const last = data.requests?.[0];

    const pos = (v: number | null | undefined): number | null =>
        typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;

    // Strata web monitor semantics:
    //   live.tok_s                -> "Decode now"                      (${gen})
    //   live.tok_s_mean           -> this request's average, falls back
    //                                to the last request decode_tok_s  (${gen_avg})
    //   live.prefill_tok_s_mean   -> "Prefill this request"            (${pre})
    const gen = pos(live.tok_s) ?? pos(hw.tok_s);
    const genAvg =
        pos(live.tok_s_mean) ??
        pos(hw.tok_s_mean) ??
        (isActiveState(live.state) ? pos(last?.decode_tok_s) : null);
    const pre = pos(live.prefill_tok_s_mean) ?? pos(hw.prefill_tok_s_mean);
    const gpu = gpuLoadPercent(hw.gpu_util);
    // a 0% GPU reading only matters while the engine is doing something
    const gpuVisible = gpu !== null && (gpu > 0 || isActiveState(live.state));

    const ctxUsed = (live.slots ?? []).reduce((sum, s) => sum + (s.held_tokens || 0), 0);

    let acc: number | null = null;
    const offered = last?.drafts_offered ?? data.totals?.drafts_offered;
    const accepted = last?.drafts_accepted ?? data.totals?.drafts_accepted;
    if (offered && accepted !== undefined) acc = (accepted / offered) * 100;

    return {
        state: live.state ?? null,
        phase: live.phase ?? null,
        icon: pickIcon(live.state),
        gen: gen !== null ? fmtNum(gen) : null,
        gen_avg: genAvg !== null ? fmtNum(genAvg) : null,
        dec: genAvg !== null ? fmtNum(genAvg) : null, // legacy alias for ${gen_avg}
        pre: pre !== null ? fmtNum(pre) : null,
        gpu: gpuVisible ? String(Math.round(gpu!)) : null,
        vram: hw.gpu_mem_total
            ? `${fmtNum((hw.gpu_mem_used / hw.gpu_mem_total) * 100, 0)}%`
            : null,
        power: hw.gpu_power !== undefined ? fmtNum(hw.gpu_power) : null,
        temp: hw.gpu_temp !== undefined ? String(Math.round(hw.gpu_temp)) : null,
        cpu: hw.cpu !== undefined ? fmtNum(hw.cpu) : null,
        ram: hw.ram_total
            ? `${fmtNum((hw.ram_used / hw.ram_total) * 100, 0)}%`
            : null,
        ctx: ctxUsed > 0 ? String(ctxUsed) : null,
        ctxmax: eng.max_context ? String(eng.max_context) : null,
        queued: live.queued ? String(live.queued) : null,
        running: live.running ? String(live.running) : null,
        model: eng.model ?? null,
        hit: last?.hit_rate !== undefined ? String(Math.round(last.hit_rate * 100)) : null,
        acc: acc !== null ? String(Math.round(acc)) : null,
    };
}

/**
 * Renders the status bar template.
 * - `${name}` placeholders are substituted from `values`.
 * - Segments separated by `|` are dropped when they contain a placeholder
 *   whose value is null/empty (so "idle" collapses to just the state segment).
 * - `$(codicon-name)` sequences are left untouched for VS Code to render.
 */
export function renderTemplate(template: string, values: TemplateValues): string {
    const segments = template.split('|').map((s) => s.trim()).filter(Boolean);
    const out: string[] = [];
    for (const seg of segments) {
        let resolved = true;
        const text = seg.replace(/\$\{(\w+)\}/g, (_m, key: string) => {
            const v = values[key];
            if (v === null || v === undefined || v === '') {
                resolved = false;
                return '';
            }
            return v;
        });
        if (resolved && text.trim()) out.push(text.trim());
    }
    return out.join(' | ');
}
