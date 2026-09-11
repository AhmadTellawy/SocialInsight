import type { Locator } from '@playwright/test';

/** Measure rendered text against the composited solid backgrounds, including transparent ancestors. */
export async function computedTextContrast(locator: Locator) {
  return locator.evaluate((element) => {
    type Color = [number, number, number, number];
    const parseColor = (value: string): Color => {
      const match = value.match(/^rgba?\(([^)]+)\)$/);
      if (!match) throw new Error(`Unsupported computed color: ${value}`);
      const channels = match[1].split(/[\s,/]+/).map(Number);
      return [channels[0], channels[1], channels[2], channels[3] ?? 1];
    };
    const over = (foreground: Color, background: Color): Color => {
      const alpha = foreground[3] + background[3] * (1 - foreground[3]);
      if (alpha === 0) return [0, 0, 0, 0];
      return [0, 1, 2].map(index => (
        foreground[index] * foreground[3] + background[index] * background[3] * (1 - foreground[3])
      ) / alpha).concat(alpha) as Color;
    };
    let background: Color = [0, 0, 0, 0];
    for (let current: Element | null = element; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (Number(style.opacity) !== 1) throw new Error('Contrast helper requires fully opaque element layers');
      if (background[3] < 1) {
        if (style.backgroundImage !== 'none') throw new Error('Contrast helper requires solid background layers');
        background = over(background, parseColor(style.backgroundColor));
      }
    }
    background = over(background, [255, 255, 255, 1]);
    const textColor = getComputedStyle(element).color;
    const foreground = over(parseColor(textColor), background);
    const luminance = (color: Color) => color.slice(0, 3).map(channel => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }).reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
    const foregroundLuminance = luminance(foreground);
    const backgroundLuminance = luminance(background);
    return {
      textColor,
      background: background.slice(0, 3),
      ratio: (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
        / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05),
    };
  });
}
