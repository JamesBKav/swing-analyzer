# Swing Analyzer

A golf swing analysis app that runs entirely on your phone. Record or import a swing, step through it frame by frame, draw on it, get automatic pose-based metrics, and compare two swings side by side.

**Live app:** https://jamesbkav.github.io/swing-analyzer/

- **100% on-device.** No backend, no uploads, no accounts. Videos and analysis are stored in your browser's IndexedDB and never leave the phone.
- **Works offline.** The pose model (MediaPipe Pose Landmarker) and its WebAssembly runtime are bundled with the app and cached by the service worker on first load.
- **Built for iPhone Safari** installed to the home screen; also works on Android Chrome and desktop browsers.

## Features

| | |
|---|---|
| **Capture** | Record with the camera or import from the photo library, including 120/240 fps slow-mo. Frame rate is auto-detected. |
| **Player** | Play/pause, 0.1×–1× speed, frame step (hold to repeat), scrub bar with fine control (slide your finger up while scrubbing), swipe the video to step frames, tap to play/pause. |
| **Drawing** | Line (shows its angle), 3-point angle, circle, freehand. Shapes can stay on every frame or belong to one frame. Undo and clear. |
| **Pose analysis** | Runs MediaPipe Pose in a Web Worker with a progress bar. Landmarks are cached per swing. Toggleable skeleton (lead side amber, trail side blue). |
| **Swing phases** | Auto-detects address, top, impact and finish from the lead-wrist path and speed. Tap a phase to jump there; tap **Set here** to correct it. |
| **Metrics** | Tempo (backswing : downswing), spine angle at address vs impact, head movement box, shoulder/hip line tilt, face-on turn estimate, lead-arm angle at the top. |
| **Compare** | Two swings side by side or overlaid (opacity slider), synced at address, at impact, or across all phases. Mirror option for comparing a left- and right-handed swing. |

> **About the metrics:** every number is a **2D estimate measured in the camera image**, not a true 3D angle. Results depend on where the camera is, so film the same way each time if you want to track changes.

## Install on your phone

