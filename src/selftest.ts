/**
 * Self-test: renders the status bar line and checks template logic.
 * Uses an embedded synthetic payload; if a local data.json dump exists,
 * its values are also rendered (informational only). Run: npm run selftest
 */
import * as fs from 'fs';
import * as path from 'path';
import { extractValues, renderTemplate, DEFAULT_FORMAT } from './format';
import type { MetricsPayload } from './types';

// The shipped DEFAULT_FORMAT leads with ${phase}, which is null while idle.
// State/rate assertions below use an explicit ${state} template; the default's
// collapse behavior is asserted separately.
const STATE_TEMPLATE =
    '${state} | ${gen} t/s | avg ${gen_avg} | prefill ${pre} t/s | gpu ${gpu}%';

function assert(cond: boolean, msg: string): void {
    if (!cond) {
        console.error(`FAIL: ${msg}`);
        process.exitCode = 1;
    } else {
        console.log(`ok:   ${msg}`);
    }
}

/** Minimal synthetic dump: idle, zero load. */
const idle: MetricsPayload = {
    engine: { model: 'test-model', max_context: 262144, version: '0.0.0', expert_slots: 100, expert_cache_mib: 100 },
    live: {
        state: 'idle', queued: 0, phase: null, prompt_tokens: null, prompt_read: null,
        prompt_total: null, generated: null, max_tokens: null, elapsed_s: null, tok_s: null,
        tok_s_mean: null, prefill_tok_s_mean: null, tok_s_window_s: null, parallel: 1,
        running: 0, slots: [{ slot: 0, state: 'idle', held_tokens: 1234 }], outside_slots: 0,
        waiting: 0, admitting: 0,
    },
    requests: [
        {
            id: 'r1', time: 1000, duration_s: 2, finish: 'stop', prompt_tokens: 100, reused: 90,
            output_tokens: 50, first_engine_token_s: 0.3, prompt_total: 100, prompt_read: 10,
            decode_tok_s: 66, hit_rate: 0.9, pcie_share: 0.05, prompt_ms: 200,
            drafts_offered: 40, drafts_accepted: 20,
        },
    ],
    conversation_cache: {
        enabled: true, budget_mib: 100, slots: 1, parked: 1, bytes: 1000, evictions: 0,
        parks: 1, restores: 1, requests: 1, requests_reused: 1, reused_tokens: 90,
        prompt_tokens: 100,
    },
    totals: {
        requests: 1, prompt_tokens: 100, reused: 90, output_tokens: 50, prompt_ms: 200,
        decode_ms: 750, drafts_offered: 40, drafts_accepted: 20,
    },
    hardware: {
        gpus: [{ index: 0, name: 'Test GPU', util: 0, mem_used: 2000, mem_total: 4000, temp: 30, power: 20 }],
        gpu_util: 0, gpu_mem_used: 2000, gpu_mem_total: 4000, gpu_temp: 30, gpu_power: 20,
        cpu: 1, ram_used: 4000, ram_total: 8000, tok_s: 0, tok_s_mean: 0, prefill_tok_s_mean: 0,
    },
    time: 1000,
};

/** Active variant of the same dump: generating at full tilt. */
const active: MetricsPayload = {
    ...idle,
    live: { ...idle.live, state: 'generating', tok_s: 116.8, tok_s_mean: 110, prefill_tok_s_mean: 85, running: 1 },
    hardware: { ...idle.hardware, gpu_util: 0.43 },
};

const idleValues = extractValues(idle);
const idleLine = renderTemplate(STATE_TEMPLATE, idleValues);
console.log(`idle line:    "${idleLine}"`);
assert(idleLine.includes('idle'), 'idle state is rendered');
assert(idleValues.icon === '$(circle-filled)', 'idle icon chosen for icon item');
assert(!idleLine.includes('t/s'), 'zero rates collapse when idle');
assert(!idleLine.includes('gpu'), 'zero gpu load collapses when idle');
// the shipped default collapses to empty while idle (extension then paints
// the "Strata ${state}" fallback) because ${phase} is null when nothing runs
assert(renderTemplate(DEFAULT_FORMAT, idleValues) === '', '${phase} default collapses when idle');

const activeLine = renderTemplate(STATE_TEMPLATE, extractValues(active));
console.log(`active line:  "${activeLine}"`);
assert(activeLine.includes('generating'), 'active state is rendered');
assert(extractValues(active).icon === '$(sync~spin)', 'active icon spins');
assert(activeLine.includes('avg 110'), 'gen_avg renders request average');
assert(activeLine.includes('prefill 85 t/s'), 'prefill speed is rendered');
assert(activeLine.includes('gpu 43%'), 'gpu fraction converted to percent');

// percentage-style gpu_util (0..100) also works
const pctStyle = extractValues({ ...idle, hardware: { ...idle.hardware, gpu_util: 42 } });
assert(renderTemplate('${gpu}', pctStyle) === '42', 'gpu percent passthrough');

// template edge cases
assert(renderTemplate('a | ${missing} | b', idleValues) === 'a | b', 'missing placeholder drops segment');
assert(renderTemplate('$(broadcast) fixed', idleValues) === '$(broadcast) fixed', 'codicons pass through');

// optional: also render a real local dump when present (gitignored, not shipped)
const localDump = path.join(__dirname, '..', 'data.json');
if (fs.existsSync(localDump)) {
    const real = extractValues(JSON.parse(fs.readFileSync(localDump, 'utf8')) as MetricsPayload);
    console.log(`local dump:   "${renderTemplate(DEFAULT_FORMAT, real)}"`);
}
