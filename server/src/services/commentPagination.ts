export function replyCursor(comment: {id:string;createdAt:Date}) {
  return Buffer.from(JSON.stringify([comment.createdAt.toISOString(),comment.id])).toString('base64url');
}
export function replyCursorWhere(cursor?:string, direction: 'asc'|'desc'='asc') {
  if(!cursor)return {};
  try{
    if(cursor.length>256)throw Error();
    const value=JSON.parse(Buffer.from(cursor,'base64url').toString());
    if(!Array.isArray(value)||value.length!==2||typeof value[0]!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(value[0])||typeof value[1]!=='string'||!value[1]||value[1].length>100)throw Error();
    const createdAt=new Date(value[0]);if(!Number.isFinite(createdAt.getTime()))throw Error();
    const op=direction==='asc'?'gt':'lt';
    return {OR:[{createdAt:{[op]:createdAt}},{createdAt,id:{[op]:value[1]}}]};
  }catch{throw new Error('INVALID_REPLY_CURSOR');}
}