### iPhone (Safari)
1. Open the [live app](https://jamesbkav.github.io/swing-analyzer/) in **Safari** (other iOS browsers can't install web apps on older iOS versions).
2. Tap the **Share** button (square with an up arrow).
3. Scroll down and tap **Add to Home Screen**, then **Add**.
4. Open it from the home screen once while online. After the "Ready to work offline" message it works without a connection.

### Android (Chrome)
1. Open the [live app](https://jamesbkav.github.io/swing-analyzer/) in **Chrome**.
2. Tap **Install app** in the banner, or open the **⋮** menu and choose **Install app** / **Add to Home screen**.
3. Open it once while online so the model is cached for offline use.

## How to film a swing

Good footage matters more than anything else for accurate pose detection.

**General setup**
- **Tripod or a steady prop.** Hand-held video makes head-movement numbers meaningless.
- **Camera at hip height**, lens level (not tilted up or down).
- **Whole body in frame** from head to feet, including the club at the top and finish. Leave some space around the golfer.
- **Good, even light**, ideally with the sun behind the camera. Avoid busy backgrounds and baggy clothes if you can.
- **Slow-mo (120 or 240 fps)** gives much sharper positions around impact. On iPhone, use the Camera's **Slo-Mo** mode.
- **Start recording before you set up** and stop after the finish, so the app sees you standing still at address.

**Face-on**
- Camera directly in front of the golfer, square to the chest, about **3–4 m (10–13 ft) away**.
- Line the lens up with the **middle of the stance** (between the feet), at hip height.
- Best for: head movement and sway, spine tilt, shoulder/hip tilt and the turn estimate.

**Down the line**
- Camera **behind the golfer, on the target line**, pointing at the target. Line up with the **hands or the ball-target line**, not the golfer's body, about **3–4 m back**.
- Hip height, lens level.
- Best for: spine forward bend (posture) at address vs impact, and swing-plane lines with the drawing tool.

In the app, open **Setup** and choose the camera view and whether the golfer is right- or left-handed, so metrics are labelled and signed correctly.

### Slow-motion tips
- **True 120/240 fps files** (the normal case) play in real time and the app slows them down. Leave *"Slow-mo baked into the clip?"* set to **No**.
- If you import a clip that **already plays slowly** (for example, a slow-mo exported from another app), choose **4× slower** or **8× slower** so times are shown in real seconds. Tempo ratios are correct either way.
- Long 240 fps clips are analysed at about 60 samples per real second (and at most 900 frames) to stay within phone memory limits. Trim clips to the swing for the best results.

## Development

Requires Node.js 20.19+ (CI uses Node 24).

```bash
npm install
```

`npm install` also copies the MediaPipe WebAssembly runtime from `node_modules` into `public/mediapipe/wasm` (see `scripts/copy-mediapipe.mjs`).

```bash
npm run dev
```

The dev server serves the app at `http://localhost:5173/swing-analyzer/`. To test on a phone on the same Wi-Fi, run `npm run dev -- --host` and open the network URL. Camera capture needs HTTPS on most phones, but importing files works over plain HTTP.

```bash
npm test
```

```bash
npm run build
```

`npm test` runs the Vitest unit tests for phase detection, metrics and phase sync, using synthetic landmark data. `npm run build` type-checks and builds to `dist/`.

### Project structure

```
src/
  capture/   file picker, metadata probe, thumbnails
  player/    frame-accurate VideoPlayer, scrub bar, transport controls
  pose/      PoseLandmarker engine, Web Worker, analysis driver, skeleton drawing
  metrics/   phase detection, metrics, phase sync, geometry (+ tests, synthetic swings)
  draw/      drawing tools: shape model, renderer, touch controller
  storage/   IndexedDB (idb) for sessions, videos, pose tracks, thumbnails
  ui/        views (home, analyze, compare) and panels
public/
  models/    pose_landmarker_full.task and pose_landmarker_lite.task
  icons/     app icons (regenerate with `npm run icons`)
```

### How analysis works

1. A hidden `<video>` seeks through the clip at about 60 real-time samples per second. Each frame is downscaled to 480 px and sent as an `ImageBitmap` to a module Web Worker.
2. The worker runs PoseLandmarker in `VIDEO` mode, trying the GPU delegate first and falling back to CPU. If workers aren't available, the same engine runs on the main thread. Decoding the next frame overlaps with inference on the current one.
3. Landmarks are stored as a `Float32Array` per swing in IndexedDB, so re-opening a swing is instant.
4. Phases come from the hand trajectory: impact is near the peak hand speed, the top is the highest hand point before it, and address and finish are the still periods either side. Metrics are computed from landmarks at those phases.

## Deployment

Every push to `main` runs `.github/workflows/deploy.yml`, which installs, tests, builds with `BASE_PATH=/<repo-name>/` and publishes `dist/` to GitHub Pages.

One-time setup (already done for this repo): **Settings → Pages → Build and deployment → Source: GitHub Actions**.

The Vite `base` defaults to `/swing-analyzer/`. If you fork under another name, the workflow sets it from the repo name automatically. For a custom domain, build with `BASE_PATH=/`.

## Limitations

- Metrics are 2D projections; rotation (turn) can only be estimated face-on and is rough.
- Pose detection struggles with motion blur at normal frame rates, poor light, or the golfer partly out of frame. Use slow-mo and check the auto-detected phases.
- The club itself isn't tracked. Phases are inferred from the hands.
- iOS can evict website data that isn't used for a long time unless the app is installed to the home screen. The app requests persistent storage where supported.

## Privacy

There is no server component. The app makes no network requests after the first load (and the service-worker update check). Your videos, landmarks and drawings stay in your browser's storage on your device, and deleting a swing in the app removes them.
