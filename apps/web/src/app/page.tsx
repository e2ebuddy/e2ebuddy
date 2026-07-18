'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

export default function HomePage() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true); setError('');
    const data = new FormData(event.currentTarget);
    const username = String(data.get('username') ?? '').trim();
    const password = String(data.get('password') ?? '');
    const response = await fetch('/api/runs', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        targetUrl: data.get('targetUrl'),
        userBrief: String(data.get('userBrief') ?? '').trim() || undefined,
        credentials: username && password ? { username, password } : undefined,
      }),
    });
    const body = await response.json() as { id?: string; error?: string };
    if (!response.ok || body.id === undefined) { setError(body.error ?? '提交失败'); setPending(false); return; }
    router.push(`/run/${body.id}`);
  }

  return <main className="shell">
    <nav className="nav"><span className="brand">e2ebuddy</span><span className="muted">Zero-config acceptance testing</span></nav>
    <section className="hero"><p className="eyebrow">Products built by AI, tested by AI</p><h1>AI 造的产品，AI 来验收。</h1><p className="muted">粘贴部署地址。Agent 会理解产品、执行功能/内容/视觉检查，并给出可直接交给编程工具的修复 Prompt。</p></section>
    <form className="panel form" onSubmit={submit}>
      <label>部署 URL<input required name="targetUrl" type="url" placeholder="https://your-app.example" /></label>
      <label>当初你是怎么描述这个产品的？（可选）<textarea name="userBrief" placeholder="粘贴原始需求或生成 Prompt，可发现缺失功能" /></label>
      <details><summary>测试账号（可选，加密保存）</summary><div className="grid"><label>用户名<input name="username" autoComplete="username" /></label><label>密码<input name="password" type="password" autoComplete="current-password" /></label></div></details>
      {error && <p className="error">{error}</p>}<button disabled={pending}>{pending ? '正在提交…' : '开始验收'}</button>
    </form>
  </main>;
}
