/** Static markup for the Dev UI, split out so index.ts is only behavior. */

export const HELP_HTML =
  '<b>Center window</b>: nearly invisible at rest (clear for the GLB), but reacts to the alarm. Normal glass on the side windows. <b>Trigger:</b> ✦ Activate star (live preview). ' +
  '<b>Star (GLB) → shatterProgress</b>: scrub the exact explosion frame from the timeline. <b>Load another GLB…</b>: pick any .glb from disk to try it in the same spot. ' +
  '<b>Parallax</b>: button or the timeline boolean; moves wall+glass+neon, star, and background at different depths with the mouse. ' +
  '<b>Masks</b>: <b>Center Window</b> = its own offset/scale; <b>Windows</b> = glass + one offset/scale for both sides. ' +
  '<b>Star background → swingRange</b>: limits how far the stars rotate (they used to spin without a cap). ' +
  '<b>Layer Outliner</b>: fade (0 = full, 1 = gone) or set <b>render</b> to 0 to skip drawing/updating that group. ' +
  '<b>Wall & Grid Fade → blackout</b>: sequence fade for wall+grid; stacks with the outliner. The grid already clips itself around whatever window positions you set. ' +
  '<b>Orbit</b> = free-look; <b>Capture</b> = camera keyframe; <b>Reset camera</b> if it drifted too far/near.';

export const BAR_HTML = /*html*/ `
<div id="bar" data-dev-bar="minified">
  <button id="devBarToggleBtn" type="button" title="Collapse / expand dev bar">▾ Dev UI</button>
  <div id="barControls">
    <div id="barTools">
      <button id="actBtn" class="act">✦ Activate star</button>
      <button id="theatreUiBtn">Theatre UI: ON</button>
      <button id="saveTheatreBtn" type="button" title="Download current Theatre project state as JSON">Save Theatre JSON</button>
      <button id="statsToggleBtn" type="button" title="Show / hide FPS stats">Stats: ON</button>
      <button id="resetBtn">Reset</button>
      <button id="navBtn">Orbit: OFF</button>
      <button id="grabBtn">Capture camera → keyframe</button>
      <button id="resetCamBtn">Reset camera</button>
      <button id="loadGlbBtn">Load another GLB…</button>
      <input type="file" id="glbFileInput" accept=".glb" style="display:none" />
      <button id="paraxBtn">Parallax: ON</button>
      <button id="vortexDrawBtn">✎ Draw</button>
      <button id="vortexAddBtn">+ Point</button>
      <button id="vortexRemoveBtn">− Point (selected)</button>
      <label class="barField"
        >Tension <input type="range" id="vortexTensionInput" min="0" max="1" step="0.05" value="0.5"
      /></label>
      <label class="barField"
        >Draw depth <input type="range" id="vortexDepthInput" min="20" max="200" value="110"
      /></label>
      <button id="vortexResetPathBtn">Reset path</button>
      <button id="helpToggleBtn">?</button>
    </div>

    <div id="timelinePanel">
      <div class="timelineTitle">Timeline</div>
      <label class="barField barFieldCol"
        >Scroll Source
        <select id="scrollSourceSelect">
          <option value="page">page</option>
          <option value="sections" selected>sections</option>
          <option value="external">external</option>
        </select>
      </label>
      <label class="barField barCheck"
        ><input type="checkbox" id="syncTheatreToScroll" checked /> Sync Theatre to Scroll
      </label>
      <label class="barField barFieldCol"
        >Seek T (manual)
        <span class="seekRow">
          <input type="range" id="seekTSlider" min="0" max="1" step="0.001" value="0" />
          <input type="number" id="seekTNumber" min="0" max="1" step="0.001" value="0" />
        </span>
      </label>
      <div id="scrollReadout"></div>
    </div>

    <div id="postFxPanel">
      <div class="timelineTitle">Post FX</div>
      <label class="barField barCheck"
        ><input type="checkbox" id="postFxComposer" checked /> EffectComposer
      </label>
      <label class="barField barCheck"
        ><input type="checkbox" id="postFxRenderPass" checked /> RenderPass
      </label>
      <label class="barField barCheck"
        ><input type="checkbox" id="postFxBloom" checked /> UnrealBloomPass
      </label>
      <label class="barField barCheck"
        ><input type="checkbox" id="postFxOutput" checked /> OutputPass
      </label>
    </div>
  </div>
</div>
`.trim();
