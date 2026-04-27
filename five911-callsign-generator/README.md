# Five911 Callsign Generator

A Render-ready Node.js app with:

- Web dashboard
- Postgres storage
- Discord bot slash commands
- Player callsigns remembered against Discord user IDs

## Callsign formats

- Chicago Police Department: `07###`
- Illinois State Trooper: `17###` or `20###`
- Chicago Sheriffs Department:
  - Standard Patrol: `G###`
  - Detectives: `H###`
  - Tactical: `TAC###`
  - K9: `K9###`
  - AIR: `###`
  - Sergeants: `D###`
  - Lieutenant: `L###`
  - Higher Command: `K###`
- Illinois Game Wardens: `WARDEN###`

## Local setup

```bash
npm install
cp .env.example .env
npm run migrate
npm run register-commands
npm start
```

## Render setup

1. Create a Render PostgreSQL database.
2. Create a Render Web Service from this folder/repo.
3. Set Build Command: `npm install && npm run migrate && npm run register-commands`
4. Set Start Command: `npm start`
5. Add environment variables:
   - `DATABASE_URL`
   - `DISCORD_TOKEN`
   - `DISCORD_CLIENT_ID`
   - `DISCORD_GUILD_ID`
   - `DASHBOARD_KEY`
   - optional `ADMIN_ROLE_ID`

## Discord commands

- `/callsign generate department unit_type`
- `/callsign mine`
- `/callsign-admin release id`

Note: Discord slash command options cannot dynamically change their choices based on another option in the same command. This app validates the selected department/unit pairing and rejects incorrect combinations.
