# Five911 Callsign Generator

Render-ready Node.js app with:

- Discord bot slash commands
- PostgreSQL callsign storage
- Admin web dashboard login
- Add, edit and delete callsigns from the dashboard

## Render settings

Root Directory, if your GitHub files are inside the nested folder:

```txt
five911-callsign-generator
```

Build Command:

```txt
npm install && npm run migrate && npm run register-commands
```

Start Command:

```txt
npm start
```

## Required environment variables

```txt
DATABASE_URL=your_render_internal_database_url
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_application_client_id
DISCORD_GUILD_ID=your_discord_server_id
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_secure_password
SESSION_SECRET=a_long_random_secret
```

Optional:

```txt
ADMIN_ROLE_ID=discord_role_allowed_to_use_discord_admin_command
SHOW_DISCORD_ERRORS=false
```

## Admin dashboard

Open your Render URL and log in using `ADMIN_USERNAME` and `ADMIN_PASSWORD`.

From the dashboard you can:

- View all allocations
- Search allocations
- Add manual callsigns
- Edit player/callsign details
- Delete callsigns

## Discord commands

```txt
/callsign cpd
/callsign isp
/callsign sheriff
/callsign gamewarden
/callsign mine
/callsign-admin release
```
