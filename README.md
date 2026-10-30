# Straddle Carrier Sim

A personal browser sim for driving an unbranded straddle carrier around a yard. Built with Babylon.js, TypeScript and Vite.

## Run

```
npm install
npm run dev
```

## Controls (M1)

| Key | Action |
|---|---|
| W / S | Throttle / brake and reverse |
| A / D | Steer left / right |
| R / F | Hoist up / lower spreader |
| I / K | Side shift spreader |
| Space | Lock / release twistlocks (lock works on a container on the ground, when the spreader is at its lowest, aligned over it) |
| 1 | Cockpit camera |
| 2 | Chase camera |
| Mouse drag / arrow keys | Cockpit: look around the cab |
| V | Cockpit: recentre the view on the spreader |

## Scene

Quay apron with three ship-to-shore cranes, a container ship with stacked containers on deck, a yard block with a rubber-tyred gantry, light masts, and an office. Two containers on the ground to pick up.

## Milestones

- **M1** Drive and steer, cockpit camera, flat yard
- **M2** Spreader hoist, sway, twistlock engagement. Sway and locking are kinematic, not physics-based
- **M3** Pick up and stack in a 6 by 8 grid, up to 3 high; two AI straddle carriers pick up and stack containers too (this commit). No collision detection yet
- **M4** Unloading loop from a quay point
- **M5** Camera polish, scoring, HUD
