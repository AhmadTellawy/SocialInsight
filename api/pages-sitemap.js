export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Type','application/xml; charset=utf-8');
  if(!['GET','HEAD'].includes(req.method)){res.statusCode=405;return res.end();}
  const part=req.query?.part;
  if(part!==undefined&&(typeof part!=='string'||!/^\d{1,5}$/.test(part)||Number(part)<1||Number(part)>50000)){res.statusCode=400;return res.end();}
  try{
    const response=await fetch('https://socialinsight-api.onrender.com/api/pages-seo/sitemap'+(part?'?part='+part:''),{signal:AbortSignal.timeout(5000),redirect:'error'});
    res.statusCode=response.status;
    return res.end(req.method==='HEAD'?'':await response.text());
  }catch{res.statusCode=503;return res.end();}
}
