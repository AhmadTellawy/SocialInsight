'use strict';
// Five disposable, verified-email accounts only in the isolated Render Stage DB.
// Their known password is test data, never a production account credential.
const assert=require('node:assert/strict');
module.exports=async function seedSynthetic(){
 assert.equal(process.env.STAGE_ONLY,'true');
 assert.equal(process.env.RENDER_SERVICE_NAME,'si-pages-qa-api-20260926');
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/si_pages_qa');
 const {PrismaClient}=require('../server/node_modules/@prisma/client');
 const bcrypt=require('../server/node_modules/bcryptjs');
 const db=new PrismaClient();
 try{
  const hash=await bcrypt.hash('StageOnly!20260926',10);
  const now=new Date();
  const roles=['owner','editor','analyst','visitor','other'];
  await db.user.createMany({data:roles.map(role=>({
   name:`Pages Stage ${role}`,handle:`pagesqa26_${role}`,
   email:`pagesqa26_${role}@example.test`,passwordHash:hash,
   emailVerifiedAt:now,status:'ACTIVE',authProvider:'Email'
  })),skipDuplicates:true});
 }finally{await db.$disconnect();}
};
