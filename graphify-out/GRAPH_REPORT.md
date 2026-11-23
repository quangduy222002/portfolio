# Graph Report - portfolio  (2026-11-23)

## Corpus Check
- 132 files · ~170,272 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 335 file(s) not represented in the graph (top: .glb 101, .mtl 91, .obj 91)
- WARNING: 335 of 473 files seen (71%) have no supported extractor and are missing from this graph entirely. It may look complete while representing only part of the codebase.

## Summary
- 1358 nodes · 3061 edges · 56 communities (50 shown, 6 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 129 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f6f6893c`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- store/package.json
- ref_three
- shopify.ts
- SheetView
- web/package.json
- package.json
- deploy
- configurator.ts
- three-core/package.json
- build.ts
- compilerOptions
- compilerOptions
- web/tsconfig.json
- artifact.mjs
- .prettierrc.json
- export.ts
- store/README.md
- 4. Danh sách cảnh (bản chính ~88 giây)
- index.ts
- assembly/app.ts
- drawing.ts
- pages/index.astro
- PlanEditor
- graphify.sh
- Geometric / rule-based algorithms for parsing vector floor plans (PDF/DXF segments + text) into walls, openings and rooms
- room/app.ts
- symbols.ts
- room/ai.ts
- techdraw.ts
- studio/index.astro
- index.ts
- box/studio.ts
- setupThree
- Architectural floor plan drawing conventions for automatic parsing (Vietnamese residential focus)
- pointInPoly
- ProjectChapter.astro
- studio/app.ts
- furniture.ts
- Learned floor plan understanding and floor-plan-to-model tools (state of the art, transferability, expected accuracy)
- Combining vision-language models with geometric parsing for floor plan understanding
- plan.ts
- BaseLayout.astro
- watch/catalog.ts
- Plan
- detect.ts
- watch/model.ts
- views.ts
- store.ts
- room/textures.ts
- Để hình học đếm, để Claude đọc bản vẽ
- RenderLoop
- room/look.ts
- Duy Q. — 3D portfolio & product demos
- LICENSES.md
- LICENSE.md

## God Nodes (most connected - your core abstractions)
1. `startRoomcraft()` - 56 edges
2. `startStudio()` - 41 edges
3. `PlanEditor` - 39 edges
4. `Plan` - 37 edges
5. `$` - 28 edges
6. `Vec2` - 27 edges
7. `RenderLoop` - 27 edges
8. `startStudio()` - 27 edges
9. `setupThree()` - 26 edges
10. `nodeMap()` - 21 edges

## Surprising Connections (you probably didn't know these)
- `3D work: performance comes first` --references--> `RenderLoop`  [INFERRED]
  CLAUDE.md → packages/three-core/src/loop.ts
- `Layout` --references--> `RenderLoop`  [INFERRED]
  CLAUDE.md → packages/three-core/src/loop.ts
- `Layout` --references--> `ScrollDirector`  [INFERRED]
  CLAUDE.md → packages/three-core/src/scroll-director.ts
- `Layout` --references--> `analyseSheet()`  [INFERRED]
  CLAUDE.md → apps/web/src/scripts/room/ai.ts
- `Layout` --references--> `reviewFloor()`  [INFERRED]
  CLAUDE.md → apps/web/src/scripts/room/ai.ts

## Import Cycles
- None detected.

## Communities (56 total, 6 thin omitted)

### Community 0 - "store/package.json"
Cohesion: 0.08
Nodes (31): dependencies, @meridian/three-core@*, react@^18.3.1, react-dom@^18.3.1, react-router-dom@^6.30.6, @shopify/hydrogen-react@^2026.4.4, three@~0.187.0, devDependencies (+23 more)

### Community 1 - "ref_three"
Cohesion: 0.32
Nodes (6): detectTier(), gpuName(), PRESETS, Quality, Tier, RendererOptions

### Community 2 - "shopify.ts"
Cohesion: 0.06
Nodes (75): CartCtx, CartProvider(), Ctx, load(), save(), useCart(), sized(), COLORS (+67 more)

### Community 3 - "SheetView"
Cohesion: 0.19
Nodes (3): SheetHost, SheetView, startStudio()

### Community 4 - "web/package.json"
Cohesion: 0.08
Nodes (34): dependencies, @anthropic-ai/sdk@^1.8.0, dxf-parser@^1.1.2, @fontsource/geist-mono@^5.3.0, @fontsource/instrument-serif@^5.3.0, @fontsource-variable/inter@^5.3.0, @meridian/three-core@*, pdfjs-dist@^6.5.438 (+26 more)

### Community 5 - "package.json"
Cohesion: 0.06
Nodes (43): description, devDependencies, eslint@^10.14.0, @eslint/js@^10.0.0, eslint-plugin-astro@^3.2.1, eslint-plugin-react-hooks@^7.1.1, globals@^17.0.0, @playwright/test@1.63.0 (+35 more)

### Community 6 - "deploy"
Cohesion: 0.06
Nodes (34): name, runs-on, steps, concurrency, cancel-in-progress, group, environment, if (+26 more)

### Community 7 - "configurator.ts"
Cohesion: 0.11
Nodes (22): buildBackdrops(), ARMREST_PRICE, BASE_PRICE, ChairConfig, COLORS, FabricKey, FABRICS, FrameKey (+14 more)

### Community 8 - "three-core/package.json"
Cohesion: 0.13
Nodes (17): description, devDependencies, @types/three@~0.187.0, typescript@~5.9.3, exports, ./math, ./support, three (+9 more)

### Community 9 - "build.ts"
Cohesion: 0.24
Nodes (12): createFloorShadow(), createLightShafts(), gradientCanvas(), buildRoom(), Hotspot, mat(), rbox(), createDust() (+4 more)

### Community 10 - "compilerOptions"
Cohesion: 0.15
Nodes (12): compilerOptions, isolatedModules, lib, module, moduleResolution, noEmit, noUncheckedIndexedAccess, skipLibCheck (+4 more)

### Community 11 - "compilerOptions"
Cohesion: 0.18
Nodes (10): compilerOptions, jsx, lib, module, moduleResolution, noEmit, skipLibCheck, strict (+2 more)

### Community 12 - "web/tsconfig.json"
Cohesion: 0.22
Nodes (8): compilerOptions, baseUrl, lib, paths, exclude, extends, include, astro/tsconfigs/strict

### Community 13 - "artifact.mjs"
Cohesion: 0.05
Nodes (28): astro, body, bytes, dist, files, head, html, keep (+20 more)

### Community 14 - ".prettierrc.json"
Cohesion: 0.33
Nodes (5): overrides, plugins, printWidth, singleQuote, trailingComma

### Community 15 - "export.ts"
Cohesion: 0.16
Nodes (17): FloorReview, add(), CRC, crc32(), Drawing, esc(), LAYERS, linework() (+9 more)

### Community 18 - "4. Danh sách cảnh (bản chính ~88 giây)"
Cohesion: 0.10
Nodes (20): 1. Tóm tắt, 2. Nơi quay, 3. Chuẩn bị trước khi quay, 4. Danh sách cảnh (bản chính ~88 giây), 5. Phong cách hình ảnh khi dựng, 6. Những điều không được làm, 7. Bản ngắn 30 giây (mạng xã hội), 8. Kiểm tra trước khi xuất clip (+12 more)

### Community 19 - "index.ts"
Cohesion: 0.10
Nodes (24): loadWatchTextures(), WatchTextures, brush, cotes, dial(), engrave, grain, perlage (+16 more)

### Community 20 - "assembly/app.ts"
Cohesion: 0.05
Nodes (59): AiContext, AiMove, AiStep, generateStep(), Place, PLACES, schema(), systemPrompt() (+51 more)

### Community 21 - "drawing.ts"
Cohesion: 0.19
Nodes (16): BlockRef, boundsOf(), markArcRuns(), markPolylineArcs(), scaleFromDimensions(), segLen(), Text, embeddedPlan() (+8 more)

### Community 22 - "pages/index.astro"
Cohesion: 0.19
Nodes (7): Props, projects, services, stack, steps, UPWORK_URL, rail

### Community 23 - "PlanEditor"
Cohesion: 0.13
Nodes (9): EditorHost, paintStair(), PlanEditor, WallView, closestOnSegment(), PlanNode, Vec2, wallEnds() (+1 more)

### Community 25 - "Geometric / rule-based algorithms for parsing vector floor plans (PDF/DXF segments + text) into walls, openings and rooms"
Cohesion: 0.05
Nodes (36): 1. Wall detection (parallel-line pairing, skeletons, hatch/stroke/layer features, merging, junctions), 2. Openings (door arcs/leaves, windows, gap closing), 3. Room segmentation (noding, planar graph, face extraction, filtering, labels), 4. Annotation separation (dimensions, grids, leaders, hatches, title block, setbacks, furniture), 5. Scale inference, 6. Multi-plan sheets, alignment between floors, rotation, 7. Robustness, performance and evaluation, Cited Findings (+28 more)

### Community 26 - "room/app.ts"
Cohesion: 0.08
Nodes (35): hostClaude(), HostDownloads, hostDownloads(), HostError, HostSample, hostUse(), saveFile(), uses (+27 more)

### Community 27 - "symbols.ts"
Cohesion: 0.16
Nodes (17): inRegion(), fold(), labelOf(), LABELS, Box, findSymbols(), fold(), FoundSymbol (+9 more)

### Community 28 - "room/ai.ts"
Cohesion: 0.08
Nodes (42): hostFailure(), adoptCustoms(), AiItem, AiQuestion, analyseSheet(), askJson(), cleanStyle(), compass() (+34 more)

### Community 29 - "techdraw.ts"
Cohesion: 0.21
Nodes (25): Arc, Seg, add(), arc(), axisLetter(), Chain, cluster(), dedupe() (+17 more)

### Community 30 - "studio/index.astro"
Cohesion: 0.24
Nodes (4): Props, gl, gl, hasWebGL()

### Community 31 - "index.ts"
Cohesion: 0.20
Nodes (8): boxSpecs(), chairSpecs(), noise(), FrameCallback, LoopOptions, rand32(), Ctx2D, SpecMap

### Community 32 - "box/studio.ts"
Cohesion: 0.09
Nodes (23): usd(), createDieline(), rebuild(), toVec(), createPallet(), PALLET, PalletPlan, DISCOUNT (+15 more)

### Community 33 - "setupThree"
Cohesion: 0.11
Nodes (11): setupThree(), onModelLoaded(), setFixtureGlow(), House, metreUVs(), openingOutline(), skirtingGeo(), createLook() (+3 more)

### Community 34 - "Architectural floor plan drawing conventions for automatic parsing (Vietnamese residential focus)"
Cohesion: 0.06
Nodes (31): Architectural floor plan drawing conventions for automatic parsing (Vietnamese residential focus), Cited Findings, Cited Findings, Cited Findings, Cited Findings, Cited Findings, Cited Findings, Cut walls vs projection lines: line weights, hatches, structure vs masonry, wall thicknesses (+23 more)

### Community 35 - "pointInPoly"
Cohesion: 0.18
Nodes (14): FURNITURE, AUTO, BACK, designLighting(), edgeDistance(), kelvinColor(), centroidOf(), findRooms() (+6 more)

### Community 36 - "ProjectChapter.astro"
Cohesion: 0.29
Nodes (3): Props, Project, withBase()

### Community 37 - "studio/app.ts"
Cohesion: 0.16
Nodes (15): DrawingShot, count(), emptyPlan(), Stage, withoutMasks(), Drawing, Segment, alignTo() (+7 more)

### Community 38 - "furniture.ts"
Cohesion: 0.09
Nodes (40): Add, artwork(), Build, buildCustom(), builders, buildFurniture(), buildModel(), buildPiece() (+32 more)

### Community 39 - "Learned floor plan understanding and floor-plan-to-model tools (state of the art, transferability, expected accuracy)"
Cohesion: 0.06
Nodes (31): Cited findings, Cited findings, Cited findings, Cited findings, Cited findings, Cited findings, Commercial products and their approach (what they ask the user, how they handle errors), Datasets and models: input, output, reported metrics, licence, browser feasibility (+23 more)

### Community 40 - "Combining vision-language models with geometric parsing for floor plan understanding"
Cohesion: 0.07
Nodes (26): 1. Measured capabilities and failure modes of VLMs on floor plans and technical drawings, 2. Coordinate grounding techniques (Set-of-Mark, grids, IDs, tiling, image plus structured list), 3. Division of labour between the VLM and the geometry (and existing systems), 4. Prompt patterns, output formats, image budgets, cost and latency, 5. Limits, risks and geometric validation of VLM output, Cited findings, Cited findings, Cited findings (+18 more)

### Community 41 - "plan.ts"
Cohesion: 0.09
Nodes (39): DEFAULT_STYLE, Finish, FLOORS, GROUPS, ROOM_DEFAULTS, WALLS, OPENING_WIDTH, Selection (+31 more)

### Community 42 - "BaseLayout.astro"
Cohesion: 0.17
Nodes (5): astro@^7.4.11, base, canonical, Props, astro

### Community 43 - "watch/catalog.ts"
Cohesion: 0.09
Nodes (30): $, announce(), initCursor(), initRail(), initStickyNav(), liveRegion, toast(), initReveals() (+22 more)

### Community 44 - "Plan"
Cohesion: 0.16
Nodes (4): RoomcraftApi, RoomcraftOptions, Plan, DetectResult

### Community 45 - "detect.ts"
Cohesion: 0.23
Nodes (15): splitWall(), uid(), Chord, closeDangles(), curvedWalls(), detectWalls(), dropStrayClusters(), findColumns() (+7 more)

### Community 46 - "watch/model.ts"
Cohesion: 0.14
Nodes (17): buildWatch(), createInk(), createMaterials(), dauphine(), ExplodedPart, gearShape(), lathe(), sweptStrap() (+9 more)

### Community 47 - "views.ts"
Cohesion: 0.36
Nodes (5): Region, findViews(), floorOf(), fold(), PlanView

### Community 48 - "store.ts"
Cohesion: 0.26
Nodes (12): samplePlan(), autosave(), clearLinkHash(), compact(), fromB64(), isPlan(), loadInitial(), normalise() (+4 more)

### Community 49 - "room/textures.ts"
Cohesion: 0.22
Nodes (3): roomSpecs(), RoomTexture, TILE_METRES

### Community 50 - "Để hình học đếm, để Claude đọc bản vẽ"
Cohesion: 0.25
Nodes (7): Bản vẽ Việt Nam mã hóa ngữ nghĩa bằng độ dày nét chứ không bằng layer, Claude giỏi đọc chữ và phán đoán, kém đếm ký hiệu, Ghép cặp song song là đúng hướng, nhưng phải dựa trên histogram độ dày, Kết luận, Mô hình học máy đạt 90 điểm trong phòng thí nghiệm nhưng chưa vào được trình duyệt, Mười kỹ thuật xếp theo tác động lên ba lỗi thật của khách, Để hình học đếm, để Claude đọc bản vẽ

### Community 51 - "RenderLoop"
Cohesion: 0.13
Nodes (19): Hero3D(), Story(), startChair(), Framing, NUMERIC, Pose, SECTION_OF, Shot (+11 more)

### Community 53 - "Duy Q. — 3D portfolio & product demos"
Cohesion: 0.50
Nodes (3): Develop, Duy Q. — 3D portfolio & product demos, Stack

## Knowledge Gaps
- **1 isolated node(s):** `astro/tsconfigs/strict`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 486 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `$` connect `watch/catalog.ts` to `box/studio.ts`, `setupThree`, `SheetView`, `studio/app.ts`, `configurator.ts`, `RenderLoop`, `assembly/app.ts`, `pages/index.astro`, `room/app.ts`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **Are the 7 inferred relationships involving `startRoomcraft()` (e.g. with `.deleteSelection()` and `.draw()`) actually correct?**
  _`startRoomcraft()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **What connects `astro/tsconfigs/strict` to the rest of the system?**
  _1 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `store/package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.0766488413547237 - nodes in this community are weakly interconnected._
- **Why does `@playwright/test` connect `package.json` to `artifact.mjs`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `startStudio()` (e.g. with `.cancelCalibration()` and `.draw()`) actually correct?**
  _`startStudio()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Should `shopify.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0638148667601683 - nodes in this community are weakly interconnected._