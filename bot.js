const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { GoalNear } = goals
const Vec3 = require('vec3')

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const ROCK_AREA = [
  new Vec3(26, 64, 25),
  new Vec3(26, 64, 26),
  new Vec3(26, 64, 27),
  new Vec3(26, 64, 28)
]
const STAND_POS         = new Vec3(26, 63, 23)   // bot stands here to mine
const CHEST_POS         = new Vec3(28, 63, 24)  // cobblestone chest
const PICKAXE_CHEST_POS = new Vec3(28, 63, 24)  // pickaxe chest (change if different)
const COBBLE_ID         = 'cobblestone'
const STONE_ID          = 'stone'
const STACK_SIZE        = 64

const bot = mineflayer.createBot({
  host: '143.244.130.94',   // change to your server IP
  port: 6945,         // change if needed
  username: 'MinerBot', // change to your bot's username
  version: '1.20.6'
})

bot.loadPlugin(pathfinder)
const mcData = require('minecraft-data')(bot.version)

// ─── STATE ────────────────────────────────────────────────────────────────────
let mining   = false   // is the bot in mining loop?
let stopping = false   // stop requested mid-loop?

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/** Count cobblestone and stone in inventory */
function rockCount() {
  return bot.inventory.items()
    .filter(i => i.name === COBBLE_ID || i.name === STONE_ID)
    .reduce((sum, i) => sum + i.count, 0)
}

/** Check if bot has any pickaxe in hand or inventory */
function hasPickaxe() {
  return bot.inventory.items().some(i => i.name.includes('_pickaxe'))
}

/** Equip pickaxe from inventory if available */
async function equipPickaxe() {
  const pick = bot.inventory.items().find(i => i.name.includes('_pickaxe'))
  if (pick) {
    await bot.equip(pick, 'hand')
    return true
  }
  return false
}

/** Grab a pickaxe from the pickaxe chest, then return to stand pos */
async function fetchPickaxe() {
  bot.chat('No pickaxe! Heading to pickaxe chest...')
  await walkTo(PICKAXE_CHEST_POS, 2)

  const chestBlock = bot.blockAt(PICKAXE_CHEST_POS)
  if (!chestBlock || !chestBlock.name.includes('chest')) {
    bot.chat('Could not find pickaxe chest!')
    return false
  }

  const chest = await bot.openChest(chestBlock)

  // Wait for chest inventory to fully load
  await bot.waitForTicks(5)

  const allItems = chest.containerItems()

  const pick = allItems.find(i => i.name.includes('_pickaxe'))

  if (!pick) {
    chest.close()
    bot.chat('No pickaxes found in pickaxe chest! Stopping.')
    return false
  }

  await chest.withdraw(pick.type, null, 1)
  chest.close()
  bot.chat(`Grabbed ${pick.name}. Returning to mining spot...`)
  await equipPickaxe()
  await walkTo(STAND_POS)
  return true
}

/** Ensure bot has a pickaxe — fetch one if not */
async function ensurePickaxe() {
  if (hasPickaxe()) {
    await equipPickaxe()
    return true
  }
  return await fetchPickaxe()
}

/** Walk to an exact position */
async function walkTo(vec3, radius = 0) {
  const movements = new Movements(bot, mcData)
  movements.canDig = false
  bot.pathfinder.setMovements(movements)
  await bot.pathfinder.goto(new GoalNear(vec3.x, vec3.y, vec3.z, radius))
}

/** Mine one block from the stone generator area, whether cobblestone or stone */
async function mineOneRock() {
  for (const pos of ROCK_AREA) {
    const block = bot.blockAt(pos)
    if (block && (block.name === COBBLE_ID || block.name === STONE_ID)) {
      await bot.dig(block)
      return
    }
  }

  // No block available yet; return immediately so the loop can retry quickly
}

/** Deposit all mined rocks into chest */
async function depositToChest() {
  bot.chat('Heading to chest...')
  await walkTo(CHEST_POS, 2)

  const chestBlock = bot.blockAt(CHEST_POS)
  if (!chestBlock || !chestBlock.name.includes('chest')) {
    bot.chat('Could not find chest at the specified location!')
    return
  }

  const chest = await bot.openChest(chestBlock)

  // Wait for chest inventory to fully load
  await bot.waitForTicks(5)

  for (const item of bot.inventory.items()) {
    if (item.name === COBBLE_ID || item.name === STONE_ID) {
      try {
        await chest.deposit(item.type, null, item.count)
      } catch (e) {
        bot.chat('Chest might be full!')
        break
      }
    }
  }

  chest.close()
  bot.chat('Deposited mined blocks. Returning to mining spot...')
  await walkTo(STAND_POS)
}

