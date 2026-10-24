import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePagePhone, normalizePageUrl, preparePageInfo } from './pageInfo.ts';
const info={name:' صفحة ',category:'creator',bio:'',description:'',country:'',city:'',website:null,publicEmail:null,publicPhone:null,links:[],cta:null} as const;
test('optional setup normalizes Arabic/Persian phone digits and bare web addresses',()=>{
  assert.equal(normalizePagePhone(' +٩٦٢ ۷۹ ١٢٣٤٥٦٧ '),'+962 79 1234567');
  assert.equal(normalizePageUrl(' example.com/path '),'https://example.com/path');
  for(const value of ['javascript:alert(1)','https://user:password@example.com','//example.com'])assert.equal(normalizePageUrl(value),value);
});
test('empty links do not block save; partial entries remain for validation and CTA clears with target',()=>{
  const result=preparePageInfo({...info,links:[{title:' ',url:''},{title:'Support',url:' example.com/help '},{title:'Partial',url:''}],cta:'EMAIL',publicEmail:' '});
  assert.deepEqual(result.links,[{title:'Support',url:'https://example.com/help'},{title:'Partial',url:''}]);
  assert.equal(result.cta,null);assert.equal(result.publicEmail,null);assert.equal(result.name,'صفحة');
});
