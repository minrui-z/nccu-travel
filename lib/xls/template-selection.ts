import type { Draft } from '../claim/types';
/** The original student seven-column work cell spans six dates. Private dates
 * use the matching blank variant with separate work cells in that row. */
export function templateIdFor(
  draft: Pick<Draft, 'template' | 'days'>,
  segments: number,
): string {
  return `${draft.template}-${segments}${draft.template === 'student' && segments === 7 && draft.days.some((day) => day.kind === 'personal') ? '-private' : ''}`;
}
