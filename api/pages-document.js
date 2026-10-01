import fs from 'node:fs/promises';
import path from 'node:path';

export const escapeHtml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function pageDocument(template,metadata){
  const head=metadata?'<title>'+escapeHtml(metadata.title)+'</title><meta name="description" content="'+escapeHtml(metadata.description)+'"><link rel="canonical" href="'+escapeHtml(metadata.canonicalUrl)+'"><meta property="og:type" content="website"><meta property="og:title" content="'+escapeHtml(metadata.title)+'"><meta property="og:description" content="'+escapeHtml(metadata.description)+'"><meta property="og:url" content="'+escapeHtml(metadata.canonicalUrl)+'"><meta property="og:image" content="'+escapeHtml(metadata.imageUrl)+'">':'<title>Opiniup</title><meta name="robots" content="noindex,nofollow">';
  const content=metadata?'<main><h1>'+escapeHtml(metadata.title.replace(/ \| Opiniup$/,''))+'</h1><p>'+escapeHtml(metadata.description)+'</p></main>':'';
  return template.replace(/<title>[^<]*<\/title>/i,'').replace('</head>',head+'</head>').replace('<div id="root"></div>','<div id="root">'+content+'</div>');
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Type','text/html; charset=utf-8');
  if(!['GET','HEAD'].includes(req.method)){res.statusCode=405;return res.end();}
  const handle=typeof req.query?.handle==='string'?req.query.handle:'';
  const reserved=new Set(['create','mine','manage','staff','cases','blocks','invitations','transfers']);
  let metadata=null,status=200;
  if(/^[a-zA-Z][a-zA-Z0-9_]{2,29}$/.test(handle)&&!reserved.has(handle)){
    try{
      const upstream=await fetch('https://socialinsight-api.onrender.com/api/pages-seo/'+encodeURIComponent(handle),{signal:AbortSignal.timeout(5000),redirect:'error',headers:{Accept:'application/json'}});
      if(upstream.ok){
        const value=await upstream.json();
        const canonical=new URL(value.canonicalUrl),image=new URL(value.imageUrl);
        if(canonical.origin!=='https://opiniup.com'||!/^\/pages\/[a-z][a-z0-9_]{2,29}$/.test(canonical.pathname)||canonical.search||canonical.hash||!['https://opiniup.com','https://socialinsight-api.onrender.com'].includes(image.origin))throw new Error('Invalid Page metadata');
        metadata=value;
        if(canonical.pathname!=='/pages/'+handle){res.statusCode=302;res.setHeader('Location',canonical.href);return res.end();}
      }else status=upstream.status===404?404:503;
    }catch{status=503;}
  }
  if(!metadata)res.setHeader('X-Robots-Tag','noindex, nofollow');
  try{const template=await fs.readFile(path.join(process.cwd(),'dist/index.html'),'utf8');res.statusCode=status;return res.end(req.method==='HEAD'?'':pageDocument(template,metadata));}
  catch{res.statusCode=503;return res.end('<!doctype html><meta name="robots" content="noindex"><title>Opiniup</title><p>Page temporarily unavailable.</p>');}
}
