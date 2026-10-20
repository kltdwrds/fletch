// M29.6: the system's motion in the app. A layout claim is measured at rest, so a browser test waits for every finite
// animation on the page to finish (an open sheet's slide, a dialog's pop) before it reads a box; loops (spinners,
// typing dots) never finish and are left running.
export const SETTLED = `Promise.all(document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().endTime !== Infinity).map((a) => a.finished.catch(() => {})))`;
