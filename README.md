# VELTRIS

<p align="center">
  <img src="icon.png?v=15" alt="Veltris" width="260">
</p>

A fast, sharp-cornered puzzle game in the style of **Puyo Puyo**. Pair up
matching square blocks — match **4 or more** in a row to pop them, trigger
chains for huge points, and beat your high score!

**Play it at:** <https://fakerhog15.github.io/veltris/>

## Gameplay

- Blocks fall in pairs of two.
- Match 4+ blocks orthogonally to clear them.
- Cleared blocks fall away and chain into new matches.
- Build chains to multiply your score.
- Game over when blocks reach the top.

## Difficulty

Pick a mode with the **MODE** button in-game (or `?mode=easy|medium|hard`); the
choice is remembered. Higher modes use more colors and drop faster:

| Mode   | Colors | Fall speed |
| ------ | ------ | ---------- |
| Easy   | 4      | slower     |
| Medium | 6      | normal     |
| Hard   | 14     | faster     |

## Colors

Blocks are drawn from a palette of bold colors — **blue, green, red, black,
white, yellow, purple, orange, grey**, plus custom tones
`rgb(15, 82, 186)`, `rgb(0, 149, 255)`, `rgb(56, 182, 255)`, `rgb(0, 230, 153)`,
`rgb(138, 43, 226)`, `rgb(255, 170, 0)` and `rgb(220, 20, 60)`. The active mode
decides how many of them appear at once.

## Controls

| Key                        | Action        |
| -------------------------- | ------------- |
| <kbd>&larr;</kbd> <kbd>&rarr;</kbd> | Move left / right |
| <kbd>&uarr;</kbd> or <kbd>X</kbd>   | Rotate clockwise |
| <kbd>Z</kbd>               | Rotate counter-clockwise |
| <kbd>&darr;</kbd>          | Soft drop      |
| <kbd>Space</kbd>           | Hard drop      |
| <kbd>C</kbd>               | Hold piece     |
| <kbd>Enter</kbd>           | Pause / resume |

On-screen touch buttons are included for mobile play.

## Presentation

- One-canvas layout with a **piece preview queue** (next 3) and a **hold** slot.
- **Ghost piece** drop indicator and active-column highlight.
- Smooth sub-cell falling animation and a live **FPS** readout.
- Particle bursts, chain flashes, leveling and a level progress bar.
- **Display filter** with three modes, cycled by the **DISPLAY** button
  in-game (choice is remembered):
  - **CRT + RF** — full effect: `crt-geom` style screen curvature, aperture-grille
    shadow mask and scanlines, plus a `crt-guest-advanced` NTSC/RF look with color
    fringing, animated RF static, horizontal ringing echo and phosphor afterglow.
  - **CRT** — scanline/mask/curvature only (no RF).
  - **OFF** — plain, unfiltered render.
  - Set the initial mode with a URL param, e.g. `?crt=off`, `?crt=crt`, `?crt=rf`.
  - The effect runs on **WebGPU** (the Vulkan backend on Linux) and automatically
    falls back to **WebGL**, then to a plain 2D render, if unavailable. The active
    backend is shown as **GPU:** in the DISPLAY panel.

## Sound

Six background tracks:

- **Main Menu** — *Mario Kart 7 Soundtrack - Main Menu*
- **SNES Rainbow Road** — *Mario Kart 7 Soundtrack - SNES Rainbow Road*
- **CV Bloodlines - Stage 1** — *Castlevania Bloodlines - Reincarnated Soul Part 2 (Stage 1)*
- **CV Portrait of Ruin** — *Castlevania Portrait of Ruin - Bloodlines Bequethed*
- **Ninja Warriors - Boss 2** — *The Ninja Warriors - Boss 2*
- **Ninja Warriors - Boss 5** — *The Ninja Warriors - Boss 5*

- Cycle between tracks with the **TRACK** button in-game.
- Turn music on/off with the **MUSIC** button (choice is remembered).
- Drag the **VOLUME** slider to set the music level from 0–100%; the setting is
  remembered between sessions.

Switch tracks anytime during play. All in-game sound effects (move, rotate,
drop, hold, clear, chain, game over) are synthesized in the browser with a
16-bit **SNES-style** Web Audio engine (pulse + sub-oscillator tones and a
band-limited noise channel).

## Credits

- Music: *Mario Kart 7*, *Castlevania: Bloodlines*, *Castlevania: Portrait of Ruin*,
  *The Ninja Warriors* (Nintendo / Konami / Taito)
- Font: **Super Mario World 2: Yoshi's Island (Alt)** by Patrick H. Lauke, via
  [FontStruct](https://fontstruct.com/fontstructions/show/2117618), licensed under
  [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). License bundled at
  `fonts/license.txt`.
- Built with plain HTML5 Canvas + JavaScript — no dependencies.
