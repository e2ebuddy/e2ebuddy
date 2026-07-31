import { create } from 'zustand';

import {
  cancelRun,
  createRun,
  fetchHealth,
  fetchReportMarkdown,
  fetchRun,
  fetchRuns,
  fetchSettings,
  openRunEventSource,
  retestRun,
  saveBranding,
  saveLlm,
  testLlm,
  uploadLogo,
  type Health,
  type PublicRun,
  type PublicSettings,
  type RunEvent,
} from './api';

/** Main app chrome: workbench vs full settings shell (ADE-style). */
export type NavView = 'workbench' | 'settings';

/** Sections inside the settings page. */
export type SettingsSection = 'branding' | 'llm';

type AppState = {
  health: Health | null;
  settings: PublicSettings | null;
  runs: PublicRun[];
  selectedRunId: string | null;
  selectedRun: PublicRun | null;
  events: RunEvent[];
  view: NavView;
  settingsSection: SettingsSection;
  loading: boolean;
  error: string | null;
  targetUrl: string;
  userBrief: string;
  reportMarkdown: string | null;
  setView: (view: NavView) => void;
  setSettingsSection: (section: SettingsSection) => void;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  setTargetUrl: (value: string) => void;
  setUserBrief: (value: string) => void;
  selectRun: (id: string | null) => Promise<void>;
  refresh: () => Promise<void>;
  submit: () => Promise<void>;
  cancelSelected: () => Promise<void>;
  retestSelected: (issue?: { issueId?: string; issueTitle?: string }) => Promise<void>;
  loadReportMarkdown: () => Promise<void>;
  saveBrandingForm: (productName: string) => Promise<void>;
  uploadLogoFile: (file: File) => Promise<void>;
  clearLogo: () => Promise<void>;
  saveLlmForm: (input: {
    provider: string;
    baseUrl: string;
    apiKey: string;
    agentModel: string;
    visionModel: string;
    reportModel: string;
  }) => Promise<void>;
  testLlmConnection: () => Promise<string>;
  appendEvent: (event: RunEvent) => void;
};

let eventSource: EventSource | null = null;

function closeEventSource(): void {
  eventSource?.close();
  eventSource = null;
}

export const useAppStore = create<AppState>((set, get) => ({
  health: null,
  settings: null,
  runs: [],
  selectedRunId: null,
  selectedRun: null,
  events: [],
  view: 'workbench',
  settingsSection: 'branding',
  loading: false,
  error: null,
  targetUrl: 'https://example.com',
  userBrief: '',
  reportMarkdown: null,

  setView: (view) => set({ view }),
  setSettingsSection: (section) => set({ settingsSection: section }),
  openSettings: (section) =>
    set({
      view: 'settings',
      settingsSection: section ?? get().settingsSection ?? 'branding',
    }),
  closeSettings: () => set({ view: 'workbench' }),
  setTargetUrl: (value) => set({ targetUrl: value }),
  setUserBrief: (value) => set({ userBrief: value }),

  appendEvent: (event) => {
    set((state) => {
      if (state.events.some((item) => item.id === event.id)) return state;
      return { events: [...state.events, event].sort((a, b) => a.id - b.id) };
    });
  },

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const [health, runs, settings] = await Promise.all([
        fetchHealth(),
        fetchRuns(),
        fetchSettings(),
      ]);
      const selectedRunId = get().selectedRunId;
      let selectedRun = get().selectedRun;
      if (selectedRunId) {
        selectedRun = runs.find((run) => run.id === selectedRunId) ?? (await fetchRun(selectedRunId));
      }
      set({ health, runs, settings, selectedRun, loading: false });
      if (health.productName) document.title = health.productName;
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  selectRun: async (id) => {
    closeEventSource();
    set({ selectedRunId: id, events: [], reportMarkdown: null });
    if (!id) {
      set({ selectedRun: null });
      return;
    }
    try {
      const run = await fetchRun(id);
      set({ selectedRun: run });
      const lastId = 0;
      eventSource = openRunEventSource(id, lastId, (event) => {
        get().appendEvent(event);
        if (
          event.type === 'run.completed' ||
          event.type === 'run.failed' ||
          event.type === 'artifact.created' ||
          event.type === 'phase.completed'
        ) {
          void fetchRun(id).then((latest) => set({ selectedRun: latest }));
          void get().refresh();
        }
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  submit: async () => {
    const { targetUrl, userBrief } = get();
    set({ loading: true, error: null });
    try {
      const run = await createRun({
        targetUrl: targetUrl.trim(),
        userBrief: userBrief.trim() || undefined,
      });
      await get().refresh();
      await get().selectRun(run.id);
      set({ loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  cancelSelected: async () => {
    const id = get().selectedRunId;
    if (!id) return;
    await cancelRun(id);
    await get().refresh();
    await get().selectRun(id);
  },

  retestSelected: async (issue) => {
    const id = get().selectedRunId;
    if (!id) return;
    set({ loading: true, error: null });
    try {
      const run = await retestRun(id, issue);
      await get().refresh();
      await get().selectRun(run.id);
      set({ loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  loadReportMarkdown: async () => {
    const id = get().selectedRunId;
    if (!id) return;
    const markdown = await fetchReportMarkdown(id);
    set({ reportMarkdown: markdown });
  },

  saveBrandingForm: async (productName) => {
    const settings = await saveBranding({ productName });
    set({ settings });
    document.title = settings.branding.productName;
    await get().refresh();
  },

  uploadLogoFile: async (file) => {
    const settings = await uploadLogo(file);
    set({ settings });
  },

  clearLogo: async () => {
    const settings = await saveBranding({ clearLogo: true });
    set({ settings });
  },

  saveLlmForm: async (input) => {
    const settings = await saveLlm(input);
    set({ settings });
    await get().refresh();
  },

  testLlmConnection: async () => {
    const result = await testLlm();
    return result.message;
  },
}));
