# LoopGrid → GarageBand Test Kit

Everything needed to test LoopGrid MIDI exports in GarageBand on iPhone.
All content: **105 BPM, A minor, 4/4**. Every loop is 2 bars.

**The workflow in one line: sketch in AR, finish in GarageBand.** The Lens is
where you perform and draft — including drawing your own drum patterns in the
16-step Custom editor — but its playback timing is approximate (the runtime
only ticks once per frame, so every custom hit lands up to a quarter of a
16th-note late). The MIDI export is the exact rendition: every note lands
precisely on its grid line. Judge feel and arrangement in the Lens; judge
timing here, in GarageBand.

> ## ⚠️ Set the song up BEFORE importing
>
> GarageBand imports MIDI at the **song's existing tempo** — it ignores the
> tempo stored in the file. And a fixed-length song section **truncates** the
> import. In your GarageBand song, before dragging anything in:
>
> 1. **Tempo → 105** (song settings ⚙)
> 2. **Key → A minor** (song settings ⚙)
> 3. **Song section → Automatic** (tap `+` at the top right of Tracks view →
>    Section A → Automatic) — otherwise anything past the section boundary
>    (8 bars by default) is cut off.

## What's in here

```
midi/                    Combined arrangements — one file, one track per playing row
  LoopGrid-Minimal.mid     8 bars  — Drums col 1 + Bass col 1 (2 tracks; unused
                                     rows are omitted, not empty)
  LoopGrid-FullBand.mid    16 bars — all five rows playing column 2 together
  LoopGrid-Demo.mid        28 bars — full arrangement:
                                     bar 0  Drums 1 + Bass 1
                                     bar 4  Keys 3 joins
                                     bar 8  Lead 5 + Perc 2 join
                                     bar 16 Drums + Bass switch to col 4
                                     bar 24 Keys → col 6, Lead drops out
                                     bar 28 everything stops
  LoopGrid-CustomBeat.mid  8 bars  — a USER-DRAWN custom drum pattern
                                     (four-on-the-floor kick + offbeat hats,
                                     drawn in the Lens's 16-step editor) over
                                     bass col 3. In GarageBand every hit is
                                     exactly on the grid — compare with how
                                     the same pattern sounds in the Lens.
midi/stems/              The Demo split into five SINGLE-track files
                           (LoopGrid-Demo-Drums/Bass/Keys/Lead/Perc.mid)
reference-audio/         The actual WAV loops the Lens plays for the cells used
                           in the Demo (named Row-Column, e.g. Keys-3.wav)
convert/                 The converter (needs Node.js on a computer):
                           node loopgrid-midi.js "<code>" out.mid          combined
                           node loopgrid-midi.js --stems "<code>" out.mid  stems
                         Or skip Node entirely: open docs/index.html in a
                         browser, paste the code, download from there.
```

## Combined vs stems — which to import?

GarageBand turns **every track of a multitrack MIDI into a pitched Keyboard
track**. That means in the combined arrangement the Drums and Perc tracks play
as piano notes, not a drum kit. Drums only land on a kit when a
**single-track** file is dropped **onto a Drums track**.

- **Combined** (`midi/*.mid`) — one drag, whole arrangement, quickest way to
  check timing and structure. Accept that drums sound pitched.
- **Stems** (`midi/stems/*.mid`) — import Bass/Keys/Lead normally, but create a
  **Drums track first** and drop `-Drums.mid` (and `-Perc.mid`) directly onto
  it so they play on a real kit. This is the way to hear the demo properly.

Rows with zero notes are never written in either mode, so you'll never see an
empty track after import.

## Getting the files onto your iPhone

- **iCloud Drive**: copy this folder into iCloud Drive, open Files on the phone.
- **AirDrop** (from a Mac): AirDrop the .mid files; they land in Files.
- **Cable**: copy to "On My iPhone" via Finder/iTunes file sharing.

## Importing (there is no "Open in GarageBand" for .mid)

Tapping a .mid in the Files app will **not** open it in GarageBand. Import
happens inside a song:

1. Open GarageBand, create a new song (any instrument), and switch to
   **Tracks view** (the mixer-style icon, top left).
2. Tap the **Loop Browser** (loop icon, top right) → **Files** tab →
   **Browse items from the Files app** → locate the .mid file.
3. **Touch and hold** the file in the list, then **drag it into the tracks
   area** and release at bar 1.
4. Stems only: for `-Drums.mid` and `-Perc.mid`, create a **Drums** track
   first and release the drag **on that track**.

## What to verify

- **Minimal** imports as exactly 2 tracks (Drums, Bass) — no empty extras.
- **Demo**: region changes land exactly on bars 4, 8, 16, 24, 28; loops repeat
  seamlessly every 2 bars; nothing sounds after bar 28.
- **Stems on a Drums track**: kick/snare/hats, with an open hi-hat and a ride —
  bongos or congas mean the GM remap failed.
- **Melodic rows**: Bass/Keys/Lead carry GM programs (Finger Bass, E.Piano,
  Vibraphone); GarageBand may substitute sounds — pitches matter, timbre doesn't.
- Compare against `reference-audio/` — same notes as the Lens plays.

## Custom drum patterns

Rows Drums and Perc each have a 9th **Custom** cell in the Lens. Tapping it
opens a 16-step × 5-lane editor (Kick / Snare / Hat / Clap / Shaker) and arms
the pattern like any other cell — it launches on the next downbeat, and the
1-bar pattern plays twice per 2-bar cycle. In the Lens it is a *sketch*:
hits are triggered per-frame and land audibly loose. In the exported MIDI the
same pattern is exact — kick on GM 36, snare 38, hat 42, clap 39, shaker 70,
channel 10, every hit on its 16th-note line. The pattern travels inside the
export code's `PAT:` segment, so the code is still fully self-contained.

## Converting your own performance

Perform in the LoopGrid Lens, open its export panel, and copy the code
(`LG1|105|Am|0:D1,B1;...|END:8|PAT:-|I` — the last character is a checksum;
a session using custom patterns carries them in the `PAT:` segment). Then
either paste it into `docs/index.html` in a browser, or with Node.js:

```
cd convert
node loopgrid-midi.js "PASTE-CODE-HERE" my-session.mid
node loopgrid-midi.js --stems "PASTE-CODE-HERE" my-session.mid
```

A mistyped character is rejected with a checksum error rather than producing a
wrong arrangement — re-read the code from the panel if that happens.
