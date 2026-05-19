const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, Events } = require('discord.js');
const {
  allocateCallsign,
  getUserCallsigns,
  friendlyDepartment,
  friendlyUnit,
  deleteAllocation,
  getDepartmentChoices,
  getUnitChoices,
  getDepartmentRequirement,
  getUnitRequirement,
} = require('./callsigns');
const { handleJobsAutocomplete, handleSetJob } = require('./jobs');

function hasAdminAccess(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  const roleId = process.env.ADMIN_ROLE_ID;
  if (!roleId) return false;
  return memberHasRole(interaction, roleId);
}

function memberHasRole(interaction, roleId) {
  const roles = interaction.member?.roles;
  if (!roles) return false;
  if (roles.cache?.has(roleId)) return true;
  if (Array.isArray(roles)) return roles.includes(roleId);
  return false;
}

function memberHasAnyRole(interaction, requiredRoleIds) {
  if (!requiredRoleIds || !requiredRoleIds.length) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  return requiredRoleIds.some((roleId) => memberHasRole(interaction, roleId));
}

function filterChoices(choices, focused) {
  const q = String(focused || '').toLowerCase();
  return choices
    .filter((choice) => choice.name.toLowerCase().includes(q) || choice.value.toLowerCase().includes(q))
    .slice(0, 25);
}

async function handleGenerateCallsign(interaction) {
  const department = interaction.options.getString('department', true);
  const unitType = interaction.options.getString('unit_type', true);
  const requiredDepartmentRoles = await getDepartmentRequirement(department);
  if (!memberHasAnyRole(interaction, requiredDepartmentRoles)) {
    return interaction.reply({ content: 'You do not have the required Discord role to generate a callsign for this department.', ephemeral: true });
  }
  const requiredUnitRoles = await getUnitRequirement(department, unitType);
  if (!memberHasAnyRole(interaction, requiredUnitRoles)) {
    return interaction.reply({ content: 'You do not have the required Discord role to generate a callsign for this subdivision/unit type.', ephemeral: true });
  }
  const { allocation, created } = await allocateCallsign({
    discordUserId: interaction.user.id,
    discordUsername: interaction.user.tag,
    department,
    unitType,
  });

  const embed = new EmbedBuilder()
    .setTitle(created ? 'Five911 Callsign Allocated' : 'Existing Five911 Callsign')
    .setColor(0x1f6feb)
    .addFields(
      { name: 'Department', value: await friendlyDepartment(allocation.department), inline: false },
      { name: 'Unit Type', value: await friendlyUnit(allocation.department, allocation.unit_type), inline: true },
      { name: 'Callsign', value: `**${allocation.callsign}**`, inline: true }
    )
    .setFooter({ text: 'Five911 Callsign System' })
    .setTimestamp();
  return interaction.reply({ embeds: [embed], ephemeral: true });
}

function createBot() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

  client.once(Events.ClientReady, () => {
    console.log(`Discord bot logged in as ${client.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isAutocomplete() && ['callsign', 'generatecallsign'].includes(interaction.commandName)) {
        const focused = interaction.options.getFocused(true);
        if (focused.name === 'department') {
          return interaction.respond(filterChoices(await getDepartmentChoices(), focused.value));
        }
        if (focused.name === 'unit_type') {
          const department = interaction.options.getString('department');
          if (!department) return interaction.respond([]);
          return interaction.respond(filterChoices(await getUnitChoices(department), focused.value));
        }
        return interaction.respond([]);
      }

      if (interaction.isAutocomplete() && interaction.commandName === 'setjob') {
        return handleJobsAutocomplete(interaction);
      }

      if (!interaction.isChatInputCommand()) return;

      if (interaction.commandName === 'setjob') {
        return handleSetJob(client, interaction);
      }

      if (interaction.commandName === 'generatecallsign') {
        return handleGenerateCallsign(interaction);
      }

      if (interaction.commandName === 'callsign') {
        const sub = interaction.options.getSubcommand();

        if (sub === 'mine') {
          const rows = await getUserCallsigns(interaction.user.id);
          if (!rows.length) return interaction.reply({ content: 'You do not have any allocated callsigns yet.', ephemeral: true });
          const lines = [];
          for (const r of rows) {
            lines.push(`**${r.callsign}** — ${await friendlyDepartment(r.department)} / ${await friendlyUnit(r.department, r.unit_type)}`);
          }
          return interaction.reply({ content: lines.join('\n'), ephemeral: true });
        }

        if (sub === 'generate') {
          return handleGenerateCallsign(interaction);
        }
      }

      if (interaction.commandName === 'callsign-admin') {
        if (!hasAdminAccess(interaction)) return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        const sub = interaction.options.getSubcommand();
        if (sub === 'release') {
          const id = interaction.options.getInteger('id', true);
          const deleted = await deleteAllocation(id);
          if (!deleted) return interaction.reply({ content: 'No callsign allocation found with that ID.', ephemeral: true });
          return interaction.reply({ content: `Released callsign **${deleted.callsign}**.`, ephemeral: true });
        }
      }
    } catch (err) {
      console.error(err);
      const safeDetail = process.env.SHOW_DISCORD_ERRORS === 'true' ? `\n\`${err.message}\`` : '';
      const message = `Something went wrong while handling that callsign request.${safeDetail}`;
      if (interaction.deferred || interaction.replied) return interaction.followUp({ content: message, ephemeral: true });
      if (interaction.isAutocomplete()) return interaction.respond([]).catch(() => {});
      return interaction.reply({ content: message, ephemeral: true });
    }
  });

  return client;
}

async function startBot() {
  if (!process.env.DISCORD_TOKEN) {
    console.warn('DISCORD_TOKEN not set. Bot not started.');
    return null;
  }
  const client = createBot();
  await client.login(process.env.DISCORD_TOKEN);
  return client;
}

module.exports = { startBot };
