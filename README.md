# Kettleborn

Dark-fantasy RPG kettlebell training companion, plus a fully standalone
custom-interval Timer. React Native + Expo + TypeScript.

Architecture is locked as of **Mobile Architecture v1.0** and **v2.0** — see the
folder-level `README.md` files under `src/`, `engines/`, and `content/` for what
each piece is responsible for.

## Requirements

- **Node.js 20.19.4+ / 22.13.0+ / 24.3.0+** (required by Expo SDK 57 / React Native 0.86 — see `react-native`'s own `engines.node` field for the exact ranges)
- Expo CLI (installed automatically via `npx expo`)
- A phone with **Expo Go** installed (iOS App Store / Google Play), or an
  Android/iOS simulator

## Setup

```bash
npm install
npx expo install --check   # reconciles native module versions against SDK 57
npx expo start
```

Scan the QR code with Expo Go (Android: in-app scanner; iOS: the system
Camera app), or press `a` / `i` in the terminal for an emulator/simulator.

If your phone and computer can't see each other over Wi-Fi, use:

```bash
npx expo start --tunnel
```

## Status

Playable vertical slice: two monsters (Minotaur, Arachne) with a full
Hunt loop (World Map → Hunt Brief → Active Hunt with a real Battle Engine →
Victory/Failure), plus a fully standalone Timer tab with custom per-round
intervals, saved presets, and sound cues. Persistence (SQLite), Chronicle,
and Hunter progression are all live.

## Upgrading the Expo SDK

This project targets **Expo SDK 57** (React Native 0.86, React 19.2). When
upgrading further, upgrade one SDK at a time and re-run:

```bash
npx expo install --fix
npx expo-doctor
```
