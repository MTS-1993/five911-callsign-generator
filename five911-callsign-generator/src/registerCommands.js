require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const callsign = new SlashCommandBuilder()
  .setName('callsign')
  .setDescription('Five911 callsign tools')
  .addSubcommand((sub) =>
    sub
      .setName('generate')
      .setDescription('Generate or retrieve a callsign')
      .addStringOption((opt) => opt.setName('department').setDescription('Department').setRequired(true).setAutocomplete(true))
      .addStringOption((opt) => opt.setName('unit_type').setDescription('Unit type').setRequired(true).setAutocomplete(true))
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
  await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID), { body: [callsign.toJSON(), admin.toJSON()] });
  console.log('Slash commands registered.');
}

main().catch((err) => { console.error(err); process.exit(1); });
