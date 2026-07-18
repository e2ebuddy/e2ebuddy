import { readFile } from 'node:fs/promises';

import type { Browser, BrowserContext, Download, Page, Route } from 'playwright';
import { chromium } from 'playwright';

import {
  ActionResultSchema,
  AgentActionSchema,
  PagePerceptionSchema,
  type ActionResult,
  type AgentAction,
  type Interactable,
  type PagePerception,
} from 'shared';

import { inspectClickSafety } from './action-safety.js';
import { hasSameOrigin, PublicUrlGuard, type UrlGuard } from './url-safety.js';

const interactiveSelector = [
  'a[href]',
  'button',
  'input',
  'textarea',
  'select',
  '[role]',
  '[contenteditable="true"]',
  '[tabindex]',
].join(',');

const viewportPresets = {
  desktop: { width: 1_440, height: 900 },
  mobile: { width: 375, height: 812 },
} as const;

export interface PageExecutorOptions {
  targetUrl: string;
  browser?: Browser;
  urlGuard?: UrlGuard;
  viewport?: keyof typeof viewportPresets;
  caseStepLimit?: number;
  runTimeoutMs?: number;
  stabilityTimeoutMs?: number;
  recordVideoDir?: string;
}

export interface TrustedLoginResult {
  success: boolean;
  note: string;
}

export class PageExecutor {
  readonly page: Page;
  readonly targetOrigin: string;

  private readonly context: BrowserContext;
  private readonly browser: Browser;
  private readonly ownsBrowser: boolean;
  private readonly urlGuard: UrlGuard;
  private readonly caseStepLimit: number;
  private readonly runTimeoutMs: number;
  private readonly stabilityTimeoutMs: number;
  private readonly startedAt = Date.now();
  private stepCount = 0;
  private lastPerception?: PagePerception;
  private transientBlockReason?: string;

  private constructor(
    page: Page,
    context: BrowserContext,
    browser: Browser,
    ownsBrowser: boolean,
    targetOrigin: string,
    urlGuard: UrlGuard,
    options: PageExecutorOptions,
  ) {
    this.page = page;
    this.context = context;
    this.browser = browser;
    this.ownsBrowser = ownsBrowser;
    this.targetOrigin = targetOrigin;
    this.urlGuard = urlGuard;
    this.caseStepLimit = options.caseStepLimit ?? 25;
    this.runTimeoutMs = options.runTimeoutMs ?? 600_000;
    this.stabilityTimeoutMs = options.stabilityTimeoutMs ?? 8_000;
  }

  static async launch(options: PageExecutorOptions): Promise<PageExecutor> {
    const urlGuard = options.urlGuard ?? new PublicUrlGuard();
    const target = await urlGuard.assertAllowed(options.targetUrl);
    const ownsBrowser = options.browser === undefined;
    const browser = options.browser ?? (await chromium.launch({ headless: true }));
    const context = await browser.newContext({
      acceptDownloads: false,
      viewport: viewportPresets[options.viewport ?? 'desktop'],
      recordVideo:
        options.recordVideoDir === undefined
          ? undefined
          : {
              dir: options.recordVideoDir,
              size: viewportPresets[options.viewport ?? 'desktop'],
            },
    });

    let executor: PageExecutor | undefined;
    try {
      const page = await context.newPage();
      executor = new PageExecutor(
        page,
        context,
        browser,
        ownsBrowser,
        target.origin,
        urlGuard,
        options,
      );
      await executor.installNetworkPolicy();
      executor.installPageGuards();
      await page.goto(target.href, { waitUntil: 'domcontentloaded' });
      await executor.waitForStablePage();
      await executor.perceive();
      return executor;
    } catch (error) {
      await context.close().catch(() => undefined);
      if (ownsBrowser) await browser.close().catch(() => undefined);
      throw error;
    }
  }

