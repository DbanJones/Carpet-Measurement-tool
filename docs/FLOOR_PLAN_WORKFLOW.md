# Floor-plan measurement workspace

The uploaded-plan flow is **Upload → Set scale → Add rooms → Review**. Blank house sheets keep
their known grid and manual drawing tools; image analysis is unnecessary for those sheets.

## Set the scale

Calibration has a dedicated purple task state. Other drawing tools are hidden until the scale is
confirmed. Readable room dimensions are matched to structural wall spans to suggest a scale. Both
printed sides must agree with the room, and supported measurements from other rooms are checked
for conflicts. The reference room and A–B length appear for review; **Confirm scale & find rooms**
saves the calibration and starts room detection. Nothing is measured or added before confirmation.

**Set scale manually** remains available throughout. Mark A and B on a wall, enter its printed or
measured length, then choose **Set scale & continue**. Starting manual points cancels automatic
suggestions. Unclear text, missing decimal points, conflicting dimensions or unmatched wall geometry
fall back to this manual route. Existing calibrations are retained until a replacement is confirmed.
The unsaved overlay shows the suggested or entered length; the confirmed reference remains visible
while drawing or detecting rooms. A physical ruler tracks the canvas zoom. Recalibrating affects
new outlines; existing saved rooms retain their measured scale.

Wall matching samples beside windows and tolerates small inward doorway recesses, while requiring
independent wall evidence on all four sides. This supports multi-floor estate-agent sheets without
guessing missing OCR decimal points or treating an entire irregular open-plan area as a rectangle.

**Precision zoom** shows a floating close-up during placement and corner dragging. It is available
for scale, measurement, doorways and drawing, and can be switched off. Scale and doorway markers
can also be dragged after placement; pan and pinch gestures never place an extra point.

## Automatic reading

Uploaded images and PDFs without useful embedded labels automatically run local OCR. Useful PDF
text is reused. Reading supplies scale suggestions, but only explicit confirmation sets calibration.
The compact status shows progress; detailed text, retry and cancellation are in **Read plan text**.
Failed or cancelled attempts do not repeatedly restart on navigation. Confirmed readings persist.

Room suggestions and untouched room-name drafts adopt labels inside their outlines. Names typed
by the user and saved rooms are preserved. Explicitly unit-labelled dimension pairs near the room
label are compared with the measured outline: 5% or 100 mm tolerance. Rotated, irregular or unclear
readings are identified as approximate. Missing decimals and implausible lengths are shown for
checking instead of being guessed. **Review or correct recognised text** edits individual lines
at their original positions; these corrections update spatial checks and persist with the project.

## Detect all rooms

After setting scale, **Detect all rooms** scans the image once for enclosed room candidates. It
bridges plausible door gaps, filters exterior regions, page frames and small furniture/text regions,
and excludes existing room/stair outlines. Processing runs in a cancellable worker with a bounded
review batch. Incomplete or open-plan drawings may still need **Detect room**, **Rectangle** or
**Draw outline**.

Nothing is added to the estimate until acceptance. Numbered overlays match a checkbox list. Select
an outline to review its suggested name, area and printed dimensions. **Edit detected outline**
opens the existing corner editor; saving returns the edited suggestion to the batch. The selected
floor covering applies to the batch and survives cancelled edits. Remove or deselect unwanted
outlines, then **Add selected rooms**.

Spaces under **1 m²** start unchecked and remain available for explicit inclusion. **Detect all rooms**
also looks for repeated stair tread lines and connected turning sections. S-marked footprints are
review-only: check the total riser count, width and tread depth, then include the flights you want.
Riser height cannot be read from the plan; the editable starting assumption is 200 mm. Counts are
limited to the same 30 risers supported by the staircase guide. Faint or hidden winders can leave a
partial footprint. Added stairs carry a note to check the complete flight, rotation and landings.
Room/stair overlaps are checked in the batch and when drawing or editing saved outlines.

Doorway recognition checks the original fine ink around an opening for a curved swing and radial
door leaf. A leaf without a curve needs additional endpoint and clearance checks. Recognised
symbols appear as straight amber thresholds and D1/D2 markers; the room review lists their calibrated widths.
These suggestions are included by default. Untick an incorrect doorway before adding the rooms.
Ordinary gap closures remain unconfirmed openings and do not create doorways by themselves.

The flooring outline fills any excluded door-swing sector and reaches a straight line across the
doorway. Neighbouring rooms meet at the centre of the wall opening, so the area beneath the door
is included once. Unrelated recesses remain intact. If a wall junction or another room prevents
safe inclusion, the original outline is retained and the doorway shows a check message. Moving
outline corners rechecks the coverage shown in the review.

Accepted doorways are saved on the room walls and stay editable in the floor-plan and room editors.
Two room sides of the same physical opening share an identity so the estimate buys one door bar.
This also works when the neighbouring room is accepted in a later batch. Editing an outline retains
door suggestions on unchanged walls and removes suggestions that no longer fit the original wall.
Unclear, unusual or missing door symbols can still be marked manually after adding a room.
Manual doorway marking can straighten a small door-swing recess between the two jambs. Its preview
shows the resulting floor boundary before confirmation; existing doors are remapped to that boundary,
and a change that removes floor area or overlaps another space is refused.

Acceptance checks validity and overlaps again. A changed source image or calibration invalidates
the pending batch. Running detection again excludes rooms already saved, allowing users to work
through a plan in stages. Unaccepted suggestions survive navigation within the current session;
accepted rooms use normal project autosave and file export.

## Verification

The detection suites cover partitions, doorway closures, noise, exclusion, limits and cancellation.
Component tests cover calibration, batch editing/acceptance, preserved products, late OCR naming,
changed source images and immutable saved work. Real Chrome journeys:

- `scripts/floorplan-scale-smoke.mjs` — scale references, zoom ruler and responsive layout.
- `scripts/floorplan-batch-smoke.mjs` — automatic OCR, three-room detection, editing, subset
  acceptance, duplicate prevention and reload.
- `scripts/automatic-plan-reading-smoke.mjs` — actual OCR, corrections and dimension differences.
- `scripts/automatic-scale-smoke.mjs` — scale proposals, confirmation, manual fallback and straight
  threshold coverage through the upload and room-review flow.
- `scripts/floorplan-precision-smoke.mjs` — actual estate-agent image (supplied through
  `FLOORPLAN_PATH`), automatic scale, staircase review, precision placement and doorway repair.
- `scripts/detect-all-probe.mjs` — raster/worker detection of the estate-agent fixture.
- `scripts/doorway-detection-probe.mjs` — real worker detection across door-symbol variants and
  plain-opening controls.
- `scripts/doorway-batch-smoke.mjs` — doorway review, exclusions, shared openings and persistence.
- `scripts/offline-smoke.mjs` — production assets, PDF import and automatic OCR without a connection.
