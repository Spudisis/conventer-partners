# Partner logo converter

Drops any partner logo (SVG / PNG / JPEG / WebP) onto a 178×82 card, recolors it
to the brand grey `#565B63`, knocks the background out, and exports SVG + WebP.

- **UI:** `pnpm dev` — drag & drop, per-image padding and fill method, batch ZIP download.
- **CLI:** `pnpm convert <files-or-dirs...>` — same pipeline, no browser window.

## Script / CLI usage

The conversion runs on browser APIs (canvas pixel work, `DOMParser`, `canvas.toBlob`
for WebP), so the CLI executes the *exact same modules the UI uses* inside a headless
Chromium page — output is identical to what you'd get by dragging the file into the app.

```bash
# from this repo
pnpm convert logo.png -o ./assets

# from anywhere (e.g. another project — no need to open the UI)
node /Users/aleksandrvoronin/Documents/converter-partner-svg/scripts/convert.mjs \
  ./logos -o ./public/partners --json
```

Options:

| Flag | Default | Meaning |
| --- | --- | --- |
| `-o, --out <dir>` | `./converted` | Output directory (created if missing) |
| `-f, --format <fmt>` | `both` | `svg`, `webp` or `both` |
| `-s, --scale <n>` | `3` | WebP retina scale (1–4 in the UI) |
| `--fill <method>` | `default` | `default`, `cutout`, `foreground`, `two-tone` — background handling for vector SVGs |
| `-p, --padding <spec>` | `auto` | `auto`, `none`, `N`, `V,H` or `T,R,B,L` in card units |
| `--name <base>` | source name | Output base name (single input only) |
| `--json` | off | JSON report on stdout (paths, byte sizes, resolved padding, per-file errors) |
| `-q, --quiet` | off | No per-file progress lines |

Directories are scanned recursively for `.svg .png .jpg .jpeg .webp`. Exit code is
`1` if any input failed, `2` on bad arguments.

`--fill` only affects vector SVGs (rasters and SVGs with an embedded bitmap always go
through the pixel pipeline, which removes solid backgrounds on its own):

- `default` — paint everything brand grey (a logo on a solid card becomes a solid card)
- `cutout` — keep the card, knock the artwork out of it (transparent letters)
- `foreground` — drop the background shape, keep only the artwork
- `two-tone` — background at 15% opacity behind full-strength artwork

### For agents

```
node <repo>/scripts/convert.mjs <input...> -o <outdir> [--fill cutout] [-f webp] --json
```

Reads inputs, writes `<basename>.svg` / `<basename>.webp` into `-o`, prints a JSON
report with absolute output paths. Requires `pnpm install` in this repo once; a
Chromium build is resolved from the local Playwright cache, from an installed Google
Chrome, or from `$CHROME_PATH`.

---

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
