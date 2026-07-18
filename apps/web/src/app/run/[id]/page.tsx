'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const labels: Record<string,string> = { queued:'等待执行',exploring:'理解产品',planning:'生成测试计划',executing:'执行测试',judging:'判定问题',reporting:'生成报告' };

export default function RunPage() {
  const { id } = useParams<{ id: string }>(); const router = useRouter();
  const [status,setStatus] = useState('queued'); const [error,setError] = useState('');
  useEffect(() => {
    let active = true;
    async function poll() {
      const response = await fetch(`/api/runs/${id}`, { cache:'no-store' });
      const body = await response.json() as { status?:string; error?:string };
      if (!active) return;
      if (!response.ok) { setError(body.error ?? '无法读取任务'); return; }
      setStatus(body.status ?? 'queued'); setError(body.error ?? '');
      if (body.status === 'done') { router.replace(`/report/${id}`); return; }
      if (body.status !== 'failed') window.setTimeout(poll,3000);
    }
    void poll(); return () => { active=false; };
  },[id,router]);
  return <main className="shell"><nav className="nav"><a className="brand" href="/">e2ebuddy</a></nav><section className="panel"><p className="eyebrow">Run {id}</p>{error ? <><h1>执行失败</h1><p className="error">{error}</p></> : <><div className="status"><span className="pulse"/><h2>{labels[status] ?? status}</h2></div><p className="muted">浏览器 Agent 正在安全沙箱中工作。页面每 3 秒自动更新。</p></>}</section></main>;
}
