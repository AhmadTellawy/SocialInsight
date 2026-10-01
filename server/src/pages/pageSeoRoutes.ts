import { Router } from 'express';
import prisma from '../prisma';
import { pageDiscoveryWhere } from './pageService';
import { pagesEnabled } from './pageFeature';
import rateLimit from 'express-rate-limit';

const router=Router();
const origin='https://opiniup.com';
const apiOrigin='https://socialinsight-api.onrender.com';
const escapeXml=(value:string)=>value.replace(/[<>&"']/g,char=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[char]!));
const sitemapLimiter=rateLimit({windowMs:60_000,limit:30,standardHeaders:true,legacyHeaders:false});
let sitemapCountCache:{total:number;expiresAt:number}|null=null;
async function sitemapCount(){
  if(sitemapCountCache&&sitemapCountCache.expiresAt>Date.now())return sitemapCountCache.total;
  const total=await prisma.page.count({where:pageDiscoveryWhere()});
  sitemapCountCache={total,expiresAt:Date.now()+60_000};
  return total;
}
router.use((_req,res,next)=>{res.setHeader('Cache-Control','private, no-store');next();});
router.get('/sitemap',sitemapLimiter,async(req,res,next)=>{try{
  res.type('application/xml');
  const head='<?xml version="1.0" encoding="UTF-8"?>';
  if(!pagesEnabled())return res.send(head+'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
  const where=pageDiscoveryWhere();
  if(req.query.part===undefined){
    const total=await sitemapCount();
    const parts=Math.ceil(total/1000);
    if(parts>50000)return res.status(503).send(head+'<error>Sitemap partition capacity reached</error>');
    res.setHeader('Cache-Control','public, max-age=60, s-maxage=60');
    return res.send(head+'<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+Array.from({length:parts},(_,i)=>'<sitemap><loc>'+origin+'/pages-sitemap.xml?part='+(i+1)+'</loc></sitemap>').join('')+'</sitemapindex>');
  }
  if(typeof req.query.part!=='string'||!/^\d{1,5}$/.test(req.query.part)||Number(req.query.part)<1||Number(req.query.part)>50000)return res.status(400).end();
  if(Number(req.query.part)>Math.ceil((await sitemapCount())/1000))return res.status(404).end();
  const rows=await prisma.page.findMany({where,select:{handle:true,updatedAt:true},orderBy:{id:'asc'},skip:(Number(req.query.part)-1)*1000,take:1000});
  res.setHeader('Cache-Control','public, max-age=60, s-maxage=60');
  return res.send(head+'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+rows.map(row=>'<url><loc>'+escapeXml(origin+'/pages/'+row.handle)+'</loc><lastmod>'+row.updatedAt.toISOString()+'</lastmod></url>').join('')+'</urlset>');
}catch(error){next(error);}});
router.get('/:handle',async(req,res,next)=>{try{
  if(!pagesEnabled()||! /^[a-zA-Z][a-zA-Z0-9_]{2,29}$/.test(req.params.handle))return res.status(404).json({code:'PAGE_NOT_FOUND'});
  const alias=await prisma.pageHandle.findFirst({where:{handle:req.params.handle.toLowerCase(),page:pageDiscoveryWhere()},select:{page:{select:{name:true,bio:true,handle:true,avatarMediaId:true,coverMediaId:true}}}});
  if(!alias)return res.status(404).json({code:'PAGE_NOT_FOUND'});
  const page=alias.page;
  return res.json({title:page.name+' | Opiniup',description:page.bio,canonicalUrl:origin+'/pages/'+page.handle,
    imageUrl:page.coverMediaId||page.avatarMediaId?apiOrigin+'/api/media/'+(page.coverMediaId||page.avatarMediaId)+'/content':origin+'/logo.png'});
}catch(error){next(error);}});
export default router;
