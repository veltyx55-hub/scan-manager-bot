# ScanBot — Discord Bot (Node.js)

A Discord bot for manga/scan team auction and assignment management. Fully migrated from Python (`discord.py` + `asyncpg`) to Node.js (`discord.js` v14 + `pg`).

## Features

- `/auction` — Create a new chapter auction in the appropriate channel
- `/ktldone`, `/etldone`, `/tsdone` — Mark chapters as done (multi-select)
- `/unclaim` — Release a claimed chapter (with reason modal)
- `/sync` — Force re-sync slash commands (owner only)
- **Claim buttons** — Persistent role-gated claim buttons on auction messages
- **Deadline checker** — Runs every 5 minutes; sends tiered reminders and re-auctions expired chapters
- **PostgreSQL** — Full persistence via `pg` (same schema as the Python version)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create `.env` from the example

```bash
cp .env.example .env
```

Fill in:
```
TOKEN=your_discord_bot_token
DATABASE_URL=postgresql://user:password@host:5432/dbname
```

### 3. Run the bot

```bash
npm start
```

## Project Structure

```
discord-bot/
├── index.js                   # Main entry — client, event routing
├── config.js                  # All IDs, rates, deadlines, constants
├── package.json
├── .env.example
├── commands/
│   ├── auction.js             # /auction
│   ├── done.js                # /ktldone, /etldone, /tsdone + executeMarkDone
│   ├── unclaim.js             # /unclaim + modal
│   └── sync.js                # /sync (owner only)
├── components/
│   └── claimButton.js         # claim_KTL / claim_ETL / claim_TS button handler
├── database/
│   └── db.js                  # pg Pool, initDb (creates/migrates tables)
├── scheduler/
│   └── deadlineCheck.js       # 5-min loop: reminders + expired re-auction
└── utils/
    ├── helpers.js             # Pure helpers (effectiveRate, parseDeadline, etc.)
    ├── embeds.js              # buildEmbed() — auction embed builder
    ├── refreshAuction.js      # refreshAuctionMessage() — edit auction message
    └── registerCommands.js    # Register/sync guild slash commands via REST
```

## Python → Node.js Migration Map

| Python | Node.js |
|--------|---------|
| `discord.py` | `discord.js` v14 |
| `asyncpg` | `pg` (node-postgres) |
| `discord.ext.tasks` loop | `setInterval` (5 min) |
| `discord.ui.Button` | `ButtonBuilder` + `interaction.isButton()` |
| `discord.ui.Select` | `StringSelectMenuBuilder` + `awaitMessageComponent` |
| `discord.ui.Modal` | `ModalBuilder` + `awaitModalSubmit` |
| `app_commands.CommandTree` | `REST` + `Routes.applicationGuildCommands` |
| `asyncpg.Pool` | `pg.Pool` |
| `asyncpg` `$1` params | `pg` `$1` params (identical) |

## Manual Testing Checklist

- [ ] `/auction ktl:50,51 etl:50 urgent:true` — creates embed in TL channel with Claim buttons
- [ ] Click **Claim KTL** — checks role, max-active limit, assigns chapter, pings project channel
- [ ] `/ktldone` — dropdown shows your claimed chapters; selecting marks done and pings uploader/admin
- [ ] `/unclaim` — dropdown then modal; reason posted to project channel
- [ ] `/sync` — only works for the owner ID configured in `config.js`
- [ ] Deadline check — claim a chapter then manually set `deadline_at` to a past time in the DB to verify the expiry + reauction logic

## Notes

- The bot registers commands as **guild commands** on startup (instant, no propagation delay), same as the Python version.
- `claim_*` buttons are handled globally via `interactionCreate` — no timeout, fully persistent across restarts.
- The `OWNER_ID` in `config.js` bypasses guild restriction for all commands, matching the Python behavior.
