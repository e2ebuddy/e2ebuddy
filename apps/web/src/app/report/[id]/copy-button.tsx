'use client';

import { useState } from 'react';

export function CopyButton({ value, label = '复制修复 Prompt' }: { value:string; label?:string }) {
  const [copied,setCopied] = useState(false);
  return <button onClick={async()=>{await navigator.clipboard.writeText(value);setCopied(true);window.setTimeout(()=>setCopied(false),1600)}}>{copied?'已复制 ✓':label}</button>;
}
