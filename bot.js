const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { GoalNear } = goals
const Vec3 = require('vec3')

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const COBBLE_POS        = new Vec3(26, 63, -10)   // cobblestone generator block
const STAND_POS         = new Vec3(26, 63, -9)   // bot stands here to mine
const CHEST_POS         = new Vec3(28, 64, -10)  // cobblestone chest
const PICKAXE_CHEST_POS = new Vec3(28, 64, -10)  // pickaxe chest (change if different)
const COBBLE_ID         = 'cobblestone'
const STACK_SIZE        = 64

const bot = mineflayer.createBot({
  host: '143.244.130.94',   // change to your server IP
  port: 6945,         // change if needed
  username: 'MinerBot',
  version: '1.20.6'
})

bot.loadPlugin(pathfinder)

// ─── STATE ────────────────────────────────────────────────────────────────────
let mining   = false   // is the bot in mining loop?
let stopping = false   // stop requested mid-loop?

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/** Count cobblestone in inventory */
function cobbleCount() {
  return bot.inventory.items()
    .filter(i => i.name === COBBLE_ID)
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
  const mcData = require('minecraft-data')(bot.version)
  const movements = new Movements(bot, mcData)
  movements.canDig = false
  bot.pathfinder.setMovements(movements)
  await bot.pathfinder.goto(new GoalNear(vec3.x, vec3.y, vec3.z, radius))
}

/** Mine ONLY the block at the fixed cobblestone position */
async function mineOneCobble() {
  const block = bot.blockAt(COBBLE_POS)
  if (!block || block.name !== COBBLE_ID) {
    // Wait for generator to produce cobblestone
    await bot.waitForTicks(10)
    return
  }
  await bot.dig(block)
}

/** Deposit all cobblestone into chest */
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
    if (item.name === COBBLE_ID) {
      try {
        await chest.deposit(item.type, null, item.count)
      } catch (e) {
        bot.chat('Chest might be full!')
        break
      }
    }
  }

  chest.close()
  bot.chat('Deposited cobblestone. Returning to mining spot...')
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

    await mineOneCobble()

    // If a full stack accumulated, deposit it
    if (cobbleCount() >= STACK_SIZE) {
      bot.chat(`Inventory has ${cobbleCount()} cobblestone. Depositing...`)
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
      if (cobbleCount() === 0) {
        bot.chat('No cobblestone to deposit.')
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
      bot.chat(`Mining: ${mining} | Cobblestone: ${cobbleCount()} | Pickaxe: ${pickInfo}`)
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