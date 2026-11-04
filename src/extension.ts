/**
 * Strata Metrics — shows the live status of a Strata inference engine
 * in the VS Code status bar (left side); clicking opens the full metrics view.
 */
import * as vscode from 'vscode';
import { fetchMetrics } from './client';
import {
    DEFAULT_FORMAT,
    extractValues,
    isActiveState,
    isErrorState,
    renderTemplate,
} from './format';
import { MetricsPanel } from './panel';
import type { MetricsPayload } from './types';

// ${icon} stays available for splitIcon: false formats
const FORMAT_PRESETS: Array<[string, string]> = [
    ['Minimal — state only', '${phase}'],
    ['Standard — state + speed + GPU (default)', DEFAULT_FORMAT],
    ['Detailed — state, speeds, GPU, VRAM, temp',
        '${phase} | ${gen} t/s | avg ${gen_avg} | prefill ${pre} t/s | gpu ${gpu}% | vram ${vram} | ${temp}°C'],
    ['Hardware — GPU, power, temp, CPU, RAM',
        '$(broadcast) gpu ${gpu}% | ${power} W | ${temp}°C | cpu ${cpu}% | ram ${ram}%'],
    ['Context — context tokens / model',
        '$(broadcast) ${model} | ctx ${ctx} / ${ctxmax} | ${phase}'],
];

