require('dotenv').config();
const {
  Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes,
  ActivityType
} = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');

// --- Keep-alive endpoint for Render ---
const express = require('express');
const app = express();

app.get('/', (req, res) => res.send('Bot is running!'));

const PORT = process.env.PORT || 3020;
app.listen(PORT, () => console.log(`🌐 Web server live on port ${PORT}`));

// ─── ENV ──────────────────────────────────────────────────────────────────────

const DISCORD_TOKEN  = process.env.DISCORD_TOKEN;
const CLIENT_ID      = process.env.CLIENT_ID;
const GUILD_ID       = process.env.GUILD_ID;
const ROBLOX_COOKIE  = process.env.ROBLOX_COOKIE;
const GROUP_ID       = process.env.GROUP_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const ALLOWED_ROLES  = process.env.ALLOWED_ROLES
  ? process.env.ALLOWED_ROLES.split(',').map(r => r.trim())
  : [];

const FOOTER_ICON = 'https://cdn.discordapp.com/attachments/1473143652371927209/1473181303389290569/image.png?ex=6995ef41&is=69949dc1&hm=7bfda4ad5d3c84d2ae2bbf84f7a48c1174e0d09952cea66e0dd411e215e30c88&';
const THUMBNAIL   = FOOTER_ICON;
const BOT_START   = Date.now();

// ─── STORAGE ──────────────────────────────────────────────────────────────────

const DATA_DIR        = path.join(__dirname, 'data');
const LOGS_FILE       = path.join(DATA_DIR, 'ranklogs.json');
const VERIFIED_FILE   = path.join(DATA_DIR, 'verified.json');
const NOTES_FILE      = path.join(DATA_DIR, 'notes.json');
const WARNINGS_FILE   = path.join(DATA_DIR, 'warnings.json');
const BLACKLIST_FILE  = path.join(DATA_DIR, 'blacklist.json');
const WATCHLIST_FILE  = path.join(DATA_DIR, 'watchlist.json');
const APPEALS_FILE    = path.join(DATA_DIR, 'appeals.json');
const SCHEDULES_FILE  = path.join(DATA_DIR, 'schedules.json');
const AUDITLOG_FILE   = path.join(DATA_DIR, 'auditlog.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
const initFile = (f, d) => { if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify(d)); };
initFile(LOGS_FILE,      []);
initFile(VERIFIED_FILE,  {});
initFile(NOTES_FILE,     {});
initFile(WARNINGS_FILE,  {});
initFile(BLACKLIST_FILE, []);
initFile(WATCHLIST_FILE, []);
initFile(APPEALS_FILE,   []);
initFile(SCHEDULES_FILE, []);
initFile(AUDITLOG_FILE,  []);

const readJSON  = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJSON = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

function pushLog(entry) {
  const logs = readJSON(LOGS_FILE);
  logs.unshift(entry);
  if (logs.length > 1000) logs.length = 1000;
  writeJSON(LOGS_FILE, logs);
}

function pushAudit(action, staffTag, staffId, details) {
  const audit = readJSON(AUDITLOG_FILE);
  audit.unshift({ timestamp: new Date().toISOString(), action, staffTag, staffId, details });
  if (audit.length > 500) audit.length = 500;
  writeJSON(AUDITLOG_FILE, audit);
}

// ─── CLIENT ───────────────────────────────────────────────────────────────────

const client = new Client({ intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildModeration,
  GatewayIntentBits.GuildInvites,
  GatewayIntentBits.GuildEmojisAndStickers,
] });

client.on('error', err => console.error('Discord client error:', err));
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));

// ─── ROBLOX API ───────────────────────────────────────────────────────────────

async function getRobloxUserByUsername(username) {
  const res = await axios.post('https://users.roblox.com/v1/usernames/users', {
    usernames: [username], excludeBannedUsers: false
  });
  const user = res.data.data[0];
  if (!user) throw new Error(`User "${username}" not found on Roblox.`);
  return user;
}

async function getRobloxUserById(userId) {
  const res = await axios.get(`https://users.roblox.com/v1/users/${userId}`);
  return res.data;
}

async function getGroupRoles() {
  const res = await axios.get(`https://groups.roblox.com/v1/groups/${GROUP_ID}/roles`);
  return res.data.roles;
}

async function getGroupInfo() {
  const res = await axios.get(`https://groups.roblox.com/v1/groups/${GROUP_ID}`);
  return res.data;
}

async function getUserGroupRole(userId) {
  const res = await axios.get(`https://groups.roblox.com/v2/users/${userId}/groups/roles`);
  const m = res.data.data.find(g => g.group.id === parseInt(GROUP_ID));
  return m ? m.role : null;
}

async function getCsrfToken() {
  try {
    await axios.post('https://auth.roblox.com/v2/logout', {}, {
      headers: { Cookie: `.ROBLOSECURITY=${ROBLOX_COOKIE}` }
    });
  } catch (err) {
    if (err.response?.headers['x-csrf-token']) return err.response.headers['x-csrf-token'];
    throw new Error('Failed to get CSRF token.');
  }
}

async function setGroupRank(userId, roleId) {
  await axios.patch(
    `https://groups.roblox.com/v1/groups/${GROUP_ID}/users/${userId}`,
    { roleId },
    { headers: { Cookie: `.ROBLOSECURITY=${ROBLOX_COOKIE}`, 'X-CSRF-TOKEN': await getCsrfToken() } }
  );
}

