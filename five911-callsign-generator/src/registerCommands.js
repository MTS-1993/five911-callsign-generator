require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const callsign = new SlashCommandBuilder()
  .setName('callsign')
  .setDescription('Five911 callsign tools')
  .addSubcommand((sub) =>
    sub
      .setName('cpd')
      .setDescription('Generate or retrieve your Chicago Police Department callsign')
  )
  .addSubcommand((sub) =>
    sub
      .setName('isp')
      .setDescription('Generate or retrieve your Illinois State Trooper callsign')
      .addStringOption((opt) =>
        opt
          .setName('district')
          .setDescription('Illinois State Police district')
          .setRequired(true)
          .addChoices(
            { name: 'District 17', value: 'district17' },
            { name: 'District 20', value: 'district20' }
          )
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('sheriff')
      .setDescription('Generate or retrieve your Chicago Sheriffs Department callsign')
      .addStringOption((opt) =>
        opt
          .setName('unit')
          .setDescription('Sheriff unit type')
          .setRequired(true)
          .addChoices(
            { name: 'Standard Patrol', value: 'patrol' },
            { name: 'Detectives', value: 'detectives' },
            { name: 'Tactical Units', value: 'tactical' },
            { name: 'K9 Units', value: 'k9' },
            { name: 'AIR', value: 'air' },
            { name: 'Sergeants', value: 'sergeant' },
            { name: 'Lieutenant', value: 'lieutenant' },
            { name: 'Higher Command', value: 'command' }
          )
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('gamewarden')
      .setDescription('Generate or retrieve your Illinois Game Wardens callsign')
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
