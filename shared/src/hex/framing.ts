/**
 * Camera framing for a SCENE — a backdrop the table looks at, rather than
 * ground it crosses.
 *
 * The art fills the pane vertically, edge to edge, and fits horizontally too
 * whenever its shape allows. A wide panorama therefore keeps its full height
 * and runs off the sides instead of sitting in a letterbox; a tall, narrow
 * picture ends up fully visible, because filling the height already leaves
 * its width inside the pane.
 *
 * Returns 1 for any degenerate input (a pane not laid out yet, an image whose
 * size isn't known): the camera multiplies by this, so a zero would be
 * unrecoverable.
 */
export function sceneFrameScale(
  viewportW: number, viewportH: number, imageW: number, imageH: number,
): number {
  if (!(viewportW > 0) || !(viewportH > 0) || !(imageW > 0) || !(imageH > 0)) return 1;
  const contain = Math.min(viewportW / imageW, viewportH / imageH);
  const fillHeight = viewportH / imageH;
  const scale = Math.max(contain, fillHeight);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}
