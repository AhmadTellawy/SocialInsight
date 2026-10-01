import { PagePolicyError } from './pagePolicy';
import { Prisma } from '@prisma/client';

export const isPageTestUser = (userId?:string|null):boolean => !!userId &&
  (process.env.PAGES_TEST_USERS || '').split(',').some(value=>value.trim()===userId);

/** One runtime gate for Page routes, shared post surfaces, media and workers. */
export const pagesEnabled = (viewerId?:string|null):boolean =>
  process.env.PAGES_ENABLED === 'true' || isPageTestUser(viewerId);

export function assertPagesEnabled(viewerId?:string|null):void {
  if(!pagesEnabled(viewerId))throw new PagePolicyError('PAGES_UNAVAILABLE',404);
}

/** Discovery excludes test fixtures even for allowlisted accounts; explicit links remain testable. */
export const pageDiscoveryPostWhere=():Prisma.PostWhereInput=>({AND:[
  {OR:[{pageId:null},{page:{is:{isTestFixture:false}}}]},
  {OR:[{sharedFromId:null},{sharedFrom:{is:{OR:[{pageId:null},{page:{is:{isTestFixture:false}}}]}}}]},
]});
