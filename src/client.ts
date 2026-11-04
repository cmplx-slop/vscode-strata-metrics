/**
 * Minimal JSON poller for the Strata metrics endpoint.
 * Uses node http/https so it works on every VS Code version without fetch typings.
 */
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import type { MetricsPayload } from './types';

export interface PollResult {
    ok: boolean;
    data: MetricsPayload | null;
    error?: string;
    status?: number;
}

export function fetchMetrics(
    endpoint: string,
    timeoutMs: number,
    bearerToken?: string
): Promise<PollResult> {
    return new Promise((resolve) => {
        let url: URL;
        try {
            url = new URL(endpoint);
        } catch {
            resolve({ ok: false, data: null, error: `Invalid endpoint URL: ${endpoint}` });
            return;
        }

        const lib = url.protocol === 'https:' ? https : http;
        const headers: Record<string, string> = {};
        if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`;
        const req = lib.get(url, { timeout: timeoutMs, headers }, (res) => {
            const status = res.statusCode ?? 0;
            if (status < 200 || status >= 300) {
                res.resume();
                const hint =
                    status === 401 || status === 403
                        ? ' — the server requires an API key; run "Strata: Set API Key"'
                        : '';
                resolve({ ok: false, data: null, status, error: `HTTP ${status}${hint}` });
                return;
            }
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf8');
                try {
                    resolve({ ok: true, data: JSON.parse(body) as MetricsPayload, status });
                } catch (e) {
                    resolve({
                        ok: false,
                        data: null,
                        status,
                        error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
                    });
                }
            });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({ ok: false, data: null, error: `Request timed out after ${timeoutMs} ms` });
        });
        req.on('error', (e) => {
            resolve({ ok: false, data: null, error: e.message });
        });
    });
}
