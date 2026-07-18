import type { Locator } from 'playwright';

const irreversiblePattern = new RegExp(
  [
    '\\bpay(?:ment)?\\b',
    '\\bcharge\\b',
    '\\bplace\\s+order\\b',
    '\\bdelete(?:\\s+(?:account|data|project|workspace))?\\b',
    '\\bpublish\\b',
    '\\bdeploy\\b',
    '\\bsend(?:\\s+(?:message|email))?\\b',
    '\\binvite\\b',
    '\\bsubscribe\\b',
    '\\bchange\\s+password\\b',
    '确认支付',
    '立即支付',
    '付款',
    '删除(?:账号|账户|数据|项目|工作区)?',
    '注销账号',
    '发布',
    '上线',
    '发送(?:消息|邮件)?',
    '邀请',
    '订阅',
    '修改密码',
  ].join('|'),
  'i',
);

export interface ActionSafetyDecision {
  allowed: boolean;
  reason?: string;
}

interface ElementSafetySnapshot {
  text: string;
  href: string | null;
  formAction: string | null;
  target: string | null;
  download: boolean;
}

export async function inspectClickSafety(
  locator: Locator,
  targetOrigin: string,
): Promise<ActionSafetyDecision> {
  const snapshot = await locator.evaluate<ElementSafetySnapshot, HTMLElement>((element) => {
    const htmlElement = element;
    const anchor = htmlElement.closest('a');
    const form = htmlElement.closest('form');
    const labelledBy = htmlElement.getAttribute('aria-labelledby');
    const labelledText = labelledBy
      ?.split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    const text = [
      htmlElement.getAttribute('aria-label'),
      labelledText,
      htmlElement.textContent,
      htmlElement.getAttribute('value'),
      htmlElement.getAttribute('title'),
      form?.textContent,
      location.pathname,
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 5_000);

    return {
      text,
      href: anchor?.href ?? null,
      formAction: form?.action ?? null,
      target: anchor?.target ?? form?.target ?? null,
      download: anchor?.hasAttribute('download') ?? false,
    };
  });

  if (snapshot.download) return { allowed: false, reason: 'File downloads are blocked.' };
  if (irreversiblePattern.test(snapshot.text)) {
    return { allowed: false, reason: 'Potentially irreversible action was blocked.' };
  }

  for (const destination of [snapshot.href, snapshot.formAction]) {
    if (destination === null || destination.length === 0) continue;
    let url: URL;
    try {
      url = new URL(destination);
    } catch {
      return { allowed: false, reason: 'Invalid navigation target was blocked.' };
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { allowed: false, reason: `Unsafe navigation protocol was blocked: ${url.protocol}` };
    }
    if (url.origin !== targetOrigin) {
      return { allowed: false, reason: `Cross-origin navigation was blocked: ${url.origin}` };
    }
  }

  if (snapshot.target !== null && snapshot.target !== '' && snapshot.target !== '_self') {
    return { allowed: false, reason: 'Opening a new browsing context was blocked.' };
  }

  return { allowed: true };
}
