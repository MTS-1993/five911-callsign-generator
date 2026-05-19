const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');

const jobsCommand = new SlashCommandBuilder()
  .setName('setjob')
  .setDescription('Set an online or offline player job in Five911/QBCore.')
  .addStringOption((option) =>
    option
      .setName('player')
      .setDescription('Online player or citizenid')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption((option) =>
    option
      .setName('job')
      .setDescription('QBCore job')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addIntegerOption((option) =>
    option
      .setName('grade')
      .setDescription('Job grade/rank')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption((option) =>
    option
      .setName('reason')
      .setDescription('Audit reason')
      .setMaxLength(180)
      .setRequired(false)
  );

let jobsCache = { expires: 0, rows: [] };
let playersCache = { expires: 0, rows: [] };

function getJobsConfig() {
  return {
    bridgeUrl: (process.env.FIVEM_BRIDGE_URL || '').replace(/\/+$/, ''),
    bridgeToken: process.env.FIVEM_BRIDGE_TOKEN,
    jobLogChannelId: process.env.JOB_LOG_CHANNEL_ID,
    allowedRoleIds: (process.env.ALLOWED_ROLE_IDS || '')
      .split(',')
      .map((role) => role.trim())
      .filter(Boolean),
  };
}

function assertJobsConfig() {
  const config = getJobsConfig();
  const missing = [];
  if (!config.bridgeUrl) missing.push('FIVEM_BRIDGE_URL');
  if (!config.bridgeToken) missing.push('FIVEM_BRIDGE_TOKEN');
  if (missing.length) throw new Error(`Missing required env values: ${missing.join(', ')}`);
  return config;
}

function memberHasRole(interaction, roleId) {
  const roles = interaction.member?.roles;
  if (!roles) return false;
  if (roles.cache?.has(roleId)) return true;
  if (Array.isArray(roles)) return roles.includes(roleId);
  return false;
}

function hasAllowedRole(interaction) {
  const config = getJobsConfig();
  if (!config.allowedRoleIds.length) return true;
  return config.allowedRoleIds.some((roleId) => memberHasRole(interaction, roleId));
}

async function bridgeFetch(path, options = {}) {
  const config = assertJobsConfig();
  const response = await fetch(`${config.bridgeUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.bridgeToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || payload.error || `FiveM bridge failed: ${response.status}`);
  }
  return payload;
}

async function getJobs(force = false) {
  const now = Date.now();
  if (!force && jobsCache.expires > now) return jobsCache.rows;

  const payload = await bridgeFetch('/discord/jobs');
  jobsCache = {
    expires: now + 5 * 60 * 1000,
    rows: payload.jobs || [],
  };
  return jobsCache.rows;
}

async function getPlayers(force = false) {
  const now = Date.now();
  if (!force && playersCache.expires > now) return playersCache.rows;

  const payload = await bridgeFetch('/discord/players');
  playersCache = {
    expires: now + 15 * 1000,
    rows: payload.players || [],
  };
  return playersCache.rows;
}

async function setJob({ target, job, grade, actor, reason }) {
  return bridgeFetch('/discord/setjob', {
    method: 'POST',
    body: JSON.stringify({ target, job, grade, actor, reason }),
  });
}

function searchRows(rows, query, formatter) {
  const lowered = String(query || '').toLowerCase();
  return rows
    .filter((row) => formatter(row).toLowerCase().includes(lowered))
    .slice(0, 25);
}

function actorName(interaction) {
  return `${interaction.user.tag} (${interaction.user.id})`;
}

async function getJobDisplay(jobName, gradeLevel) {
  const jobs = await getJobs();
  const job = jobs.find((row) => row.name === jobName);
  const grade = job?.grades?.find((row) => Number(row.grade) === Number(gradeLevel));
  return {
    text: `${job?.label || jobName} - ${grade?.label || `Grade ${gradeLevel}`}`,
  };
}

async function getTargetDisplay(target) {
  const players = await getPlayers().catch(() => []);
  const player = players.find((row) =>
    String(row.source) === String(target) || String(row.citizenid).toLowerCase() === String(target).toLowerCase()
  );

  if (!player) {
    return {
      display: String(target),
      detail: 'Offline/manual citizenid or source',
    };
  }

  return {
    display: `${player.name} (#${player.source})`,
    detail: `Citizen ID: ${player.citizenid}`,
  };
}

async function sendJobLog(client, interaction, details) {
  const config = getJobsConfig();
  if (!config.jobLogChannelId) return;

  const channel = await client.channels.fetch(config.jobLogChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(0x635bff)
    .setTitle('Five911 Job Role Changed')
    .setDescription('A Discord admin command changed a player job/rank.')
    .addFields(
      { name: 'Command Ran By', value: `${interaction.user} (${interaction.user.tag})\nID: ${interaction.user.id}`, inline: false },
      { name: 'Player Changed', value: `${details.targetDisplay}\n${details.targetDetail}`, inline: false },
      { name: 'New Job & Rank', value: details.jobDisplay, inline: false },
      { name: 'Reason', value: details.reason || 'No reason provided.', inline: false }
    )
    .setTimestamp();

  if (details.bridgeMessage) {
    embed.addFields({ name: 'FiveM Result', value: details.bridgeMessage.slice(0, 1024), inline: false });
  }

  await channel.send({ embeds: [embed] }).catch((error) => {
    console.error(`Could not send job log to channel ${config.jobLogChannelId}:`, error.message);
  });
}

async function handleJobsAutocomplete(interaction) {
  const focused = interaction.options.getFocused(true);

  if (focused.name === 'job') {
    const jobs = await getJobs();
    const rows = searchRows(jobs, focused.value, (job) => `${job.label} ${job.name}`);
    await interaction.respond(rows.map((job) => ({
      name: `${job.label} (${job.name})`.slice(0, 100),
      value: job.name,
    })));
    return;
  }

  if (focused.name === 'grade') {
    const selectedJob = interaction.options.getString('job');
    const jobs = await getJobs();
    const job = jobs.find((row) => row.name === selectedJob);
    const grades = searchRows(job?.grades || [], focused.value, (grade) => `${grade.label} ${grade.grade}`);
    await interaction.respond(grades.map((grade) => ({
      name: `${grade.grade} | ${grade.label}`.slice(0, 100),
      value: Number(grade.grade),
    })));
    return;
  }

  if (focused.name === 'player') {
    const typed = String(focused.value || '').trim();
    const players = await getPlayers();
    const rows = searchRows(players, focused.value, (player) =>
      `${player.name} ${player.serverName} ${player.citizenid} ${player.source}`
    );
    const choices = rows.map((player) => ({
      name: `#${player.source} ${player.name} | ${player.citizenid}`.slice(0, 100),
      value: String(player.source),
    }));

    if (typed && !choices.some((choice) => choice.value === typed)) {
      choices.unshift({
        name: `Use typed citizenid/source: ${typed}`.slice(0, 100),
        value: typed,
      });
    }

    await interaction.respond(choices.slice(0, 25));
  }
}

async function handleSetJob(client, interaction) {
  if (!hasAllowedRole(interaction)) {
    await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    return;
  }

  const target = interaction.options.getString('player', true);
  const job = interaction.options.getString('job', true);
  const grade = interaction.options.getInteger('grade', true);
  const reason = interaction.options.getString('reason') || 'Discord command';

  await interaction.deferReply({ ephemeral: true });

  try {
    const display = await getJobDisplay(job, grade);
    const targetDisplay = await getTargetDisplay(target);
    const result = await setJob({
      target,
      job,
      grade,
      actor: actorName(interaction),
      reason,
    });
    await sendJobLog(client, interaction, {
      target,
      targetDisplay: targetDisplay.display,
      targetDetail: targetDisplay.detail,
      jobDisplay: display.text,
      reason,
      bridgeMessage: result.message,
    });
    await interaction.editReply(`Player job updated to **${display.text}**.`);
  } catch (error) {
    await interaction.editReply(`Could not set job: ${error.message}`);
  }
}

module.exports = {
  jobsCommand,
  handleJobsAutocomplete,
  handleSetJob,
};
