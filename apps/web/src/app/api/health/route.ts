import { NextResponse } from 'next/server';

export function GET() { return NextResponse.json({ ok:true, service:'e2ebuddy-web', timestamp:new Date().toISOString() }); }
