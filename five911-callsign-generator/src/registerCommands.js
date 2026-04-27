require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getDepartmentChoices } = require('./callsigns');

const departments = getDepartmentChoices();

const callsign = new SlashCommandBuilder()
  .setName('callsign')
  .setDescription('Five911 callsign tools')
  .addSubcommand((sub) =>
    sub
      .setName('generate')
      .setDescription('Generate or retrieve your assigned Five911 callsign')
      .addStringOption((opt) =>
        opt.setName('department')
          .setDescription('Department')
          .setRequired(true)
          .addChoices(...departments)
      )
      .addStringOption((opt) =>
        opt.setName('unit_type')
          .setDescription('Unit type. Must match the selected department.')
          .setRequired(true)
          .addChoices(
            { name: 'CPD - Beat / Unit Number', value: 'patrol' },
            { name: 'ISP - District 17', value: 'district17' },
            { name: 'ISP - District 20', value: 'district20' },
            { name: 'Sheriff - Standard Patrol', value: 'patrol' },
            { name: 'Sheriff - Detectives', value: 'detectives' },
            { name: 'Sheriff - Tactical Units', value: 'tactical' },
            { name: 'Sheriff - K9 Units', value: 'k9' },
            { name: 'Sheriff - AIR', value: 'air' },
            { name: 'Sheriff - Sergeants', value: 'sergeant' },
            { name: 'Sheriff - Lieutenant', value: 'lieutenant' },
            { name: 'Sheriff - Higher Command', value: 'command' },
            { name: 'Illinois Game Wardens', value: 'warden' }
          )
      )
  )
  .addSubcommand((sub) => sub.setName('mine').setDescription('View your allocated Five911 callsigns'));

const admin = new SlashCommandBuilder()
  .setName('callsign-admin')
  .setDescription('Admin tools for Five911 callsigns')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub
      .setName('release')
      .setDescription('Release a callsign allocation by dashboard ID')
      .addIntegerOption((opt) => opt.setName('id').setDescription('Allocation ID').setRequired(true))
  );

async function main() {
  const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID'];
  for (const key of required) {
    if (!process.env[key]) throw new Error(`${key} is missing`);
  }

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
    { body: [callsign.toJSON(), admin.toJSON()] }
  );
  console.log('Slash commands registered.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
