import { mkdir, readFile, rename, writeFile, copyFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import type { UserDataLayout } from '../lib/paths.js';

export type BrandingSettings = {
  productName: string;
  logoFileName: string | null;
};

export type LlmSettings = {
  provider: 'openai-compatible' | 'anthropic';
  baseUrl: string;
  /** Stored secret; never returned raw via public API. */
  apiKey: string;
  agentModel: string;
  visionModel: string;
  reportModel: string;
};

export type AppSettings = {
  version: 1;
  branding: BrandingSettings;
  llm: LlmSettings;
};

function nonEmpty(value: string | undefined | null): string {
  return value?.trim() ? value.trim() : '';
}

/** Build defaults from current process.env (call after loadEnvFile). */
function envSeededSettings(): AppSettings {
  return {
    version: 1,
    branding: {
      productName: process.env.E2EBUDDY_UI_PRODUCT_NAME?.trim() || 'e2ebuddy',
      logoFileName: null,
    },
    llm: {
      provider:
        (process.env.AI_PROVIDER?.trim() as LlmSettings['provider'] | undefined) ||
        (process.env.AI_API_KEY ? 'openai-compatible' : 'anthropic'),
      baseUrl: process.env.AI_BASE_URL?.trim() || '',
      apiKey: process.env.AI_API_KEY?.trim() || process.env.ANTHROPIC_API_KEY?.trim() || '',
      agentModel:
        process.env.AI_AGENT_MODEL?.trim() || process.env.ANTHROPIC_AGENT_MODEL?.trim() || '',
      visionModel: process.env.AI_VISION_MODEL?.trim() || '',
      reportModel:
        process.env.AI_REPORT_MODEL?.trim() ||
        process.env.ANTHROPIC_REPORT_MODEL?.trim() ||
        process.env.AI_AGENT_MODEL?.trim() ||
        '',
    },
  };
}

export type PublicSettings = {
  branding: BrandingSettings & { logoUrl: string | null };
  llm: {
    provider: LlmSettings['provider'];
    baseUrl: string;
    apiKeyMasked: string;
    hasApiKey: boolean;
    agentModel: string;
    visionModel: string;
    reportModel: string;
  };
};

export class SettingsStore {
  private readonly layout: UserDataLayout;
  private settings: AppSettings;
  private loaded = false;

  constructor(layout: UserDataLayout) {
    this.layout = layout;
    this.settings = envSeededSettings();
  }

  async init(): Promise<void> {
    if (this.loaded) return;
    await mkdir(this.layout.config, { recursive: true, mode: 0o700 });
    await mkdir(this.layout.branding, { recursive: true, mode: 0o700 });
    try {
      const raw = await readFile(this.layout.configFile, 'utf8');
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      const envDefaults = envSeededSettings();
      this.settings = {
        version: 1,
        branding: {
          productName:
            parsed.branding?.productName?.trim() || envDefaults.branding.productName,
          logoFileName: parsed.branding?.logoFileName ?? null,
        },
        llm: {
          provider:
            parsed.llm?.provider === 'anthropic' || parsed.llm?.provider === 'openai-compatible'
              ? parsed.llm.provider
              : envDefaults.llm.provider,
          // Prefer file values when non-empty; otherwise fall back to process env.
          baseUrl: nonEmpty(parsed.llm?.baseUrl) || envDefaults.llm.baseUrl,
          apiKey: nonEmpty(parsed.llm?.apiKey) || envDefaults.llm.apiKey,
          agentModel: nonEmpty(parsed.llm?.agentModel) || envDefaults.llm.agentModel,
          visionModel: nonEmpty(parsed.llm?.visionModel) || envDefaults.llm.visionModel,
          reportModel: nonEmpty(parsed.llm?.reportModel) || envDefaults.llm.reportModel,
        },
      };
    } catch {
      // seed from env defaults on first run
      this.settings = envSeededSettings();
      await this.persist();
    }
    this.loaded = true;
  }

  getRaw(): AppSettings {
    return this.settings;
  }

  toPublic(): PublicSettings {
    const logoFileName = this.settings.branding.logoFileName;
    return {
      branding: {
        productName: this.settings.branding.productName,
        logoFileName,
        logoUrl: logoFileName ? `/api/branding/logo?v=${encodeURIComponent(logoFileName)}` : null,
      },
      llm: {
        provider: this.settings.llm.provider,
        baseUrl: this.settings.llm.baseUrl,
        apiKeyMasked: maskSecret(this.settings.llm.apiKey),
        hasApiKey: this.settings.llm.apiKey.trim().length > 0,
        agentModel: this.settings.llm.agentModel,
        visionModel: this.settings.llm.visionModel,
        reportModel: this.settings.llm.reportModel,
      },
    };
  }

  async updateBranding(input: {
    productName?: string;
    clearLogo?: boolean;
  }): Promise<PublicSettings> {
    await this.init();
    if (input.productName !== undefined) {
      const name = input.productName.trim();
      if (name.length === 0 || name.length > 80) {
        throw new Error('productName must be 1–80 characters.');
      }
      this.settings.branding.productName = name;
    }
    if (input.clearLogo) {
      const previous = this.settings.branding.logoFileName;
      this.settings.branding.logoFileName = null;
      if (previous) {
        await unlink(path.join(this.layout.branding, previous)).catch(() => undefined);
      }
    }
    await this.persist();
    return this.toPublic();
  }

  async saveLogoFromUpload(sourcePath: string, originalName: string): Promise<PublicSettings> {
    await this.init();
    const ext = path.extname(originalName).toLowerCase().replace(/^\./, '') || 'png';
    if (!/^(png|jpe?g|gif|webp|svg)$/.test(ext)) {
      throw new Error('Logo must be png, jpg, gif, webp, or svg.');
    }
    const fileName = `logo-${randomBytes(8).toString('hex')}.${ext === 'jpeg' ? 'jpg' : ext}`;
    const destination = path.join(this.layout.branding, fileName);
    await copyFile(sourcePath, destination);
    const previous = this.settings.branding.logoFileName;
    this.settings.branding.logoFileName = fileName;
    if (previous && previous !== fileName) {
      await unlink(path.join(this.layout.branding, previous)).catch(() => undefined);
    }
    await this.persist();
    return this.toPublic();
  }

  async saveLogoBuffer(data: Buffer, originalName: string): Promise<PublicSettings> {
    await this.init();
    const ext = path.extname(originalName).toLowerCase().replace(/^\./, '') || 'png';
    if (!/^(png|jpe?g|gif|webp|svg)$/.test(ext)) {
      throw new Error('Logo must be png, jpg, gif, webp, or svg.');
    }
    const fileName = `logo-${randomBytes(8).toString('hex')}.${ext === 'jpeg' ? 'jpg' : ext}`;
    const destination = path.join(this.layout.branding, fileName);
    await writeFile(destination, data, { mode: 0o600 });
    const previous = this.settings.branding.logoFileName;
    this.settings.branding.logoFileName = fileName;
    if (previous && previous !== fileName) {
      await unlink(path.join(this.layout.branding, previous)).catch(() => undefined);
    }
    await this.persist();
    return this.toPublic();
  }

  async updateLlm(input: Partial<LlmSettings> & { apiKey?: string }): Promise<PublicSettings> {
    await this.init();
    if (input.provider === 'anthropic' || input.provider === 'openai-compatible') {
      this.settings.llm.provider = input.provider;
    }
    if (input.baseUrl !== undefined) this.settings.llm.baseUrl = input.baseUrl.trim();
    if (input.agentModel !== undefined) this.settings.llm.agentModel = input.agentModel.trim();
    if (input.visionModel !== undefined) this.settings.llm.visionModel = input.visionModel.trim();
    if (input.reportModel !== undefined) this.settings.llm.reportModel = input.reportModel.trim();
    if (input.apiKey !== undefined) {
      const key = input.apiKey.trim();
      // Empty or mask-like means keep previous.
      if (key.length > 0 && !key.includes('•') && !key.includes('*')) {
        this.settings.llm.apiKey = key;
      }
    }
    await this.persist();
    this.applyLlmToProcessEnv();
    return this.toPublic();
  }

  /** Push LLM settings into process.env for brain clients. */
  applyLlmToProcessEnv(): void {
    const llm = this.settings.llm;
    process.env.AI_PROVIDER = llm.provider;
    if (llm.provider === 'openai-compatible') {
      if (llm.apiKey) process.env.AI_API_KEY = llm.apiKey;
      if (llm.baseUrl) process.env.AI_BASE_URL = llm.baseUrl;
      if (llm.agentModel) process.env.AI_AGENT_MODEL = llm.agentModel;
      if (llm.visionModel) process.env.AI_VISION_MODEL = llm.visionModel;
      if (llm.reportModel) process.env.AI_REPORT_MODEL = llm.reportModel;
    } else {
      if (llm.apiKey) process.env.ANTHROPIC_API_KEY = llm.apiKey;
      if (llm.agentModel) process.env.ANTHROPIC_AGENT_MODEL = llm.agentModel;
      if (llm.reportModel) process.env.ANTHROPIC_REPORT_MODEL = llm.reportModel;
    }
  }

  logoAbsolutePath(): string | undefined {
    const name = this.settings.branding.logoFileName;
    if (!name) return undefined;
    return path.join(this.layout.branding, name);
  }

  private async persist(): Promise<void> {
    const temporary = `${this.layout.configFile}.tmp-${process.pid}`;
    await writeFile(temporary, `${JSON.stringify(this.settings, null, 2)}\n`, {
      mode: 0o600,
      encoding: 'utf8',
    });
    await rename(temporary, this.layout.configFile);
  }
}

function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return '';
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 3)}••••${trimmed.slice(-4)}`;
}

export async function testLlmConnection(settings: LlmSettings): Promise<{
  ok: boolean;
  message: string;
}> {
  if (!settings.apiKey.trim()) {
    return { ok: false, message: 'API key is empty.' };
  }
  if (settings.provider === 'openai-compatible') {
    if (!settings.baseUrl.trim()) return { ok: false, message: 'Base URL is required.' };
    if (!settings.agentModel.trim()) return { ok: false, message: 'Agent model is required.' };
    try {
      const base = settings.baseUrl.replace(/\/$/, '');
      const response = await fetch(`${base}/models`, {
        headers: { authorization: `Bearer ${settings.apiKey}` },
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) {
        return {
          ok: false,
          message: `Models endpoint returned HTTP ${response.status}.`,
        };
      }
      return { ok: true, message: 'Connection OK (models list reachable).' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message: `Connection failed: ${message.slice(0, 200)}` };
    }
  }
  // Anthropic: lightweight messages ping without leaking key
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: settings.agentModel || 'claude-3-5-haiku-latest',
        max_tokens: 16,
        messages: [{ role: 'user', content: 'ping' }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: `Auth failed (HTTP ${response.status}).` };
    }
    // 400 may still mean key accepted but request shape wrong — treat 2xx/4xx(non-auth) as reachable
    if (response.ok || response.status === 400) {
      return { ok: true, message: 'Anthropic API reachable with provided key.' };
    }
    return { ok: false, message: `Anthropic returned HTTP ${response.status}.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `Connection failed: ${message.slice(0, 200)}` };
  }
}
