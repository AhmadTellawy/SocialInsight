const fs=require('node:fs');
module.exports=async()=>{
  let receiptPath;
  try{receiptPath=(await (await fetch('http://127.0.0.1:4193/__test/shutdown',{method:'POST'})).json()).receiptPath;}catch{return;}
  for(let attempt=0;attempt<80;attempt++){
    const receipt=JSON.parse(fs.readFileSync(receiptPath,'utf8'));
    if(receipt.cleanup==='OWN_CLUSTER_STOPPED_DATA_RETAINED')return;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw new Error('Owned test database cleanup was not confirmed');
};
