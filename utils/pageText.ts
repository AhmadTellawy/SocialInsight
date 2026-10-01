/// <reference lib="es2022.intl" />
const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
export const pageTextLength = (value:string):number => Array.from(segmenter.segment(value)).length;
