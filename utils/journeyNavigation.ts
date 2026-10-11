import type { ResumePosition } from './appResume';
const positions = new Map<string, ResumePosition>();
let viewer = '';
export function navigationViewer(next: string) { if (viewer !== next) { positions.clear(); viewer = next; } }
export function readPosition(key: string) { return positions.get(key); }
export function capturePosition(key: string, path: string, container: HTMLElement, feedLimit = 10) {
  const bounds = container.getBoundingClientRect();
  const anchor = Array.from(container.querySelectorAll<HTMLElement>('[data-post-id]')).find(el => el.getBoundingClientRect().bottom > bounds.top);
  positions.delete(key); positions.set(key,{viewer,path,top:container.scrollTop,feedLimit,at:Date.now(),
    ...(anchor ? {anchor:{id:anchor.dataset.postId!,offset:anchor.getBoundingClientRect().top-bounds.top}} : {})});
  while (positions.size > 100) positions.delete(positions.keys().next().value!);
}