/** Deposit ALL items (including pickaxe) into chest */
async function depositAllItemsToChest() {
  bot.chat('Heading to chest to deposit everything...')
  await walkTo(CHEST_POS, 2)

  const chestBlock = bot.blockAt(CHEST_POS)
  if (!chestBlock || !chestBlock.name.includes('chest')) {
    bot.chat('Could not find chest at the specified location!')
    return
  }

  const chest = await bot.openChest(chestBlock)

  // Wait for chest inventory to fully load
  await bot.waitForTicks(5)

  const itemsCopy = [...bot.inventory.items()]
  for (const item of itemsCopy) {
    try {
      await chest.deposit(item.type, null, item.count)
    } catch (e) {
      bot.chat('Chest might be full!')
      break
    }
  }

  chest.close()
  bot.chat('Deposited all items to chest.')
}

// ─── MAIN MINING LOOP ─────────────────────────────────────────────────────────
async function miningLoop() {
  bot.chat('Mining started!')
  await walkTo(STAND_POS)

  // Ensure pickaxe before starting
  const ok = await ensurePickaxe()
  if (!ok) {
    bot.chat('Cannot mine without a pickaxe. Stopping.')
    mining = false
    return
  }
  await walkTo(STAND_POS)

  while (mining) {
    if (stopping) break

    // Check pickaxe before every mine attempt
    if (!hasPickaxe()) {
      const ok = await ensurePickaxe()
      if (!ok) { stopping = true; break }
      await walkTo(STAND_POS)
    }

    await mineOneRock()

    // If a full stack of mined stone/cobblestone accumulated, deposit it
    if (rockCount() >= STACK_SIZE) {
      bot.chat(`Inventory has ${rockCount()} mined blocks. Depositing...`)
      await depositToChest()
    }

    await bot.waitForTicks(2) // small tick delay to avoid hammering
  }

  bot.chat('Mining stopped.')
  stopping = false
  mining   = false
}

// ─── CHAT COMMANDS ───────────────────────────────────────────────────────────
bot.on('chat', (username, message) => {
  if (username === bot.username) return  // ignore own messages

  switch (message.trim().toLowerCase()) {

    case '!start':
      if (mining) {
        bot.chat('Already mining!')
      } else {
        mining   = true
        stopping = false
        miningLoop().catch(err => {
          bot.chat(`Error: ${err.message}`)
          mining   = false
          stopping = false
        })
      }
      break

    case '!stop':
      if (!mining) {
        bot.chat('Not mining right now.')
      } else {
        mining = false
        stopping = true
        bot.chat('Stopping and depositing all items...')
        depositAllItemsToChest().catch(err => {
          bot.chat(`Error depositing items: ${err.message}`)
        }).finally(() => {
          stopping = false
        })
      }
      break

    case '!keep':
      if (rockCount() === 0) {
        bot.chat('No mined blocks to deposit.')
      } else {
        const wasMining = mining
        mining = false  // pause loop
        depositToChest().then(() => {
          if (wasMining) {
            mining   = true
            stopping = false
            miningLoop().catch(err => {
              bot.chat(`Error: ${err.message}`)
              mining = false
            })
          }
        })
      }
      break

    case '!status': {
      const pick = bot.inventory.items().find(i => i.name.includes('_pickaxe'))
      const pickInfo = pick ? pick.name : 'none'
      const cobble = bot.inventory.items().filter(i => i.name === COBBLE_ID).reduce((sum, i) => sum + i.count, 0)
      const stone = bot.inventory.items().filter(i => i.name === STONE_ID).reduce((sum, i) => sum + i.count, 0)
      bot.chat(`Mining: ${mining} | Cobblestone: ${cobble} | Stone: ${stone} | Pickaxe: ${pickInfo}`)
      break
    }

    case '!help':
      bot.chat('Commands: !start, !stop, !keep, !status')
      break
  }
})

// ─── LIFECYCLE ────────────────────────────────────────────────────────────────
bot.once('spawn', () => {
  console.log('Bot spawned. Waiting for commands.')
  bot.chat('MinerBot ready! Type !help for commands.')
})

bot.on('error',      err  => console.error('Bot error:', err))
bot.on('end',        ()   => console.log('Bot disconnected.'))
bot.on('kicked',     msg  => console.log('Bot kicked:', msg))