/**
 * Types for the Strata JSON metrics payload.
 * Field set mirrors the engine's /metrics dump (see data.json).
 */

export interface SlotInfo {
    slot: number;
    state: string;
    held_tokens: number;
}

export interface LiveInfo {
    state: string | null;
    queued: number;
    phase: string | null;
    prompt_tokens: number | null;
    prompt_read: number | null;
    prompt_total: number | null;
    generated: number | null;
    max_tokens: number | null;
    elapsed_s: number | null;
    tok_s: number | null;
    tok_s_mean: number | null;
    prefill_tok_s_mean: number | null;
    tok_s_window_s: number | null;
    parallel: number;
    running: number;
    slots: SlotInfo[];
    outside_slots: number;
    waiting: number;
    admitting: number;
}

export interface EngineInfo {
    model: string;
    max_context: number;
    version: string;
    images?: boolean;
    kv?: string;
    vram_free_mib?: number;
    batch_slots?: number;
    spec?: number;
    mtp_max?: number;
    lookup?: number;
    expert_slots?: number;
    expert_cache_mib?: number;
    [key: string]: unknown;
}

export interface GpuInfo {
    index: number;
    name: string;
    util: number;
    mem_used: number;
    mem_total: number;
    temp: number;
    power: number;
}

export interface HardwareInfo {
    gpus: GpuInfo[];
    gpu_util: number;
    gpu_mem_used: number;
    gpu_mem_total: number;
    gpu_temp: number;
    gpu_power: number;
    gpu_power_limit?: number;
    gpu_pcie_gen?: number;
    gpu_pcie_gen_max?: number;
    gpu_pcie_width?: number;
    gpu_pcie_rx_mb?: number;
    gpu_pcie_tx_mb?: number;
    cpu: number;
    ram_used: number;
    ram_total: number;
    disk_read_mb?: number;
    disk_write_mb?: number;
    tok_s: number;
    tok_s_mean: number;
    prefill_tok_s_mean: number;
}

export interface RequestInfo {
    id: string;
    time: number;
    duration_s: number;
    finish: string;
    prompt_tokens: number;
    reused: number;
    output_tokens: number;
    first_engine_token_s: number;
    prompt_total?: number;
    prompt_read?: number;
    decode_tok_s: number;
    hit_rate: number;
    pcie_share?: number;
    prompt_ms: number;
    drafts_offered: number;
    drafts_accepted: number;
    [key: string]: unknown;
}

export interface ConversationCacheInfo {
    enabled: boolean;
    budget_mib: number;
    slots: number;
    parked: number;
    bytes: number;
    evictions: number;
    parks: number;
    restores: number;
    requests: number;
    requests_reused: number;
    reused_tokens: number;
    prompt_tokens: number;
    last_event?: string;
    last_tokens?: number;
    last_at?: number;
    last_reused?: number;
    last_prompt?: number;
}

export interface TotalsInfo {
    requests: number;
    prompt_tokens: number;
    reused: number;
    output_tokens: number;
    prompt_ms: number;
    decode_ms: number;
    drafts_offered: number;
    drafts_accepted: number;
    [key: string]: unknown;
}

export interface MetricsPayload {
    engine: EngineInfo;
    live: LiveInfo;
    requests: RequestInfo[];
    requests_kept?: number;
    conversation_cache: ConversationCacheInfo;
    totals: TotalsInfo & { since?: number };
    hardware: HardwareInfo;
    hardware_static?: Record<string, unknown>;
    history?: Record<string, number[]>;
    time: number;
}
