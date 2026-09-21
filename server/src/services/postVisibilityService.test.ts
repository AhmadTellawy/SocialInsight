import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVisiblePublishedPostWhere } from './postVisibilityService';

test('guest discovery allows only public audiences or public groups', () => {
  const where = buildVisiblePublishedPostWhere();
  assert.equal(where.isDeleted, false);
  assert.equal(where.status, 'PUBLISHED');
  const serialized = JSON.stringify(where);
  assert.match(serialized, /"isPublic":true/);
  assert.match(serialized, /"targetedGroups":\{"none":\{\}\}/);
  assert.doesNotMatch(JSON.stringify((where.AND as any[])[0].OR[1]), /"isPrivate"/);
});

test('authenticated discovery carries private-group membership and both block directions', () => {
  const serialized = JSON.stringify(buildVisiblePublishedPostWhere('viewer-1'));
  assert.match(serialized, /"members":\{"some":\{"userId":"viewer-1","status":"JOINED"\}\}/);
  assert.match(serialized, /"blockedBy":\{"some":\{"blockerId":"viewer-1"\}\}/);
  assert.match(serialized, /"blocking":\{"some":\{"blockedId":"viewer-1"\}\}/);
  assert.match(serialized, /"targetAudience":\{"equals":"Followers"/);
  assert.match(serialized, /"sharedFromId":null/);
  assert.match(serialized, /"sharedFrom":\{"is":/);
  assert.match(serialized, /"hiddenBy":\{"some":\{"userId":"viewer-1"\}\}/);
});

// Bounded Prisma predicate evaluator: unsupported operators fail rather than
// silently bypassing authorization in a test double. Database races are tested in Stage.
function permits(record: any, where: any): boolean {
  if (where === null || typeof where !== 'object') return record === where;
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'AND') return (Array.isArray(value) ? value : [value]).every(item => permits(record, item));
    if (key === 'OR') return value.some((item: any) => permits(record, item));
    if (key === 'NOT') return (Array.isArray(value) ? value : [value]).every(item => !permits(record, item));
    const actual = record?.[key];
    if (value === null || typeof value !== 'object') return actual === value;
    if ('some' in value) return Array.isArray(actual) && actual.some(item => permits(item, value.some));
    if ('none' in value) return Array.isArray(actual) && !actual.some(item => permits(item, value.none));
    if ('is' in value) return actual != null && permits(actual, value.is);
    if ('equals' in value) return value.mode === 'insensitive' ? typeof actual === 'string' && actual.toLowerCase() === value.equals.toLowerCase() : actual === value.equals;
    if ('in' in value) return value.in.includes(actual);
    if ('not' in value) return actual !== value.not;
    assert.ok(!['isNot', 'every', 'contains', 'startsWith', 'endsWith'].some(operator => operator in value), 'Unsupported predicate operator');
    return actual != null && permits(actual, value);
  });
}
const personal = (changes: any = {}) => ({ id:'p', pageId:null, authorId:'author', isDeleted:false, status:'PUBLISHED', targetAudience:'Public', groupId:null, group:null, targetedGroups:[], hiddenBy:[], sharedFromId:null, author:{isPrivate:false,mediaPrivacyTarget:false,following:[],blockedBy:[],blocking:[]}, ...changes });
const pageState = (changes: any = {}) => ({ownerId:'owner',owner:{status:'ACTIVE'},members:[],blocks:[],follows:[],publicationState:'PUBLISHED',platformState:'NONE',safetyHiddenAt:null,deletionRequestedAt:null,purgedAt:null,...changes});
const pagePost = (changes: any = {}) => personal({pageId:'page',page:pageState(),...changes});

