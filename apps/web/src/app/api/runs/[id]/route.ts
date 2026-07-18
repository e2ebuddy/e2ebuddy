import { NextResponse } from 'next/server';

import { getRun } from '../../../../lib/server';

export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) { const {id}=await params; const run=await getRun(id); return run===undefined?NextResponse.json({error:'Run not found'},{status:404}):NextResponse.json(run); }
