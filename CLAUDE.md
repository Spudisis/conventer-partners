# Partner logo converter

Puts a partner logo (SVG / PNG / JPEG / WebP) on a 178×82 card, recolors it to the
brand grey `#565B63`, clears the background, exports SVG + WebP. Two front ends over
one pipeline: the React UI (`pnpm dev`) and a headless CLI.

## Generating images — do this

**Never open the UI, and never reimplement the conversion.** Run the CLI:

```bash
node scripts/convert.mjs <files-or-dirs...> -o <outdir> --json
```

Works from any cwd, so another project calls it by absolute path:

```bash
node /Users/aleksandrvoronin/Documents/converter-partner-svg/scripts/convert.mjs \
  ./logos -o ./public/partners --json
```

Writes `<basename>.svg` and `<basename>.webp` into `-o`. `--json` prints absolute
output paths, byte sizes, the padding that was auto-picked, and per-file errors —
parse that instead of guessing filenames. Exit `1` = some file failed, `2` = bad args.

| Flag | Default | Notes |
| --- | --- | --- |
| `-o, --out <dir>` | `./converted` | created if missing |
| `-f, --format` | `both` | `svg` \| `webp` \| `both` |
| `-s, --scale` | `3` | WebP retina scale → 534×246 at 3× |
| `--fill` | `default` | vector SVGs only (see below) |
| `-p, --padding` | `auto` | `auto` \| `none` \| `N` \| `V,H` \| `T,R,B,L`, in card units |
| `--name <base>` | source name | single input only |
| `-q, --quiet` | off | `--json` implies it |

Directories are scanned recursively for `.svg .png .jpg .jpeg .webp`.

### Picking `--fill`

Only matters for **pure vector SVGs**. Rasters — and SVGs with an embedded bitmap —
always go through the pixel pipeline, which keys out a solid background on its own.

- `default` — paint everything brand grey. A logo sitting on a solid card comes out
  as a solid grey rectangle, which is usually **not** what's wanted.
- `cutout` — keep the card, knock the artwork out of it. The right pick for a logo on
  a coloured card.
- `foreground` — drop the background shape, keep only the artwork.
- `two-tone` — background at 15 % opacity behind full-strength artwork.

Unsure? Convert with two or three of them into a scratch dir and look at the results.

### Check the result by looking at it

`Read` renders `.webp` inline, so eyeball the output before reporting success —
a silent all-grey rectangle is a *successful* conversion of the wrong `--fill`.
SVGs don't render in `Read` — look at the `.webp` twin instead (the default
`-f both` always writes one).

Prefer `.webp` for delivery when the source was a raster: the `.svg` then wraps an
embedded PNG (tens of KB) instead of real vector paths.

## Layout

- `src/shared/lib/imageToSvg.ts` — the whole pipeline: background keying, brand
  recolor, auto-padding, vector fill methods. Tuned thresholds live here as named
  constants; change them deliberately.
- `src/features/convert-image/lib/downloadHelpers.ts` — `svgToWebpBlob`, ZIP export.
- `scripts/convert.mjs` — the CLI: bundles `src/` with Vite, runs it in headless
  Chromium, writes files.
- `scripts/headless/entry.ts` — browser-side shim the CLI injects; it *imports* the
  UI's functions, so both front ends can't drift apart. Keep it that way.

## Gotchas

- The pipeline needs browser APIs (canvas pixel work, `DOMParser`, `canvas.toBlob`).
  That's why the CLI drives Chromium instead of running in Node — don't "port" it.
- The page is served over loopback, not `about:blank`: blob URLs and canvas readback
  need a real origin.
- Chromium comes from `$CHROME_PATH`, the local Playwright cache, or installed Google
  Chrome, in that order. Needs `pnpm install` in this repo once.
- The Vite bundle is cached in `node_modules/.cache/converter-cli`, keyed by source
  mtimes — edits to `src/` are picked up automatically; no manual build step.
- `pnpm lint` has one pre-existing error in `src/entities/image/ui/ImageCard.tsx`
  (`set-state-in-effect`). Not yours.