  async perceive(): Promise<PagePerception> {
    const interactables = await this.collectInteractables();
    const screenshot = await this.page.screenshot({ type: 'jpeg', quality: 60, fullPage: false });
    const body = this.page.locator('body');
    const snapshot =
      (await body
        .ariaSnapshot({ timeout: this.stabilityTimeoutMs })
        .catch(() => ''));
    const layout = await this.page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      hashTarget: window.location.hash,
      hashTargetTop: window.location.hash
        ? document.querySelector(window.location.hash)?.getBoundingClientRect().top ?? null
        : null,
    }));
    const horizontalOverflow = Math.max(0, layout.documentWidth - layout.viewportWidth);
    const maxScrollY = Math.max(0, layout.documentHeight - layout.viewportHeight);
    const a11yTree = `${snapshot}\n[layout] viewport=${layout.viewportWidth}x${layout.viewportHeight} document=${layout.documentWidth}x${layout.documentHeight} horizontalOverflow=${horizontalOverflow}px scroll=${layout.scrollX},${layout.scrollY} maxScrollY=${maxScrollY}px hashTarget=${JSON.stringify(layout.hashTarget)} hashTargetTop=${layout.hashTargetTop === null ? 'none' : `${Math.round(layout.hashTargetTop)}px`}`.slice(0, 8_000);

    const perception = PagePerceptionSchema.parse({
      url: this.page.url(),
      title: await this.page.title(),
      screenshotBase64: screenshot.toString('base64'),
      a11yTree,
      interactables,
    });
    this.lastPerception = perception;
    return perception;
  }

  async execute(input: AgentAction): Promise<ActionResult> {
    const action = AgentActionSchema.parse(input);
    const previous = this.lastPerception ?? (await this.perceive());

    if (action.type === 'done') {
      return ActionResultSchema.parse({ action, outcome: 'ok', perception: previous });
    }
    if (this.stepCount >= this.caseStepLimit) {
      return this.blockedResult(action, previous, 'Case step limit reached.');
    }
    if (Date.now() - this.startedAt >= this.runTimeoutMs) {
      return this.blockedResult(action, previous, 'Run time limit reached.');
    }

    this.stepCount += 1;
    this.transientBlockReason = undefined;

    try {
      const blockedReason = await this.performAction(action);
      if (blockedReason !== undefined) {
        const perception = await this.safePerceive(previous);
        return this.blockedResult(action, perception, blockedReason);
      }

      await this.waitForStablePage();
      const perception = await this.safePerceive(previous);
      if (this.transientBlockReason !== undefined) {
        return this.blockedResult(action, perception, this.transientBlockReason);
      }

      const outcome = this.hasNoVisibleChange(action, previous, perception)
        ? 'no-visible-change'
        : 'ok';
      return ActionResultSchema.parse({ action, outcome, perception });
    } catch (error) {
      const perception = await this.safePerceive(previous);
      const note = this.transientBlockReason ?? this.errorMessage(error);
      return ActionResultSchema.parse({
        action,
        outcome: this.transientBlockReason === undefined ? 'error' : 'blocked',
        perception,
        note,
      });
    }
  }

  async close(): Promise<void> {
    await this.context.close();
    if (this.ownsBrowser) await this.browser.close();
  }

  async closeAndReadVideo(): Promise<Uint8Array | undefined> {
    const video = this.page.video();
    await this.close();
    if (video === null) return undefined;
    return readFile(await video.path());
  }

  async trustedLogin(credentials: { username: string; password: string }): Promise<TrustedLoginResult> {
    const captchaPattern = /captcha|recaptcha|hcaptcha|验证码|人机验证/i;
    if (captchaPattern.test(await this.page.locator('body').innerText().catch(() => ''))) {
      return { success: false, note: 'Login was blocked because CAPTCHA was detected.' };
    }

    let password = this.page.locator('input[type="password"]:visible').first();
    if ((await password.count()) === 0) {
      const loginEntry = this.page
        .getByRole('link', { name: /log[ -]?in|sign[ -]?in|登录|登入/i })
        .or(this.page.getByRole('button', { name: /log[ -]?in|sign[ -]?in|登录|登入/i }))
        .first();
      if ((await loginEntry.count()) === 0) {
        return { success: false, note: 'No login form or login entry was found.' };
      }
      await loginEntry.click();
      await this.waitForStablePage();
      if (!hasSameOrigin(new URL(this.page.url()), this.targetOrigin)) {
        return { success: false, note: 'Login attempted to navigate off-origin.' };
      }
      password = this.page.locator('input[type="password"]:visible').first();
    }

    const username = this.page
      .locator(
        'input[autocomplete="username"]:visible, input[type="email"]:visible, input[name*="user" i]:visible, input[name*="email" i]:visible',
      )
      .first();
    if ((await username.count()) === 0 || (await password.count()) === 0) {
      return { success: false, note: 'A complete username/password login form was not found.' };
    }

    await username.fill(credentials.username);
    await password.fill(credentials.password);
    const submit = this.page
      .locator('button[type="submit"]:visible, input[type="submit"]:visible')
      .or(this.page.getByRole('button', { name: /log[ -]?in|sign[ -]?in|登录|登入/i }))
      .first();
    if ((await submit.count()) === 0) {
      await username.fill('');
      await password.fill('');
      return { success: false, note: 'The login form has no recognizable submit control.' };
    }
    await submit.click();
    await this.waitForStablePage();

    const passwordStillVisible = await this.page.locator('input[type="password"]:visible').count();
    const pageText = await this.page.locator('body').innerText().catch(() => '');
    if (passwordStillVisible > 0 || captchaPattern.test(pageText)) {
      await this.page.locator('input[type="password"]:visible').fill('').catch(() => undefined);
      await username.fill('').catch(() => undefined);
      return {
        success: false,
        note: captchaPattern.test(pageText)
          ? 'Login was blocked because CAPTCHA was detected.'
          : 'Login did not leave the password form; credentials may be invalid or MFA may be required.',
      };
    }
    await this.perceive();
    return { success: true, note: 'Login completed.' };
  }

  private async performAction(action: Exclude<AgentAction, { type: 'done' }>): Promise<string | undefined> {
    switch (action.type) {
      case 'navigate': {
        const url = await this.urlGuard.assertAllowed(action.url);
        if (!hasSameOrigin(url, this.targetOrigin)) {
          return `Cross-origin navigation was blocked: ${url.origin}`;
        }
        await this.page.goto(url.href, { waitUntil: 'domcontentloaded' });
        return undefined;
      }
      case 'click': {
        const locator = await this.locatorForRef(action.ref);
        const decision = await inspectClickSafety(locator, this.targetOrigin);
        if (!decision.allowed) return decision.reason ?? 'Unsafe click was blocked.';
        await locator.click();
        return undefined;
      }
      case 'type': {
        const locator = await this.locatorForRef(action.ref);
        await locator.fill(action.text);
        if (action.pressEnter === true) await locator.press('Enter');
        return undefined;
      }
      case 'scroll':
        await this.page.evaluate((direction) => {
          const amount = Math.max(1, Math.floor(window.innerHeight * 0.8));
          window.scrollBy({ top: direction === 'down' ? amount : -amount, behavior: 'instant' });
        }, action.direction);
        return undefined;
      case 'select':
        await (await this.locatorForRef(action.ref)).selectOption(action.value);
        return undefined;
      case 'wait':
        await this.page.waitForTimeout(action.ms);
        return undefined;
      case 'setViewport':
        await this.page.setViewportSize(viewportPresets[action.preset]);
        return undefined;
    }
  }

  private async locatorForRef(ref: string) {
    if (!/^e\d+$/.test(ref)) throw new Error(`Invalid or stale element ref: ${ref}`);
    const locator = this.page.locator(`[data-e2ebuddy-ref="${ref}"]`);
    if ((await locator.count()) !== 1) throw new Error(`Invalid or stale element ref: ${ref}`);
    return locator;
  }

  private async collectInteractables(): Promise<Interactable[]> {
    return this.page.locator(interactiveSelector).evaluateAll((elements) => {
      document
        .querySelectorAll('[data-e2ebuddy-ref]')
        .forEach((element) => element.removeAttribute('data-e2ebuddy-ref'));

      const supportedRoles = new Set([
        'button',
        'link',
        'textbox',
        'searchbox',
        'checkbox',
        'radio',
        'combobox',
        'listbox',
        'menuitem',
        'option',
        'switch',
        'tab',
        'slider',
        'spinbutton',
      ]);

      const inferRole = (element: HTMLElement): string | undefined => {
        const explicit = element.getAttribute('role')?.toLowerCase();
        if (explicit !== undefined && supportedRoles.has(explicit)) return explicit;
        const tag = element.tagName.toLowerCase();
        if (tag === 'a') return 'link';
        if (tag === 'button') return 'button';
        if (tag === 'textarea' || element.isContentEditable) return 'textbox';
        if (tag === 'select') return (element as HTMLSelectElement).multiple ? 'listbox' : 'combobox';
        if (tag === 'input') {
          const type = (element as HTMLInputElement).type.toLowerCase();
          if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
          if (type === 'checkbox') return 'checkbox';
          if (type === 'radio') return 'radio';
          if (type === 'range') return 'slider';
          if (type === 'number') return 'spinbutton';
          if (type === 'search') return 'searchbox';
          if (type !== 'hidden') return 'textbox';
        }
        if (element.tabIndex >= 0) return explicit ?? 'button';
        return undefined;
      };

      const accessibleName = (element: HTMLElement): string => {
        const labelledBy = element.getAttribute('aria-labelledby');
        const labelledText = labelledBy
          ?.split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ');
        const labels =
          'labels' in element
            ? Array.from((element as HTMLInputElement).labels ?? [])
                .map((label) => {
                  const clone = label.cloneNode(true) as HTMLLabelElement;
                  clone
                    .querySelectorAll('input, select, textarea, button')
                    .forEach((control) => control.remove());
                  return clone.textContent ?? '';
                })
                .join(' ')
            : '';
        const inputValue =
          element instanceof HTMLInputElement &&
          ['button', 'submit', 'reset'].includes(element.type.toLowerCase())
            ? element.value
            : '';
        return [
          labels,
          element.getAttribute('aria-label'),
          labelledText,
          element.innerText,
          inputValue,
          element.getAttribute('placeholder'),
          element.getAttribute('title'),
        ]
          .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
          ?.replace(/\s+/g, ' ')
          .trim()
          .slice(0, 2_000) ?? '';
      };

      const output: Array<{
        ref: string;
        role: string;
        name: string;
        options?: Array<{ label: string; value: string }>;
      }> = [];
      for (const candidate of elements) {
        const element = candidate as HTMLElement;
        const style = getComputedStyle(element);
        const rectangle = element.getBoundingClientRect();
        const visible =
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0 &&
          rectangle.width > 0 &&
          rectangle.height > 0;
        const disabled = element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true';
        const role = inferRole(element);
        if (!visible || disabled || role === undefined) continue;

        const ref = `e${output.length + 1}`;
        element.setAttribute('data-e2ebuddy-ref', ref);
        const item: {
          ref: string;
          role: string;
          name: string;
          options?: Array<{ label: string; value: string }>;
        } = { ref, role, name: accessibleName(element) };
        if (element instanceof HTMLSelectElement) {
          item.options = Array.from(element.options).map((option) => ({
            label: option.label,
            value: option.value,
          }));
        }
        output.push(item);
      }
      return output;
    });
  }

  private async installNetworkPolicy(): Promise<void> {
    await this.context.route('**/*', async (route) => {
      await this.handleRoute(route);
    });
  }

  private async handleRoute(route: Route): Promise<void> {
    const request = route.request();
    try {
      const url = await this.urlGuard.assertAllowed(request.url());
      if (request.isNavigationRequest() && this.isTopFrameNavigation(request.frame().parentFrame())) {
        if (!hasSameOrigin(url, this.targetOrigin)) {
          this.transientBlockReason = `Cross-origin navigation was blocked: ${url.origin}`;
          await route.abort('blockedbyclient');
          return;
        }
      }
      await route.continue();
    } catch (error) {
      this.transientBlockReason = this.errorMessage(error);
      await route.abort('blockedbyclient').catch(() => undefined);
    }
  }

  private isTopFrameNavigation(parentFrame: unknown): boolean {
    return parentFrame === null;
  }

  private installPageGuards(): void {
    this.page.on('popup', (popup) => {
      this.transientBlockReason = 'Opening a new tab or popup was blocked.';
      void popup.close();
    });
    this.page.on('download', (download: Download) => {
      this.transientBlockReason = 'File download was blocked.';
      void download.cancel();
    });
  }

  private async waitForStablePage(): Promise<void> {
    await this.page
      .waitForLoadState('domcontentloaded', { timeout: this.stabilityTimeoutMs })
      .catch(() => undefined);
    await this.page
      .waitForLoadState('networkidle', { timeout: this.stabilityTimeoutMs })
      .catch(() => undefined);
  }

  private async safePerceive(fallback: PagePerception): Promise<PagePerception> {
    return this.perceive().catch(() => fallback);
  }

  private blockedResult(
    action: AgentAction,
    perception: PagePerception,
    note: string,
  ): ActionResult {
    return ActionResultSchema.parse({ action, outcome: 'blocked', perception, note });
  }

  private hasNoVisibleChange(
    action: AgentAction,
    before: PagePerception,
    after: PagePerception,
  ): boolean {
    if (!['click', 'type', 'select'].includes(action.type)) return false;
    const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
    return (
      before.url === after.url &&
      before.title === after.title &&
      normalize(before.a11yTree) === normalize(after.a11yTree)
    );
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message.slice(0, 5_000) : String(error).slice(0, 5_000);
  }
}
