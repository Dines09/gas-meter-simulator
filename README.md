# Gas Detector Trainer

A hands-on web simulator for training ship crews on **Riken Keiki portable gas detectors**, so procedures can be practised without using up real calibration gas.

**Open on your phone:** https://dines09.github.io/gas-meter-simulator/

## Models

| Model | Gases | Notes |
|---|---|---|
| **GX-8000** | CH4 %LEL · O2 · CO · H2S | 4-gas pump detector, segment LCD. Calibration mode (▼ + DISPLAY), maintenance mode (▲ + ▼ + POWER, password 0008). |
| **RX-8000** | HC %LEL ⇄ vol% (isobutane, IR) · O2 | Tanker / inert-gas meter. Filter check and warm-up at start, ONE CAL with ▲ + ▼. |
| **GX-9000** | O2 · H2S · CO · CH4 %LEL | Dot-matrix display; User mode (POWER + ▲ from off) with BUMP TEST, GAS CAL and ALARM SETTING. |

## What you can practise

- Power on and the start-up self-check
- Fresh air calibration (AIR CAL)
- Alarm test (lamps and buzzer)
- Bump test
- Span calibration: all gases at once (AUTO CAL) or one gas at a time (ONE CAL)
- Gas alarm check with test gas, and alarm reset
- Changing alarm setpoints
- Pump stop, PEAK/STEL/TWA display, manual memory, power off

**Learning mode** shows each step and highlights the key or port to use. **Free practice** gives no guidance; a short hint line explains the keys for the screen that is showing.

The gas bench has calibration cylinders (4-gas mix, isobutane %LEL and vol%, nitrogen, zero air). Each has a regulator and gauge, and there is a 2 L plastic gas sampling bag with self-sealing snap couplings. Drag flexible tubes from the cylinder to the bag, then from the bag to the meter's GAS IN. The meter pump empties the bag. If the bag runs empty, the meter shows a LOW FLOW fault.

## Landscape and install (PWA)

The app is made for a phone held sideways, like the real meter. In portrait it asks you to rotate.
It can be installed as an app: on Android tap **⤓ Install** (or browser menu → *Install app*); on iPhone use Share → *Add to Home Screen*. After the first visit it also works offline.

## Controls

- **Phone:** tap the keys (the phone vibrates on each press, Android). Hold a key for a long press. Use two or three fingers for key combinations.
- **Keyboard:** `↑`/`Q` = ▲, `↓`/`A` = ▼, `D` = DISPLAY / PEAK·ESC / DISP·ESC, `Enter`/`E` = POWER/ENTER
- **Mouse:** Shift + click latches a key down, so you can do combinations.
- The `2×` button sets the simulation speed (1×, 2× or 4×). It speeds up sensor response and countdowns.

## Run locally

It's a static site with no build step:

```
python -m http.server 8080
# open http://localhost:8080
```

Logic tests for the meter procedures: `node tests/meters.test.js`

## Sources and disclaimer

Key sequences, screens, alarm setpoints and calibration flows are based on the published Riken Keiki manuals: the GX-8000 Operating Manual (PT0E-0980) and User Maintenance Manual (H4E-0050), the RX-8000 Operating Manual (PT0E-1194), and the GX-9000 series Operating Manual. Sensor drift, timings and concentrations are simulated so that the training is realistic, but they are approximate.

Developed by ETO · +91 99919 94468.

This is an unofficial training aid. It is not affiliated with or endorsed by RIKEN KEIKI Co., Ltd., and product names are trademarks of their owners. Always follow the official manual and your company's SMS on board.