async function getRobloxAvatar(userId) {
  try {
    const res = await axios.get(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png`
    );
    return res.data.data[0]?.imageUrl || null;
  } catch { return null; }
}

async function checkGamePass(userId, gamePassId) {
  const res = await axios.get(
    `https://inventory.roblox.com/v1/users/${userId}/items/GamePass/${gamePassId}`
  );
  return res.data.data && res.data.data.length > 0;
}

async function getRobloxFriendCount(userId) {
  try {
    const res = await axios.get(`https://friends.roblox.com/v1/users/${userId}/friends/count`);
    return res.data.count;
  } catch { return 'N/A'; }
}

async function kickFromGroup(userId) {
  await axios.delete(
    `https://groups.roblox.com/v1/groups/${GROUP_ID}/users/${userId}`,
    { headers: { Cookie: `.ROBLOSECURITY=${ROBLOX_COOKIE}`, 'X-CSRF-TOKEN': await getCsrfToken() } }
  );
}

async function postGroupShout(message) {
  await axios.patch(
    `https://groups.roblox.com/v1/groups/${GROUP_ID}/status`,
    { message },
    { headers: { Cookie: `.ROBLOSECURITY=${ROBLOX_COOKIE}`, 'X-CSRF-TOKEN': await getCsrfToken() } }
  );
}

async function getUserBadges(userId) {
  try {
    const res = await axios.get(`https://badges.roblox.com/v1/users/${userId}/badges?limit=10&sortOrder=Desc`);
    return res.data.data || [];
  } catch { return []; }
}

async function getRobloxGroups(userId) {
  try {
    const res = await axios.get(`https://groups.roblox.com/v2/users/${userId}/groups/roles`);
    return res.data.data || [];
  } catch { return []; }
}

async function getUserFollowerCount(userId) {
  try {
    const res = await axios.get(`https://friends.roblox.com/v1/users/${userId}/followers/count`);
    return res.data.count;
  } catch { return 'N/A'; }
}

async function getUserFollowingCount(userId) {
  try {
    const res = await axios.get(`https://friends.roblox.com/v1/users/${userId}/followings/count`);
    return res.data.count;
  } catch { return 'N/A'; }
}

async function getRobloxGameInfo(gameId) {
  const res = await axios.get(`https://games.roblox.com/v1/games?universeIds=${gameId}`);
  return res.data.data?.[0] || null;
}

async function getRankingAccountInfo() {
  try {
    const res = await axios.get('https://users.roblox.com/v1/users/authenticated', {
      headers: { Cookie: `.ROBLOSECURITY=${ROBLOX_COOKIE}` }
    });
    return res.data;
  } catch { return null; }
}

async function getGroupAuditLog() {
  try {
    const res = await axios.get(
      `https://groups.roblox.com/v1/groups/${GROUP_ID}/audit-log?actionType=ChangeRank&limit=10`,
      { headers: { Cookie: `.ROBLOSECURITY=${ROBLOX_COOKIE}` } }
    );
    return res.data.data || [];
  } catch { return []; }
}

function baseEmbed() {
  return new EmbedBuilder()
    .setColor(0x111111)
    .setThumbnail(THUMBNAIL)
    .setImage('https://cdn.discordapp.com/attachments/1473143652371927209/1473183844864757801/simplyFresh_3.png?ex=69969a5f&is=699548df&hm=50ff670270d83eb0bd98bf47299b7a1733820361d5573939861f418e3bf6030f&')
    .setTimestamp()
    .setFooter({ text: 'Rank System', iconURL: FOOTER_ICON });
}

// ─── EMBED HELPERS ────────────────────────────────────────────────────────────

function baseEmbed() {
  return new EmbedBuilder()
    .setColor(0x111111)
    .setThumbnail(THUMBNAIL)
    .setTimestamp()
    .setFooter({ text: 'Rank System', iconURL: FOOTER_ICON });
}

function errorEmbed(description) {
  return new EmbedBuilder()
    .setColor(0x222222)
    .setThumbnail(THUMBNAIL)
    .setDescription(`✗ ${description}`)
    .setTimestamp()
    .setFooter({ text: 'Rank System', iconURL: FOOTER_ICON });
}

function hasPermission(member) {
  if (!ALLOWED_ROLES || ALLOWED_ROLES.length === 0) return true;
  return member.roles.cache.some(r => ALLOWED_ROLES.includes(r.id));
}

async function sendLogToChannel(embed) {
  if (!LOG_CHANNEL_ID) return;
  try {
    const ch = await client.channels.fetch(LOG_CHANNEL_ID);
    if (ch) await ch.send({ embeds: [embed] });
  } catch { }
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// ─── COMMANDS ─────────────────────────────────────────────────────────────────

const commands = [
  // ── BOT COMMANDS ──────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('bot-status')
    .setDescription('Check the bot\'s status, uptime, and system health.'),

  new SlashCommandBuilder()
    .setName('bot-info')
    .setDescription('Info about this bot and who made it.'),

  new SlashCommandBuilder()
    .setName('status-change')
    .setDescription('Change what the bot is watching/playing.')
    .addStringOption(o => o.setName('message').setDescription('New status message').setRequired(true))
    .addStringOption(o => o.setName('type').setDescription('Activity type').setRequired(false)
      .addChoices(
        { name: 'Watching', value: 'watching' },
        { name: 'Playing', value: 'playing' },
        { name: 'Listening', value: 'listening' },
        { name: 'Competing', value: 'competing' }
      )),

  // ── RANK COMMANDS ─────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('changerank')
    .setDescription('Change a Roblox user\'s rank in the group.')
    .addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true))
    .addStringOption(o => o.setName('rank').setDescription('New rank name').setRequired(true)),

  new SlashCommandBuilder()
    .setName('massrank')
    .setDescription('Change multiple users to the same rank (comma-separated, max 20).')
    .addStringOption(o => o.setName('usernames').setDescription('Comma-separated Roblox usernames').setRequired(true))
    .addStringOption(o => o.setName('rank').setDescription('New rank name').setRequired(true)),

  new SlashCommandBuilder()
    .setName('checkrank')
    .setDescription('Check a Roblox user\'s current rank.')
    .addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true)),

  new SlashCommandBuilder()
    .setName('ranklist')
    .setDescription('List all ranks in the group with rank numbers and member counts.'),

  new SlashCommandBuilder()
    .setName('rankinfo')
    .setDescription('Show info about a specific rank.')
    .addStringOption(o => o.setName('rank').setDescription('Rank name').setRequired(true)),

  new SlashCommandBuilder()
    .setName('rankcount')
    .setDescription('See how many members are in each rank, sorted by size.'),

  new SlashCommandBuilder()
    .setName('topranked')
    .setDescription('Show the top 10 highest ranked members in the group.'),

  new SlashCommandBuilder()
    .setName('recentranks')
    .setDescription('Show the 10 most recent rank changes from the group audit log.'),

  new SlashCommandBuilder()
    .setName('schedulerank')
    .setDescription('Schedule a rank change for a future time.')
    .addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true))
    .addStringOption(o => o.setName('rank').setDescription('New rank name').setRequired(true))
    .addIntegerOption(o => o.setName('minutes').setDescription('Minutes from now to apply rank').setRequired(true)),

  new SlashCommandBuilder()
    .setName('schedules')
    .setDescription('View all pending scheduled rank changes.'),

  new SlashCommandBuilder()
    .setName('cancelschedule')
    .setDescription('Cancel a scheduled rank change.')
    .addStringOption(o => o.setName('id').setDescription('Schedule ID').setRequired(true)),

  // ── LOG COMMANDS ──────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('ranklog')
    .setDescription('View rank change history.')
    .addIntegerOption(o => o.setName('page').setDescription('Page number').setRequired(false)),

  new SlashCommandBuilder()
    .setName('stafflog')
    .setDescription('View rank actions performed by a specific staff member.')
    .addUserOption(o => o.setName('staff').setDescription('Staff Discord user').setRequired(true))
    .addIntegerOption(o => o.setName('page').setDescription('Page number').setRequired(false)),

  new SlashCommandBuilder()
    .setName('userlog')
    .setDescription('View all rank changes for a specific Roblox user.')
    .addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true))
    .addIntegerOption(o => o.setName('page').setDescription('Page number').setRequired(false)),

  new SlashCommandBuilder()
    .setName('logstats')
    .setDescription('View ranking statistics from the log history.'),

  new SlashCommandBuilder()
    .setName('auditlog')
    .setDescription('View internal bot audit log (all staff actions).')
    .addIntegerOption(o => o.setName('page').setDescription('Page number').setRequired(false)),

  new SlashCommandBuilder()
    .setName('clearlog')
    .setDescription('Clear the entire rank log history (owner only).'),

  // ── USER COMMANDS ─────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Full Roblox profile of a user.')
    .addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true)),

  new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Link your Discord account to your Roblox account.')
    .addStringOption(o => o.setName('username').setDescription('Your Roblox username').setRequired(true)),

  new SlashCommandBuilder()
    .setName('unverify')
    .setDescription('Unlink your Discord from your Roblox account.'),

  new SlashCommandBuilder()
    .setName('whois')
    .setDescription('Look up a verified user\'s Roblox info.')
    .addUserOption(o => o.setName('user').setDescription('Discord user').setRequired(true)),

  new SlashCommandBuilder()
    .setName('whoverified')
    .setDescription('Check which Discord account a Roblox username is linked to.')
    .addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true)),

  new SlashCommandBuilder()
    .setName('sync')
    .setDescription('Sync a verified user\'s Discord roles to their Roblox rank.')
    .addUserOption(o => o.setName('user').setDescription('Discord user').setRequired(true)),

  new SlashCommandBuilder()
    .setName('checkinventory')
    .setDescription('Check if a user owns a specific asset (badge, gamepass).')
    .addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true))
    .addStringOption(o => o.setName('type').setDescription('Asset type').setRequired(true)
      .addChoices(
        { name: 'Game Pass', value: 'GamePass' },
        { name: 'Badge', value: 'Badge' }
      ))
    .addStringOption(o => o.setName('assetid').setDescription('Asset ID').setRequired(true)),

  new SlashCommandBuilder()
    .setName('badges')
    .setDescription('Show recent badges a Roblox user has earned.')
    .addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true)),

  new SlashCommandBuilder()
    .setName('groups')
    .setDescription('Show all Roblox groups a user is in.')
    .addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true)),

  new SlashCommandBuilder()
    .setName('gameinfo')
    .setDescription('Get info about a Roblox game by Universe ID.')
    .addStringOption(o => o.setName('universeid').setDescription('Roblox Universe ID').setRequired(true)),

  new SlashCommandBuilder()
    .setName('rankingaccount')
    .setDescription('Check the ranking bot\'s Roblox account status.'),

  new SlashCommandBuilder()
  .setName('webhook')
  .setDescription('Send an embed with optional buttons via a webhook.')
  .addStringOption(o => o.setName('webhook-url').setDescription('The webhook URL').setRequired(true))
  .addStringOption(o => o.setName('message').setDescription('The embed description').setRequired(true))
  .addStringOption(o => o.setName('title').setDescription('Embed title').setRequired(false))
  .addStringOption(o => o.setName('image-url').setDescription('Image URL for the embed').setRequired(false))
  .addStringOption(o => o.setName('color').setDescription('Hex color e.g. #ff0000').setRequired(false))
  .addStringOption(o => o.setName('button1-label').setDescription('Button 1 label').setRequired(false))
  .addStringOption(o => o.setName('button1-url').setDescription('Button 1 URL').setRequired(false))
  .addStringOption(o => o.setName('button2-label').setDescription('Button 2 label').setRequired(false))
  .addStringOption(o => o.setName('button2-url').setDescription('Button 2 URL').setRequired(false))
  .addStringOption(o => o.setName('button3-label').setDescription('Button 3 label').setRequired(false))
  .addStringOption(o => o.setName('button3-url').setDescription('Button 3 URL').setRequired(false))
  .addStringOption(o => o.setName('button4-label').setDescription('Button 4 label').setRequired(false))
  .addStringOption(o => o.setName('button4-url').setDescription('Button 4 URL').setRequired(false))
  .addStringOption(o => o.setName('button5-label').setDescription('Button 5 label').setRequired(false))
  .addStringOption(o => o.setName('button5-url').setDescription('Button 5 URL').setRequired(false)),

  // ── MODERATION ────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a Roblox user and log it.')
    .addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true)),

  new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('View warnings for a Roblox user.')
    .addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true)),

  new SlashCommandBuilder()
    .setName('clearwarnings')
    .setDescription('Clear all warnings for a Roblox user.')
    .addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true)),

  new SlashCommandBuilder()
    .setName('addnote')
    .setDescription('Add a note to a Roblox user.')
    .addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true))
    .addStringOption(o => o.setName('note').setDescription('Note content').setRequired(true)),

  new SlashCommandBuilder()
    .setName('notes')
    .setDescription('View notes on a Roblox user.')
    .addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true)),

  new SlashCommandBuilder()
    .setName('clearnotes')
    .setDescription('Clear all notes on a Roblox user.')
    .addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true)),

  new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Blacklist a Roblox user from being ranked.')
    .addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true)),

  new SlashCommandBuilder()
    .setName('unblacklist')
    .setDescription('Remove a user from the blacklist.')
    .addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true)),

  new SlashCommandBuilder()
    .setName('blacklisted')
    .setDescription('View the full blacklist.'),

  new SlashCommandBuilder()
    .setName('watchlist')
    .setDescription('Manage the watchlist.')
    .addStringOption(o => o.setName('action').setDescription('add / remove / view').setRequired(true))
    .addStringOption(o => o.setName('username').setDescription('Roblox username (for add/remove)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a user from the Roblox group.')
    .addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true)),

  new SlashCommandBuilder()
    .setName('appeal')
    .setDescription('Submit a rank appeal.')
    .addStringOption(o => o.setName('username').setDescription('Your Roblox username').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Why should your rank be reconsidered?').setRequired(true)),

  new SlashCommandBuilder()
    .setName('appeals')
    .setDescription('View pending rank appeals (staff only).')
    .addIntegerOption(o => o.setName('page').setDescription('Page number').setRequired(false)),

  new SlashCommandBuilder()
    .setName('resolveappeal')
    .setDescription('Resolve a rank appeal.')
    .addStringOption(o => o.setName('id').setDescription('Appeal ID').setRequired(true))
    .addStringOption(o => o.setName('decision').setDescription('approve or deny').setRequired(true))
    .addStringOption(o => o.setName('note').setDescription('Optional note to the user').setRequired(false)),

  // ── GROUP COMMANDS ────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('groupinfo')
    .setDescription('Show group info and rank breakdown.'),

  new SlashCommandBuilder()
    .setName('shout')
    .setDescription('Post a shout to the Roblox group.')
    .addStringOption(o => o.setName('message').setDescription('Shout message (max 255 chars)').setRequired(true)),

  new SlashCommandBuilder()
    .setName('clearshout')
    .setDescription('Clear the current group shout.'),

  // ── MISC ──────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('own')
    .setDescription('Check if a user owns a game pass.')
    .addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true))
    .addStringOption(o => o.setName('gamepassid').setDescription('Game Pass ID').setRequired(true)),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('List all available commands with descriptions.'),
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
    body: commands.map(c => c.toJSON())
  });
  console.log(`Registered ${commands.length} commands.`);
}

// ─── PENDING ──────────────────────────────────────────────────────────────────

const pendingChanges = new Map();

// ─── SCHEDULE RUNNER ──────────────────────────────────────────────────────────

function startScheduleRunner() {
  setInterval(async () => {
    const schedules = readJSON(SCHEDULES_FILE);
    const now = Date.now();
    const pending = schedules.filter(s => !s.done && new Date(s.executeAt).getTime() <= now);
    if (!pending.length) return;

    for (const s of pending) {
      try {
        await setGroupRank(s.robloxId, s.newRoleId);
        pushLog({
          timestamp: new Date().toISOString(),
          staffDiscordId: s.staffId,
          staffTag: s.staffTag,
          robloxUsername: s.robloxUsername,
          robloxId: s.robloxId,
          oldRank: s.oldRank,
          newRank: s.newRank,
          note: 'Scheduled rank change'
        });

        await sendLogToChannel(
          baseEmbed()
            .setDescription('✓ Scheduled rank change executed')
            .addFields(
              { name: 'User', value: s.robloxUsername },
              { name: 'Old Rank', value: s.oldRank },
              { name: 'New Rank', value: s.newRank },
              { name: 'Scheduled By', value: `<@${s.staffId}>` }
            )
        );

        s.done = true;
        s.completedAt = new Date().toISOString();
      } catch (err) {
        s.done = true;
        s.error = err.message;
      }
    }

    writeJSON(SCHEDULES_FILE, schedules);
  }, 15_000); // check every 15 seconds
}

// ─── INTERACTION HANDLER ──────────────────────────────────────────────────────