test('general and Page-only predicates preserve audience, state, role and shared-source rules under caller OR', () => {
  const original = process.env.PAGES_ENABLED;
  process.env.PAGES_ENABLED='true';
  try {
    const cases: Array<[string, any, string | undefined, boolean]> = [
      ['guest public personal',personal(),undefined,true],
      ['guest private personal',personal({author:{...personal().author,isPrivate:true}}),undefined,false],
      ['following private personal',personal({author:{...personal().author,isPrivate:true,following:[{followerId:'viewer',status:'ACTIVE'}]}}),'viewer',true],
      ['outgoing personal block',personal({author:{...personal().author,blockedBy:[{blockerId:'viewer'}]}}),'viewer',false],
      ['incoming personal block',personal({author:{...personal().author,blocking:[{blockedId:'viewer'}]}}),'viewer',false],
      ['guest public group',personal({groupId:'group',group:{isPublic:true,isDeleted:false},author:{...personal().author,isPrivate:true}}),undefined,true],
      ['private group member',personal({groupId:'group',group:{isPublic:false,isDeleted:false,members:[{userId:'viewer',status:'JOINED'}]}}),'viewer',true],
      ['private group outsider',personal({groupId:'group',group:{isPublic:false,isDeleted:false,members:[]}}),'viewer',false],
      ['public Page guest',pagePost(),undefined,true],
      ['private actor does not privatize Page',pagePost({author:{...personal().author,isPrivate:true,blocking:[{blockedId:'viewer'}]}}),'viewer',true],
      ['followers outsider',pagePost({targetAudience:'Followers'}),'viewer',false],
      ['Page follower',pagePost({targetAudience:'Followers',page:pageState({follows:[{userId:'viewer'}]})}),'viewer',true],
      ['human follower not Page follower',pagePost({targetAudience:'Followers',author:{...personal().author,following:[{followerId:'viewer',status:'ACTIVE'}]}}),'viewer',false],
      ['active Page owner',pagePost({targetAudience:'Custom Audience'}),'owner',true],
      ['active Page editor',pagePost({targetAudience:'Custom Audience',page:pageState({members:[{userId:'viewer',role:'EDITOR',user:{status:'ACTIVE'}}]})}),'viewer',true],
      ['analyst does not bypass audience',pagePost({targetAudience:'Custom Audience',page:pageState({members:[{userId:'viewer',role:'ANALYST',user:{status:'ACTIVE'}}]})}),'viewer',false],
      ['inactive editor cannot bypass',pagePost({targetAudience:'Custom Audience',page:pageState({members:[{userId:'viewer',role:'EDITOR',user:{status:'SUSPENDED'}}]})}),'viewer',false],
      ['blocked Page follower',pagePost({page:pageState({blocks:[{userId:'viewer'}],follows:[{userId:'viewer'}]})}),'viewer',false],
      ['Page cannot appear in groups',pagePost({groupId:'group'}),'owner',false],
      ['Page cannot target groups',pagePost({targetedGroups:[{id:'group',isPublic:true,isDeleted:false}] }),'owner',false],
      ['hidden Page post',pagePost({hiddenBy:[{userId:'viewer'}]}),'viewer',false],
      ['deleted post',pagePost({isDeleted:true}),'owner',false],
      ['draft post',pagePost({status:'DRAFT'}),'owner',false],
      ['no active content team',pagePost({page:pageState({owner:{status:'SUSPENDED'}})}),'viewer',false],
      ['active editor keeps Page public',pagePost({page:pageState({owner:{status:'SUSPENDED'},members:[{userId:'editor',role:'EDITOR',user:{status:'ACTIVE'}}]})}),'viewer',true],
    ];
    for (const changes of [{publicationState:'DRAFT'},{platformState:'SUSPENDED'},{safetyHiddenAt:new Date()},{deletionRequestedAt:new Date()},{purgedAt:new Date()}]) cases.push(['Page restriction '+Object.keys(changes)[0],pagePost({page:pageState(changes)}),'owner',false]);
    for (const [name, source, viewer, allowed] of [...cases]) {
      cases.push(['Page wrapper of '+name,pagePost({sharedFromId:source.id,sharedFrom:source}),viewer,allowed]);
      cases.push(['personal wrapper of '+name,personal({sharedFromId:source.id,sharedFrom:source}),viewer,allowed]);
    }
    for (const [name, post, viewer, allowed] of cases) {
      const general=buildVisiblePublishedPostWhere(viewer);
      assert.equal(permits(post,general),allowed,name);
      assert.equal(permits(post,{...general,OR:[{id:post.id}]}),allowed,name+' with caller OR');
      const narrowed=buildVisiblePublishedPostWhere(viewer,'PAGE');
      assert.equal(permits(post,narrowed),allowed&&post.pageId!==null,name+' in Page-only feed');
    }
    process.env.PAGES_ENABLED='false';
    assert.equal(permits(pagePost(),buildVisiblePublishedPostWhere('viewer')),false);
    assert.equal(permits(pagePost(),buildVisiblePublishedPostWhere('viewer','PAGE')),false);
    assert.equal(permits(personal(),buildVisiblePublishedPostWhere('viewer')),true);
  } finally { if(original===undefined)delete process.env.PAGES_ENABLED;else process.env.PAGES_ENABLED=original; }
});
