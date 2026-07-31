import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  ArrowLeft,
  Bot,
  Copy,
  Image as ImageIcon,
  Languages,
  LayoutDashboard,
  Loader2,
  Moon,
  Play,
  RefreshCw,
  RotateCcw,
  Settings,
  Settings2,
  Square,
  Sun,
} from 'lucide-react';

import { t, type Locale, type MessageKey } from './i18n';
import { applyTheme, initPrefs, saveLocale, type Theme } from './prefs';
import { useAppStore } from './store';

const PHASES = ['explore', 'plan', 'execute', 'judge', 'report'] as const;

export function App() {
  const [locale, setLocale] = useState<Locale>(() => initPrefs().locale);
  const [theme, setTheme] = useState<Theme>(() => initPrefs().theme);

  const {
    health,
    settings,
    runs,
    selectedRun,
    selectedRunId,
    events,
    view,
    loading,
    error,
    targetUrl,
    userBrief,
    reportMarkdown,
    settingsSection,
    setTargetUrl,
    setUserBrief,
    setSettingsSection,
    openSettings,
    closeSettings,
    selectRun,
    refresh,
    submit,
    cancelSelected,
    retestSelected,
    loadReportMarkdown,
    saveBrandingForm,
    uploadLogoFile,
    clearLogo,
    saveLlmForm,
    testLlmConnection,
  } = useAppStore();

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 4_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const tr = (key: MessageKey) => t(locale, key);
  const productName = settings?.branding.productName || health?.productName || 'e2ebuddy';
  const phaseStatus = useMemo(() => derivePhases(events), [events]);
  const evidence = selectedRun?.lastEvidence;

  const toggleLocale = () => {
    const next: Locale = locale === 'zh' ? 'en' : 'zh';
    setLocale(next);
    saveLocale(next);
  };

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
  };

  return (
    <div className="ui-surface flex min-h-screen">
      <aside className="ui-elevated flex w-64 shrink-0 flex-col border-r ui-border">
        <div className="flex items-center gap-3 border-b ui-border px-4 py-4">
          {settings?.branding.logoUrl ? (
            <img
              src={settings.branding.logoUrl}
              alt=""
              className="h-9 w-9 rounded-lg object-cover"
            />
          ) : (
            <div
              className="flex h-9 w-9 items-center justify-center rounded-lg"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              <Activity className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{productName}</div>
            <div className="ui-faint text-[11px]">{tr('localWorkbench')}</div>
          </div>
        </div>

        <nav className="space-y-1 p-3 text-sm">
          <NavButton
            active={view === 'workbench'}
            icon={<LayoutDashboard className="h-4 w-4" />}
            label={tr('workbench')}
            onClick={() => closeSettings()}
          />
        </nav>

        <div className="flex-1 overflow-auto border-t ui-border p-3">
          <div className="ui-faint mb-2 flex items-center justify-between text-[11px] uppercase tracking-wide">
            <span>{tr('runHistory')}</span>
            <span>{runs.length}</span>
          </div>
          {runs.length === 0 ? (
            <p className="ui-faint text-xs">{tr('noRuns')}</p>
          ) : (
            <ul className="space-y-1">
              {runs.map((run) => (
                <li key={run.id}>
                  <button
                    type="button"
                    onClick={() => {
                      closeSettings();
                      void selectRun(run.id);
                    }}
                    className={`w-full rounded-lg border px-2 py-2 text-left transition ${
                      selectedRunId === run.id && view === 'workbench'
                        ? 'border-[color:var(--accent)]'
                        : 'border-transparent hover:ui-btn'
                    }`}
                    style={
                      selectedRunId === run.id && view === 'workbench'
                        ? { background: 'var(--accent-soft)' }
                        : undefined
                    }
                  >
                    <div className="truncate text-xs">{run.targetUrl}</div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <StatusPill status={run.status} />
                      <span className="ui-faint font-mono text-[10px]">{run.id.slice(0, 8)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ADE-style bottom toolbar: settings gear on the left */}
        <div className="mt-auto shrink-0 border-t ui-border">
          <div className="flex items-center justify-between px-2 py-1.5">
            <button
              type="button"
              onClick={() => openSettings()}
              aria-label={tr('settings')}
              title={tr('settings')}
              className={`ui-btn inline-flex h-8 w-8 items-center justify-center rounded-md ${
                view === 'settings' ? 'ring-1 ring-[color:var(--accent)]' : ''
              }`}
            >
              <Settings className="h-4 w-4" strokeWidth={2.25} />
            </button>
            <div className="ui-faint truncate px-1 text-[10px]">
              {tr('localMode')}
              {health?.pipeline ? ` · ${health.pipeline}` : ''} · v{health?.version ?? '—'}
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b ui-border px-5 py-3">
          <div className="ui-muted flex flex-wrap items-center gap-2 text-xs">
            {PHASES.map((phase) => (
              <PhaseChip key={phase} phase={phase} state={phaseStatus[phase]} />
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={toggleLocale}
              className="ui-btn inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs"
              title={locale === 'zh' ? 'Switch to English' : '切换到中文'}
            >
              <Languages className="h-3.5 w-3.5" />
              {tr('lang')}
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              className="ui-btn inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs"
              title={theme === 'dark' ? tr('themeLight') : tr('themeDark')}
            >
              {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              {theme === 'dark' ? tr('themeLight') : tr('themeDark')}
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              className="ui-btn inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              {tr('refresh')}
            </button>
          </div>
        </header>

        {error ? (
          <div
            className="mx-5 mt-4 rounded-lg border px-3 py-2 text-sm"
            style={{
              borderColor: 'color-mix(in srgb, var(--danger) 40%, transparent)',
              background: 'color-mix(in srgb, var(--danger) 12%, transparent)',
              color: 'var(--danger)',
            }}
          >
            {error}
          </div>
        ) : null}

        {view === 'workbench' ? (
          <Workbench
            tr={tr}
            targetUrl={targetUrl}
            userBrief={userBrief}
            setTargetUrl={setTargetUrl}
            setUserBrief={setUserBrief}
            submit={() => void submit()}
            loading={loading}
            selectedRun={selectedRun}
            events={events}
            evidence={evidence ?? null}
            pipeline={health?.pipeline}
            cancelSelected={() => void cancelSelected()}
            retestSelected={() => void retestSelected()}
            loadReportMarkdown={() => void loadReportMarkdown()}
            reportMarkdown={reportMarkdown}
            retestIssue={(issue) => void retestSelected(issue)}
          />
        ) : null}

        {view === 'settings' ? (
          <SettingsShell
            tr={tr}
            section={settingsSection}
            onBack={() => closeSettings()}
            onSelectSection={setSettingsSection}
            branding={
              settings ? (
                <BrandingPanel
                  tr={tr}
                  settings={settings}
                  onSave={(name) => void saveBrandingForm(name)}
                  onUpload={(file) => void uploadLogoFile(file)}
                  onClear={() => void clearLogo()}
                />
              ) : null
            }
            models={
              settings ? (
                <LlmPanel
                  tr={tr}
                  settings={settings}
                  onSave={(input) => void saveLlmForm(input)}
                  onTest={() => testLlmConnection()}
                />
              ) : null
            }
          />
        ) : null}
      </div>
    </div>
  );
}

/** ADE-style settings page: left section nav + content. */
function SettingsShell(props: {
  tr: (key: MessageKey) => string;
  section: 'branding' | 'llm';
  onBack: () => void;
  onSelectSection: (section: 'branding' | 'llm') => void;
  branding: ReactNode;
  models: ReactNode;
}) {
  const { tr, section } = props;
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <aside className="ui-elevated flex w-56 shrink-0 flex-col border-r ui-border">
        <div className="border-b ui-border px-2 py-2">
          <button
            type="button"
            onClick={props.onBack}
            className="ui-btn flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm"
          >
            <ArrowLeft className="h-4 w-4" />
            {tr('settingsBack')}
          </button>
          <div className="mt-2 px-2.5 pb-1 text-xs font-semibold tracking-wide">
            {tr('settings')}
          </div>
        </div>
        <nav className="space-y-1 p-2 text-sm">
          <NavButton
            active={section === 'branding'}
            icon={<ImageIcon className="h-4 w-4" />}
            label={tr('branding')}
            onClick={() => props.onSelectSection('branding')}
          />
          <NavButton
            active={section === 'llm'}
            icon={<Bot className="h-4 w-4" />}
            label={tr('models')}
            onClick={() => props.onSelectSection('llm')}
          />
        </nav>
      </aside>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {section === 'branding' ? props.branding : props.models}
      </div>
    </div>
  );
}

function Workbench(props: {
  tr: (key: MessageKey) => string;
  targetUrl: string;
  userBrief: string;
  setTargetUrl: (v: string) => void;
  setUserBrief: (v: string) => void;
  submit: () => void;
  loading: boolean;
  selectedRun: ReturnType<typeof useAppStore.getState>['selectedRun'];
  events: ReturnType<typeof useAppStore.getState>['events'];
  evidence: NonNullable<ReturnType<typeof useAppStore.getState>['selectedRun']>['lastEvidence'];
  pipeline?: string;
  cancelSelected: () => void;
  retestSelected: () => void;
  loadReportMarkdown: () => void;
  reportMarkdown: string | null;
  retestIssue: (issue: { issueId?: string; issueTitle?: string }) => void;
}) {
  const { tr } = props;
  const [panel, setPanel] = useState<'dom' | 'a11y' | 'visual' | 'network' | 'console'>('visual');
  const report = props.selectedRun?.report as Record<string, unknown> | null | undefined;
  const issues = Array.isArray(report?.issues) ? (report?.issues as Record<string, unknown>[]) : [];

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 xl:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
      <section className="flex min-h-0 flex-col border-r ui-border">
        <div className="border-b ui-border p-4">
          {props.pipeline === 'brain' ? (
            <div
              className="mb-3 rounded-lg border px-3 py-2 text-xs"
              style={{
                borderColor: 'color-mix(in srgb, var(--accent) 35%, transparent)',
                background: 'var(--accent-soft)',
                color: 'var(--accent)',
              }}
            >
              {tr('brainBanner')}
            </div>
          ) : (
            <div
              className="mb-3 rounded-lg border px-3 py-2 text-xs"
              style={{
                borderColor: 'color-mix(in srgb, var(--warn) 40%, transparent)',
                background: 'color-mix(in srgb, var(--warn) 12%, transparent)',
                color: 'var(--warn)',
              }}
            >
              {tr('demoBanner')}{' '}
              <button
                type="button"
                className="underline"
                onClick={() => useAppStore.getState().openSettings('llm')}
              >
                {tr('models')}
              </button>
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <label className="ui-faint block text-[11px] font-medium uppercase tracking-wide">
              {tr('targetUrl')}
              <input
                value={props.targetUrl}
                onChange={(e) => props.setTargetUrl(e.target.value)}
                className="ui-input mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
              />
            </label>
            <div className="flex items-end gap-2">
              <button
                type="button"
                disabled={props.loading || !props.targetUrl.trim()}
                onClick={props.submit}
                className="ui-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {props.loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {tr('run')}
              </button>
              {props.selectedRun && ['queued', 'running'].includes(props.selectedRun.status) ? (
                <button
                  type="button"
                  onClick={props.cancelSelected}
                  className="ui-btn inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm"
                >
                  <Square className="h-3.5 w-3.5" />
                  {tr('cancel')}
                </button>
              ) : null}
            </div>
          </div>
          <label className="ui-faint mt-3 block text-[11px] font-medium uppercase tracking-wide">
            {tr('brief')}
            <textarea
              value={props.userBrief}
              onChange={(e) => props.setUserBrief(e.target.value)}
              rows={2}
              className="ui-input mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
              placeholder={tr('briefPlaceholder')}
            />
          </label>
        </div>

        <div className="grid min-h-0 flex-1 grid-rows-[minmax(200px,1fr)_minmax(160px,0.7fr)]">
          <div className="overflow-auto border-b ui-border p-4">
            <div className="ui-faint mb-2 text-[11px] uppercase tracking-wide">{tr('viewport')}</div>
            {props.evidence?.screenshotBase64 ? (
              <img
                src={`data:image/jpeg;base64,${props.evidence.screenshotBase64}`}
                alt=""
                className="max-h-[420px] w-full rounded-xl border ui-border object-contain"
                style={{ background: '#000' }}
              />
            ) : (
              <EmptyState text={tr('selectRunScreenshot')} />
            )}
            {props.evidence?.title ? (
              <div className="ui-muted mt-2 truncate text-xs">
                {props.evidence.title} · {props.evidence.url}
              </div>
            ) : null}
          </div>

          <div className="overflow-auto p-4">
            <div className="ui-faint mb-2 text-[11px] uppercase tracking-wide">{tr('timeline')}</div>
            {props.events.length === 0 ? (
              <EmptyState text={tr('eventsHint')} />
            ) : (
              <ol className="space-y-2">
                {props.events.map((event) => (
                  <li
                    key={event.id}
                    className="ui-elevated rounded-lg border ui-border px-3 py-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span style={{ color: 'var(--accent)' }} className="font-medium">
                        {event.type}
                      </span>
                      <span className="ui-faint">{event.createdAt.slice(11, 19)}</span>
                    </div>
                    <pre className="ui-muted mt-1 max-h-20 overflow-auto whitespace-pre-wrap text-[11px]">
                      {JSON.stringify(event.payload, null, 0)}
                    </pre>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </section>

      <section className="flex min-h-0 flex-col">
        <div className="flex flex-wrap gap-1 border-b ui-border p-2">
          {(['visual', 'dom', 'a11y', 'network', 'console'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setPanel(key)}
              className={`rounded-md px-2 py-1 text-xs capitalize ${
                panel === key ? 'ui-btn' : 'ui-muted hover:ui-btn'
              }`}
              style={panel === key ? { background: 'var(--bg-muted)' } : undefined}
            >
              {tr(key)}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4 text-sm">
          {!props.evidence ? (
            <EmptyState text={tr('evidenceEmpty')} />
          ) : panel === 'visual' ? (
            <div className="space-y-2 text-xs">
              <Row label={tr('title')} value={props.evidence.title} />
              <Row label={tr('url')} value={props.evidence.url} />
              <Row
                label={tr('geometry')}
                value={
                  props.evidence.geometry
                    ? `${props.evidence.geometry.viewportWidth}×${props.evidence.geometry.viewportHeight}`
                    : '—'
                }
              />
              <Row
                label={tr('interactables')}
                value={String(props.evidence.interactableCount ?? '—')}
              />
            </div>
          ) : panel === 'dom' ? (
            <pre className="ui-muted whitespace-pre-wrap text-xs">
              {props.evidence.domSummary || tr('noDom')}
            </pre>
          ) : panel === 'a11y' ? (
            <pre className="ui-muted whitespace-pre-wrap text-xs">
              {props.evidence.a11ySummary || tr('noA11y')}
            </pre>
          ) : panel === 'network' ? (
            <div className="space-y-2 text-xs">
              <Row label={tr('requests')} value={String(props.evidence.network?.requestCount ?? 0)} />
              <Row label={tr('failed')} value={String(props.evidence.network?.failedCount ?? 0)} />
              <ul className="ui-muted mt-2 max-h-64 space-y-1 overflow-auto">
                {(props.evidence.network?.sampleUrls ?? []).map((u) => (
                  <li key={u} className="truncate font-mono text-[11px]">
                    {u}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <ul className="space-y-2 text-xs">
              {(props.evidence.consoleLogs ?? []).length === 0 ? (
                <EmptyState text={tr('noConsole')} />
              ) : (
                (props.evidence.consoleLogs ?? []).map((log, index) => (
                  <li key={`${log.type}-${index}`} className="rounded border ui-border p-2">
                    <span style={{ color: 'var(--warn)' }}>{log.type}</span>
                    <div className="mt-1">{log.text}</div>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>

        <div className="max-h-[40%] overflow-auto border-t ui-border p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="ui-faint text-[11px] uppercase tracking-wide">{tr('report')}</div>
            <div className="flex flex-wrap gap-2">
              {props.selectedRun?.status === 'completed' ||
              props.selectedRun?.status === 'failed' ? (
                <>
                  <button
                    type="button"
                    onClick={props.retestSelected}
                    className="ui-btn inline-flex items-center gap-1 rounded px-2 py-1 text-[11px]"
                  >
                    <RotateCcw className="h-3 w-3" /> {tr('retest')}
                  </button>
                  <button
                    type="button"
                    onClick={props.loadReportMarkdown}
                    className="ui-btn inline-flex items-center gap-1 rounded px-2 py-1 text-[11px]"
                  >
                    {tr('loadMarkdown')}
                  </button>
                </>
              ) : null}
            </div>
          </div>

          {report ? (
            <div className="space-y-2 text-xs">
              <Row label={tr('mode')} value={String(report.mode ?? '—')} />
              <Row label={tr('health')} value={String(report.healthScore ?? '—')} />
              <Row label={tr('verdict')} value={String(report.verdict ?? report.summary ?? '—')} />
              {props.selectedRun?.parentRunId ? (
                <Row label={tr('parentRun')} value={props.selectedRun.parentRunId} />
              ) : null}
              {issues.length > 0 ? (
                <div className="mt-3 space-y-2">
                  <div className="ui-faint text-[11px] uppercase">{tr('issues')}</div>
                  {issues.map((issue) => (
                    <div
                      key={String(issue.id)}
                      className="ui-elevated rounded-lg border ui-border p-2"
                    >
                      <div style={{ color: 'var(--danger)' }} className="font-medium">
                        {String(issue.title)}
                      </div>
                      <div className="ui-muted mt-1">
                        {String(issue.severity)} · conf {String(issue.confidence)}
                      </div>
                      <p className="mt-1">{String(issue.detail)}</p>
                      <button
                        type="button"
                        className="mt-2 text-[11px] hover:underline"
                        style={{ color: 'var(--accent)' }}
                        onClick={() =>
                          props.retestIssue({
                            issueId: String(issue.id),
                            issueTitle: String(issue.title),
                          })
                        }
                      >
                        {tr('retestIssue')}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="ui-faint">{tr('noIssues')}</p>
              )}
            </div>
          ) : (
            <EmptyState text={tr('reportEmpty')} />
          )}

          {props.reportMarkdown ? (
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="ui-faint text-[11px] uppercase">{tr('markdown')}</span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[11px]"
                  style={{ color: 'var(--accent)' }}
                  onClick={() => void navigator.clipboard.writeText(props.reportMarkdown ?? '')}
                >
                  <Copy className="h-3 w-3" /> {tr('copy')}
                </button>
              </div>
              <pre className="ui-elevated max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border ui-border p-2 text-[11px]">
                {props.reportMarkdown}
              </pre>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function BrandingPanel(props: {
  tr: (key: MessageKey) => string;
  settings: NonNullable<ReturnType<typeof useAppStore.getState>['settings']>;
  onSave: (name: string) => void;
  onUpload: (file: File) => void;
  onClear: () => void;
}) {
  const { tr } = props;
  const [name, setName] = useState(props.settings.branding.productName);
  useEffect(() => {
    setName(props.settings.branding.productName);
  }, [props.settings.branding.productName]);

  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="flex items-center gap-2 text-lg font-semibold">
        <ImageIcon className="h-5 w-5" style={{ color: 'var(--accent)' }} /> {tr('brandingTitle')}
      </h1>
      <p className="ui-muted mt-1 text-sm">{tr('brandingHint')}</p>
      <label className="ui-faint mt-6 block text-xs uppercase tracking-wide">
        {tr('productName')}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="ui-input mt-2 w-full rounded-lg px-3 py-2 text-sm"
        />
      </label>
      <div className="mt-4 flex items-center gap-4">
        {props.settings.branding.logoUrl ? (
          <img
            src={props.settings.branding.logoUrl}
            alt=""
            className="h-16 w-16 rounded-xl border ui-border object-cover"
          />
        ) : (
          <div className="ui-faint flex h-16 w-16 items-center justify-center rounded-xl border border-dashed ui-border text-xs">
            {tr('noLogo')}
          </div>
        )}
        <div className="space-y-2">
          <label className="ui-btn inline-flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm">
            {tr('uploadLogo')}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) props.onUpload(file);
              }}
            />
          </label>
          <button type="button" onClick={props.onClear} className="ui-muted block text-xs hover:underline">
            {tr('clearLogo')}
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => props.onSave(name)}
        className="ui-btn-primary mt-6 rounded-lg px-4 py-2 text-sm font-medium"
      >
        {tr('saveBranding')}
      </button>
    </div>
  );
}

function LlmPanel(props: {
  tr: (key: MessageKey) => string;
  settings: NonNullable<ReturnType<typeof useAppStore.getState>['settings']>;
  onSave: (input: {
    provider: string;
    baseUrl: string;
    apiKey: string;
    agentModel: string;
    visionModel: string;
    reportModel: string;
  }) => void;
  onTest: () => Promise<string>;
}) {
  const { tr } = props;
  const llm = props.settings.llm;
  const [provider, setProvider] = useState(llm.provider);
  const [baseUrl, setBaseUrl] = useState(llm.baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [agentModel, setAgentModel] = useState(llm.agentModel);
  const [visionModel, setVisionModel] = useState(llm.visionModel);
  const [reportModel, setReportModel] = useState(llm.reportModel);
  const [testMessage, setTestMessage] = useState<string | null>(null);

  useEffect(() => {
    setProvider(llm.provider);
    setBaseUrl(llm.baseUrl);
    setAgentModel(llm.agentModel);
    setVisionModel(llm.visionModel);
    setReportModel(llm.reportModel);
    setApiKey('');
  }, [llm]);

  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="flex items-center gap-2 text-lg font-semibold">
        <Settings2 className="h-5 w-5" style={{ color: 'var(--accent)' }} /> {tr('modelsTitle')}
      </h1>
      <p className="ui-muted mt-1 text-sm">{tr('modelsHint')}</p>

      <label className="ui-faint mt-6 block text-xs uppercase tracking-wide">
        {tr('provider')}
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as typeof provider)}
          className="ui-input mt-2 w-full rounded-lg px-3 py-2 text-sm"
        >
          <option value="openai-compatible">OpenAI-compatible</option>
          <option value="anthropic">Anthropic</option>
        </select>
      </label>

      {provider === 'openai-compatible' ? (
        <label className="ui-faint mt-3 block text-xs uppercase tracking-wide">
          {tr('baseUrl')}
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="ui-input mt-2 w-full rounded-lg px-3 py-2 text-sm"
            placeholder="https://api.example.com/v1"
          />
        </label>
      ) : null}

      <label className="ui-faint mt-3 block text-xs uppercase tracking-wide">
        {tr('apiKey')}
        {llm.hasApiKey ? ` (${tr('saved')}: ${llm.apiKeyMasked})` : ''}
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="ui-input mt-2 w-full rounded-lg px-3 py-2 text-sm"
          placeholder={llm.hasApiKey ? tr('keepKey') : 'sk-...'}
          autoComplete="off"
        />
      </label>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label={tr('agentModel')} value={agentModel} onChange={setAgentModel} />
        <Field label={tr('visionModel')} value={visionModel} onChange={setVisionModel} />
        <Field label={tr('reportModel')} value={reportModel} onChange={setReportModel} />
      </div>

      <button
        type="button"
        className="mt-3 text-xs hover:underline"
        style={{ color: 'var(--accent)' }}
        onClick={() => {
          setVisionModel(agentModel);
          setReportModel(agentModel);
        }}
      >
        {tr('reuseAgent')}
      </button>

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() =>
            props.onSave({
              provider,
              baseUrl,
              apiKey,
              agentModel,
              visionModel,
              reportModel,
            })
          }
          className="ui-btn-primary rounded-lg px-4 py-2 text-sm font-medium"
        >
          {tr('saveModels')}
        </button>
        <button
          type="button"
          onClick={() => {
            void props
              .onTest()
              .then(setTestMessage)
              .catch((e: unknown) => {
                setTestMessage(e instanceof Error ? e.message : String(e));
              });
          }}
          className="ui-btn rounded-lg px-4 py-2 text-sm"
        >
          {tr('testConnection')}
        </button>
      </div>
      {testMessage ? <p className="ui-muted mt-3 text-sm">{testMessage}</p> : null}
    </div>
  );
}

function Field(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="ui-faint block text-xs uppercase tracking-wide">
      {props.label}
      <input
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="ui-input mt-2 w-full rounded-lg px-3 py-2 text-sm"
      />
    </label>
  );
}

function NavButton(props: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left ${
        props.active ? '' : 'ui-muted'
      }`}
      style={
        props.active
          ? { background: 'var(--bg-muted)', color: 'var(--text)' }
          : undefined
      }
    >
      {props.icon}
      {props.label}
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  const color =
    status === 'completed'
      ? 'var(--ok)'
      : status === 'failed' || status === 'cancelled'
        ? 'var(--danger)'
        : status === 'running'
          ? 'var(--accent)'
          : 'var(--warn)';
  return (
    <span
      className="rounded-full border px-1.5 py-0.5 text-[10px] capitalize"
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
      }}
    >
      {status}
    </span>
  );
}

function PhaseChip({
  phase,
  state,
}: {
  phase: string;
  state: 'idle' | 'active' | 'done' | 'failed';
}) {
  const color =
    state === 'done'
      ? 'var(--ok)'
      : state === 'active'
        ? 'var(--accent)'
        : state === 'failed'
          ? 'var(--danger)'
          : 'var(--text-faint)';
  return (
    <span
      className="rounded-full border px-2 py-0.5 capitalize"
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
      }}
    >
      {phase}
    </span>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="ui-faint">{label}</span>
      <span className="max-w-[70%] truncate text-right">{value || '—'}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="ui-faint text-xs">{text}</p>;
}

function derivePhases(
  events: Array<{ type: string; payload: unknown }>,
): Record<(typeof PHASES)[number], 'idle' | 'active' | 'done' | 'failed'> {
  const result: Record<(typeof PHASES)[number], 'idle' | 'active' | 'done' | 'failed'> = {
    explore: 'idle',
    plan: 'idle',
    execute: 'idle',
    judge: 'idle',
    report: 'idle',
  };
  for (const event of events) {
    const payload = event.payload as { phase?: string } | undefined;
    const phase = payload?.phase as (typeof PHASES)[number] | undefined;
    if (!phase || !(phase in result)) continue;
    if (event.type === 'phase.started') result[phase] = 'active';
    if (event.type === 'phase.completed') result[phase] = 'done';
  }
  if (events.some((e) => e.type === 'run.failed')) {
    for (const phase of PHASES) {
      if (result[phase] === 'active') result[phase] = 'failed';
    }
  }
  return result;
}
