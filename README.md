# Cobblestone Bot

Mineflayer bot that mines cobblestone, stores it, and manages pickaxes.

## Setup

```bash
npm install
npm start
```

## Config (`bot.js`)

```js
host: 'localhost'
port: 25565

COBBLE_POS = { x: 8, y: 63, z: 6 }
STAND_POS = { x: 8, y: 63, z: 7 }
CHEST_POS = { x: 10, y: 64, z: 6 }
PICKAXE_CHEST_POS = { x: 10, y: 64, z: 6 }
```

## Commands

* `!start` — start mining
* `!stop` — stop
* `!keep` — deposit cobble
* `!status` — info

## Notes

* Mines only the target block
* Auto-pickaxe from chest
* Returns to stand position every time
