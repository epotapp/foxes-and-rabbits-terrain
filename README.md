# Foxes and Rabbits — Terrain edition

Play at https://epotapp.github.io/foxes-and-rabbits-terrain/

Browser release 2.0.0-terrain.1. Human vs human (pass-and-play), human vs agent and agent vs agent, terrain maps, playtests, replays and GIF export. Runs entirely in browser workers using the same referee and planners as the local edition.

Settings stay in this browser. Games and playtests last for the current page session; reloading or closing the page ends them. Save completed replays and reports with the download buttons. Files go to browser downloads. This release has no network multiplayer or server storage.

This repository contains the generated static distribution. Publishing source: the separate foxes-and-rabbits-terrain workspace, scripts/build-pages.mjs (Node 24+).