export function activate(context: vscode.ExtensionContext): void {
    const panel = new MetricsPanel(() => getEndpoint());

    let lastData: MetricsPayload | null = null;
    let lastError: string | undefined;
    let lastUpdate: Date | null = null;
    let failCount = 0; // consecutive failed polls; renders stale data as offline
    let timer: NodeJS.Timeout | undefined;
    let polling = false;

    const cfg = () => vscode.workspace.getConfiguration('strata');
    const getEndpoint = () => cfg().get<string>('endpoint', 'http://127.0.0.1:8080/metrics');

    // Bearer token: encrypted secret storage (Strata: Set API Key) wins over
    // the plaintext strata.apiKey setting.
    const SECRET_KEY = 'strata.apiKey';
    const loadToken = async (): Promise<string | undefined> => {
        const secret = await context.secrets.get(SECRET_KEY);
        const fallback = cfg().get<string>('apiKey', '').trim();
        return secret || fallback || undefined;
    };

    // status bar items (alignment is not changeable on live items, so they are
    // recreated when strata.statusBar.alignment changes)
    const makeItem = (name: string, priorityOffset: number): vscode.StatusBarItem => {
        const align =
            cfg().get<string>('statusBar.alignment', 'left') === 'right'
                ? vscode.StatusBarAlignment.Right
                : vscode.StatusBarAlignment.Left;
        // built-in right-side editor items (Ln/Col, language, ...) sit at 100..100.5;
        // higher priority renders further left, so the default lands in front of them
        const priority = (cfg().get<number>('statusBar.priority', 105) ?? 105) + priorityOffset;
        const item = vscode.window.createStatusBarItem(align, priority);
        item.name = name;
        item.command = 'strata.showMetrics';
        return item;
    };
    // text item + a tiny leading icon item; the icon lives on its own so the
    // spin animation is not restarted by the frequent text updates
    let statusItem = makeItem('Strata Metrics', 0);
    let iconItem = makeItem('Strata State', 1);
    // tooltip assignment is guarded by this key: re-assigning a new MarkdownString
    // every poll would make a visible tooltip flicker/re-open (and restart the spin)
    let lastTooltipKey: string | undefined;
    const reAlignStatusBar = (): void => {
        statusItem.dispose();
        iconItem.dispose();
        statusItem = makeItem('Strata Metrics', 0);
        iconItem = makeItem('Strata State', 1);
        // freshly created items have no tooltip; force re-assignment on next paint
        lastTooltipKey = undefined;
    };

    const paint = (): void => {
        if (!cfg().get<boolean>('enabled', true)) {
            statusItem.hide();
            iconItem.hide();
            return;
        }
        const splitIcon = cfg().get<boolean>('statusBar.splitIcon', false);
        const values = extractValues(lastData);
        const style = cfg().get<string>('statusBar.activeStyle', 'color');

        let text: string;
        let icon = '';
        let color: string | undefined;
        let bg: vscode.ThemeColor | undefined;
        let tooltip: vscode.MarkdownString;
        let tooltipKey: string;

        // after a couple of consecutive failures treat stale data as offline
        // instead of showing yesterday's numbers with normal styling
        if (!lastData || failCount >= 2) {
            icon = '$(circle-slash)';
            text = 'Strata offline';
            bg = new vscode.ThemeColor('statusBarItem.warningBackground');
            const md = new vscode.MarkdownString(
                `**Strata metrics unavailable**\n\nEndpoint: \`${getEndpoint()}\`` +
                    (lastError ? `\n\nLast error: ${lastError}` : '') +
                    (lastUpdate ? `\n\nLast successful update: ${lastUpdate.toLocaleTimeString()}` : '') +
                    '\n\n_Click to open the metrics view._'
            );
            tooltip = md;
            // endpoint is part of the key: the tooltip quotes it, so the assignment
            // must not be skipped after a strata.endpoint change while offline
            tooltipKey = `offline|${getEndpoint()}|${lastError ?? ''}`;
        } else {
            let template = cfg().get<string>('statusBar.format', DEFAULT_FORMAT);
            if (splitIcon) {
                // the icon item already shows the state icon; drop the legacy
                // ${icon} placeholder so it does not render twice. Segments that
                // become empty are dropped by renderTemplate.
                template = template.replace(/\$\{\s*icon\s*\}/g, ' ');
            }
            text = renderTemplate(template, values) || `Strata ${values.state ?? '?'}`;
            if (isErrorState(values.state)) {
                // only error/warning backgrounds are whitelisted by VS Code
                bg = new vscode.ThemeColor('statusBarItem.errorBackground');
            } else if (isActiveState(values.state) && style === 'color') {
                const c = cfg().get<string>('statusBar.activeColor', '#34d399').trim();
                if (c) color = c;
            } else if (isActiveState(values.state) && style === 'warning') {
                bg = new vscode.ThemeColor('statusBarItem.warningBackground');
            }
            icon = values.icon ?? '$(circle-filled)';
            tooltip = buildTooltip(lastData, values);
            tooltipKey = JSON.stringify(values);
        }

        if (!splitIcon && icon && !text.includes('$(')) text = `${icon} ${text}`;

        // guarded writes: VS Code re-renders the entry on every property assignment
        // (restarting codicon animations), so only assign changed values
        if (statusItem.text !== text) statusItem.text = text;
        if (String(statusItem.color ?? '') !== String(color ?? '')) statusItem.color = color;
        if (statusItem.backgroundColor?.id !== bg?.id) statusItem.backgroundColor = bg;
        if (splitIcon) {
            if (iconItem.text !== icon) iconItem.text = icon;
            if (String(iconItem.color ?? '') !== String(color ?? '')) iconItem.color = color;
            if (iconItem.backgroundColor?.id !== bg?.id) iconItem.backgroundColor = bg;
            iconItem.show();
        } else {
            iconItem.hide();
        }
        if (tooltipKey !== lastTooltipKey) {
            statusItem.tooltip = tooltip;
            iconItem.tooltip = tooltip;
            lastTooltipKey = tooltipKey;
        }
        statusItem.show();
    };

    const poll = async (): Promise<void> => {
        if (polling) return;
        polling = true;
        try {
            const timeoutMs = Math.max(1, cfg().get<number>('requestTimeoutSeconds', 4)) * 1000;
            const res = await fetchMetrics(getEndpoint(), timeoutMs, await loadToken());
            if (res.ok && res.data) {
                lastData = res.data;
                lastError = undefined;
                lastUpdate = new Date();
                failCount = 0;
            } else {
                lastError = res.error;
                failCount++;
            }
        } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
            failCount++;
        } finally {
            polling = false;
        }
        // render outside the fetch block so a rendering glitch can never reject
        // the promise returned to setInterval/refreshNow
        try {
            paint();
            panel.update(lastData, lastError, lastUpdate);
        } catch (err) {
            console.error('Strata metrics render failed:', err);
        }
    };

    const restartTimer = (): void => {
        if (timer) clearInterval(timer);
        timer = undefined;
        if (!cfg().get<boolean>('enabled', true)) {
            statusItem.hide();
            iconItem.hide();
            return;
        }
        const secs = Math.max(0.5, cfg().get<number>('refreshIntervalSeconds', 2));
        timer = setInterval(poll, secs * 1000);
        void poll();
    };

    context.subscriptions.push(
        { dispose: () => { statusItem.dispose(); iconItem.dispose(); } },
        { dispose: () => { if (timer) clearInterval(timer); timer = undefined; } },
        vscode.commands.registerCommand('strata.showMetrics', () => panel.show(lastData, lastError, lastUpdate)),
        vscode.commands.registerCommand('strata.refreshNow', poll),
        vscode.commands.registerCommand('strata.setEndpoint', async () => {
            const value = await vscode.window.showInputBox({
                title: 'Strata metrics endpoint',
                prompt: 'URL of the Strata JSON metrics endpoint',
                value: getEndpoint(),
                placeHolder: 'http://127.0.0.1:8080/metrics',
            });
            if (value !== undefined) {
                await cfg().update('endpoint', value.trim(), vscode.ConfigurationTarget.Global);
            }
        }),
        vscode.commands.registerCommand('strata.setApiKey', async () => {
            const current = await loadToken();
            const value = await vscode.window.showInputBox({
                title: 'Strata API key (Bearer token)',
                prompt:
                    'Sent as "Authorization: Bearer <key>" to the metrics endpoint. ' +
                    'Leave empty to remove the stored key.',
                password: true,
                ignoreFocusOut: true,
                placeHolder: current ? '•••••••• (stored — type a new key, or empty to remove)' : 'the key from strata launch / strata launch --show-key',
            });
            if (value === undefined) return;
            const trimmed = value.trim();
            if (trimmed) {
                await context.secrets.store(SECRET_KEY, trimmed);
                void vscode.window.showInformationMessage('Strata: API key stored in VS Code secret storage.');
            } else {
                await context.secrets.delete(SECRET_KEY);
                if (cfg().get<string>('apiKey', '').trim()) {
                    void vscode.window.showWarningMessage(
                        'Strata: secret storage key removed, but strata.apiKey is still set in settings — clear it there too.'
                    );
                } else {
                    void vscode.window.showInformationMessage('Strata: API key removed.');
                }
            }
            void poll();
        }),
        vscode.commands.registerCommand('strata.setStatusBarFormat', async () => {
            const picked = await vscode.window.showQuickPick(
                FORMAT_PRESETS.map(([label, format]) => ({ label, description: format, format })),
                { title: 'Strata status bar format', placeHolder: 'Choose a preset (or edit strata.statusBar.format in settings)' }
            );
            if (picked) {
                await cfg().update('statusBar.format', picked.format, vscode.ConfigurationTarget.Global);
            }
        }),
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('strata.statusBar.alignment') || e.affectsConfiguration('strata.statusBar.priority')) {
                reAlignStatusBar();
            }
            if (e.affectsConfiguration('strata')) {
                paint();
                restartTimer();
            }
        })
    );

    restartTimer();
}

export function deactivate(): void {
    // the poll interval and status bar items are disposed via context.subscriptions
}

function buildTooltip(data: MetricsPayload, values: Record<string, string | null>): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = false;
    const line = (k: string, v: string | null | undefined) => (v ? md.appendText(`${k}: ${v}\n`) : undefined);
    md.appendMarkdown(`**Strata — ${data.engine?.model ?? 'unknown model'}**\n\n`);
    line('State', values.state);
    line('Decode now', values.gen ? `${values.gen} t/s` : null);
    line('Avg (this request)', values.gen_avg ? `${values.gen_avg} t/s` : null);
    line('Prefill', values.pre ? `${values.pre} t/s` : null);
    line('GPU load', values.gpu ? `${values.gpu}%` : null);
    line('GPU VRAM', values.vram);
    line('Temp', values.temp ? `${values.temp} °C` : null);
    line('Context', values.ctx ? `${values.ctx} tokens` : null);
    md.appendMarkdown(`\n_Click to open full metrics._`);
    return md;
}