client.on('interactionCreate', async interaction => {

  // ── BUTTONS ───────────────────────────────────────────────────────────────
  if (interaction.isButton()) {
    const [action, changeId] = interaction.customId.split('::');
    const pending = pendingChanges.get(changeId);

    if (!pending) return interaction.reply({ embeds: [errorEmbed('This confirmation has expired.')], ephemeral: true });
    if (interaction.user.id !== pending.requesterId) return interaction.reply({ embeds: [errorEmbed('Only the person who ran this command can confirm it.')], ephemeral: true });

    pendingChanges.delete(changeId);

    if (['cancel', 'masscancel', 'kickcancel'].includes(action)) {
      return interaction.update({ embeds: [baseEmbed().setDescription('✗ Action cancelled.')], components: [] });
    }

    // single rank confirm
    if (action === 'confirm') {
      await interaction.deferUpdate();
      try {
        await setGroupRank(pending.userId, pending.newRoleId);
        const oldName = pending.oldRole?.name ?? 'Guest';
        const newName = pending.newRole.name;
        pushLog({ timestamp: new Date().toISOString(), staffDiscordId: pending.requesterId, staffTag: interaction.user.tag, robloxUsername: pending.robloxUser.name, robloxId: pending.userId, oldRank: oldName, newRank: newName });
        pushAudit('CHANGERANK', interaction.user.tag, interaction.user.id, `${pending.robloxUser.name}: ${oldName} → ${newName}`);
        const embed = baseEmbed().setDescription('✓ Rank change successful').addFields(
          { name: 'User', value: pending.robloxUser.name },
          { name: 'Old Rank', value: oldName },
          { name: 'New Rank', value: newName },
          { name: 'Changed By', value: `<@${pending.requesterId}>` }
        );
        await sendLogToChannel(baseEmbed().setDescription('✓ Rank change logged').addFields(
          { name: 'User', value: pending.robloxUser.name },
          { name: 'Old Rank', value: oldName },
          { name: 'New Rank', value: newName },
          { name: 'Staff', value: `<@${pending.requesterId}> (${interaction.user.tag})` }
        ));
        return interaction.editReply({ embeds: [embed], components: [] });
      } catch (err) { return interaction.editReply({ embeds: [errorEmbed(`Failed: ${err.message}`)], components: [] }); }
    }

    // mass rank confirm
    if (action === 'massconfirm') {
      await interaction.deferUpdate();
      const { users, newRole, requesterId } = pending;
      const success = [], failed = [];
      const csrf = await getCsrfToken().catch(() => null);
      if (!csrf) return interaction.editReply({ embeds: [errorEmbed('Failed to get CSRF token.')], components: [] });
      for (const u of users) {
        try {
          await axios.patch(`https://groups.roblox.com/v1/groups/${GROUP_ID}/users/${u.robloxUser.id}`, { roleId: newRole.id }, { headers: { Cookie: `.ROBLOSECURITY=${ROBLOX_COOKIE}`, 'X-CSRF-TOKEN': csrf } });
          pushLog({ timestamp: new Date().toISOString(), staffDiscordId: requesterId, staffTag: interaction.user.tag, robloxUsername: u.robloxUser.name, robloxId: u.robloxUser.id, oldRank: u.oldRole?.name ?? 'Guest', newRank: newRole.name });
          success.push(u.robloxUser.name);
        } catch { failed.push(u.robloxUser.name); }
      }
      pushAudit('MASSRANK', interaction.user.tag, interaction.user.id, `${success.length} users → ${newRole.name}`);
      const embed = baseEmbed().setDescription('✓ Mass rank complete').addFields(
        { name: 'New Rank', value: newRole.name },
        { name: `✓ Success (${success.length})`, value: success.length ? success.join('\n') : 'None' },
        ...(failed.length ? [{ name: `✗ Failed (${failed.length})`, value: failed.join('\n') }] : []),
        { name: 'Changed By', value: `<@${requesterId}>` }
      );
      await sendLogToChannel(baseEmbed().setDescription('✓ Mass rank logged').addFields(
        { name: 'New Rank', value: newRole.name },
        { name: `✓ Success (${success.length})`, value: success.join('\n') || 'None' },
        ...(failed.length ? [{ name: `✗ Failed`, value: failed.join('\n') }] : []),
        { name: 'Staff', value: `<@${requesterId}>` }
      ));
      return interaction.editReply({ embeds: [embed], components: [] });
    }

    // kick confirm
    if (action === 'kickconfirm') {
      await interaction.deferUpdate();
      try {
        await kickFromGroup(pending.userId);
        pushLog({ timestamp: new Date().toISOString(), staffDiscordId: pending.requesterId, staffTag: interaction.user.tag, robloxUsername: pending.robloxUser.name, robloxId: pending.userId, oldRank: pending.oldRole?.name ?? 'Guest', newRank: 'KICKED', reason: pending.reason });
        pushAudit('KICK', interaction.user.tag, interaction.user.id, `${pending.robloxUser.name} — ${pending.reason}`);
        const embed = baseEmbed().setDescription('✓ User kicked from group').addFields(
          { name: 'User', value: pending.robloxUser.name },
          { name: 'Previous Rank', value: pending.oldRole?.name ?? 'Guest' },
          { name: 'Reason', value: pending.reason },
          { name: 'Kicked By', value: `<@${pending.requesterId}>` }
        );
        await sendLogToChannel(baseEmbed().setDescription('✓ Group kick logged').addFields(
          { name: 'User', value: pending.robloxUser.name },
          { name: 'Previous Rank', value: pending.oldRole?.name ?? 'Guest' },
          { name: 'Reason', value: pending.reason },
          { name: 'Staff', value: `<@${pending.requesterId}>` }
        ));
        return interaction.editReply({ embeds: [embed], components: [] });
      } catch (err) { return interaction.editReply({ embeds: [errorEmbed(`Failed to kick: ${err.message}`)], components: [] }); }
    }

    // shout confirm
    if (action === 'shoutconfirm') {
      await interaction.deferUpdate();
      try {
        await postGroupShout(pending.message);
        pushAudit('SHOUT', interaction.user.tag, interaction.user.id, pending.message);
        const embed = baseEmbed().setDescription('✓ Shout posted').addFields(
          { name: 'Message', value: pending.message },
          { name: 'Posted By', value: `<@${pending.requesterId}>` }
        );
        return interaction.editReply({ embeds: [embed], components: [] });
      } catch (err) { return interaction.editReply({ embeds: [errorEmbed(`Failed to post shout: ${err.message}`)], components: [] }); }
    }

    // clearshout confirm
    if (action === 'clearshoutconfirm') {
      await interaction.deferUpdate();
      try {
        await postGroupShout('');
        pushAudit('CLEARSHOUT', interaction.user.tag, interaction.user.id, 'Shout cleared');
        return interaction.editReply({ embeds: [baseEmbed().setDescription('✓ Group shout cleared.')], components: [] });
      } catch (err) { return interaction.editReply({ embeds: [errorEmbed(`Failed: ${err.message}`)], components: [] }); }
    }

    // clearlog confirm
    if (action === 'clearlogconfirm') {
      await interaction.deferUpdate();
      writeJSON(LOGS_FILE, []);
      pushAudit('CLEARLOG', interaction.user.tag, interaction.user.id, 'Rank log cleared');
      return interaction.editReply({ embeds: [baseEmbed().setDescription('✓ Rank log cleared.')], components: [] });
    }
  }

  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  // ══════════════════════════════════════════════════════════════════════════
  // BOT COMMANDS
  // ══════════════════════════════════════════════════════════════════════════

  // ── /bot-status ────────────────────────────────────────────────────────────

if (commandName === 'webhook') {
  if (!hasPermission(interaction.member)) return interaction.reply({ embeds: [errorEmbed('No permission.')], ephemeral: true });

  const webhookUrl   = interaction.options.getString('webhook-url');
  const message      = interaction.options.getString('message')
                         .replace(/\\n/g, '\n'); // allows typing \n for new lines
  const title        = interaction.options.getString('title');
  const imageUrl     = interaction.options.getString('image-url');
  const colorInput   = interaction.options.getString('color');

  if (
    !webhookUrl.startsWith('https://discord.com/api/webhooks/') &&
    !webhookUrl.startsWith('https://discordapp.com/api/webhooks/')
  ) {
    return interaction.reply({ embeds: [errorEmbed('Invalid webhook URL.')], ephemeral: true });
  }

  let color = 0x111111;
  if (colorInput) {
    const parsed = parseInt(colorInput.replace('#', ''), 16);
    if (!isNaN(parsed)) color = parsed;
  }

  // Collect buttons
  const buttons = [];
  for (let i = 1; i <= 5; i++) {
    const label = interaction.options.getString(`button${i}-label`);
    const url   = interaction.options.getString(`button${i}-url`);
    if (label && url) {
      try {
        new URL(url);
        buttons.push({ label, url });
      } catch {
        return interaction.reply({ embeds: [errorEmbed(`Button ${i} has an invalid URL.`)], ephemeral: true });
      }
    } else if (label && !url) {
      return interaction.reply({ embeds: [errorEmbed(`Button ${i} has a label but no URL.`)], ephemeral: true });
    } else if (!label && url) {
      return interaction.reply({ embeds: [errorEmbed(`Button ${i} has a URL but no label.`)], ephemeral: true });
    }
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    // Step 1: Send embed via webhook
    const embedPayload = {
      description: message,
      color,
      timestamp: new Date().toISOString(),
      footer: { text: 'SimplyFresh System' }, // ← changed here
      ...(title    ? { title }                   : {}),
      ...(imageUrl ? { image: { url: imageUrl } } : {})
    };

    const webhookRes = await axios.post(`${webhookUrl}?wait=true`, {
      embeds: [embedPayload]
    });

    // Step 2: If buttons exist, fetch the channel from the webhook and send a follow-up bot message with buttons
    if (buttons.length > 0) {
      // Extract channel ID from webhook info
      const webhookInfo = await axios.get(webhookUrl);
      const channelId = webhookInfo.data.channel_id;

      if (channelId) {
        const channel = await client.channels.fetch(channelId);
        if (channel) {
          const row = new ActionRowBuilder().addComponents(
            ...buttons.map(b =>
              new ButtonBuilder()
                .setLabel(b.label)
                .setURL(b.url)
                .setStyle(ButtonStyle.Link)
            )
          );
          await channel.send({ components: [row] });
        }
      }
    }

    pushAudit('WEBHOOK_SEND', interaction.user.tag, interaction.user.id, `"${message.slice(0, 50)}" — ${buttons.length} button(s)`);

    const buttonPreview = buttons.length
      ? buttons.map((b, i) => `**${i + 1}.** [${b.label}](${b.url})`).join('\n')
      : 'None';

    return interaction.editReply({ embeds: [baseEmbed().setDescription('✓ Webhook sent successfully').addFields(
      { name: 'Title',   value: title    || 'None',           inline: true },
      { name: 'Color',   value: colorInput || '#111111',       inline: true },
      { name: 'Image',   value: imageUrl  ? '✓ Set' : 'None', inline: true },
      { name: 'Message', value: message.slice(0, 200)                       },
      { name: `Buttons (${buttons.length})`, value: buttonPreview           },
      { name: 'Sent By', value: interaction.user.tag                        }
    )] });

  } catch (err) {
    return interaction.editReply({ embeds: [errorEmbed(`Failed to send: ${err.message}`)] });
  }
}

  if (commandName === 'bot-status') {
    const uptime = formatUptime(Date.now() - BOT_START);
    const ping = client.ws.ping;
    const memUsed = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
    const memTotal = (process.memoryUsage().heapTotal / 1024 / 1024).toFixed(1);
    const logs = readJSON(LOGS_FILE);
    const verified = readJSON(VERIFIED_FILE);
    const warnings = readJSON(WARNINGS_FILE);
    const bl = readJSON(BLACKLIST_FILE);
    const platform = os.platform() === 'win32' ? 'Windows' : os.platform() === 'linux' ? 'Linux' : os.platform();

    const embed = baseEmbed()
      .setDescription('✓ Bot is online and running')
      .addFields(
        { name: 'Uptime', value: uptime, inline: true },
        { name: 'Ping', value: `${ping}ms`, inline: true },
        { name: 'Platform', value: platform, inline: true },
        { name: 'Memory', value: `${memUsed}MB / ${memTotal}MB`, inline: true },
        { name: 'Node.js', value: process.version, inline: true },
        { name: 'discord.js', value: 'v14', inline: true },
        { name: 'Total Rank Changes', value: String(logs.length), inline: true },
        { name: 'Verified Users', value: String(Object.keys(verified).length), inline: true },
        { name: 'Blacklisted Users', value: String(bl.length), inline: true },
        { name: 'Commands', value: String(commands.length), inline: true },
        { name: 'Group ID', value: GROUP_ID, inline: true },
        { name: 'Log Channel', value: LOG_CHANNEL_ID ? `<#${LOG_CHANNEL_ID}>` : 'Not set', inline: true }
      );
    return interaction.reply({ embeds: [embed] });
  }

  // ── /bot-info ──────────────────────────────────────────────────────────────
  if (commandName === 'bot-info') {
    const embed = baseEmbed()
      .setDescription('✓ Bot information')
      .addFields(
        { name: 'Bot Name', value: client.user.tag },
        { name: 'Made By', value: 'Zaid' },
        { name: 'Purpose', value: 'Roblox group ranking automation — change ranks, manage staff, track logs, verify users, and more.' },
        { name: 'Total Commands', value: String(commands.length) },
        { name: 'Key Features', value: 'Rank management\nMass ranking\nVerification system\nWarning & note system\nBlacklist & watchlist\nScheduled rank changes\nGroup shout control\nFull audit logging\nRoblox profile lookup\nGame pass checking' },
        { name: 'Version', value: '3.0.0' },
        { name: 'Bot ID', value: client.user.id }
      );
    return interaction.reply({ embeds: [embed] });
  }

  // ── /status-change ─────────────────────────────────────────────────────────
  if (commandName === 'status-change') {
    if (!hasPermission(interaction.member)) return interaction.reply({ embeds: [errorEmbed('No permission.')], ephemeral: true });
    const message = interaction.options.getString('message');
    const typeStr = interaction.options.getString('type') || 'watching';
    const typeMap = {
      watching: ActivityType.Watching,
      playing: ActivityType.Playing,
      listening: ActivityType.Listening,
      competing: ActivityType.Competing
    };
    client.user.setActivity(message, { type: typeMap[typeStr] });
    pushAudit('STATUS_CHANGE', interaction.user.tag, interaction.user.id, `${typeStr}: ${message}`);
    const embed = baseEmbed()
      .setDescription('✓ Bot status updated')
      .addFields(
        { name: 'Type', value: typeStr.charAt(0).toUpperCase() + typeStr.slice(1) },
        { name: 'Message', value: message },
        { name: 'Changed By', value: interaction.user.tag }
      );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RANK COMMANDS
  // ══════════════════════════════════════════════════════════════════════════

  // ── /changerank ────────────────────────────────────────────────────────────
  if (commandName === 'changerank') {
    if (!hasPermission(interaction.member)) return interaction.reply({ embeds: [errorEmbed('No permission.')], ephemeral: true });
    const username = interaction.options.getString('username');
    const rankName = interaction.options.getString('rank');
    await interaction.deferReply();
    try {
      const robloxUser = await getRobloxUserByUsername(username);
      const bl = readJSON(BLACKLIST_FILE);
      if (bl.find(e => e.robloxId === robloxUser.id)) return interaction.editReply({ embeds: [errorEmbed(`${robloxUser.name} is blacklisted from being ranked.`)] });
      const roles = await getGroupRoles();
      const newRole = roles.find(r => r.name.toLowerCase() === rankName.toLowerCase());
      if (!newRole) return interaction.editReply({ embeds: [errorEmbed(`Rank not found. Available: ${roles.map(r => r.name).join(', ')}`)] });
      const oldRole = await getUserGroupRole(robloxUser.id);
      const changeId = `${interaction.id}-${Date.now()}`;
      pendingChanges.set(changeId, { userId: robloxUser.id, newRoleId: newRole.id, robloxUser, oldRole, newRole, requesterId: interaction.user.id });
      setTimeout(() => pendingChanges.delete(changeId), 60_000);
      const embed = baseEmbed().setDescription('Confirm this rank change.').addFields(
        { name: 'User', value: robloxUser.name },
        { name: 'Current Rank', value: oldRole?.name ?? 'Guest' },
        { name: 'New Rank', value: newRole.name }
      );
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm::${changeId}`).setLabel('Confirm').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`cancel::${changeId}`).setLabel('Cancel').setStyle(ButtonStyle.Danger)
      );
      return interaction.editReply({ embeds: [embed], components: [row] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /massrank ──────────────────────────────────────────────────────────────
  if (commandName === 'massrank') {
    if (!hasPermission(interaction.member)) return interaction.reply({ embeds: [errorEmbed('No permission.')], ephemeral: true });
    const usernameList = interaction.options.getString('usernames').split(',').map(u => u.trim()).filter(Boolean);
    const rankName = interaction.options.getString('rank');
    if (usernameList.length > 20) return interaction.reply({ embeds: [errorEmbed('Max 20 users per mass rank.')], ephemeral: true });
    await interaction.deferReply();
    try {
      const roles = await getGroupRoles();
      const newRole = roles.find(r => r.name.toLowerCase() === rankName.toLowerCase());
      if (!newRole) return interaction.editReply({ embeds: [errorEmbed(`Rank not found.`)] });
      const resolvedUsers = [], failedUsers = [];
      const bl = readJSON(BLACKLIST_FILE);
      for (const username of usernameList) {
        try {
          const robloxUser = await getRobloxUserByUsername(username);
          if (bl.find(e => e.robloxId === robloxUser.id)) { failedUsers.push(`${username} (blacklisted)`); continue; }
          const oldRole = await getUserGroupRole(robloxUser.id);
          resolvedUsers.push({ robloxUser, oldRole });
        } catch { failedUsers.push(username); }
      }
      if (!resolvedUsers.length) return interaction.editReply({ embeds: [errorEmbed('No valid users found.')] });
      const changeId = `${interaction.id}-${Date.now()}`;
      pendingChanges.set(changeId, { users: resolvedUsers, newRole, requesterId: interaction.user.id });
      setTimeout(() => pendingChanges.delete(changeId), 120_000);
      const embed = baseEmbed().setDescription('Confirm mass rank change.').addFields(
        { name: 'New Rank', value: newRole.name },
        { name: `Users (${resolvedUsers.length})`, value: resolvedUsers.map(u => u.robloxUser.name).join('\n') },
        ...(failedUsers.length ? [{ name: `✗ Skipped (${failedUsers.length})`, value: failedUsers.join('\n') }] : [])
      );
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`massconfirm::${changeId}`).setLabel('Confirm All').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`masscancel::${changeId}`).setLabel('Cancel').setStyle(ButtonStyle.Danger)
      );
      return interaction.editReply({ embeds: [embed], components: [row] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /checkrank ─────────────────────────────────────────────────────────────
  if (commandName === 'checkrank') {
    const username = interaction.options.getString('username');
    await interaction.deferReply();
    try {
      const robloxUser = await getRobloxUserByUsername(username);
      const role = await getUserGroupRole(robloxUser.id);
      const avatar = await getRobloxAvatar(robloxUser.id);
      const embed = baseEmbed().setDescription('✓ Rank lookup').addFields(
        { name: 'User', value: robloxUser.name },
        { name: 'Display Name', value: robloxUser.displayName || robloxUser.name },
        { name: 'Rank', value: role?.name ?? 'Not in group' },
        { name: 'Rank Number', value: role ? String(role.rank) : 'N/A' }
      );
      if (avatar) embed.setThumbnail(avatar);
      return interaction.editReply({ embeds: [embed] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /ranklist ──────────────────────────────────────────────────────────────
  if (commandName === 'ranklist') {
    await interaction.deferReply();
    try {
      const roles = await getGroupRoles();
      const sorted = roles.sort((a, b) => b.rank - a.rank);
      const list = sorted.map(r => `**${r.name}** — Rank ${r.rank} (${r.memberCount} members)`).join('\n');
      return interaction.editReply({ embeds: [baseEmbed().setDescription('✓ Group rank list').addFields({ name: `All Ranks (${roles.length})`, value: list || 'None' })] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /rankinfo ──────────────────────────────────────────────────────────────
  if (commandName === 'rankinfo') {
    const rankName = interaction.options.getString('rank');
    await interaction.deferReply();
    try {
      const roles = await getGroupRoles();
      const role = roles.find(r => r.name.toLowerCase() === rankName.toLowerCase());
      if (!role) return interaction.editReply({ embeds: [errorEmbed(`Rank "${rankName}" not found.`)] });
      const logs = readJSON(LOGS_FILE);
      const promotedTo = logs.filter(l => l.newRank === role.name).length;
      const demotedFrom = logs.filter(l => l.oldRank === role.name).length;
      return interaction.editReply({ embeds: [baseEmbed().setDescription(`✓ Rank info — ${role.name}`).addFields(
        { name: 'Rank Name', value: role.name },
        { name: 'Rank Number', value: String(role.rank) },
        { name: 'Current Members', value: String(role.memberCount) },
        { name: 'Times Promoted To (logged)', value: String(promotedTo) },
        { name: 'Times Demoted From (logged)', value: String(demotedFrom) }
      )] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /rankcount ─────────────────────────────────────────────────────────────
  if (commandName === 'rankcount') {
    await interaction.deferReply();
    try {
      const roles = await getGroupRoles();
      const sorted = roles.filter(r => r.memberCount > 0).sort((a, b) => b.memberCount - a.memberCount);
      const total = roles.reduce((s, r) => s + r.memberCount, 0);
      const list = sorted.map((r, i) => {
        const pct = ((r.memberCount / total) * 100).toFixed(1);
        return `**${i + 1}.** ${r.name} — **${r.memberCount}** (${pct}%)`;
      }).join('\n');
      return interaction.editReply({ embeds: [baseEmbed().setDescription('✓ Members per rank').addFields(
        { name: 'Total Members', value: String(total) },
        { name: 'Breakdown', value: list || 'None' }
      )] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /topranked ─────────────────────────────────────────────────────────────
  if (commandName === 'topranked') {
    await interaction.deferReply();
    try {
      const roles = await getGroupRoles();
      const sorted = roles.sort((a, b) => b.rank - a.rank).filter(r => r.rank < 255 && r.memberCount > 0).slice(0, 5);
      const lines = [];
      for (const role of sorted) {
        try {
          const res = await axios.get(`https://groups.roblox.com/v1/groups/${GROUP_ID}/roles/${role.id}/users?limit=3`);
          const members = res.data.data || [];
          const names = members.map(m => m.username).join(', ') || 'None';
          lines.push(`**${role.name}** (Rank ${role.rank})\n> ${names}${role.memberCount > 3 ? ` + ${role.memberCount - 3} more` : ''}`);
        } catch { lines.push(`**${role.name}** (Rank ${role.rank})`); }
      }
      return interaction.editReply({ embeds: [baseEmbed().setDescription('✓ Top ranked members').addFields({ name: 'Highest Ranks', value: lines.join('\n\n') || 'None' })] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /recentranks ───────────────────────────────────────────────────────────
  if (commandName === 'recentranks') {
    await interaction.deferReply();
    try {
      const auditEntries = await getGroupAuditLog();
      if (!auditEntries.length) return interaction.editReply({ embeds: [baseEmbed().setDescription('No recent rank changes in Roblox audit log.')] });
      const lines = auditEntries.map((e, i) => {
        const date = new Date(e.created).toLocaleDateString('en-GB');
        return `**${i + 1}.** \`${e.description?.TargetName ?? 'Unknown'}\`\n> by ${e.actor?.user?.username ?? 'Unknown'} • ${date}`;
      }).join('\n\n');
      return interaction.editReply({ embeds: [baseEmbed().setDescription(`**Recent Roblox Rank Changes**\n\n${lines}`)] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /schedulerank ──────────────────────────────────────────────────────────
  if (commandName === 'schedulerank') {
    if (!hasPermission(interaction.member)) return interaction.reply({ embeds: [errorEmbed('No permission.')], ephemeral: true });
    const username = interaction.options.getString('username');
    const rankName = interaction.options.getString('rank');
    const minutes = interaction.options.getInteger('minutes');
    if (minutes < 1 || minutes > 10080) return interaction.reply({ embeds: [errorEmbed('Minutes must be between 1 and 10080 (7 days).')], ephemeral: true });
    await interaction.deferReply();
    try {
      const robloxUser = await getRobloxUserByUsername(username);
      const roles = await getGroupRoles();
      const newRole = roles.find(r => r.name.toLowerCase() === rankName.toLowerCase());
      if (!newRole) return interaction.editReply({ embeds: [errorEmbed(`Rank not found.`)] });
      const oldRole = await getUserGroupRole(robloxUser.id);
      const executeAt = new Date(Date.now() + minutes * 60_000).toISOString();
      const id = `sch-${Date.now()}`;
      const schedules = readJSON(SCHEDULES_FILE);
      schedules.push({ id, robloxId: robloxUser.id, robloxUsername: robloxUser.name, newRoleId: newRole.id, newRank: newRole.name, oldRank: oldRole?.name ?? 'Guest', staffId: interaction.user.id, staffTag: interaction.user.tag, executeAt, done: false });
      writeJSON(SCHEDULES_FILE, schedules);
      pushAudit('SCHEDULERANK', interaction.user.tag, interaction.user.id, `${robloxUser.name} → ${newRole.name} in ${minutes}m`);
      return interaction.editReply({ embeds: [baseEmbed().setDescription('✓ Rank change scheduled').addFields(
        { name: 'User', value: robloxUser.name },
        { name: 'New Rank', value: newRole.name },
        { name: 'Executes In', value: `${minutes} minute${minutes !== 1 ? 's' : ''}` },
        { name: 'Schedule ID', value: id }
      )] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /schedules ─────────────────────────────────────────────────────────────
  if (commandName === 'schedules') {
    const schedules = readJSON(SCHEDULES_FILE).filter(s => !s.done);
    if (!schedules.length) return interaction.reply({ embeds: [baseEmbed().setDescription('No pending scheduled rank changes.')] });
    const lines = schedules.map((s, i) => {
      const when = new Date(s.executeAt).toLocaleString('en-GB');
      return `**${i + 1}.** \`${s.robloxUsername}\` → **${s.newRank}**\n> ID: \`${s.id}\` • Executes: ${when}`;
    }).join('\n\n');
    return interaction.reply({ embeds: [baseEmbed().setDescription(`**Pending Schedules (${schedules.length})**\n\n${lines}`)] });
  }

  // ── /cancelschedule ────────────────────────────────────────────────────────
  if (commandName === 'cancelschedule') {
    if (!hasPermission(interaction.member)) return interaction.reply({ embeds: [errorEmbed('No permission.')], ephemeral: true });
    const id = interaction.options.getString('id');
    const schedules = readJSON(SCHEDULES_FILE);
    const idx = schedules.findIndex(s => s.id === id && !s.done);
    if (idx === -1) return interaction.reply({ embeds: [errorEmbed(`Schedule \`${id}\` not found or already executed.`)], ephemeral: true });
    const s = schedules[idx];
    schedules.splice(idx, 1);
    writeJSON(SCHEDULES_FILE, schedules);
    pushAudit('CANCELSCHEDULE', interaction.user.tag, interaction.user.id, id);
    return interaction.reply({ embeds: [baseEmbed().setDescription(`✓ Schedule \`${id}\` cancelled — was going to rank **${s.robloxUsername}** to **${s.newRank}**.`)] });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LOG COMMANDS
  // ══════════════════════════════════════════════════════════════════════════

  // ── /ranklog ───────────────────────────────────────────────────────────────
  if (commandName === 'ranklog') {
    const page = Math.max(1, interaction.options.getInteger('page') || 1);
    const PER_PAGE = 10;
    const logs = readJSON(LOGS_FILE);
    if (!logs.length) return interaction.reply({ embeds: [baseEmbed().setDescription('No rank changes logged yet.')] });
    const totalPages = Math.ceil(logs.length / PER_PAGE);
    const pageNum = Math.min(page, totalPages);
    const slice = logs.slice((pageNum - 1) * PER_PAGE, pageNum * PER_PAGE);
    const lines = slice.map((log, i) => {
      const date = new Date(log.timestamp).toLocaleDateString('en-GB');
      const num = (pageNum - 1) * PER_PAGE + i + 1;
      const newRank = log.newRank === 'KICKED' ? '**KICKED**' : log.newRank;
      return `**${num}.** \`${log.robloxUsername}\` — ${log.oldRank} → ${newRank}\n> by <@${log.staffDiscordId}> • ${date}`;
    }).join('\n\n');
    return interaction.reply({ embeds: [baseEmbed().setDescription(`**Rank Log — Page ${pageNum}/${totalPages}**\n\n${lines}`).setFooter({ text: `Rank System • ${logs.length} total entries`, iconURL: FOOTER_ICON })] });
  }

  // ── /stafflog ──────────────────────────────────────────────────────────────
  if (commandName === 'stafflog') {
    const staffUser = interaction.options.getUser('staff');
    const page = Math.max(1, interaction.options.getInteger('page') || 1);
    const PER_PAGE = 10;
    const filtered = readJSON(LOGS_FILE).filter(l => l.staffDiscordId === staffUser.id);
    if (!filtered.length) return interaction.reply({ embeds: [baseEmbed().setDescription(`No rank changes found for <@${staffUser.id}>.`)] });
    const totalPages = Math.ceil(filtered.length / PER_PAGE);
    const pageNum = Math.min(page, totalPages);
    const slice = filtered.slice((pageNum - 1) * PER_PAGE, pageNum * PER_PAGE);
    const lines = slice.map((log, i) => {
      const date = new Date(log.timestamp).toLocaleDateString('en-GB');
      return `**${(pageNum - 1) * PER_PAGE + i + 1}.** \`${log.robloxUsername}\` — ${log.oldRank} → ${log.newRank}\n> ${date}`;
    }).join('\n\n');
    return interaction.reply({ embeds: [baseEmbed().setDescription(`**Staff Log for <@${staffUser.id}> — Page ${pageNum}/${totalPages}**\n\n${lines}`).setFooter({ text: `Rank System • ${filtered.length} total actions`, iconURL: FOOTER_ICON })] });
  }

  // ── /userlog ───────────────────────────────────────────────────────────────
  if (commandName === 'userlog') {
    const username = interaction.options.getString('username');
    const page = Math.max(1, interaction.options.getInteger('page') || 1);
    const PER_PAGE = 10;
    const filtered = readJSON(LOGS_FILE).filter(l => l.robloxUsername.toLowerCase() === username.toLowerCase());
    if (!filtered.length) return interaction.reply({ embeds: [baseEmbed().setDescription(`No rank changes found for **${username}**.`)] });
    const totalPages = Math.ceil(filtered.length / PER_PAGE);
    const pageNum = Math.min(page, totalPages);
    const slice = filtered.slice((pageNum - 1) * PER_PAGE, pageNum * PER_PAGE);
    const lines = slice.map((log, i) => {
      const date = new Date(log.timestamp).toLocaleDateString('en-GB');
      return `**${(pageNum - 1) * PER_PAGE + i + 1}.** ${log.oldRank} → ${log.newRank}\n> by <@${log.staffDiscordId}> • ${date}`;
    }).join('\n\n');
    return interaction.reply({ embeds: [baseEmbed().setDescription(`**Rank history for \`${username}\` — Page ${pageNum}/${totalPages}**\n\n${lines}`).setFooter({ text: `Rank System •${filtered.length} total changes`, iconURL: FOOTER_ICON })] });
  }

  // ── /logstats ─────────────────────────────────────────────────────────────
  if (commandName === 'logstats') {
    const logs = readJSON(LOGS_FILE);
    if (!logs.length) return interaction.reply({ embeds: [baseEmbed().setDescription('No logs yet.')] });
    const staffCount = {}, rankCount = {};
    let kicks = 0;
    for (const log of logs) {
      staffCount[log.staffDiscordId] = (staffCount[log.staffDiscordId] || 0) + 1;
      rankCount[log.newRank] = (rankCount[log.newRank] || 0) + 1;
      if (log.newRank === 'KICKED') kicks++;
    }
    const topStaff = Object.entries(staffCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topRanks = Object.entries(rankCount).filter(([k]) => k !== 'KICKED').sort((a, b) => b[1] - a[1]).slice(0, 5);
    const today = new Date().toLocaleDateString('en-GB');
    const todayCount = logs.filter(l => new Date(l.timestamp).toLocaleDateString('en-GB') === today).length;
    return interaction.reply({ embeds: [baseEmbed().setDescription('✓ Log statistics').addFields(
      { name: 'Total Rank Changes', value: String(logs.length), inline: true },
      { name: 'Total Kicks', value: String(kicks), inline: true },
      { name: 'Changes Today', value: String(todayCount), inline: true },
      { name: 'Top Staff (by actions)', value: topStaff.map(([id, c], i) => `**${i + 1}.** <@${id}> — ${c}`).join('\n') || 'None' },
      { name: 'Most Given Ranks', value: topRanks.map(([name, c], i) => `**${i + 1}.** ${name} — ${c} times`).join('\n') || 'None' }
    )] });
  }

  // ── /auditlog ─────────────────────────────────────────────────────────────
  if (commandName === 'auditlog') {
    if (!hasPermission(interaction.member)) return interaction.reply({ embeds: [errorEmbed('No permission.')], ephemeral: true });
    const page = Math.max(1, interaction.options.getInteger('page') || 1);
    const PER_PAGE = 10;
    const audit = readJSON(AUDITLOG_FILE);
    if (!audit.length) return interaction.reply({ embeds: [baseEmbed().setDescription('Audit log is empty.')] });
    const totalPages = Math.ceil(audit.length / PER_PAGE);
    const pageNum = Math.min(page, totalPages);
    const slice = audit.slice((pageNum - 1) * PER_PAGE, pageNum * PER_PAGE);
    const lines = slice.map((e, i) => {
      const date = new Date(e.timestamp).toLocaleString('en-GB');
      return `**${(pageNum - 1) * PER_PAGE + i + 1}.** \`${e.action}\` by ${e.staffTag}\n> ${e.details} • ${date}`;
    }).join('\n\n');
    return interaction.reply({ embeds: [baseEmbed().setDescription(`**Audit Log — Page ${pageNum}/${totalPages}**\n\n${lines}`)] });
  }

  // ── /clearlog ─────────────────────────────────────────────────────────────
  if (commandName === 'clearlog') {
    if (!hasPermission(interaction.member)) return interaction.reply({ embeds: [errorEmbed('No permission.')], ephemeral: true });
    const changeId = `${interaction.id}-${Date.now()}`;
    pendingChanges.set(changeId, { requesterId: interaction.user.id });
    setTimeout(() => pendingChanges.delete(changeId), 30_000);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`clearlogconfirm::${changeId}`).setLabel('Yes, Clear All Logs').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`cancel::${changeId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    );
    return interaction.reply({ embeds: [baseEmbed().setDescription('Are you sure you want to clear the entire rank log? This cannot be undone.')], components: [row], ephemeral: true });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // USER / VERIFICATION COMMANDS
  // ══════════════════════════════════════════════════════════════════════════

  // ── /profile ───────────────────────────────────────────────────────────────
  if (commandName === 'profile') {
    const username = interaction.options.getString('username');
    await interaction.deferReply();
    try {
      const robloxUser = await getRobloxUserByUsername(username);
      const [role, avatar, friends, followers, following] = await Promise.all([
        getUserGroupRole(robloxUser.id),
        getRobloxAvatar(robloxUser.id),
        getRobloxFriendCount(robloxUser.id),
        getUserFollowerCount(robloxUser.id),
        getUserFollowingCount(robloxUser.id)
      ]);
      const warnings = readJSON(WARNINGS_FILE)[robloxUser.id] || [];
      const notes = readJSON(NOTES_FILE)[robloxUser.id] || [];
      const bl = readJSON(BLACKLIST_FILE);
      const wl = readJSON(WATCHLIST_FILE);
      const createdDate = new Date(robloxUser.created).toLocaleDateString('en-GB');
      const embed = baseEmbed().setDescription('✓ Roblox profile').addFields(
        { name: 'Username', value: robloxUser.name, inline: true },
        { name: 'Display Name', value: robloxUser.displayName || robloxUser.name, inline: true },
        { name: 'Roblox ID', value: String(robloxUser.id), inline: true },
        { name: 'Account Created', value: createdDate, inline: true },
        { name: 'Friends', value: String(friends), inline: true },
        { name: 'Followers', value: String(followers), inline: true },
        { name: 'Following', value: String(following), inline: true },
        { name: 'Group Rank', value: role?.name ?? 'Not in group', inline: true },
        { name: 'Rank Number', value: role ? String(role.rank) : 'N/A', inline: true },
        { name: 'Warnings', value: String(warnings.length), inline: true },
        { name: 'Notes', value: String(notes.length), inline: true },
        { name: 'Blacklisted', value: bl.find(e => e.robloxId === robloxUser.id) ? '✗ Yes' : '✓ No', inline: true },
        { name: 'On Watchlist', value: wl.find(e => e.robloxId === robloxUser.id) ? '✓ Yes' : 'No', inline: true }
      );
      if (avatar) embed.setThumbnail(avatar);
      return interaction.editReply({ embeds: [embed] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /verify ────────────────────────────────────────────────────────────────
  if (commandName === 'verify') {
    const username = interaction.options.getString('username');
    await interaction.deferReply({ ephemeral: true });
    try {
      const robloxUser = await getRobloxUserByUsername(username);
      const verified = readJSON(VERIFIED_FILE);
      const existing = Object.entries(verified).find(([, v]) => v.robloxId === robloxUser.id);
      if (existing && existing[0] !== interaction.user.id) return interaction.editReply({ embeds: [errorEmbed('That Roblox account is already linked to another Discord user.')] });
      verified[interaction.user.id] = { robloxId: robloxUser.id, robloxUsername: robloxUser.name, verifiedAt: new Date().toISOString() };
      writeJSON(VERIFIED_FILE, verified);
      return interaction.editReply({ embeds: [baseEmbed().setDescription('✓ Account verified').addFields(
        { name: 'Discord', value: `<@${interaction.user.id}>` },
        { name: 'Roblox', value: robloxUser.name },
        { name: 'Roblox ID', value: String(robloxUser.id) }
      )] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /unverify ──────────────────────────────────────────────────────────────
  if (commandName === 'unverify') {
    const verified = readJSON(VERIFIED_FILE);
    if (!verified[interaction.user.id]) return interaction.reply({ embeds: [errorEmbed('You are not verified.')], ephemeral: true });
    const old = verified[interaction.user.id].robloxUsername;
    delete verified[interaction.user.id];
    writeJSON(VERIFIED_FILE, verified);
    return interaction.reply({ embeds: [baseEmbed().setDescription(`✓ Unverified — removed link to **${old}**`)], ephemeral: true });
  }

  // ── /whois ─────────────────────────────────────────────────────────────────
  if (commandName === 'whois') {
    const targetUser = interaction.options.getUser('user');
    await interaction.deferReply();
    try {
      const verified = readJSON(VERIFIED_FILE);
      const entry = verified[targetUser.id];
      if (!entry) return interaction.editReply({ embeds: [errorEmbed(`<@${targetUser.id}> has not verified.`)] });
      const robloxUser = await getRobloxUserById(entry.robloxId);
      const role = await getUserGroupRole(entry.robloxId);
      const avatar = await getRobloxAvatar(entry.robloxId);
      const warnings = readJSON(WARNINGS_FILE)[entry.robloxId] || [];
      const notes = readJSON(NOTES_FILE)[entry.robloxId] || [];
      const embed = baseEmbed().setDescription('✓ User info').addFields(
        { name: 'Discord', value: `<@${targetUser.id}>` },
        { name: 'Roblox Username', value: robloxUser.name },
        { name: 'Roblox ID', value: String(robloxUser.id) },
        { name: 'Group Rank', value: role?.name ?? 'Not in group' },
        { name: 'Rank Number', value: role ? String(role.rank) : 'N/A' },
        { name: 'Warnings', value: String(warnings.length) },
        { name: 'Notes', value: String(notes.length) },
        { name: 'Verified At', value: new Date(entry.verifiedAt).toLocaleDateString('en-GB') }
      );
      if (avatar) embed.setThumbnail(avatar);
      return interaction.editReply({ embeds: [embed] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /whoverified ───────────────────────────────────────────────────────────
  if (commandName === 'whoverified') {
    const username = interaction.options.getString('username');
    await interaction.deferReply();
    try {
      const robloxUser = await getRobloxUserByUsername(username);
      const verified = readJSON(VERIFIED_FILE);
      const entry = Object.entries(verified).find(([, v]) => v.robloxId === robloxUser.id);
      if (!entry) return interaction.editReply({ embeds: [errorEmbed(`${robloxUser.name} is not linked to any Discord account.`)] });
      return interaction.editReply({ embeds: [baseEmbed().setDescription('✓ Verification lookup').addFields(
        { name: 'Roblox User', value: robloxUser.name },
        { name: 'Linked Discord', value: `<@${entry[0]}>` },
        { name: 'Verified At', value: new Date(entry[1].verifiedAt).toLocaleDateString('en-GB') }
      )] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /sync ──────────────────────────────────────────────────────────────────
  if (commandName === 'sync') {
    if (!hasPermission(interaction.member)) return interaction.reply({ embeds: [errorEmbed('No permission.')], ephemeral: true });
    const targetUser = interaction.options.getUser('user');
    await interaction.deferReply();
    try {
      const verified = readJSON(VERIFIED_FILE);
      const entry = verified[targetUser.id];
      if (!entry) return interaction.editReply({ embeds: [errorEmbed(`<@${targetUser.id}> has not verified.`)] });
      const role = await getUserGroupRole(entry.robloxId);
      const member = await interaction.guild.members.fetch(targetUser.id);
      const matchingRole = interaction.guild.roles.cache.find(r => role && r.name.toLowerCase() === role.name.toLowerCase());
      let syncResult;
      if (matchingRole) {
        await member.roles.add(matchingRole);
        syncResult = `✓ Added role: ${matchingRole.name}`;
      } else {
        syncResult = `✗ No Discord role matches rank: ${role?.name ?? 'Not in group'}`;
      }
      pushAudit('SYNC', interaction.user.tag, interaction.user.id, `${targetUser.tag} → ${role?.name ?? 'none'}`);
      return interaction.editReply({ embeds: [baseEmbed().setDescription('✓ Sync complete').addFields(
        { name: 'Discord User', value: `<@${targetUser.id}>` },
        { name: 'Roblox Username', value: entry.robloxUsername },
        { name: 'Roblox Rank', value: role?.name ?? 'Not in group' },
        { name: 'Sync Result', value: syncResult }
      )] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /checkinventory ────────────────────────────────────────────────────────
  if (commandName === 'checkinventory') {
    const username = interaction.options.getString('username');
    const type = interaction.options.getString('type');
    const assetId = interaction.options.getString('assetid');
    await interaction.deferReply();
    try {
      const robloxUser = await getRobloxUserByUsername(username);
      const res = await axios.get(`https://inventory.roblox.com/v1/users/${robloxUser.id}/items/${type}/${assetId}`);
      const owns = res.data.data && res.data.data.length > 0;
      return interaction.editReply({ embeds: [baseEmbed().setDescription(owns ? `✓ User owns this ${type}` : `✗ User does not own this ${type}`).addFields(
        { name: 'User', value: robloxUser.name },
        { name: 'Asset Type', value: type },
        { name: 'Asset ID', value: assetId },
        { name: 'Owns It', value: owns ? '✓ Yes' : '✗ No' }
      )] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /badges ────────────────────────────────────────────────────────────────
  if (commandName === 'badges') {
    const username = interaction.options.getString('username');
    await interaction.deferReply();
    try {
      const robloxUser = await getRobloxUserByUsername(username);
      const badges = await getUserBadges(robloxUser.id);
      if (!badges.length) return interaction.editReply({ embeds: [baseEmbed().setDescription(`${robloxUser.name} has no recent badges.`)] });
      const list = badges.map((b, i) => `**${i + 1}.** ${b.name}`).join('\n');
      return interaction.editReply({ embeds: [baseEmbed().setDescription('✓ Recent badges').addFields(
        { name: 'User', value: robloxUser.name },
        { name: 'Recent Badges (up to 10)', value: list }
      )] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /groups ────────────────────────────────────────────────────────────────
  if (commandName === 'groups') {
    const username = interaction.options.getString('username');
    await interaction.deferReply();
    try {
      const robloxUser = await getRobloxUserByUsername(username);
      const groups = await getRobloxGroups(robloxUser.id);
      if (!groups.length) return interaction.editReply({ embeds: [baseEmbed().setDescription(`${robloxUser.name} is not in any groups.`)] });
      const list = groups.slice(0, 15).map((g, i) => `**${i + 1}.** ${g.group.name} — ${g.role.name}`).join('\n');
      return interaction.editReply({ embeds: [baseEmbed().setDescription('✓ Roblox groups').addFields(
        { name: 'User', value: robloxUser.name },
        { name: `Groups (${groups.length})`, value: list }
      )] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /gameinfo ──────────────────────────────────────────────────────────────
  if (commandName === 'gameinfo') {
    const universeId = interaction.options.getString('universeid');
    await interaction.deferReply();
    try {
      const game = await getRobloxGameInfo(universeId);
      if (!game) return interaction.editReply({ embeds: [errorEmbed(`No game found for universe ID ${universeId}.`)] });
      return interaction.editReply({ embeds: [baseEmbed().setDescription('✓ Roblox game info').addFields(
        { name: 'Name', value: game.name },
        { name: 'Creator', value: game.creator?.name ?? 'Unknown' },
        { name: 'Playing Now', value: String(game.playing ?? 0) },
        { name: 'Visits', value: String(game.visits ?? 0) },
        { name: 'Max Players', value: String(game.maxPlayers ?? 'N/A') },
        { name: 'Favourites', value: String(game.favoritedCount ?? 0) },
        { name: 'Universe ID', value: universeId }
      )] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /rankingaccount ────────────────────────────────────────────────────────
  if (commandName === 'rankingaccount') {
    if (!hasPermission(interaction.member)) return interaction.reply({ embeds: [errorEmbed('No permission.')], ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    try {
      const account = await getRankingAccountInfo();
      if (!account) return interaction.editReply({ embeds: [errorEmbed('Could not retrieve ranking account info. Cookie may be invalid.')] });
      const avatar = await getRobloxAvatar(account.id);
      const role = await getUserGroupRole(account.id);
      const embed = baseEmbed().setDescription('✓ Ranking account status').addFields(
        { name: 'Username', value: account.name },
        { name: 'Roblox ID', value: String(account.id) },
        { name: 'Group Rank', value: role?.name ?? 'Not in group' },
        { name: 'Cookie Status', value: '✓ Valid' }
      );
      if (avatar) embed.setThumbnail(avatar);
      return interaction.editReply({ embeds: [embed] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(`Cookie may be invalid or expired: ${err.message}`)] }); }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MODERATION COMMANDS
  // ══════════════════════════════════════════════════════════════════════════

  // ── /warn ──────────────────────────────────────────────────────────────────
  if (commandName === 'warn') {
    if (!hasPermission(interaction.member)) return interaction.reply({ embeds: [errorEmbed('No permission.')], ephemeral: true });
    const username = interaction.options.getString('username');
    const reason = interaction.options.getString('reason');
    await interaction.deferReply();
    try {
      const robloxUser = await getRobloxUserByUsername(username);
      const warnings = readJSON(WARNINGS_FILE);
      if (!warnings[robloxUser.id]) warnings[robloxUser.id] = [];
      warnings[robloxUser.id].push({ reason, warnedBy: interaction.user.tag, warnedById: interaction.user.id, timestamp: new Date().toISOString() });
      writeJSON(WARNINGS_FILE, warnings);
      pushAudit('WARN', interaction.user.tag, interaction.user.id, `${robloxUser.name} — ${reason}`);
      await sendLogToChannel(baseEmbed().setDescription('✗ Warning issued').addFields(
        { name: 'User', value: robloxUser.name },
        { name: 'Reason', value: reason },
        { name: 'Total Warnings', value: String(warnings[robloxUser.id].length) },
        { name: 'Staff', value: `<@${interaction.user.id}>` }
      ));
      return interaction.editReply({ embeds: [baseEmbed().setDescription('✓ Warning issued').addFields(
        { name: 'User', value: robloxUser.name },
        { name: 'Reason', value: reason },
        { name: 'Total Warnings', value: String(warnings[robloxUser.id].length) },
        { name: 'Issued By', value: interaction.user.tag }
      )] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /warnings ─────────────────────────────────────────────────────────────
  if (commandName === 'warnings') {
    if (!hasPermission(interaction.member)) return interaction.reply({ embeds: [errorEmbed('No permission.')], ephemeral: true });
    const username = interaction.options.getString('username');
    await interaction.deferReply({ ephemeral: true });
    try {
      const robloxUser = await getRobloxUserByUsername(username);
      const warnings = readJSON(WARNINGS_FILE)[robloxUser.id] || [];
      if (!warnings.length) return interaction.editReply({ embeds: [baseEmbed().setDescription(`No warnings for **${robloxUser.name}**.`)] });
      const lines = warnings.map((w, i) => `**${i + 1}.** ${w.reason}\n> by ${w.warnedBy} • ${new Date(w.timestamp).toLocaleDateString('en-GB')}`).join('\n\n');
      return interaction.editReply({ embeds: [baseEmbed().setDescription(`**Warnings for ${robloxUser.name} (${warnings.length} total)**\n\n${lines}`)] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /clearwarnings ────────────────────────────────────────────────────────
  if (commandName === 'clearwarnings') {
    if (!hasPermission(interaction.member)) return interaction.reply({ embeds: [errorEmbed('No permission.')], ephemeral: true });
    const username = interaction.options.getString('username');
    await interaction.deferReply({ ephemeral: true });
    try {
      const robloxUser = await getRobloxUserByUsername(username);
      const warnings = readJSON(WARNINGS_FILE);
      warnings[robloxUser.id] = [];
      writeJSON(WARNINGS_FILE, warnings);
      pushAudit('CLEARWARNINGS', interaction.user.tag, interaction.user.id, robloxUser.name);
      return interaction.editReply({ embeds: [baseEmbed().setDescription(`✓ Cleared all warnings for **${robloxUser.name}**.`)] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /addnote ───────────────────────────────────────────────────────────────
  if (commandName === 'addnote') {
    if (!hasPermission(interaction.member)) return interaction.reply({ embeds: [errorEmbed('No permission.')], ephemeral: true });
    const username = interaction.options.getString('username');
    const noteText = interaction.options.getString('note');
    await interaction.deferReply({ ephemeral: true });
    try {
      const robloxUser = await getRobloxUserByUsername(username);
      const notes = readJSON(NOTES_FILE);
      if (!notes[robloxUser.id]) notes[robloxUser.id] = [];
      notes[robloxUser.id].push({ note: noteText, addedBy: interaction.user.tag, addedById: interaction.user.id, timestamp: new Date().toISOString() });
      writeJSON(NOTES_FILE, notes);
      pushAudit('ADDNOTE', interaction.user.tag, interaction.user.id, `${robloxUser.name} — ${noteText}`);
      return interaction.editReply({ embeds: [baseEmbed().setDescription('✓ Note added').addFields(
        { name: 'User', value: robloxUser.name },
        { name: 'Note', value: noteText }
      )] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /notes ─────────────────────────────────────────────────────────────────
  if (commandName === 'notes') {
    if (!hasPermission(interaction.member)) return interaction.reply({ embeds: [errorEmbed('No permission.')], ephemeral: true });
    const username = interaction.options.getString('username');
    await interaction.deferReply({ ephemeral: true });
    try {
      const robloxUser = await getRobloxUserByUsername(username);
      const notes = readJSON(NOTES_FILE)[robloxUser.id] || [];
      if (!notes.length) return interaction.editReply({ embeds: [baseEmbed().setDescription(`No notes for **${robloxUser.name}**.`)] });
      const lines = notes.map((n, i) => `**${i + 1}.** ${n.note}\n> by ${n.addedBy} • ${new Date(n.timestamp).toLocaleDateString('en-GB')}`).join('\n\n');
      return interaction.editReply({ embeds: [baseEmbed().setDescription(`**Notes for ${robloxUser.name}**\n\n${lines}`)] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /clearnotes ────────────────────────────────────────────────────────────
  if (commandName === 'clearnotes') {
    if (!hasPermission(interaction.member)) return interaction.reply({ embeds: [errorEmbed('No permission.')], ephemeral: true });
    const username = interaction.options.getString('username');
    await interaction.deferReply({ ephemeral: true });
    try {
      const robloxUser = await getRobloxUserByUsername(username);
      const notes = readJSON(NOTES_FILE);
      notes[robloxUser.id] = [];
      writeJSON(NOTES_FILE, notes);
      return interaction.editReply({ embeds: [baseEmbed().setDescription(`✓ Cleared all notes for **${robloxUser.name}**.`)] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /blacklist ────────────────────────────────────────────────────────────
  if (commandName === 'blacklist') {
    if (!hasPermission(interaction.member)) return interaction.reply({ embeds: [errorEmbed('No permission.')], ephemeral: true });
    const username = interaction.options.getString('username');
    const reason = interaction.options.getString('reason');
    await interaction.deferReply();
    try {
      const robloxUser = await getRobloxUserByUsername(username);
      const bl = readJSON(BLACKLIST_FILE);
      if (bl.find(e => e.robloxId === robloxUser.id)) return interaction.editReply({ embeds: [errorEmbed(`${robloxUser.name} is already blacklisted.`)] });
      bl.push({ robloxId: robloxUser.id, robloxUsername: robloxUser.name, reason, addedBy: interaction.user.tag, addedById: interaction.user.id, timestamp: new Date().toISOString() });
      writeJSON(BLACKLIST_FILE, bl);
      pushAudit('BLACKLIST', interaction.user.tag, interaction.user.id, `${robloxUser.name} — ${reason}`);
      await sendLogToChannel(baseEmbed().setDescription('✗ User blacklisted').addFields(
        { name: 'User', value: robloxUser.name },
        { name: 'Reason', value: reason },
        { name: 'Staff', value: `<@${interaction.user.id}>` }
      ));
      return interaction.editReply({ embeds: [baseEmbed().setDescription('✓ User blacklisted from ranking').addFields(
        { name: 'User', value: robloxUser.name },
        { name: 'Reason', value: reason },
        { name: 'Added By', value: interaction.user.tag }
      )] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /unblacklist ──────────────────────────────────────────────────────────
  if (commandName === 'unblacklist') {
    if (!hasPermission(interaction.member)) return interaction.reply({ embeds: [errorEmbed('No permission.')], ephemeral: true });
    const username = interaction.options.getString('username');
    await interaction.deferReply();
    try {
      const robloxUser = await getRobloxUserByUsername(username);
      let bl = readJSON(BLACKLIST_FILE);
      if (!bl.find(e => e.robloxId === robloxUser.id)) return interaction.editReply({ embeds: [errorEmbed(`${robloxUser.name} is not blacklisted.`)] });
      bl = bl.filter(e => e.robloxId !== robloxUser.id);
      writeJSON(BLACKLIST_FILE, bl);
      pushAudit('UNBLACKLIST', interaction.user.tag, interaction.user.id, robloxUser.name);
      return interaction.editReply({ embeds: [baseEmbed().setDescription('✓ User removed from blacklist').addFields({ name: 'User', value: robloxUser.name })] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /blacklisted ──────────────────────────────────────────────────────────
  if (commandName === 'blacklisted') {
    const bl = readJSON(BLACKLIST_FILE);
    if (!bl.length) return interaction.reply({ embeds: [baseEmbed().setDescription('The blacklist is empty.')] });
    const lines = bl.map((e, i) => `**${i + 1}.** \`${e.robloxUsername}\` — ${e.reason}\n> by ${e.addedBy} • ${new Date(e.timestamp).toLocaleDateString('en-GB')}`).join('\n\n');
    return interaction.reply({ embeds: [baseEmbed().setDescription(`**Blacklist (${bl.length} users)**\n\n${lines}`)] });
  }

  // ── /watchlist ────────────────────────────────────────────────────────────
  if (commandName === 'watchlist') {
    if (!hasPermission(interaction.member)) return interaction.reply({ embeds: [errorEmbed('No permission.')], ephemeral: true });
    const action = interaction.options.getString('action').toLowerCase();
    const username = interaction.options.getString('username');
    if (action === 'view') {
      const wl = readJSON(WATCHLIST_FILE);
      if (!wl.length) return interaction.reply({ embeds: [baseEmbed().setDescription('Watchlist is empty.')] });
      const lines = wl.map((e, i) => `**${i + 1}.** \`${e.robloxUsername}\`\n> added by ${e.addedBy}`).join('\n\n');
      return interaction.reply({ embeds: [baseEmbed().setDescription(`**Watchlist (${wl.length})**\n\n${lines}`)] });
    }
    if (!username) return interaction.reply({ embeds: [errorEmbed('Username is required for add/remove.')], ephemeral: true });
    await interaction.deferReply();
    try {
      const robloxUser = await getRobloxUserByUsername(username);
      let wl = readJSON(WATCHLIST_FILE);
      if (action === 'add') {
        if (wl.find(e => e.robloxId === robloxUser.id)) return interaction.editReply({ embeds: [errorEmbed(`${robloxUser.name} is already on the watchlist.`)] });
        wl.push({ robloxId: robloxUser.id, robloxUsername: robloxUser.name, addedBy: interaction.user.tag, timestamp: new Date().toISOString() });
        writeJSON(WATCHLIST_FILE, wl);
        return interaction.editReply({ embeds: [baseEmbed().setDescription(`✓ Added **${robloxUser.name}** to the watchlist.`)] });
      }
      if (action === 'remove') {
        if (!wl.find(e => e.robloxId === robloxUser.id)) return interaction.editReply({ embeds: [errorEmbed(`${robloxUser.name} is not on the watchlist.`)] });
        wl = wl.filter(e => e.robloxId !== robloxUser.id);
        writeJSON(WATCHLIST_FILE, wl);
        return interaction.editReply({ embeds: [baseEmbed().setDescription(`✓ Removed **${robloxUser.name}** from the watchlist.`)] });
      }
      return interaction.editReply({ embeds: [errorEmbed('Invalid action. Use: add, remove, or view.')] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /kick ─────────────────────────────────────────────────────────────────
  if (commandName === 'kick') {
    if (!hasPermission(interaction.member)) return interaction.reply({ embeds: [errorEmbed('No permission.')], ephemeral: true });
    const username = interaction.options.getString('username');
    const reason = interaction.options.getString('reason');
    await interaction.deferReply();
    try {
      const robloxUser = await getRobloxUserByUsername(username);
      const oldRole = await getUserGroupRole(robloxUser.id);
      if (!oldRole) return interaction.editReply({ embeds: [errorEmbed(`${robloxUser.name} is not in the group.`)] });
      const changeId = `${interaction.id}-${Date.now()}`;
      pendingChanges.set(changeId, { userId: robloxUser.id, robloxUser, oldRole, reason, requesterId: interaction.user.id });
      setTimeout(() => pendingChanges.delete(changeId), 60_000);
      const embed = baseEmbed().setDescription('Confirm kicking this user from the group.').addFields(
        { name: 'User', value: robloxUser.name },
        { name: 'Current Rank', value: oldRole.name },
        { name: 'Reason', value: reason }
      );
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`kickconfirm::${changeId}`).setLabel('Confirm Kick').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`kickcancel::${changeId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
      );
      return interaction.editReply({ embeds: [embed], components: [row] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /appeal ────────────────────────────────────────────────────────────────
  if (commandName === 'appeal') {
    const username = interaction.options.getString('username');
    const reason = interaction.options.getString('reason');
    await interaction.deferReply({ ephemeral: true });
    try {
      const robloxUser = await getRobloxUserByUsername(username);
      const appeals = readJSON(APPEALS_FILE);
      const existing = appeals.find(a => a.robloxId === robloxUser.id && a.status === 'pending');
      if (existing) return interaction.editReply({ embeds: [errorEmbed('You already have a pending appeal.')] });
      const id = `app-${Date.now()}`;
      appeals.push({ id, robloxId: robloxUser.id, robloxUsername: robloxUser.name, discordId: interaction.user.id, discordTag: interaction.user.tag, reason, status: 'pending', timestamp: new Date().toISOString() });
      writeJSON(APPEALS_FILE, appeals);
      await sendLogToChannel(baseEmbed().setDescription('New rank appeal submitted').addFields(
        { name: 'Roblox User', value: robloxUser.name },
        { name: 'Discord', value: `<@${interaction.user.id}>` },
        { name: 'Reason', value: reason },
        { name: 'Appeal ID', value: id }
      ));
      return interaction.editReply({ embeds: [baseEmbed().setDescription('✓ Appeal submitted').addFields(
        { name: 'Appeal ID', value: id },
        { name: 'Roblox Username', value: robloxUser.name },
        { name: 'Reason', value: reason },
        { name: 'Status', value: 'Pending review' }
      )] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /appeals ───────────────────────────────────────────────────────────────
  if (commandName === 'appeals') {
    if (!hasPermission(interaction.member)) return interaction.reply({ embeds: [errorEmbed('No permission.')], ephemeral: true });
    const page = Math.max(1, interaction.options.getInteger('page') || 1);
    const PER_PAGE = 5;
    const pending = readJSON(APPEALS_FILE).filter(a => a.status === 'pending');
    if (!pending.length) return interaction.reply({ embeds: [baseEmbed().setDescription('No pending appeals.')] });
    const totalPages = Math.ceil(pending.length / PER_PAGE);
    const pageNum = Math.min(page, totalPages);
    const slice = pending.slice((pageNum - 1) * PER_PAGE, pageNum * PER_PAGE);
    const lines = slice.map((a, i) => {
      const date = new Date(a.timestamp).toLocaleDateString('en-GB');
      return `**${(pageNum - 1) * PER_PAGE + i + 1}.** \`${a.robloxUsername}\` — <@${a.discordId}>\n> ${a.reason}\n> ID: \`${a.id}\` • ${date}`;
    }).join('\n\n');
    return interaction.reply({ embeds: [baseEmbed().setDescription(`**Pending Appeals — Page ${pageNum}/${totalPages}**\n\n${lines}`)] });
  }

  // ── /resolveappeal ─────────────────────────────────────────────────────────
  if (commandName === 'resolveappeal') {
    if (!hasPermission(interaction.member)) return interaction.reply({ embeds: [errorEmbed('No permission.')], ephemeral: true });
    const id = interaction.options.getString('id');
    const decision = interaction.options.getString('decision').toLowerCase();
    const note = interaction.options.getString('note') || 'No additional note.';
    if (!['approve', 'deny'].includes(decision)) return interaction.reply({ embeds: [errorEmbed('Decision must be "approve" or "deny".')], ephemeral: true });
    const appeals = readJSON(APPEALS_FILE);
    const appeal = appeals.find(a => a.id === id);
    if (!appeal) return interaction.reply({ embeds: [errorEmbed(`Appeal \`${id}\` not found.`)], ephemeral: true });
    if (appeal.status !== 'pending') return interaction.reply({ embeds: [errorEmbed(`Appeal \`${id}\` is already resolved.`)], ephemeral: true });
    appeal.status = decision === 'approve' ? 'approved' : 'denied';
    appeal.resolvedBy = interaction.user.tag;
    appeal.resolvedById = interaction.user.id;
    appeal.resolvedAt = new Date().toISOString();
    appeal.note = note;
    writeJSON(APPEALS_FILE, appeals);
    pushAudit('RESOLVEAPPEAL', interaction.user.tag, interaction.user.id, `${id} — ${decision}`);
    return interaction.reply({ embeds: [baseEmbed().setDescription(`✓ Appeal ${decision === 'approve' ? 'approved' : 'denied'}`).addFields(
      { name: 'Appeal ID', value: id },
      { name: 'Roblox User', value: appeal.robloxUsername },
      { name: 'Decision', value: decision === 'approve' ? '✓ Approved' : '✗ Denied' },
      { name: 'Note', value: note },
      { name: 'Resolved By', value: interaction.user.tag }
    )] });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GROUP COMMANDS
  // ══════════════════════════════════════════════════════════════════════════

  // ── /groupinfo ─────────────────────────────────────────────────────────────
  if (commandName === 'groupinfo') {
    await interaction.deferReply();
    try {
      const [groupData, roles] = await Promise.all([getGroupInfo(), getGroupRoles()]);
      const roleList = roles.sort((a, b) => b.rank - a.rank).map(r => `**${r.name}** — Rank ${r.rank} (${r.memberCount} members)`).join('\n');
      const embed = baseEmbed().setDescription('✓ Group info').addFields(
        { name: 'Group Name', value: groupData.name },
        { name: 'Group ID', value: String(groupData.id) },
        { name: 'Total Members', value: String(groupData.memberCount) },
        { name: 'Owner', value: groupData.owner?.username ?? 'None' },
        { name: `Ranks (${roles.length})`, value: roleList || 'None' }
      );
      if (groupData.shout?.body) embed.addFields({ name: 'Current Shout', value: groupData.shout.body.slice(0, 200) });
      return interaction.editReply({ embeds: [embed] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /shout ────────────────────────────────────────────────────────────────
  if (commandName === 'shout') {
    if (!hasPermission(interaction.member)) return interaction.reply({ embeds: [errorEmbed('No permission.')], ephemeral: true });
    const message = interaction.options.getString('message');
    if (message.length > 255) return interaction.reply({ embeds: [errorEmbed('Shout must be 255 characters or less.')], ephemeral: true });
    await interaction.deferReply();
    const changeId = `${interaction.id}-${Date.now()}`;
    pendingChanges.set(changeId, { message, requesterId: interaction.user.id });
    setTimeout(() => pendingChanges.delete(changeId), 60_000);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`shoutconfirm::${changeId}`).setLabel('Post Shout').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`cancel::${changeId}`).setLabel('Cancel').setStyle(ButtonStyle.Danger)
    );
    return interaction.editReply({ embeds: [baseEmbed().setDescription('Confirm posting this group shout.').addFields({ name: 'Message', value: message })], components: [row] });
  }

  // ── /clearshout ────────────────────────────────────────────────────────────
  if (commandName === 'clearshout') {
    if (!hasPermission(interaction.member)) return interaction.reply({ embeds: [errorEmbed('No permission.')], ephemeral: true });
    await interaction.deferReply();
    const changeId = `${interaction.id}-${Date.now()}`;
    pendingChanges.set(changeId, { requesterId: interaction.user.id });
    setTimeout(() => pendingChanges.delete(changeId), 60_000);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`clearshoutconfirm::${changeId}`).setLabel('Clear Shout').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`cancel::${changeId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    );
    return interaction.editReply({ embeds: [baseEmbed().setDescription('Confirm clearing the group shout.')], components: [row] });
  }

  // ── /own ───────────────────────────────────────────────────────────────────
  if (commandName === 'own') {
    const username = interaction.options.getString('username');
    const gamePassId = interaction.options.getString('gamepassid');
    await interaction.deferReply();
    try {
      const robloxUser = await getRobloxUserByUsername(username);
      const owns = await checkGamePass(robloxUser.id, gamePassId);
      return interaction.editReply({ embeds: [baseEmbed().setDescription(owns ? '✓ Game pass owned' : '✗ Game pass not owned').addFields(
        { name: 'User', value: robloxUser.name },
        { name: 'Game Pass ID', value: gamePassId },
        { name: 'Status', value: owns ? '✓ Owns this pass' : '✗ Does not own this pass' }
      )] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /help ─────────────────────────────────────────────────────────────────
  if (commandName === 'help') {
    const sections = {
      'Bot': '`/bot-status` `/bot-info` `/status-change`',
      'Ranking': '`/changerank` `/massrank` `/checkrank` `/ranklist` `/rankinfo` `/rankcount` `/topranked` `/recentranks`',
      'Scheduled Ranks': '`/schedulerank` `/schedules` `/cancelschedule`',
      'Logs': '`/ranklog` `/stafflog` `/userlog` `/logstats` `/auditlog` `/clearlog`',
      'Roblox Profiles': '`/profile` `/badges` `/groups` `/gameinfo` `/rankingaccount`',
      'Verification': '`/verify` `/unverify` `/whois` `/whoverified` `/sync`',
      'Inventory': '`/own` `/checkinventory`',
      'Moderation': '`/warn` `/warnings` `/clearwarnings` `/addnote` `/notes` `/clearnotes` `/kick`',
      'Blacklist & Watch': '`/blacklist` `/unblacklist` `/blacklisted` `/watchlist`',
      'Appeals': '`/appeal` `/appeals` `/resolveappeal`',
      'Group': '`/groupinfo` `/shout` `/clearshout`',
    };
    const fields = Object.entries(sections).map(([name, value]) => ({ name, value }));
    return interaction.reply({ embeds: [baseEmbed().setDescription(`**Rank System — All Commands**\nMade by **Zaid** • ${commands.length} total commands`).addFields(...fields)], ephemeral: true });
  }
});

// ─── AUDIT LOGGER ─────────────────────────────────────────────────────────────
require('./auditLogger')(client);

// ─── BOOT ─────────────────────────────────────────────────────────────────────

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setActivity('the group', { type: ActivityType.Watching });
  await registerCommands();
  startScheduleRunner();
  console.log('Schedule runner started.');
  if (process.env.AUDIT_LOG_CHANNEL) {
    console.log(`Discord audit log active → channel ${process.env.AUDIT_LOG_CHANNEL}`);
  } else {
    console.log('AUDIT_LOG_CHANNEL not set — Discord audit log disabled.');
  }
});

client.login(DISCORD_TOKEN);
