import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { createRun, enforceRateLimit, trustedRequestIp } from '../../../lib/server';

export async function POST(request: Request) {
  if (!(await enforceRateLimit(trustedRequestIp(request.headers)))) return NextResponse.json({error:'请求过于频繁，请稍后再试。'},{status:429});
  try { const run = await createRun(await request.json()); return NextResponse.json(run,{status:201}); }
  catch(error) { const message=error instanceof ZodError?'提交内容格式不正确。':error instanceof Error?error.message:'创建任务失败。'; return NextResponse.json({error:message.slice(0,2000)},{status:400}); }
}
