/**
 * Window cutouts via the stencil buffer.
 *
 * The wall and the grid both have to disappear exactly where a window is. That used
 * to be done twice, both times expensively: the wall re-triangulated a 3-hole
 * ShapeGeometry (earcut over ~290 hole vertices) on every mask change, and the grid
 * ran a 312-iteration point-in-polygon loop over dynamically indexed uniform arrays
 * per fragment.
 *
 * Instead each window stamps its real contour into the stencil buffer once per frame
 * (three tiny draw calls, no color and no depth), and anything that must be cut away
 * simply fails the stencil test. That is pixel-exact — the same hard edge the geometry
 * holes gave — costs nothing per frame on the CPU, and follows any offset/scale the
 * timeline applies for free, because the stamp is just the window's own mesh.
 */
import * as THREE from 'three';

/** Value written inside a window; everything cut out tests for "not this". */
const STENCIL_REF = 1;

/**
 * Stamps a window shape into the stencil buffer.
 *
 * Writes neither color nor depth, and skips the depth test entirely so the stamp
 * lands regardless of what has already been drawn.
 */
export function makeWindowStencilWriter(): THREE.Material {
  const mat = new THREE.MeshBasicMaterial();
  mat.colorWrite = false;
  mat.depthWrite = false;
  mat.depthTest = false;
  mat.stencilWrite = true;
  mat.stencilRef = STENCIL_REF;
  mat.stencilFunc = THREE.AlwaysStencilFunc;
  mat.stencilFail = THREE.ReplaceStencilOp;
  mat.stencilZFail = THREE.ReplaceStencilOp;
  mat.stencilZPass = THREE.ReplaceStencilOp;
  return mat;
}

/** Render `mat` only OUTSIDE the windows. Tests the stencil without modifying it. */
export function cutOutWindows<T extends THREE.Material>(mat: T): T {
  mat.stencilWrite = true;
  mat.stencilRef = STENCIL_REF;
  mat.stencilFunc = THREE.NotEqualStencilFunc;
  mat.stencilFail = THREE.KeepStencilOp;
  mat.stencilZFail = THREE.KeepStencilOp;
  mat.stencilZPass = THREE.KeepStencilOp;
  return mat;
}

/** Draw order for the stamp — before the wall (1) and the grid (1.5). */
export const STENCIL_WRITER_ORDER = -10;
