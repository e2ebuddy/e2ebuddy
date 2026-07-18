import { ImageResponse } from 'next/og';

import { getRun } from '../../../lib/server';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpenGraphImage({ params }: { params: Promise<{id:string}> }) {
  const { id } = await params;
  const run = await getRun(id).catch(() => undefined);
  const score = run?.report?.healthScore ?? '—';
  const verdict = run?.report?.verdict ?? 'Acceptance report';
  return new ImageResponse(
    <div style={{width:'100%',height:'100%',display:'flex',flexDirection:'column',justifyContent:'space-between',padding:72,background:'#07110d',color:'#eafff2',fontFamily:'sans-serif'}}>
      <div style={{display:'flex',color:'#54e58c',fontSize:34,fontWeight:800}}>e2ebuddy</div>
      <div style={{display:'flex',alignItems:'flex-end',gap:40}}><div style={{display:'flex',fontSize:190,lineHeight:1,fontWeight:900,color:'#54e58c'}}>{score}</div><div style={{display:'flex',fontSize:34,maxWidth:620,paddingBottom:24}}>{verdict}</div></div>
      <div style={{display:'flex',color:'#9ab7a5',fontSize:24}}>Products built by AI, tested by AI · {id}</div>
    </div>, size,
  );
}
