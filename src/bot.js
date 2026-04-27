const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, Events } = require('discord.js');
const {
  allocateCallsign,
  getUserCallsigns,
  friendlyDepartment,
  friendlyUnit,
  deleteAllocation,
} = require('./callsigns');

function hasAdminAccess(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  const roleId = process.env.ADMIN_ROLE_ID;
  if (!roleId) return false;
  return interaction.member?.roles?.cache?.has(roleId);
}

function getAllocationFromSubcommand(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'cpd') {
    return { department: 'CPD', unitType: 'patrol' };
  }

  if (sub === 'isp') {
    return { department: 'ISP', unitType: interaction.options.getString('district', true) };
  }

  if (sub === 'sheriff') {
    return { department: 'CSD', unitType: interaction.options.getString('unit', true) };
  }

  if (sub === 'gamewarden') {
    return { department: 'IGW', unitType: 'warden' };
  }

  return null;
}

function createBot() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, () => {
    console.log(`Discord bot logged in as ${client.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    try {
      if (interaction.commandName === 'callsign') {
        const sub = interaction.options.getSubcommand();

        if (sub === 'mine') {
          const rows = await getUserCallsigns(interaction.user.id);
          if (!rows.length) {
            return interaction.reply({ content: 'You do not have any allocated callsigns yet.', ephemeral: true });
          }

          const text = rows
            .map((r) => `**${r.callsign}** — ${friendlyDepartment(r.department)} / ${friendlyUnit(r.department, r.unit_type)}`)
            .join('\n');

          return interaction.reply({ content: text, ephemeral: true });
        }

        const chosen = getAllocationFromSubcommand(interaction);
        if (!chosen) {
          return interaction.reply({ content: 'Unknown callsign option.', ephemeral: true });
        }

        const { allocation, created } = await allocateCallsign({
          discordUserId: interaction.user.id,
          discordUsername: interaction.user.tag,
          department: chosen.department,
          unitType: chosen.unitType,
        });

        const embed = new EmbedBuilder()
          .setTitle(created ? 'Five911 Callsign Allocated' : 'Existing Five911 Callsign')
          .setColor(0x1f6feb)
          .addFields(
            { name: 'Department', value: friendlyDepartment(allocation.department), inline: false },
            { name: 'Unit Type', value: friendlyUnit(allocation.department, allocation.unit_type), inline: true },
            { name: 'Callsign', value: `**${allocation.callsign}**`, inline: true }
          )
          .setFooter({ text: 'Five911 Callsign System' })
          .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (interaction.commandName === 'callsign-admin') {
        if (!hasAdminAccess(interaction)) {
          return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

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
