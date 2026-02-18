require('dotenv').config();
const {
  Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes, ActivityType
} = require('discord.js');
const axios = require('axios');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// --- Keep-alive endpoint for Render ---
const express = require('express');
const app = express();

app.get('/', (req, res) => res.send('Bot is running!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Web server live on port ${PORT}`));

const DISCORD_TOKEN     = process.env.DISCORD_TOKEN;
const CLIENT_ID         = process.env.CLIENT_ID;
const GUILD_ID          = process.env.GUILD_ID;
const ROBLOX_COOKIE     = process.env.ROBLOX_COOKIE;
const GROUP_ID          = process.env.GROUP_ID;
const LOG_CHANNEL_ID    = process.env.LOG_CHANNEL_ID;
const AUDIT_LOG_CHANNEL = process.env.AUDIT_LOG_CHANNEL;
const ALLOWED_ROLES     = process.env.ALLOWED_ROLES ? process.env.ALLOWED_ROLES.split(',').map(r=>r.trim()) : [];

const FOOTER_ICON = 'https://cdn.discordapp.com/attachments/1473143652371927209/1473181303389290569/image.png?ex=6995ef41&is=69949dc1&hm=7bfda4ad5d3c84d2ae2bbf84f7a48c1174e0d09952cea66e0dd411e215e30c88&';
const THUMBNAIL   = FOOTER_ICON;
const BOT_START   = Date.now();

const DATA_DIR          = path.join(__dirname, 'data');
const LOGS_FILE         = path.join(DATA_DIR, 'ranklogs.json');
const VERIFIED_FILE     = path.join(DATA_DIR, 'verified.json');
const NOTES_FILE        = path.join(DATA_DIR, 'notes.json');
const WARNINGS_FILE     = path.join(DATA_DIR, 'warnings.json');
const BLACKLIST_FILE    = path.join(DATA_DIR, 'blacklist.json');
const WATCHLIST_FILE    = path.join(DATA_DIR, 'watchlist.json');
const APPEALS_FILE      = path.join(DATA_DIR, 'appeals.json');
const SCHEDULES_FILE    = path.join(DATA_DIR, 'schedules.json');
const AUDITLOG_FILE     = path.join(DATA_DIR, 'auditlog.json');
const TAGS_FILE         = path.join(DATA_DIR, 'tags.json');
const REMINDERS_FILE    = path.join(DATA_DIR, 'reminders.json');
const RANKROLES_FILE    = path.join(DATA_DIR, 'rankroles.json');
const BANNEDWORDS_FILE  = path.join(DATA_DIR, 'bannedwords.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
const initFile = (f,d) => { if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify(d)); };
[LOGS_FILE,APPEALS_FILE,SCHEDULES_FILE,AUDITLOG_FILE,REMINDERS_FILE,BANNEDWORDS_FILE].forEach(f=>initFile(f,[]));
[VERIFIED_FILE,NOTES_FILE,WARNINGS_FILE,TAGS_FILE,RANKROLES_FILE].forEach(f=>initFile(f,{}));
initFile(BLACKLIST_FILE,[]); initFile(WATCHLIST_FILE,[]);

const readJSON  = f => JSON.parse(fs.readFileSync(f,'utf8'));
const writeJSON = (f,d) => fs.writeFileSync(f, JSON.stringify(d,null,2));

function pushLog(e) { const l=readJSON(LOGS_FILE); l.unshift(e); if(l.length>2000)l.length=2000; writeJSON(LOGS_FILE,l); }
function pushAudit(action,tag,id,details) { const a=readJSON(AUDITLOG_FILE); a.unshift({timestamp:new Date().toISOString(),action,staffTag:tag,staffId:id,details}); if(a.length>1000)a.length=1000; writeJSON(AUDITLOG_FILE,a); }

const client = new Client({ intents: [
  GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildModeration,
  GatewayIntentBits.GuildInvites, GatewayIntentBits.GuildEmojisAndStickers,
]});

const rbx = axios.create({ timeout: 10000 });

async function getRobloxUser(username) {
  const r = await rbx.post('https://users.roblox.com/v1/usernames/users',{usernames:[username],excludeBannedUsers:false});
  const u = r.data.data[0]; if(!u) throw new Error(`User "${username}" not found.`); return u;
}
async function getRobloxUserById(id) { const r = await rbx.get(`https://users.roblox.com/v1/users/${id}`); return r.data; }
async function getGroupRoles() { const r = await rbx.get(`https://groups.roblox.com/v1/groups/${GROUP_ID}/roles`); return r.data.roles; }
async function getGroupInfo() { const r = await rbx.get(`https://groups.roblox.com/v1/groups/${GROUP_ID}`); return r.data; }
async function getUserGroupRole(uid) { const r = await rbx.get(`https://groups.roblox.com/v2/users/${uid}/groups/roles`); const m=r.data.data.find(g=>g.group.id===parseInt(GROUP_ID)); return m?m.role:null; }
async function getCsrf() { try { await rbx.post('https://auth.roblox.com/v2/logout',{},{headers:{Cookie:`.ROBLOSECURITY=${ROBLOX_COOKIE}`}}); } catch(e) { if(e.response?.headers['x-csrf-token']) return e.response.headers['x-csrf-token']; throw new Error('CSRF fail'); } }
async function setRank(uid,rid) { const c=await getCsrf(); await rbx.patch(`https://groups.roblox.com/v1/groups/${GROUP_ID}/users/${uid}`,{roleId:rid},{headers:{Cookie:`.ROBLOSECURITY=${ROBLOX_COOKIE}`,'X-CSRF-TOKEN':c}}); }
async function kickFromGroup(uid) { const c=await getCsrf(); await rbx.delete(`https://groups.roblox.com/v1/groups/${GROUP_ID}/users/${uid}`,{headers:{Cookie:`.ROBLOSECURITY=${ROBLOX_COOKIE}`,'X-CSRF-TOKEN':c}}); }
async function postShout(msg) { const c=await getCsrf(); await rbx.patch(`https://groups.roblox.com/v1/groups/${GROUP_ID}/status`,{message:msg},{headers:{Cookie:`.ROBLOSECURITY=${ROBLOX_COOKIE}`,'X-CSRF-TOKEN':c}}); }
async function getAvatar(uid) { try{ const r=await rbx.get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${uid}&size=150x150&format=Png`); return r.data.data[0]?.imageUrl||null; }catch{return null;} }
async function getFriendCount(uid) { try{ const r=await rbx.get(`https://friends.roblox.com/v1/users/${uid}/friends/count`); return r.data.count; }catch{return'N/A';} }
async function getFollowerCount(uid) { try{ const r=await rbx.get(`https://friends.roblox.com/v1/users/${uid}/followers/count`); return r.data.count; }catch{return'N/A';} }
async function getFollowingCount(uid) { try{ const r=await rbx.get(`https://friends.roblox.com/v1/users/${uid}/followings/count`); return r.data.count; }catch{return'N/A';} }
async function getUserGroups(uid) { try{ const r=await rbx.get(`https://groups.roblox.com/v2/users/${uid}/groups/roles`); return r.data.data||[]; }catch{return[];} }
async function getUserBadges(uid) { try{ const r=await rbx.get(`https://badges.roblox.com/v1/users/${uid}/badges?limit=10&sortOrder=Desc`); return r.data.data||[]; }catch{return[];} }
async function getGameInfo(uid) { const r=await rbx.get(`https://games.roblox.com/v1/games?universeIds=${uid}`); return r.data.data?.[0]||null; }
async function checkOwn(uid,type,aid) { const r=await rbx.get(`https://inventory.roblox.com/v1/users/${uid}/items/${type}/${aid}`); return r.data.data&&r.data.data.length>0; }
async function getAuthUser() { const r=await rbx.get('https://users.roblox.com/v1/users/authenticated',{headers:{Cookie:`.ROBLOSECURITY=${ROBLOX_COOKIE}`}}); return r.data; }
async function getRblxAudit(t='ChangeRank',n=10) { try{ const r=await rbx.get(`https://groups.roblox.com/v1/groups/${GROUP_ID}/audit-log?actionType=${t}&limit=${n}`,{headers:{Cookie:`.ROBLOSECURITY=${ROBLOX_COOKIE}`}}); return r.data.data||[]; }catch{return[];} }
async function getUserPresence(uid) { try{ const r=await rbx.post('https://presence.roblox.com/v1/presence/users',{userIds:[uid]}); return r.data.userPresences?.[0]||null; }catch{return null;} }
async function searchRblxUsers(kw) { try{ const r=await rbx.get(`https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(kw)}&limit=10`); return r.data.data||[]; }catch{return[];} }
async function getJoinRequests() { try{ const r=await rbx.get(`https://groups.roblox.com/v1/groups/${GROUP_ID}/join-requests?limit=10`,{headers:{Cookie:`.ROBLOSECURITY=${ROBLOX_COOKIE}`}}); return r.data.data||[]; }catch{return[];} }
async function acceptJoin(uid) { const c=await getCsrf(); await rbx.post(`https://groups.roblox.com/v1/groups/${GROUP_ID}/join-requests/users/${uid}`,{},{headers:{Cookie:`.ROBLOSECURITY=${ROBLOX_COOKIE}`,'X-CSRF-TOKEN':c}}); }
async function declineJoin(uid) { const c=await getCsrf(); await rbx.delete(`https://groups.roblox.com/v1/groups/${GROUP_ID}/join-requests/users/${uid}`,{headers:{Cookie:`.ROBLOSECURITY=${ROBLOX_COOKIE}`,'X-CSRF-TOKEN':c}}); }
async function getGroupWall(n=10) { try{ const r=await rbx.get(`https://groups.roblox.com/v2/groups/${GROUP_ID}/wall/posts?limit=${n}&sortOrder=Desc`); return r.data.data||[]; }catch{return[];} }
async function deleteWallPost(pid) { const c=await getCsrf(); await rbx.delete(`https://groups.roblox.com/v1/groups/${GROUP_ID}/wall/posts/${pid}`,{headers:{Cookie:`.ROBLOSECURITY=${ROBLOX_COOKIE}`,'X-CSRF-TOKEN':c}}); }
async function getRoleMembers(rid,n=10) { try{ const r=await rbx.get(`https://groups.roblox.com/v1/groups/${GROUP_ID}/roles/${rid}/users?limit=${n}`); return r.data.data||[]; }catch{return[];} }

function baseEmbed() { return new EmbedBuilder().setColor(0x111111).setThumbnail(THUMBNAIL).setTimestamp().setFooter({text:'Rank System',iconURL:FOOTER_ICON}); }
function errEmbed(d) { return new EmbedBuilder().setColor(0x222222).setThumbnail(THUMBNAIL).setDescription(`✗ ${d}`).setTimestamp().setFooter({text:'Rank System',iconURL:FOOTER_ICON}); }
function hasPerm(m) { if(!ALLOWED_ROLES.length) return true; return m.roles.cache.some(r=>ALLOWED_ROLES.includes(r.id)); }
async function sendLog(embed) { if(!LOG_CHANNEL_ID) return; try{ const ch=await client.channels.fetch(LOG_CHANNEL_ID); if(ch) await ch.send({embeds:[embed]}); }catch{} }
function fmtUptime(ms) { const s=Math.floor(ms/1000),m=Math.floor(s/60),h=Math.floor(m/60),d=Math.floor(h/24); if(d>0)return`${d}d ${h%24}h ${m%60}m`; if(h>0)return`${h}h ${m%60}m ${s%60}s`; if(m>0)return`${m}m ${s%60}s`; return`${s}s`; }
function trunc(s,n=1000) { if(!s)return'None'; return s.length>n?s.slice(0,n-3)+'...':s; }
function paginateLogs(logs,page,label='Rank Log') {
  const PER=10, total=Math.ceil(logs.length/PER), p=Math.min(Math.max(page,1),total);
  const slice=logs.slice((p-1)*PER,p*PER);
  const lines=slice.map((l,i)=>{
    const date=new Date(l.timestamp).toLocaleDateString('en-GB');
    const nr=l.newRank==='KICKED'?'**KICKED**':l.newRank==='EXILED'?'**EXILED**':l.newRank;
    return `**${(p-1)*PER+i+1}.** \`${l.robloxUsername}\` — ${l.oldRank} → ${nr}\n> <@${l.staffDiscordId}> • ${date}`;
  }).join('\n\n');
  return { embed: baseEmbed().setDescription(`**${label} — Page ${p}/${total}**\n\n${trunc(lines)}`).setFooter({text:`${logs.length} total entries`,iconURL:FOOTER_ICON}), total };
}

const pendingChanges = new Map();

// ── COMMANDS LIST ─────────────────────────────────────────────────────────────
const commands = [
  // BOT
  new SlashCommandBuilder().setName('bot-status').setDescription('Check bot health, uptime, ping, memory, stats.'),
  new SlashCommandBuilder().setName('bot-info').setDescription('Info about this bot — made by Zaid.'),
  new SlashCommandBuilder().setName('status-change').setDescription('Change bot activity status.')
    .addStringOption(o=>o.setName('message').setDescription('Status message').setRequired(true))
    .addStringOption(o=>o.setName('type').setDescription('Type').addChoices({name:'Watching',value:'watching'},{name:'Playing',value:'playing'},{name:'Listening',value:'listening'},{name:'Competing',value:'competing'})),
  new SlashCommandBuilder().setName('ping').setDescription('Check bot latency.'),
  new SlashCommandBuilder().setName('uptime').setDescription('How long the bot has been running.'),
  new SlashCommandBuilder().setName('help').setDescription('All commands by category.'),
  new SlashCommandBuilder().setName('commands').setDescription('Total command count.'),

  // RANKING CORE
  new SlashCommandBuilder().setName('changerank').setDescription('Change a user\'s group rank.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true))
    .addStringOption(o=>o.setName('rank').setDescription('New rank name').setRequired(true))
    .addStringOption(o=>o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('promote').setDescription('Promote a user one rank up.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true))
    .addStringOption(o=>o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('demote').setDescription('Demote a user one rank down.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true))
    .addStringOption(o=>o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('exile').setDescription('Kick AND permanently blacklist a user.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true))
    .addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true)),
  new SlashCommandBuilder().setName('massrank').setDescription('Rank up to 20 users to the same rank.')
    .addStringOption(o=>o.setName('usernames').setDescription('Comma-separated usernames').setRequired(true))
    .addStringOption(o=>o.setName('rank').setDescription('New rank name').setRequired(true)),
  new SlashCommandBuilder().setName('masspromote').setDescription('Promote up to 20 users one rank.')
    .addStringOption(o=>o.setName('usernames').setDescription('Comma-separated usernames').setRequired(true)),
  new SlashCommandBuilder().setName('massdemote').setDescription('Demote up to 20 users one rank.')
    .addStringOption(o=>o.setName('usernames').setDescription('Comma-separated usernames').setRequired(true)),
  new SlashCommandBuilder().setName('masskick').setDescription('Kick up to 10 users from the group.')
    .addStringOption(o=>o.setName('usernames').setDescription('Comma-separated usernames').setRequired(true))
    .addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true)),
  new SlashCommandBuilder().setName('setrank').setDescription('Set rank by rank NUMBER.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true))
    .addIntegerOption(o=>o.setName('ranknumber').setDescription('Rank number 1-255').setRequired(true)),
  new SlashCommandBuilder().setName('rankbyid').setDescription('Change rank using Roblox User ID.')
    .addStringOption(o=>o.setName('userid').setDescription('Roblox User ID').setRequired(true))
    .addStringOption(o=>o.setName('rank').setDescription('New rank name').setRequired(true)),

  // RANK INFO
  new SlashCommandBuilder().setName('checkrank').setDescription('Check a user\'s current group rank.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true)),
  new SlashCommandBuilder().setName('ranklist').setDescription('All ranks with member counts.'),
  new SlashCommandBuilder().setName('rankinfo').setDescription('Detailed info about a specific rank.')
    .addStringOption(o=>o.setName('rank').setDescription('Rank name').setRequired(true)),
  new SlashCommandBuilder().setName('rankcount').setDescription('Member count per rank sorted.'),
  new SlashCommandBuilder().setName('topranked').setDescription('Top highest-rank members.'),
  new SlashCommandBuilder().setName('rankhistory').setDescription('Rank history for a user from the log.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true)),
  new SlashCommandBuilder().setName('rankmembers').setDescription('List members in a specific rank.')
    .addStringOption(o=>o.setName('rank').setDescription('Rank name').setRequired(true)),
  new SlashCommandBuilder().setName('rankcompare').setDescription('Compare two users\' ranks.')
    .addStringOption(o=>o.setName('user1').setDescription('First username').setRequired(true))
    .addStringOption(o=>o.setName('user2').setDescription('Second username').setRequired(true)),
  new SlashCommandBuilder().setName('rankpercentage').setDescription('% of group in each rank.'),
  new SlashCommandBuilder().setName('findrankbynum').setDescription('Find rank by its number.')
    .addIntegerOption(o=>o.setName('number').setDescription('Rank number').setRequired(true)),

  // SCHEDULED
  new SlashCommandBuilder().setName('schedulerank').setDescription('Schedule a rank change.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true))
    .addStringOption(o=>o.setName('rank').setDescription('New rank name').setRequired(true))
    .addIntegerOption(o=>o.setName('minutes').setDescription('Minutes from now').setRequired(true)),
  new SlashCommandBuilder().setName('schedulepromote').setDescription('Schedule a promotion.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true))
    .addIntegerOption(o=>o.setName('minutes').setDescription('Minutes from now').setRequired(true)),
  new SlashCommandBuilder().setName('scheduledemote').setDescription('Schedule a demotion.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true))
    .addIntegerOption(o=>o.setName('minutes').setDescription('Minutes from now').setRequired(true)),
  new SlashCommandBuilder().setName('scheduleexile').setDescription('Schedule a permanent exile.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true))
    .addIntegerOption(o=>o.setName('minutes').setDescription('Minutes from now').setRequired(true))
    .addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true)),
  new SlashCommandBuilder().setName('schedules').setDescription('View pending scheduled actions.'),
  new SlashCommandBuilder().setName('cancelschedule').setDescription('Cancel a schedule by ID.')
    .addStringOption(o=>o.setName('id').setDescription('Schedule ID').setRequired(true)),
  new SlashCommandBuilder().setName('clearschedules').setDescription('Cancel ALL pending schedules.'),

  // LOGS
  new SlashCommandBuilder().setName('ranklog').setDescription('Browse rank change history.')
    .addIntegerOption(o=>o.setName('page').setDescription('Page')),
  new SlashCommandBuilder().setName('stafflog').setDescription('Rank changes by a staff member.')
    .addUserOption(o=>o.setName('staff').setDescription('Discord user').setRequired(true))
    .addIntegerOption(o=>o.setName('page').setDescription('Page')),
  new SlashCommandBuilder().setName('userlog').setDescription('Rank history for a Roblox user.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true))
    .addIntegerOption(o=>o.setName('page').setDescription('Page')),
  new SlashCommandBuilder().setName('logstats').setDescription('Stats from the rank log.'),
  new SlashCommandBuilder().setName('auditlog').setDescription('Internal bot audit log.')
    .addIntegerOption(o=>o.setName('page').setDescription('Page')),
  new SlashCommandBuilder().setName('recentranks').setDescription('Last 10 rank changes from Roblox.'),
  new SlashCommandBuilder().setName('recentkicks').setDescription('Last 10 kicks from Roblox.'),
  new SlashCommandBuilder().setName('recentbans').setDescription('Recent blacklists.'),
  new SlashCommandBuilder().setName('todaylogs').setDescription('All rank changes today.'),
  new SlashCommandBuilder().setName('weeklylogs').setDescription('Rank changes this week.'),
  new SlashCommandBuilder().setName('monthlylogs').setDescription('Rank changes this month.'),
  new SlashCommandBuilder().setName('clearlog').setDescription('Wipe the entire rank log.'),
  new SlashCommandBuilder().setName('exportlog').setDescription('Export rank log as a text file.'),
  new SlashCommandBuilder().setName('logsearch').setDescription('Search the log.')
    .addStringOption(o=>o.setName('query').setDescription('Username, rank, or staff tag').setRequired(true)),

  // ROBLOX USER INFO
  new SlashCommandBuilder().setName('profile').setDescription('Full Roblox profile.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true)),
  new SlashCommandBuilder().setName('profilebyid').setDescription('Full profile by User ID.')
    .addStringOption(o=>o.setName('userid').setDescription('Roblox User ID').setRequired(true)),
  new SlashCommandBuilder().setName('badges').setDescription('Recent badges for a user.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true)),
  new SlashCommandBuilder().setName('groups').setDescription('All Roblox groups a user is in.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true)),
  new SlashCommandBuilder().setName('friends').setDescription('Friend count.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true)),
  new SlashCommandBuilder().setName('followers').setDescription('Followers & following count.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true)),
  new SlashCommandBuilder().setName('userstatus').setDescription('Is user online/in-game?')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true)),
  new SlashCommandBuilder().setName('useringroups').setDescription('Check if user is in a specific group.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true))
    .addStringOption(o=>o.setName('groupid').setDescription('Group ID').setRequired(true)),
  new SlashCommandBuilder().setName('searchuser').setDescription('Search for Roblox users.')
    .addStringOption(o=>o.setName('keyword').setDescription('Search keyword').setRequired(true)),
  new SlashCommandBuilder().setName('accountage').setDescription('How old is a Roblox account?')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true)),
  new SlashCommandBuilder().setName('isbanned').setDescription('Is a Roblox user banned?')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true)),
  new SlashCommandBuilder().setName('lookupid').setDescription('Get username from User ID.')
    .addStringOption(o=>o.setName('userid').setDescription('Roblox User ID').setRequired(true)),

  // GROUP
  new SlashCommandBuilder().setName('groupinfo').setDescription('Full group info.'),
  new SlashCommandBuilder().setName('groupmembers').setDescription('Total group member count.'),
  new SlashCommandBuilder().setName('groupowner').setDescription('Who owns the group.'),
  new SlashCommandBuilder().setName('groupshout').setDescription('Show current group shout.'),
  new SlashCommandBuilder().setName('groupwall').setDescription('Latest 10 group wall posts.'),
  new SlashCommandBuilder().setName('deletewallpost').setDescription('Delete a wall post.')
    .addStringOption(o=>o.setName('postid').setDescription('Wall post ID').setRequired(true)),
  new SlashCommandBuilder().setName('joinrequests').setDescription('Pending group join requests.'),
  new SlashCommandBuilder().setName('acceptjoin').setDescription('Accept a join request.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true)),
  new SlashCommandBuilder().setName('declinejoin').setDescription('Decline a join request.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true)),
  new SlashCommandBuilder().setName('groupgames').setDescription('Roblox game info by Universe ID.')
    .addStringOption(o=>o.setName('universeid').setDescription('Universe ID').setRequired(true)),

  // SHOUT
  new SlashCommandBuilder().setName('shout').setDescription('Post a group shout.')
    .addStringOption(o=>o.setName('message').setDescription('Shout (max 255 chars)').setRequired(true)),
  new SlashCommandBuilder().setName('clearshout').setDescription('Clear the group shout.'),
  new SlashCommandBuilder().setName('shouthistory').setDescription('Recent shouts from bot log.'),

  // VERIFICATION
  new SlashCommandBuilder().setName('verify').setDescription('Link Discord to Roblox.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true)),
  new SlashCommandBuilder().setName('unverify').setDescription('Remove your Discord-Roblox link.'),
  new SlashCommandBuilder().setName('whois').setDescription('Discord user\'s linked Roblox info.')
    .addUserOption(o=>o.setName('user').setDescription('Discord user').setRequired(true)),
  new SlashCommandBuilder().setName('whoverified').setDescription('Which Discord is this Roblox linked to?')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true)),
  new SlashCommandBuilder().setName('sync').setDescription('Sync verified user\'s Discord roles.')
    .addUserOption(o=>o.setName('user').setDescription('Discord user').setRequired(true)),
  new SlashCommandBuilder().setName('syncall').setDescription('Sync ALL verified users\' roles.'),
  new SlashCommandBuilder().setName('verifiedlist').setDescription('All verified Discord-Roblox pairs.')
    .addIntegerOption(o=>o.setName('page').setDescription('Page')),
  new SlashCommandBuilder().setName('unverifyuser').setDescription('Force-unverify a Discord user.')
    .addUserOption(o=>o.setName('user').setDescription('Discord user').setRequired(true)),
  new SlashCommandBuilder().setName('forceverify').setDescription('Force-link Discord user to Roblox.')
    .addUserOption(o=>o.setName('user').setDescription('Discord user').setRequired(true))
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true)),
  new SlashCommandBuilder().setName('setverifiedrole').setDescription('Role to give on /verify.')
    .addRoleOption(o=>o.setName('role').setDescription('Discord role').setRequired(true)),
  new SlashCommandBuilder().setName('rankroles').setDescription('View rank → Discord role mappings.'),
  new SlashCommandBuilder().setName('setrankrole').setDescription('Map a Roblox rank to a Discord role.')
    .addStringOption(o=>o.setName('rank').setDescription('Roblox rank name').setRequired(true))
    .addRoleOption(o=>o.setName('role').setDescription('Discord role').setRequired(true)),
  new SlashCommandBuilder().setName('removerankrole').setDescription('Remove a rank→role mapping.')
    .addStringOption(o=>o.setName('rank').setDescription('Roblox rank name').setRequired(true)),

  // INVENTORY
  new SlashCommandBuilder().setName('own').setDescription('Check if user owns a game pass.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true))
    .addStringOption(o=>o.setName('gamepassid').setDescription('Game Pass ID').setRequired(true)),
  new SlashCommandBuilder().setName('ownbadge').setDescription('Check if user owns a badge.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true))
    .addStringOption(o=>o.setName('badgeid').setDescription('Badge ID').setRequired(true)),
  new SlashCommandBuilder().setName('checkinventory').setDescription('Check ownership of any asset.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true))
    .addStringOption(o=>o.setName('type').setDescription('Asset type').setRequired(true).addChoices({name:'Game Pass',value:'GamePass'},{name:'Badge',value:'Badge'},{name:'Asset',value:'Asset'}))
    .addStringOption(o=>o.setName('assetid').setDescription('Asset ID').setRequired(true)),
  new SlashCommandBuilder().setName('gameinfo').setDescription('Info about a Roblox game.')
    .addStringOption(o=>o.setName('universeid').setDescription('Universe ID').setRequired(true)),
  new SlashCommandBuilder().setName('rankingaccount').setDescription('Check the ranking bot\'s Roblox account.'),

  // MODERATION
  new SlashCommandBuilder().setName('warn').setDescription('Issue a warning to a user.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true))
    .addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true)),
  new SlashCommandBuilder().setName('warnings').setDescription('View warnings for a user.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true)),
  new SlashCommandBuilder().setName('clearwarnings').setDescription('Clear all warnings for a user.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true)),
  new SlashCommandBuilder().setName('deletewarn').setDescription('Delete a single warning by number.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true))
    .addIntegerOption(o=>o.setName('number').setDescription('Warning #').setRequired(true)),
  new SlashCommandBuilder().setName('addnote').setDescription('Add a staff note to a user.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true))
    .addStringOption(o=>o.setName('note').setDescription('Note').setRequired(true)),
  new SlashCommandBuilder().setName('notes').setDescription('View notes on a user.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true)),
  new SlashCommandBuilder().setName('clearnotes').setDescription('Clear all notes on a user.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true)),
  new SlashCommandBuilder().setName('deletenote').setDescription('Delete a single note by number.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true))
    .addIntegerOption(o=>o.setName('number').setDescription('Note #').setRequired(true)),
  new SlashCommandBuilder().setName('kick').setDescription('Kick a user from the group.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true))
    .addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true)),

  // BLACKLIST
  new SlashCommandBuilder().setName('blacklist').setDescription('Blacklist a user from ranking.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true))
    .addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true)),
  new SlashCommandBuilder().setName('unblacklist').setDescription('Remove from blacklist.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true)),
  new SlashCommandBuilder().setName('blacklisted').setDescription('View the blacklist.')
    .addIntegerOption(o=>o.setName('page').setDescription('Page')),
  new SlashCommandBuilder().setName('isblacklisted').setDescription('Check if user is blacklisted.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true)),
  new SlashCommandBuilder().setName('blacklistreason').setDescription('See why user was blacklisted.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true)),
  new SlashCommandBuilder().setName('clearblacklist').setDescription('Clear the entire blacklist.'),

  // WATCHLIST
  new SlashCommandBuilder().setName('watchlist').setDescription('Manage the watchlist.')
    .addStringOption(o=>o.setName('action').setDescription('add / remove / view').setRequired(true))
    .addStringOption(o=>o.setName('username').setDescription('Roblox username')),
  new SlashCommandBuilder().setName('iswatched').setDescription('Is user on watchlist?')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true)),
  new SlashCommandBuilder().setName('addwatch').setDescription('Add to watchlist with reason.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true))
    .addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true)),

  // APPEALS
  new SlashCommandBuilder().setName('appeal').setDescription('Submit a rank appeal.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true))
    .addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true)),
  new SlashCommandBuilder().setName('appeals').setDescription('View pending appeals (staff).')
    .addIntegerOption(o=>o.setName('page').setDescription('Page')),
  new SlashCommandBuilder().setName('resolveappeal').setDescription('Approve or deny an appeal.')
    .addStringOption(o=>o.setName('id').setDescription('Appeal ID').setRequired(true))
    .addStringOption(o=>o.setName('decision').setDescription('approve or deny').setRequired(true))
    .addStringOption(o=>o.setName('note').setDescription('Note to user')),
  new SlashCommandBuilder().setName('appealstatus').setDescription('Check status of your appeal.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true)),
  new SlashCommandBuilder().setName('allappeals').setDescription('View all appeals (pending + resolved).')
    .addIntegerOption(o=>o.setName('page').setDescription('Page')),
  new SlashCommandBuilder().setName('clearappeals').setDescription('Clear resolved appeals.'),

  // TAGS
  new SlashCommandBuilder().setName('tag').setDescription('Send a saved quick response.')
    .addStringOption(o=>o.setName('name').setDescription('Tag name').setRequired(true)),
  new SlashCommandBuilder().setName('addtag').setDescription('Create a tag.')
    .addStringOption(o=>o.setName('name').setDescription('Tag name').setRequired(true))
    .addStringOption(o=>o.setName('content').setDescription('Content').setRequired(true)),
  new SlashCommandBuilder().setName('edittag').setDescription('Edit a tag.')
    .addStringOption(o=>o.setName('name').setDescription('Tag name').setRequired(true))
    .addStringOption(o=>o.setName('content').setDescription('New content').setRequired(true)),
  new SlashCommandBuilder().setName('deletetag').setDescription('Delete a tag.')
    .addStringOption(o=>o.setName('name').setDescription('Tag name').setRequired(true)),
  new SlashCommandBuilder().setName('tags').setDescription('List all tags.'),

  // REMINDERS
  new SlashCommandBuilder().setName('remind').setDescription('Set a DM reminder.')
    .addIntegerOption(o=>o.setName('minutes').setDescription('Minutes from now').setRequired(true))
    .addStringOption(o=>o.setName('message').setDescription('Reminder message').setRequired(true)),
  new SlashCommandBuilder().setName('myreminders').setDescription('Your pending reminders.'),
  new SlashCommandBuilder().setName('cancelreminder').setDescription('Cancel a reminder.')
    .addIntegerOption(o=>o.setName('number').setDescription('Reminder #').setRequired(true)),

  // STAFF TOOLS
  new SlashCommandBuilder().setName('staffstats').setDescription('Rank actions per staff member.')
    .addIntegerOption(o=>o.setName('days').setDescription('Days to look back')),
  new SlashCommandBuilder().setName('topstaff').setDescription('Leaderboard of most active rankers.'),
  new SlashCommandBuilder().setName('staffactivity').setDescription('Has a staff member been active?')
    .addUserOption(o=>o.setName('staff').setDescription('Discord user').setRequired(true))
    .addIntegerOption(o=>o.setName('days').setDescription('Days to check')),
  new SlashCommandBuilder().setName('inactivestaffs').setDescription('Staff with no actions in 7 days.'),
  new SlashCommandBuilder().setName('staffcheck').setDescription('Is this user a staff member?')
    .addUserOption(o=>o.setName('user').setDescription('Discord user').setRequired(true)),

  // UTILITY
  new SlashCommandBuilder().setName('serverinfo').setDescription('Discord server information.'),
  new SlashCommandBuilder().setName('userinfo').setDescription('Discord user info.')
    .addUserOption(o=>o.setName('user').setDescription('Discord user')),
  new SlashCommandBuilder().setName('roleinfo').setDescription('Discord role info.')
    .addRoleOption(o=>o.setName('role').setDescription('Role').setRequired(true)),
  new SlashCommandBuilder().setName('channelinfo').setDescription('Discord channel info.')
    .addChannelOption(o=>o.setName('channel').setDescription('Channel')),
  new SlashCommandBuilder().setName('membercount').setDescription('Server member count.'),
  new SlashCommandBuilder().setName('boostinfo').setDescription('Server boost level and count.'),
  new SlashCommandBuilder().setName('timestamp').setDescription('Convert date to Discord timestamp.')
    .addStringOption(o=>o.setName('date').setDescription('Date (YYYY-MM-DD or "now")').setRequired(true)),
  new SlashCommandBuilder().setName('calculate').setDescription('Quick math calculator.')
    .addStringOption(o=>o.setName('expression').setDescription('Math expression').setRequired(true)),
  new SlashCommandBuilder().setName('say').setDescription('Make the bot say something.')
    .addStringOption(o=>o.setName('message').setDescription('Message').setRequired(true))
    .addChannelOption(o=>o.setName('channel').setDescription('Channel')),
  new SlashCommandBuilder().setName('embed').setDescription('Send a custom embed.')
    .addStringOption(o=>o.setName('title').setDescription('Title').setRequired(true))
    .addStringOption(o=>o.setName('description').setDescription('Description').setRequired(true))
    .addChannelOption(o=>o.setName('channel').setDescription('Channel')),
  new SlashCommandBuilder().setName('poll').setDescription('Create a yes/no poll.')
    .addStringOption(o=>o.setName('question').setDescription('Poll question').setRequired(true)),
  new SlashCommandBuilder().setName('announce').setDescription('Send an announcement embed.')
    .addStringOption(o=>o.setName('message').setDescription('Content').setRequired(true))
    .addChannelOption(o=>o.setName('channel').setDescription('Channel')),
  new SlashCommandBuilder().setName('avatar').setDescription('Show a Discord user\'s avatar.')
    .addUserOption(o=>o.setName('user').setDescription('Discord user')),

  // CONFIG
  new SlashCommandBuilder().setName('config').setDescription('View bot configuration.'),
  new SlashCommandBuilder().setName('setlogchannel').setDescription('Set the rank log channel.')
    .addChannelOption(o=>o.setName('channel').setDescription('Channel').setRequired(true)),
  new SlashCommandBuilder().setName('setauditchannel').setDescription('Set the audit log channel.')
    .addChannelOption(o=>o.setName('channel').setDescription('Channel').setRequired(true)),
  new SlashCommandBuilder().setName('addbannedword').setDescription('Add a banned word.')
    .addStringOption(o=>o.setName('word').setDescription('Word').setRequired(true)),
  new SlashCommandBuilder().setName('removebannedword').setDescription('Remove a banned word.')
    .addStringOption(o=>o.setName('word').setDescription('Word').setRequired(true)),
  new SlashCommandBuilder().setName('bannedwords').setDescription('View all banned words.'),
  new SlashCommandBuilder().setName('cleardata').setDescription('Wipe all bot data for a Roblox user.')
    .addStringOption(o=>o.setName('username').setDescription('Roblox username').setRequired(true)),
];

async function registerCommands() {
  const rest = new REST({version:'10'}).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID,GUILD_ID),{body:commands.map(c=>c.toJSON())});
  console.log(`✓ Registered ${commands.length} commands.`);
}

// ─── SCHEDULE RUNNER ──────────────────────────────────────────────────────────
function startScheduleRunner() {
  setInterval(async () => {
    const schedules = readJSON(SCHEDULES_FILE);
    const due = schedules.filter(s=>!s.done && new Date(s.executeAt).getTime()<=Date.now());
    if(!due.length) return;
    for(const s of due) {
      try {
        if(s.type==='rank') await setRank(s.robloxId,s.newRoleId);
        if(s.type==='kick') await kickFromGroup(s.robloxId);
        if(s.type==='exile') {
          await kickFromGroup(s.robloxId);
          const bl=readJSON(BLACKLIST_FILE);
          if(!bl.find(e=>e.robloxId===s.robloxId)) { bl.push({robloxId:s.robloxId,robloxUsername:s.robloxUsername,reason:s.reason||'Scheduled exile',addedBy:s.staffTag,addedById:s.staffId,timestamp:new Date().toISOString()}); writeJSON(BLACKLIST_FILE,bl); }
        }
        pushLog({timestamp:new Date().toISOString(),staffDiscordId:s.staffId,staffTag:s.staffTag,robloxUsername:s.robloxUsername,robloxId:s.robloxId,oldRank:s.oldRank,newRank:s.newRank||'KICKED',note:`Scheduled ${s.type}`});
        await sendLog(baseEmbed().setDescription(`✓ Scheduled ${s.type} executed`).addFields({name:'User',value:s.robloxUsername},{name:'Scheduled By',value:`<@${s.staffId}>`}));
        s.done=true; s.completedAt=new Date().toISOString();
      } catch(err) { s.done=true; s.error=err.message; }
    }
    writeJSON(SCHEDULES_FILE,schedules);
  },15_000);
}

function startReminderRunner() {
  setInterval(async () => {
    const reminders=readJSON(REMINDERS_FILE);
    const due=reminders.filter(r=>!r.done&&new Date(r.fireAt).getTime()<=Date.now());
    for(const r of due) {
      try { const user=await client.users.fetch(r.userId); await user.send({embeds:[baseEmbed().setDescription(`⏰ Reminder: **${r.message}**`)]}); r.done=true; }
      catch { r.done=true; }
    }
    writeJSON(REMINDERS_FILE,reminders);
  },10_000);
}

// ─── BUTTON HANDLER ───────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  if(interaction.isButton()) {
    const [action,changeId]=interaction.customId.split('::');
    const pending=pendingChanges.get(changeId);
    if(!pending) return interaction.reply({embeds:[errEmbed('Confirmation expired.')],ephemeral:true});
    if(interaction.user.id!==pending.requesterId) return interaction.reply({embeds:[errEmbed('Only the command author can confirm.')],ephemeral:true});
    pendingChanges.delete(changeId);

    if(['cancel','masscancel','kickcancel','exilecancel'].includes(action))
      return interaction.update({embeds:[baseEmbed().setDescription('✗ Action cancelled.')],components:[]});

    if(action==='confirm') {
      await interaction.deferUpdate();
      try {
        await setRank(pending.userId,pending.newRoleId);
        const old=pending.oldRole?.name??'Guest';
        pushLog({timestamp:new Date().toISOString(),staffDiscordId:pending.requesterId,staffTag:interaction.user.tag,robloxUsername:pending.robloxUser.name,robloxId:pending.userId,oldRank:old,newRank:pending.newRole.name,reason:pending.reason||''});
        pushAudit('CHANGERANK',interaction.user.tag,interaction.user.id,`${pending.robloxUser.name}: ${old} → ${pending.newRole.name}`);
        await sendLog(baseEmbed().setDescription('✓ Rank change').addFields({name:'User',value:pending.robloxUser.name,inline:true},{name:'Old',value:old,inline:true},{name:'New',value:pending.newRole.name,inline:true},{name:'Staff',value:`<@${pending.requesterId}>`,inline:true},{name:'Reason',value:pending.reason||'None',inline:true}));
        // auto role
        const rr=readJSON(RANKROLES_FILE); const dRoleId=rr[pending.newRole.name.toLowerCase()]; let roleNote='';
        if(dRoleId) { try { const v=readJSON(VERIFIED_FILE); const e=Object.entries(v).find(([,vv])=>vv.robloxId===pending.userId); if(e){ const m=await interaction.guild.members.fetch(e[0]).catch(()=>null); if(m){await m.roles.add(dRoleId);roleNote=`\n✓ Discord role assigned`;}}} catch{}}
        return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Rank changed'+roleNote).addFields({name:'User',value:pending.robloxUser.name,inline:true},{name:'Old Rank',value:old,inline:true},{name:'New Rank',value:pending.newRole.name,inline:true},{name:'Reason',value:pending.reason||'None'})],components:[]});
      } catch(err){return interaction.editReply({embeds:[errEmbed(err.message)],components:[]});}
    }

    if(action==='massconfirm') {
      await interaction.deferUpdate();
      const {users,newRole}=pending; const success=[],failed=[];
      let csrf; try{csrf=await getCsrf();}catch{return interaction.editReply({embeds:[errEmbed('CSRF fail')],components:[]});}
      for(const u of users) {
        try { await rbx.patch(`https://groups.roblox.com/v1/groups/${GROUP_ID}/users/${u.robloxUser.id}`,{roleId:newRole.id},{headers:{Cookie:`.ROBLOSECURITY=${ROBLOX_COOKIE}`,'X-CSRF-TOKEN':csrf}}); pushLog({timestamp:new Date().toISOString(),staffDiscordId:pending.requesterId,staffTag:interaction.user.tag,robloxUsername:u.robloxUser.name,robloxId:u.robloxUser.id,oldRank:u.oldRole?.name??'Guest',newRank:newRole.name}); success.push(u.robloxUser.name); }
        catch { failed.push(u.robloxUser.name); }
      }
      pushAudit('MASSRANK',interaction.user.tag,interaction.user.id,`${success.length} → ${newRole.name}`);
      await sendLog(baseEmbed().setDescription('✓ Mass rank').addFields({name:'New Rank',value:newRole.name},{name:'Success',value:String(success.length),inline:true},{name:'Failed',value:String(failed.length),inline:true},{name:'Staff',value:`<@${pending.requesterId}>`}));
      return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Mass rank complete').addFields({name:'New Rank',value:newRole.name},{name:`✓ Success (${success.length})`,value:success.join('\n')||'None'},...(failed.length?[{name:`✗ Failed (${failed.length})`,value:failed.join('\n')}]:[]))],components:[]});
    }

    if(action==='kickconfirm') {
      await interaction.deferUpdate();
      try {
        await kickFromGroup(pending.userId);
        pushLog({timestamp:new Date().toISOString(),staffDiscordId:pending.requesterId,staffTag:interaction.user.tag,robloxUsername:pending.robloxUser.name,robloxId:pending.userId,oldRank:pending.oldRole?.name??'Guest',newRank:'KICKED',reason:pending.reason});
        pushAudit('KICK',interaction.user.tag,interaction.user.id,`${pending.robloxUser.name} — ${pending.reason}`);
        await sendLog(baseEmbed().setDescription('✗ Group kick').addFields({name:'User',value:pending.robloxUser.name},{name:'Rank',value:pending.oldRole?.name??'Guest'},{name:'Reason',value:pending.reason},{name:'Staff',value:`<@${pending.requesterId}>`}));
        return interaction.editReply({embeds:[baseEmbed().setDescription(`✓ **${pending.robloxUser.name}** kicked`).addFields({name:'Reason',value:pending.reason})],components:[]});
      } catch(err){return interaction.editReply({embeds:[errEmbed(err.message)],components:[]});}
    }

    if(action==='exileconfirm') {
      await interaction.deferUpdate();
      try {
        await kickFromGroup(pending.userId);
        const bl=readJSON(BLACKLIST_FILE);
        if(!bl.find(e=>e.robloxId===pending.userId)){bl.push({robloxId:pending.userId,robloxUsername:pending.robloxUser.name,reason:pending.reason,addedBy:interaction.user.tag,addedById:interaction.user.id,timestamp:new Date().toISOString()});writeJSON(BLACKLIST_FILE,bl);}
        pushLog({timestamp:new Date().toISOString(),staffDiscordId:pending.requesterId,staffTag:interaction.user.tag,robloxUsername:pending.robloxUser.name,robloxId:pending.userId,oldRank:pending.oldRole?.name??'Guest',newRank:'EXILED',reason:pending.reason});
        pushAudit('EXILE',interaction.user.tag,interaction.user.id,`${pending.robloxUser.name} — ${pending.reason}`);
        await sendLog(baseEmbed().setDescription('✗ User exiled').addFields({name:'User',value:pending.robloxUser.name},{name:'Reason',value:pending.reason},{name:'Staff',value:`<@${pending.requesterId}>`}));
        return interaction.editReply({embeds:[baseEmbed().setDescription(`✓ **${pending.robloxUser.name}** exiled (kicked + blacklisted)`).addFields({name:'Reason',value:pending.reason})],components:[]});
      } catch(err){return interaction.editReply({embeds:[errEmbed(err.message)],components:[]});}
    }

    if(action==='masskickconfirm') {
      await interaction.deferUpdate();
      const{users,reason}=pending; const success=[],failed=[];
      for(const u of users){try{await kickFromGroup(u.robloxUser.id);pushLog({timestamp:new Date().toISOString(),staffDiscordId:pending.requesterId,staffTag:interaction.user.tag,robloxUsername:u.robloxUser.name,robloxId:u.robloxUser.id,oldRank:u.oldRole?.name??'Guest',newRank:'KICKED',reason});success.push(u.robloxUser.name);}catch{failed.push(u.robloxUser.name);}}
      pushAudit('MASSKICK',interaction.user.tag,interaction.user.id,`${success.length} kicked`);
      return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Mass kick complete').addFields({name:`✓ Kicked (${success.length})`,value:success.join('\n')||'None'},...(failed.length?[{name:`✗ Failed`,value:failed.join('\n')}]:[]))],components:[]});
    }

    if(action==='shoutconfirm'){await interaction.deferUpdate();try{await postShout(pending.message);pushAudit('SHOUT',interaction.user.tag,interaction.user.id,pending.message);return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Shout posted').addFields({name:'Message',value:pending.message})],components:[]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)],components:[]});}}
    if(action==='clearshoutconfirm'){await interaction.deferUpdate();try{await postShout('');pushAudit('CLEARSHOUT',interaction.user.tag,interaction.user.id,'Cleared');return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Shout cleared.')],components:[]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)],components:[]});}}
    if(action==='clearlogconfirm'){await interaction.deferUpdate();writeJSON(LOGS_FILE,[]);pushAudit('CLEARLOG',interaction.user.tag,interaction.user.id,'Log wiped');return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Rank log cleared.')],components:[]});}
    if(action==='clearblconfirm'){await interaction.deferUpdate();writeJSON(BLACKLIST_FILE,[]);pushAudit('CLEARBL',interaction.user.tag,interaction.user.id,'BL wiped');return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Blacklist cleared.')],components:[]});}
    if(action==='clearschconfirm'){await interaction.deferUpdate();const s=readJSON(SCHEDULES_FILE).map(x=>({...x,done:true}));writeJSON(SCHEDULES_FILE,s);pushAudit('CLEARSCH',interaction.user.tag,interaction.user.id,'All cancelled');return interaction.editReply({embeds:[baseEmbed().setDescription('✓ All schedules cancelled.')],components:[]});}
    if(action==='cleardataconfirm'){await interaction.deferUpdate();const{robloxId,robloxUsername}=pending;const w=readJSON(WARNINGS_FILE);delete w[robloxId];writeJSON(WARNINGS_FILE,w);const n=readJSON(NOTES_FILE);delete n[robloxId];writeJSON(NOTES_FILE,n);const bl=readJSON(BLACKLIST_FILE).filter(e=>e.robloxId!==robloxId);writeJSON(BLACKLIST_FILE,bl);const wl=readJSON(WATCHLIST_FILE).filter(e=>e.robloxId!==robloxId);writeJSON(WATCHLIST_FILE,wl);pushAudit('CLEARDATA',interaction.user.tag,interaction.user.id,robloxUsername);return interaction.editReply({embeds:[baseEmbed().setDescription(`✓ All data cleared for **${robloxUsername}**.`)],components:[]});}
    if(action==='syncallconfirm'){
      await interaction.deferUpdate();
      const verified=readJSON(VERIFIED_FILE); const rr=readJSON(RANKROLES_FILE); let synced=0,failed=0;
      for(const[did,v] of Object.entries(verified)){try{const role=await getUserGroupRole(v.robloxId);if(!role)continue;const drid=rr[role.name.toLowerCase()];if(!drid)continue;const m=await interaction.guild.members.fetch(did).catch(()=>null);if(m){await m.roles.add(drid);synced++;}}catch{failed++;}}
      return interaction.editReply({embeds:[baseEmbed().setDescription(`✓ Sync complete — ${synced} synced, ${failed} failed.`)],components:[]});
    }
  }

  if(!interaction.isChatInputCommand()) return;
  const {commandName} = interaction;
  const btn=(id,label,style)=>new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  const row=(...btns)=>new ActionRowBuilder().addComponents(...btns);
  function mkPending(data,timeout=60000){const id=`${interaction.id}-${Date.now()}`;pendingChanges.set(id,{...data,requesterId:interaction.user.id});setTimeout(()=>pendingChanges.delete(id),timeout);return id;}

  // ═══ BOT ═══
  if(commandName==='bot-status') {
    const logs=readJSON(LOGS_FILE),verified=readJSON(VERIFIED_FILE),bl=readJSON(BLACKLIST_FILE),sch=readJSON(SCHEDULES_FILE).filter(s=>!s.done),mem=process.memoryUsage();
    return interaction.reply({embeds:[baseEmbed().setDescription('✓ Bot is online').addFields(
      {name:'Uptime',value:fmtUptime(Date.now()-BOT_START),inline:true},{name:'Ping',value:`${client.ws.ping}ms`,inline:true},{name:'Platform',value:os.platform(),inline:true},
      {name:'Memory',value:`${(mem.heapUsed/1024/1024).toFixed(1)}MB`,inline:true},{name:'Node.js',value:process.version,inline:true},{name:'Commands',value:String(commands.length),inline:true},
      {name:'Total Rank Changes',value:String(logs.length),inline:true},{name:'Verified Users',value:String(Object.keys(verified).length),inline:true},{name:'Blacklisted',value:String(bl.length),inline:true},
      {name:'Pending Schedules',value:String(sch.length),inline:true},{name:'Group ID',value:GROUP_ID,inline:true},{name:'Log Channel',value:LOG_CHANNEL_ID?`<#${LOG_CHANNEL_ID}>`:'Not set',inline:true}
    )]});
  }
  if(commandName==='bot-info') {
    return interaction.reply({embeds:[baseEmbed().setDescription('✓ Bot Information').addFields(
      {name:'Bot Name',value:client.user.tag},{name:'Made By',value:'Zaid'},{name:'Version',value:'4.0.0'},
      {name:'Purpose',value:'Full Roblox group management — ranking, verification, moderation, scheduling, appeals, audit logging and more.'},
      {name:'Total Commands',value:String(commands.length)},{name:'Bot ID',value:client.user.id},{name:'Library',value:'discord.js v14'}
    )]});
  }
  if(commandName==='status-change') {
    if(!hasPerm(interaction.member)) return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});
    const msg=interaction.options.getString('message'),typeStr=interaction.options.getString('type')||'watching';
    const typeMap={watching:ActivityType.Watching,playing:ActivityType.Playing,listening:ActivityType.Listening,competing:ActivityType.Competing};
    client.user.setActivity(msg,{type:typeMap[typeStr]});
    pushAudit('STATUS_CHANGE',interaction.user.tag,interaction.user.id,`${typeStr}: ${msg}`);
    return interaction.reply({embeds:[baseEmbed().setDescription('✓ Status updated').addFields({name:'Type',value:typeStr,inline:true},{name:'Message',value:msg,inline:true})],ephemeral:true});
  }
  if(commandName==='ping') {
    const sent=await interaction.reply({content:'Pinging...',fetchReply:true});
    return interaction.editReply({content:null,embeds:[baseEmbed().setDescription('✓ Pong!').addFields({name:'Bot Latency',value:`${sent.createdTimestamp-interaction.createdTimestamp}ms`,inline:true},{name:'API',value:`${client.ws.ping}ms`,inline:true})]});
  }
  if(commandName==='uptime') return interaction.reply({embeds:[baseEmbed().setDescription(`✓ Uptime: **${fmtUptime(Date.now()-BOT_START)}**`)]});
  if(commandName==='commands') return interaction.reply({embeds:[baseEmbed().setDescription(`✓ This bot has **${commands.length}** total commands.`)]});
  if(commandName==='help') {
    const sections={'🤖 Bot':'`/bot-status` `/bot-info` `/status-change` `/ping` `/uptime` `/commands`','🎖️ Ranking':'`/changerank` `/promote` `/demote` `/exile` `/setrank` `/rankbyid` `/massrank` `/masspromote` `/massdemote` `/masskick`','📋 Rank Info':'`/checkrank` `/ranklist` `/rankinfo` `/rankcount` `/topranked` `/rankhistory` `/rankmembers` `/rankcompare` `/rankpercentage` `/findrankbynum`','⏰ Scheduled':'`/schedulerank` `/schedulepromote` `/scheduledemote` `/scheduleexile` `/schedules` `/cancelschedule` `/clearschedules`','📝 Logs':'`/ranklog` `/stafflog` `/userlog` `/logstats` `/auditlog` `/recentranks` `/recentkicks` `/recentbans` `/todaylogs` `/weeklylogs` `/monthlylogs` `/clearlog` `/exportlog` `/logsearch`','👤 Roblox Users':'`/profile` `/profilebyid` `/badges` `/groups` `/friends` `/followers` `/userstatus` `/useringroups` `/searchuser` `/accountage` `/isbanned` `/lookupid`','🏠 Group':'`/groupinfo` `/groupmembers` `/groupowner` `/groupshout` `/groupwall` `/deletewallpost` `/joinrequests` `/acceptjoin` `/declinejoin` `/groupgames`','📢 Shout':'`/shout` `/clearshout` `/shouthistory`','✅ Verification':'`/verify` `/unverify` `/whois` `/whoverified` `/sync` `/syncall` `/verifiedlist` `/unverifyuser` `/forceverify` `/setverifiedrole`','🔗 Rank Roles':'`/rankroles` `/setrankrole` `/removerankrole`','🎮 Inventory':'`/own` `/ownbadge` `/checkinventory` `/gameinfo` `/rankingaccount`','⚠️ Moderation':'`/warn` `/warnings` `/clearwarnings` `/deletewarn` `/kick` `/addnote` `/notes` `/clearnotes` `/deletenote`','🚫 Blacklist':'`/blacklist` `/unblacklist` `/blacklisted` `/isblacklisted` `/blacklistreason` `/clearblacklist`','👁️ Watchlist':'`/watchlist` `/iswatched` `/addwatch`','📩 Appeals':'`/appeal` `/appeals` `/resolveappeal` `/appealstatus` `/allappeals` `/clearappeals`','🏷️ Tags':'`/tag` `/addtag` `/edittag` `/deletetag` `/tags`','⏱️ Reminders':'`/remind` `/myreminders` `/cancelreminder`','👥 Staff Tools':'`/staffstats` `/topstaff` `/staffactivity` `/inactivestaffs` `/staffcheck`','🛠️ Utility':'`/serverinfo` `/userinfo` `/roleinfo` `/channelinfo` `/membercount` `/boostinfo` `/timestamp` `/calculate` `/say` `/embed` `/poll` `/announce` `/avatar`','⚙️ Config':'`/config` `/setlogchannel` `/setauditchannel` `/addbannedword` `/removebannedword` `/bannedwords` `/cleardata`'};
    const entries=Object.entries(sections); const embeds=[];
    for(let i=0;i<entries.length;i+=5){const chunk=entries.slice(i,i+5);embeds.push(baseEmbed().setDescription(i===0?`**All Commands — ${commands.length} total**`:null).addFields(chunk.map(([n,v])=>({name:n,value:v}))));}
    return interaction.reply({embeds:embeds.slice(0,10),ephemeral:true});
  }

  // ═══ RANKING CORE ═══
  if(commandName==='changerank') {
    if(!hasPerm(interaction.member)) return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});
    const username=interaction.options.getString('username'),rankName=interaction.options.getString('rank'),reason=interaction.options.getString('reason')||'No reason provided';
    await interaction.deferReply();
    try {
      const robloxUser=await getRobloxUser(username);
      const bl=readJSON(BLACKLIST_FILE); if(bl.find(e=>e.robloxId===robloxUser.id)) return interaction.editReply({embeds:[errEmbed(`${robloxUser.name} is blacklisted.`)]});
      const roles=await getGroupRoles(); const newRole=roles.find(r=>r.name.toLowerCase()===rankName.toLowerCase());
      if(!newRole) return interaction.editReply({embeds:[errEmbed(`Rank not found. Available: ${roles.map(r=>r.name).join(', ')}`)]});
      const oldRole=await getUserGroupRole(robloxUser.id);
      const cid=mkPending({userId:robloxUser.id,newRoleId:newRole.id,robloxUser,oldRole,newRole,reason});
      return interaction.editReply({embeds:[baseEmbed().setDescription('Confirm rank change').addFields({name:'User',value:robloxUser.name,inline:true},{name:'Old Rank',value:oldRole?.name??'Guest',inline:true},{name:'New Rank',value:newRole.name,inline:true},{name:'Reason',value:reason})],components:[row(btn(`confirm::${cid}`,'Confirm',ButtonStyle.Secondary),btn(`cancel::${cid}`,'Cancel',ButtonStyle.Danger))]});
    } catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}
  }

  if(commandName==='promote') {
    if(!hasPerm(interaction.member)) return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});
    const username=interaction.options.getString('username'),reason=interaction.options.getString('reason')||'Promotion';
    await interaction.deferReply();
    try {
      const robloxUser=await getRobloxUser(username);
      if(readJSON(BLACKLIST_FILE).find(e=>e.robloxId===robloxUser.id)) return interaction.editReply({embeds:[errEmbed(`${robloxUser.name} is blacklisted.`)]});
      const roles=(await getGroupRoles()).sort((a,b)=>a.rank-b.rank);
      const cur=await getUserGroupRole(robloxUser.id); if(!cur) return interaction.editReply({embeds:[errEmbed('Not in group.')]});
      const idx=roles.findIndex(r=>r.id===cur.id); if(idx>=roles.length-1) return interaction.editReply({embeds:[errEmbed('Already at highest rank.')]});
      const newRole=roles[idx+1];
      await setRank(robloxUser.id,newRole.id);
      pushLog({timestamp:new Date().toISOString(),staffDiscordId:interaction.user.id,staffTag:interaction.user.tag,robloxUsername:robloxUser.name,robloxId:robloxUser.id,oldRank:cur.name,newRank:newRole.name,reason});
      pushAudit('PROMOTE',interaction.user.tag,interaction.user.id,`${robloxUser.name}: ${cur.name} → ${newRole.name}`);
      await sendLog(baseEmbed().setDescription('✓ Promotion').addFields({name:'User',value:robloxUser.name},{name:'Old',value:cur.name,inline:true},{name:'New',value:newRole.name,inline:true},{name:'Staff',value:`<@${interaction.user.id}>`}));
      return interaction.editReply({embeds:[baseEmbed().setDescription(`✓ Promoted **${robloxUser.name}**`).addFields({name:'Old Rank',value:cur.name,inline:true},{name:'New Rank',value:newRole.name,inline:true},{name:'Reason',value:reason})]});
    } catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}
  }

  if(commandName==='demote') {
    if(!hasPerm(interaction.member)) return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});
    const username=interaction.options.getString('username'),reason=interaction.options.getString('reason')||'Demotion';
    await interaction.deferReply();
    try {
      const robloxUser=await getRobloxUser(username);
      const roles=(await getGroupRoles()).sort((a,b)=>a.rank-b.rank);
      const cur=await getUserGroupRole(robloxUser.id); if(!cur) return interaction.editReply({embeds:[errEmbed('Not in group.')]});
      const idx=roles.findIndex(r=>r.id===cur.id); if(idx<=0) return interaction.editReply({embeds:[errEmbed('Already at lowest rank.')]});
      const newRole=roles[idx-1];
      await setRank(robloxUser.id,newRole.id);
      pushLog({timestamp:new Date().toISOString(),staffDiscordId:interaction.user.id,staffTag:interaction.user.tag,robloxUsername:robloxUser.name,robloxId:robloxUser.id,oldRank:cur.name,newRank:newRole.name,reason});
      pushAudit('DEMOTE',interaction.user.tag,interaction.user.id,`${robloxUser.name}: ${cur.name} → ${newRole.name}`);
      await sendLog(baseEmbed().setDescription('✗ Demotion').addFields({name:'User',value:robloxUser.name},{name:'Old',value:cur.name,inline:true},{name:'New',value:newRole.name,inline:true},{name:'Staff',value:`<@${interaction.user.id}>`}));
      return interaction.editReply({embeds:[baseEmbed().setDescription(`✓ Demoted **${robloxUser.name}**`).addFields({name:'Old Rank',value:cur.name,inline:true},{name:'New Rank',value:newRole.name,inline:true},{name:'Reason',value:reason})]});
    } catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}
  }

  if(commandName==='exile') {
    if(!hasPerm(interaction.member)) return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});
    const username=interaction.options.getString('username'),reason=interaction.options.getString('reason');
    await interaction.deferReply();
    try {
      const robloxUser=await getRobloxUser(username); const oldRole=await getUserGroupRole(robloxUser.id);
      const cid=mkPending({userId:robloxUser.id,robloxUser,oldRole,reason});
      return interaction.editReply({embeds:[baseEmbed().setDescription('⚠️ This will KICK and PERMANENTLY BLACKLIST this user.').addFields({name:'User',value:robloxUser.name},{name:'Reason',value:reason})],components:[row(btn(`exileconfirm::${cid}`,'Confirm Exile',ButtonStyle.Danger),btn(`exilecancel::${cid}`,'Cancel',ButtonStyle.Secondary))]});
    } catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}
  }

  if(commandName==='massrank') {
    if(!hasPerm(interaction.member)) return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});
    const userList=interaction.options.getString('usernames').split(',').map(u=>u.trim()).filter(Boolean),rankName=interaction.options.getString('rank');
    if(userList.length>20) return interaction.reply({embeds:[errEmbed('Max 20 users.')],ephemeral:true});
    await interaction.deferReply();
    try {
      const roles=await getGroupRoles(); const newRole=roles.find(r=>r.name.toLowerCase()===rankName.toLowerCase());
      if(!newRole) return interaction.editReply({embeds:[errEmbed('Rank not found.')]});
      const bl=readJSON(BLACKLIST_FILE); const resolved=[],failed=[];
      for(const u of userList){try{const ru=await getRobloxUser(u);if(bl.find(e=>e.robloxId===ru.id)){failed.push(`${u} (blacklisted)`);continue;}const or=await getUserGroupRole(ru.id);resolved.push({robloxUser:ru,oldRole:or});}catch{failed.push(u);}}
      if(!resolved.length) return interaction.editReply({embeds:[errEmbed('No valid users.')]});
      const cid=mkPending({users:resolved,newRole},120000);
      return interaction.editReply({embeds:[baseEmbed().setDescription('Confirm mass rank').addFields({name:'New Rank',value:newRole.name},{name:`Users (${resolved.length})`,value:resolved.map(u=>u.robloxUser.name).join('\n')},...(failed.length?[{name:`✗ Skipped`,value:failed.join('\n')}]:[]))],components:[row(btn(`massconfirm::${cid}`,`Confirm All (${resolved.length})`,ButtonStyle.Secondary),btn(`masscancel::${cid}`,'Cancel',ButtonStyle.Danger))]});
    } catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}
  }

  if(commandName==='masspromote') {
    if(!hasPerm(interaction.member)) return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});
    const userList=interaction.options.getString('usernames').split(',').map(u=>u.trim()).filter(Boolean);
    if(userList.length>20) return interaction.reply({embeds:[errEmbed('Max 20 users.')],ephemeral:true});
    await interaction.deferReply();
    const roles=(await getGroupRoles()).sort((a,b)=>a.rank-b.rank); const success=[],failed=[];
    for(const u of userList){try{const ru=await getRobloxUser(u);const cur=await getUserGroupRole(ru.id);if(!cur){failed.push(`${u} (not in group)`);continue;}const idx=roles.findIndex(r=>r.id===cur.id);if(idx>=roles.length-1){failed.push(`${u} (max rank)`);continue;}const nr=roles[idx+1];await setRank(ru.id,nr.id);pushLog({timestamp:new Date().toISOString(),staffDiscordId:interaction.user.id,staffTag:interaction.user.tag,robloxUsername:ru.name,robloxId:ru.id,oldRank:cur.name,newRank:nr.name,reason:'Mass promotion'});success.push(`${ru.name}: ${cur.name} → ${nr.name}`);}catch{failed.push(u);}}
    pushAudit('MASSPROMOTE',interaction.user.tag,interaction.user.id,`${success.length} promoted`);
    return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Mass promote complete').addFields({name:`✓ Promoted (${success.length})`,value:trunc(success.join('\n'))||'None'},...(failed.length?[{name:`✗ Failed`,value:failed.join('\n')}]:[]))]});
  }

  if(commandName==='massdemote') {
    if(!hasPerm(interaction.member)) return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});
    const userList=interaction.options.getString('usernames').split(',').map(u=>u.trim()).filter(Boolean);
    if(userList.length>20) return interaction.reply({embeds:[errEmbed('Max 20 users.')],ephemeral:true});
    await interaction.deferReply();
    const roles=(await getGroupRoles()).sort((a,b)=>a.rank-b.rank); const success=[],failed=[];
    for(const u of userList){try{const ru=await getRobloxUser(u);const cur=await getUserGroupRole(ru.id);if(!cur){failed.push(`${u} (not in group)`);continue;}const idx=roles.findIndex(r=>r.id===cur.id);if(idx<=0){failed.push(`${u} (min rank)`);continue;}const nr=roles[idx-1];await setRank(ru.id,nr.id);pushLog({timestamp:new Date().toISOString(),staffDiscordId:interaction.user.id,staffTag:interaction.user.tag,robloxUsername:ru.name,robloxId:ru.id,oldRank:cur.name,newRank:nr.name,reason:'Mass demotion'});success.push(`${ru.name}: ${cur.name} → ${nr.name}`);}catch{failed.push(u);}}
    pushAudit('MASSDEMOTE',interaction.user.tag,interaction.user.id,`${success.length} demoted`);
    return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Mass demote complete').addFields({name:`✓ Demoted (${success.length})`,value:trunc(success.join('\n'))||'None'},...(failed.length?[{name:`✗ Failed`,value:failed.join('\n')}]:[]))]});
  }

  if(commandName==='masskick') {
    if(!hasPerm(interaction.member)) return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});
    const userList=interaction.options.getString('usernames').split(',').map(u=>u.trim()).filter(Boolean),reason=interaction.options.getString('reason');
    if(userList.length>10) return interaction.reply({embeds:[errEmbed('Max 10 users for mass kick.')],ephemeral:true});
    await interaction.deferReply();
    const resolved=[],failed=[];
    for(const u of userList){try{const ru=await getRobloxUser(u);const or=await getUserGroupRole(ru.id);if(!or){failed.push(`${u} (not in group)`);continue;}resolved.push({robloxUser:ru,oldRole:or});}catch{failed.push(u);}}
    if(!resolved.length) return interaction.editReply({embeds:[errEmbed('No valid users in group.')]});
    const cid=mkPending({users:resolved,reason});
    return interaction.editReply({embeds:[baseEmbed().setDescription('⚠️ Confirm mass kick').addFields({name:`Users (${resolved.length})`,value:resolved.map(u=>u.robloxUser.name).join('\n')},{name:'Reason',value:reason},...(failed.length?[{name:'✗ Skipped',value:failed.join('\n')}]:[]))],components:[row(btn(`masskickconfirm::${cid}`,`Kick All (${resolved.length})`,ButtonStyle.Danger),btn(`masscancel::${cid}`,'Cancel',ButtonStyle.Secondary))]});
  }

  if(commandName==='setrank') {
    if(!hasPerm(interaction.member)) return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});
    const username=interaction.options.getString('username'),rankNum=interaction.options.getInteger('ranknumber');
    await interaction.deferReply();
    try {
      const robloxUser=await getRobloxUser(username);
      if(readJSON(BLACKLIST_FILE).find(e=>e.robloxId===robloxUser.id)) return interaction.editReply({embeds:[errEmbed('User is blacklisted.')]});
      const roles=await getGroupRoles(); const newRole=roles.find(r=>r.rank===rankNum);
      if(!newRole) return interaction.editReply({embeds:[errEmbed(`No rank with number ${rankNum}.`)]});
      const oldRole=await getUserGroupRole(robloxUser.id);
      const cid=mkPending({userId:robloxUser.id,newRoleId:newRole.id,robloxUser,oldRole,newRole,reason:`Rank number ${rankNum}`});
      return interaction.editReply({embeds:[baseEmbed().setDescription('Confirm rank change by number').addFields({name:'User',value:robloxUser.name},{name:'Current',value:oldRole?.name??'Guest',inline:true},{name:'New',value:`${newRole.name} (#${rankNum})`,inline:true})],components:[row(btn(`confirm::${cid}`,'Confirm',ButtonStyle.Secondary),btn(`cancel::${cid}`,'Cancel',ButtonStyle.Danger))]});
    } catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}
  }

  if(commandName==='rankbyid') {
    if(!hasPerm(interaction.member)) return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});
    const userId=interaction.options.getString('userid'),rankName=interaction.options.getString('rank');
    await interaction.deferReply();
    try {
      const robloxUser=await getRobloxUserById(userId);
      if(readJSON(BLACKLIST_FILE).find(e=>e.robloxId===parseInt(userId))) return interaction.editReply({embeds:[errEmbed('User is blacklisted.')]});
      const roles=await getGroupRoles(); const newRole=roles.find(r=>r.name.toLowerCase()===rankName.toLowerCase());
      if(!newRole) return interaction.editReply({embeds:[errEmbed('Rank not found.')]});
      const oldRole=await getUserGroupRole(robloxUser.id);
      await setRank(robloxUser.id,newRole.id);
      pushLog({timestamp:new Date().toISOString(),staffDiscordId:interaction.user.id,staffTag:interaction.user.tag,robloxUsername:robloxUser.name,robloxId:robloxUser.id,oldRank:oldRole?.name??'Guest',newRank:newRole.name});
      pushAudit('RANKBYID',interaction.user.tag,interaction.user.id,`${robloxUser.name} → ${newRole.name}`);
      return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Rank changed by ID').addFields({name:'User',value:robloxUser.name},{name:'Old',value:oldRole?.name??'Guest',inline:true},{name:'New',value:newRole.name,inline:true})]});
    } catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}
  }

  // ═══ RANK INFO ═══
  if(commandName==='checkrank') {
    const username=interaction.options.getString('username'); await interaction.deferReply();
    try { const ru=await getRobloxUser(username);const[role,av]=await Promise.all([getUserGroupRole(ru.id),getAvatar(ru.id)]);const e=baseEmbed().setDescription('✓ Rank check').addFields({name:'Username',value:ru.name,inline:true},{name:'Display',value:ru.displayName||ru.name,inline:true},{name:'Rank',value:role?.name??'Not in group',inline:true},{name:'Rank #',value:role?String(role.rank):'N/A',inline:true});if(av)e.setThumbnail(av);return interaction.editReply({embeds:[e]}); }
    catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}
  }

  if(commandName==='ranklist') {
    await interaction.deferReply();
    try { const roles=(await getGroupRoles()).sort((a,b)=>b.rank-a.rank);const list=roles.map(r=>`**${r.name}** — Rank ${r.rank} (${r.memberCount} members)`).join('\n');return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Group ranks').addFields({name:`All Ranks (${roles.length})`,value:trunc(list)})]}); }
    catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}
  }

  if(commandName==='rankinfo') {
    const rankName=interaction.options.getString('rank'); await interaction.deferReply();
    try { const roles=await getGroupRoles();const role=roles.find(r=>r.name.toLowerCase()===rankName.toLowerCase());if(!role)return interaction.editReply({embeds:[errEmbed('Rank not found.')]});const logs=readJSON(LOGS_FILE);const to=logs.filter(l=>l.newRank===role.name).length,from=logs.filter(l=>l.oldRank===role.name).length;return interaction.editReply({embeds:[baseEmbed().setDescription(`✓ Rank: ${role.name}`).addFields({name:'Name',value:role.name,inline:true},{name:'Rank #',value:String(role.rank),inline:true},{name:'Members',value:String(role.memberCount),inline:true},{name:'Times Promoted To',value:String(to),inline:true},{name:'Times Left From',value:String(from),inline:true})]}); }
    catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}
  }

  if(commandName==='rankcount') {
    await interaction.deferReply();
    try { const roles=await getGroupRoles();const total=roles.reduce((s,r)=>s+r.memberCount,0);const sorted=roles.filter(r=>r.memberCount>0).sort((a,b)=>b.memberCount-a.memberCount);const list=sorted.map((r,i)=>`**${i+1}.** ${r.name} — ${r.memberCount} (${((r.memberCount/total)*100).toFixed(1)}%)`).join('\n');return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Members per rank').addFields({name:'Total',value:String(total),inline:true},{name:'Breakdown',value:trunc(list)})]}); }
    catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}
  }

  if(commandName==='topranked') {
    await interaction.deferReply();
    try { const roles=(await getGroupRoles()).sort((a,b)=>b.rank-a.rank).filter(r=>r.rank<255&&r.memberCount>0).slice(0,5);const lines=[];for(const r of roles){const ms=await getRoleMembers(r.id,5);lines.push(`**${r.name}** (Rank ${r.rank})\n> ${ms.map(m=>m.username).join(', ')||'None'}${r.memberCount>5?` +${r.memberCount-5} more`:''}`);}return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Top ranked').addFields({name:'Top Ranks',value:lines.join('\n\n')||'None'})]}); }
    catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}
  }

  if(commandName==='rankhistory') {
    const username=interaction.options.getString('username');
    const logs=readJSON(LOGS_FILE).filter(l=>l.robloxUsername.toLowerCase()===username.toLowerCase());
    if(!logs.length) return interaction.reply({embeds:[baseEmbed().setDescription(`No rank history for **${username}**.`)]});
    const lines=logs.slice(0,15).map((l,i)=>`**${i+1}.** ${l.oldRank} → ${l.newRank==='KICKED'?'**KICKED**':l.newRank}\n> by <@${l.staffDiscordId}> • ${new Date(l.timestamp).toLocaleDateString('en-GB')}`).join('\n\n');
    return interaction.reply({embeds:[baseEmbed().setDescription(`**Rank history — ${username}**\n\n${lines}`)]});
  }

  if(commandName==='rankmembers') {
    const rankName=interaction.options.getString('rank'); await interaction.deferReply();
    try { const roles=await getGroupRoles();const role=roles.find(r=>r.name.toLowerCase()===rankName.toLowerCase());if(!role)return interaction.editReply({embeds:[errEmbed('Rank not found.')]});const ms=await getRoleMembers(role.id,10);const list=ms.map((m,i)=>`**${i+1}.** ${m.username}`).join('\n');return interaction.editReply({embeds:[baseEmbed().setDescription(`✓ Members in **${role.name}** (${role.memberCount} total)`).addFields({name:'Showing up to 10',value:list||'None'})]}); }
    catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}
  }

  if(commandName==='rankcompare') {
    const u1n=interaction.options.getString('user1'),u2n=interaction.options.getString('user2'); await interaction.deferReply();
    try { const[r1,r2]=await Promise.all([getRobloxUser(u1n),getRobloxUser(u2n)]);const[rol1,rol2]=await Promise.all([getUserGroupRole(r1.id),getUserGroupRole(r2.id)]);let res='Same rank';if(rol1&&rol2){if(rol1.rank>rol2.rank)res=`${r1.name} outranks ${r2.name}`;else if(rol2.rank>rol1.rank)res=`${r2.name} outranks ${r1.name}`;}return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Rank comparison').addFields({name:r1.name,value:rol1?.name??'Not in group',inline:true},{name:r2.name,value:rol2?.name??'Not in group',inline:true},{name:'Result',value:res})]}); }
    catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}
  }

  if(commandName==='rankpercentage') {
    await interaction.deferReply();
    try { const roles=await getGroupRoles();const total=roles.reduce((s,r)=>s+r.memberCount,0);const list=roles.sort((a,b)=>b.rank-a.rank).map(r=>`**${r.name}**: ${((r.memberCount/total)*100).toFixed(2)}% (${r.memberCount})`).join('\n');return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Rank percentage breakdown').addFields({name:'Distribution',value:trunc(list)})]}); }
    catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}
  }

  if(commandName==='findrankbynum') {
    const num=interaction.options.getInteger('number'); await interaction.deferReply();
    try { const roles=await getGroupRoles();const role=roles.find(r=>r.rank===num);if(!role)return interaction.editReply({embeds:[errEmbed(`No rank with number ${num}.`)]});return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Rank found').addFields({name:'Name',value:role.name,inline:true},{name:'Rank #',value:String(role.rank),inline:true},{name:'Members',value:String(role.memberCount),inline:true})]}); }
    catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}
  }

  // ═══ SCHEDULED RANKS ═══
  async function mkSchedule(type,robloxUser,newRole,oldRole,minutes,reason,uid,utag){
    const executeAt=new Date(Date.now()+minutes*60_000).toISOString(),id=`sch-${Date.now()}`;
    const s=readJSON(SCHEDULES_FILE);s.push({id,type,robloxId:robloxUser.id,robloxUsername:robloxUser.name,newRoleId:newRole?.id,newRank:newRole?.name,oldRank:oldRole?.name??'Guest',staffId:uid,staffTag:utag,executeAt,reason,done:false});writeJSON(SCHEDULES_FILE,s);
    pushAudit(`SCHEDULE_${type.toUpperCase()}`,utag,uid,`${robloxUser.name} in ${minutes}m`);return{id,executeAt};}

  if(commandName==='schedulerank') {
    if(!hasPerm(interaction.member)) return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});
    const username=interaction.options.getString('username'),rankName=interaction.options.getString('rank'),minutes=interaction.options.getInteger('minutes');
    if(minutes<1||minutes>10080) return interaction.reply({embeds:[errEmbed('Minutes must be 1-10080.')],ephemeral:true});
    await interaction.deferReply();
    try { const ru=await getRobloxUser(username);const roles=await getGroupRoles();const nr=roles.find(r=>r.name.toLowerCase()===rankName.toLowerCase());if(!nr)return interaction.editReply({embeds:[errEmbed('Rank not found.')]});const or=await getUserGroupRole(ru.id);const{id,executeAt}=await mkSchedule('rank',ru,nr,or,minutes,'',interaction.user.id,interaction.user.tag);return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Rank change scheduled').addFields({name:'User',value:ru.name},{name:'New Rank',value:nr.name},{name:'Executes',value:`<t:${Math.floor(new Date(executeAt).getTime()/1000)}:R>`},{name:'ID',value:id})]}); }
    catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}
  }

  if(commandName==='schedulepromote') {
    if(!hasPerm(interaction.member)) return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});
    const username=interaction.options.getString('username'),minutes=interaction.options.getInteger('minutes');
    await interaction.deferReply();
    try { const ru=await getRobloxUser(username);const roles=(await getGroupRoles()).sort((a,b)=>a.rank-b.rank);const cur=await getUserGroupRole(ru.id);if(!cur)return interaction.editReply({embeds:[errEmbed('Not in group.')]});const idx=roles.findIndex(r=>r.id===cur.id);if(idx>=roles.length-1)return interaction.editReply({embeds:[errEmbed('Already at max rank.')]});const nr=roles[idx+1];const{id,executeAt}=await mkSchedule('rank',ru,nr,cur,minutes,'Scheduled promotion',interaction.user.id,interaction.user.tag);return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Promotion scheduled').addFields({name:'User',value:ru.name},{name:'Will Promote To',value:nr.name},{name:'Executes',value:`<t:${Math.floor(new Date(executeAt).getTime()/1000)}:R>`},{name:'ID',value:id})]}); }
    catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}
  }

  if(commandName==='scheduledemote') {
    if(!hasPerm(interaction.member)) return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});
    const username=interaction.options.getString('username'),minutes=interaction.options.getInteger('minutes');
    await interaction.deferReply();
    try { const ru=await getRobloxUser(username);const roles=(await getGroupRoles()).sort((a,b)=>a.rank-b.rank);const cur=await getUserGroupRole(ru.id);if(!cur)return interaction.editReply({embeds:[errEmbed('Not in group.')]});const idx=roles.findIndex(r=>r.id===cur.id);if(idx<=0)return interaction.editReply({embeds:[errEmbed('Already at lowest rank.')]});const nr=roles[idx-1];const{id,executeAt}=await mkSchedule('rank',ru,nr,cur,minutes,'Scheduled demotion',interaction.user.id,interaction.user.tag);return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Demotion scheduled').addFields({name:'User',value:ru.name},{name:'Will Demote To',value:nr.name},{name:'Executes',value:`<t:${Math.floor(new Date(executeAt).getTime()/1000)}:R>`},{name:'ID',value:id})]}); }
    catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}
  }

  if(commandName==='scheduleexile') {
    if(!hasPerm(interaction.member)) return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});
    const username=interaction.options.getString('username'),minutes=interaction.options.getInteger('minutes'),reason=interaction.options.getString('reason');
    await interaction.deferReply();
    try { const ru=await getRobloxUser(username);const or=await getUserGroupRole(ru.id);const{id,executeAt}=await mkSchedule('exile',ru,null,or,minutes,reason,interaction.user.id,interaction.user.tag);return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Exile scheduled').addFields({name:'User',value:ru.name},{name:'Reason',value:reason},{name:'Executes',value:`<t:${Math.floor(new Date(executeAt).getTime()/1000)}:R>`},{name:'ID',value:id})]}); }
    catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}
  }

  if(commandName==='schedules') {
    const all=readJSON(SCHEDULES_FILE).filter(s=>!s.done);
    if(!all.length) return interaction.reply({embeds:[baseEmbed().setDescription('No pending schedules.')]});
    const lines=all.map((s,i)=>`**${i+1}.** \`${s.robloxUsername}\` — ${s.type}: **${s.newRank||'exile'}**\n> ID: \`${s.id}\` • <t:${Math.floor(new Date(s.executeAt).getTime()/1000)}:R>`).join('\n\n');
    return interaction.reply({embeds:[baseEmbed().setDescription(`**Pending Schedules (${all.length})**\n\n${lines}`)]});
  }

  if(commandName==='cancelschedule') {
    if(!hasPerm(interaction.member)) return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});
    const id=interaction.options.getString('id');const s=readJSON(SCHEDULES_FILE);const idx=s.findIndex(x=>x.id===id&&!x.done);
    if(idx===-1) return interaction.reply({embeds:[errEmbed(`Schedule \`${id}\` not found.`)]});
    const removed=s.splice(idx,1)[0];writeJSON(SCHEDULES_FILE,s);pushAudit('CANCELSCHEDULE',interaction.user.tag,interaction.user.id,id);
    return interaction.reply({embeds:[baseEmbed().setDescription(`✓ Cancelled schedule \`${id}\` — was going to ${removed.type} **${removed.robloxUsername}**.`)]});
  }

  if(commandName==='clearschedules') {
    if(!hasPerm(interaction.member)) return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});
    const cid=mkPending({},30000);
    return interaction.reply({embeds:[baseEmbed().setDescription('Cancel ALL pending schedules?')],components:[row(btn(`clearschconfirm::${cid}`,'Cancel All Schedules',ButtonStyle.Danger),btn(`cancel::${cid}`,'Never mind',ButtonStyle.Secondary))],ephemeral:true});
  }

  // ═══ LOGS ═══
  if(commandName==='ranklog'){const page=interaction.options.getInteger('page')||1;const logs=readJSON(LOGS_FILE);if(!logs.length)return interaction.reply({embeds:[baseEmbed().setDescription('No rank changes logged.')]});const{embed}=paginateLogs(logs,page);return interaction.reply({embeds:[embed]});}
  if(commandName==='stafflog'){const su=interaction.options.getUser('staff');const page=interaction.options.getInteger('page')||1;const logs=readJSON(LOGS_FILE).filter(l=>l.staffDiscordId===su.id);if(!logs.length)return interaction.reply({embeds:[baseEmbed().setDescription(`No logs for <@${su.id}>.`)]});const{embed}=paginateLogs(logs,page,`Staff Log — ${su.tag}`);return interaction.reply({embeds:[embed]});}
  if(commandName==='userlog'){const username=interaction.options.getString('username');const page=interaction.options.getInteger('page')||1;const logs=readJSON(LOGS_FILE).filter(l=>l.robloxUsername.toLowerCase()===username.toLowerCase());if(!logs.length)return interaction.reply({embeds:[baseEmbed().setDescription(`No logs for **${username}**.`)]});const{embed}=paginateLogs(logs,page,`User Log — ${username}`);return interaction.reply({embeds:[embed]});}

  if(commandName==='logstats') {
    const logs=readJSON(LOGS_FILE); if(!logs.length) return interaction.reply({embeds:[baseEmbed().setDescription('No logs yet.')]});
    const staffC={},rankC={};let kicks=0,exiles=0,today=0;const todayStr=new Date().toLocaleDateString('en-GB');
    for(const l of logs){staffC[l.staffDiscordId]=(staffC[l.staffDiscordId]||0)+1;rankC[l.newRank]=(rankC[l.newRank]||0)+1;if(l.newRank==='KICKED')kicks++;if(l.newRank==='EXILED')exiles++;if(new Date(l.timestamp).toLocaleDateString('en-GB')===todayStr)today++;}
    const topStaff=Object.entries(staffC).sort((a,b)=>b[1]-a[1]).slice(0,5);const topRanks=Object.entries(rankC).filter(([k])=>k!=='KICKED'&&k!=='EXILED').sort((a,b)=>b[1]-a[1]).slice(0,5);
    return interaction.reply({embeds:[baseEmbed().setDescription('✓ Log statistics').addFields({name:'Total',value:String(logs.length),inline:true},{name:'Today',value:String(today),inline:true},{name:'Kicks',value:String(kicks),inline:true},{name:'Exiles',value:String(exiles),inline:true},{name:'Top Staff',value:topStaff.map(([id,c],i)=>`**${i+1}.** <@${id}> — ${c}`).join('\n')||'None'},{name:'Most Given Ranks',value:topRanks.map(([n,c],i)=>`**${i+1}.** ${n} — ${c}x`).join('\n')||'None'})]});
  }

  if(commandName==='auditlog') {
    if(!hasPerm(interaction.member)) return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});
    const PER=10,page=interaction.options.getInteger('page')||1,audit=readJSON(AUDITLOG_FILE);
    if(!audit.length) return interaction.reply({embeds:[baseEmbed().setDescription('Audit log empty.')]});
    const total=Math.ceil(audit.length/PER),p=Math.min(Math.max(page,1),total),slice=audit.slice((p-1)*PER,p*PER);
    const lines=slice.map((e,i)=>`**${(p-1)*PER+i+1}.** \`${e.action}\` by ${e.staffTag}\n> ${trunc(e.details,100)} • ${new Date(e.timestamp).toLocaleString('en-GB')}`).join('\n\n');
    return interaction.reply({embeds:[baseEmbed().setDescription(`**Audit Log — Page ${p}/${total}**\n\n${lines}`)]});
  }

  if(commandName==='recentranks'){await interaction.deferReply();try{const e=await getRblxAudit('ChangeRank',10);if(!e.length)return interaction.editReply({embeds:[baseEmbed().setDescription('No recent rank changes.')]});const lines=e.map((x,i)=>`**${i+1}.** \`${x.description?.TargetName??'Unknown'}\`\n> by ${x.actor?.user?.username??'Unknown'} • ${new Date(x.created).toLocaleDateString('en-GB')}`).join('\n\n');return interaction.editReply({embeds:[baseEmbed().setDescription(`**Recent Rank Changes (Roblox)**\n\n${lines}`)]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='recentkicks'){await interaction.deferReply();try{const e=await getRblxAudit('RemoveMember',10);if(!e.length)return interaction.editReply({embeds:[baseEmbed().setDescription('No recent kicks.')]});const lines=e.map((x,i)=>`**${i+1}.** \`${x.description?.TargetName??'Unknown'}\`\n> by ${x.actor?.user?.username??'Unknown'} • ${new Date(x.created).toLocaleDateString('en-GB')}`).join('\n\n');return interaction.editReply({embeds:[baseEmbed().setDescription(`**Recent Kicks**\n\n${lines}`)]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='recentbans'){const bl=readJSON(BLACKLIST_FILE).slice(0,10);if(!bl.length)return interaction.reply({embeds:[baseEmbed().setDescription('No recent blacklists.')]});const lines=bl.map((e,i)=>`**${i+1}.** \`${e.robloxUsername}\` — ${e.reason}\n> by ${e.addedBy} • ${new Date(e.timestamp).toLocaleDateString('en-GB')}`).join('\n\n');return interaction.reply({embeds:[baseEmbed().setDescription(`**Recent Blacklists**\n\n${lines}`)]});}
  if(commandName==='todaylogs'){const t=new Date().toLocaleDateString('en-GB');const logs=readJSON(LOGS_FILE).filter(l=>new Date(l.timestamp).toLocaleDateString('en-GB')===t);if(!logs.length)return interaction.reply({embeds:[baseEmbed().setDescription('No rank changes today.')]});const{embed}=paginateLogs(logs,1,`Today's Logs`);return interaction.reply({embeds:[embed]});}
  if(commandName==='weeklylogs'){const w=Date.now()-7*86400000;const logs=readJSON(LOGS_FILE).filter(l=>new Date(l.timestamp).getTime()>w);if(!logs.length)return interaction.reply({embeds:[baseEmbed().setDescription('No changes this week.')]});const{embed}=paginateLogs(logs,1,`Weekly Logs (${logs.length})`);return interaction.reply({embeds:[embed]});}
  if(commandName==='monthlylogs'){const m=Date.now()-30*86400000;const logs=readJSON(LOGS_FILE).filter(l=>new Date(l.timestamp).getTime()>m);if(!logs.length)return interaction.reply({embeds:[baseEmbed().setDescription('No changes this month.')]});const{embed}=paginateLogs(logs,1,`Monthly Logs (${logs.length})`);return interaction.reply({embeds:[embed]});}

  if(commandName==='clearlog'){
    if(!hasPerm(interaction.member)) return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});
    const cid=mkPending({},30000);
    return interaction.reply({embeds:[baseEmbed().setDescription('⚠️ Wipe the entire rank log?')],components:[row(btn(`clearlogconfirm::${cid}`,'Clear All Logs',ButtonStyle.Danger),btn(`cancel::${cid}`,'Cancel',ButtonStyle.Secondary))],ephemeral:true});
  }

  if(commandName==='exportlog'){
    if(!hasPerm(interaction.member)) return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});
    const logs=readJSON(LOGS_FILE);if(!logs.length)return interaction.reply({embeds:[baseEmbed().setDescription('No logs.')]});
    const text=logs.map(l=>`[${l.timestamp}] ${l.robloxUsername} | ${l.oldRank} → ${l.newRank} | by ${l.staffTag}${l.reason?` | ${l.reason}`:''}`).join('\n');
    return interaction.reply({files:[{attachment:Buffer.from(text),name:`ranklog-${Date.now()}.txt`}]});
  }

  if(commandName==='logsearch'){
    const q=interaction.options.getString('query').toLowerCase();
    const logs=readJSON(LOGS_FILE).filter(l=>l.robloxUsername.toLowerCase().includes(q)||l.newRank.toLowerCase().includes(q)||l.oldRank.toLowerCase().includes(q)||(l.staffTag&&l.staffTag.toLowerCase().includes(q))||(l.reason&&l.reason.toLowerCase().includes(q)));
    if(!logs.length)return interaction.reply({embeds:[baseEmbed().setDescription(`No logs matching **${q}**.`)]});
    const{embed}=paginateLogs(logs.slice(0,50),1,`Search: "${q}" (${logs.length} results)`);return interaction.reply({embeds:[embed]});
  }

  // ═══ ROBLOX USER INFO ═══
  if(commandName==='profile') {
    const username=interaction.options.getString('username'); await interaction.deferReply();
    try {
      const ru=await getRobloxUser(username);
      const[role,av,fr,fo,fw]=await Promise.all([getUserGroupRole(ru.id),getAvatar(ru.id),getFriendCount(ru.id),getFollowerCount(ru.id),getFollowingCount(ru.id)]);
      const warns=(readJSON(WARNINGS_FILE)[ru.id]||[]).length,notes=(readJSON(NOTES_FILE)[ru.id]||[]).length;
      const bl=readJSON(BLACKLIST_FILE).find(e=>e.robloxId===ru.id),wl=readJSON(WATCHLIST_FILE).find(e=>e.robloxId===ru.id);
      const ageDays=Math.floor((Date.now()-new Date(ru.created).getTime())/86400000);
      const e=baseEmbed().setDescription('✓ Roblox profile').addFields(
        {name:'Username',value:ru.name,inline:true},{name:'Display Name',value:ru.displayName||ru.name,inline:true},{name:'Roblox ID',value:String(ru.id),inline:true},
        {name:'Created',value:`${new Date(ru.created).toLocaleDateString('en-GB')} (${ageDays}d ago)`,inline:true},{name:'Friends',value:String(fr),inline:true},{name:'Followers',value:String(fo),inline:true},
        {name:'Following',value:String(fw),inline:true},{name:'Group Rank',value:role?.name??'Not in group',inline:true},{name:'Rank #',value:role?String(role.rank):'N/A',inline:true},
        {name:'Warnings',value:String(warns),inline:true},{name:'Notes',value:String(notes),inline:true},{name:'Blacklisted',value:bl?`✗ Yes — ${bl.reason}`:'✓ No',inline:true},
        {name:'Watchlist',value:wl?'👁 Yes':'No',inline:true}
      );
      if(av)e.setThumbnail(av);return interaction.editReply({embeds:[e]});
    } catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}
  }

  if(commandName==='profilebyid'){
    const uid=interaction.options.getString('userid'); await interaction.deferReply();
    try{const ru=await getRobloxUserById(uid);const[role,av,fr]=await Promise.all([getUserGroupRole(ru.id),getAvatar(ru.id),getFriendCount(ru.id)]);const e=baseEmbed().setDescription('✓ Profile by ID').addFields({name:'Username',value:ru.name,inline:true},{name:'Roblox ID',value:String(ru.id),inline:true},{name:'Created',value:new Date(ru.created).toLocaleDateString('en-GB'),inline:true},{name:'Friends',value:String(fr),inline:true},{name:'Group Rank',value:role?.name??'Not in group',inline:true});if(av)e.setThumbnail(av);return interaction.editReply({embeds:[e]});}
    catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}
  }

  if(commandName==='badges'){const username=interaction.options.getString('username');await interaction.deferReply();try{const ru=await getRobloxUser(username);const b=await getUserBadges(ru.id);if(!b.length)return interaction.editReply({embeds:[baseEmbed().setDescription(`${ru.name} has no recent badges.`)]});return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Recent badges').addFields({name:ru.name,value:b.map((x,i)=>`**${i+1}.** ${x.name}`).join('\n')})]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='groups'){const username=interaction.options.getString('username');await interaction.deferReply();try{const ru=await getRobloxUser(username);const g=await getUserGroups(ru.id);if(!g.length)return interaction.editReply({embeds:[baseEmbed().setDescription(`${ru.name} is not in any groups.`)]});return interaction.editReply({embeds:[baseEmbed().setDescription(`✓ Groups — ${ru.name}`).addFields({name:`${g.length} groups`,value:g.slice(0,15).map((x,i)=>`**${i+1}.** ${x.group.name} — ${x.role.name}`).join('\n')})]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='friends'){const username=interaction.options.getString('username');await interaction.deferReply();try{const ru=await getRobloxUser(username);const c=await getFriendCount(ru.id);return interaction.editReply({embeds:[baseEmbed().setDescription(`✓ **${ru.name}** has **${c}** friends.`)]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='followers'){const username=interaction.options.getString('username');await interaction.deferReply();try{const ru=await getRobloxUser(username);const[fo,fw]=await Promise.all([getFollowerCount(ru.id),getFollowingCount(ru.id)]);return interaction.editReply({embeds:[baseEmbed().setDescription(`✓ ${ru.name} social`).addFields({name:'Followers',value:String(fo),inline:true},{name:'Following',value:String(fw),inline:true})]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='userstatus'){const username=interaction.options.getString('username');await interaction.deferReply();try{const ru=await getRobloxUser(username);const p=await getUserPresence(ru.id);const sm={0:'Offline',1:'Online (Website)',2:'In-Game',3:'In Studio'};return interaction.editReply({embeds:[baseEmbed().setDescription(`✓ ${ru.name} presence`).addFields({name:'Status',value:p?sm[p.userPresenceType]||'Unknown':'Unknown',inline:true},{name:'Last Location',value:p?.lastLocation||'N/A',inline:true})]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='useringroups'){const username=interaction.options.getString('username'),gid=interaction.options.getString('groupid');await interaction.deferReply();try{const ru=await getRobloxUser(username);const g=await getUserGroups(ru.id);const found=g.find(x=>x.group.id===parseInt(gid));return interaction.editReply({embeds:[baseEmbed().setDescription(found?'✓ User IS in this group':'✗ User is NOT in this group').addFields({name:'User',value:ru.name},{name:'Group ID',value:gid},...(found?[{name:'Rank',value:found.role.name}]:[]))]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='searchuser'){const kw=interaction.options.getString('keyword');await interaction.deferReply();try{const u=await searchRblxUsers(kw);if(!u.length)return interaction.editReply({embeds:[baseEmbed().setDescription(`No users found for "${kw}".`)]});return interaction.editReply({embeds:[baseEmbed().setDescription(`✓ Search: **${kw}**`).addFields({name:'Results',value:u.map((x,i)=>`**${i+1}.** ${x.name} *(${x.displayName})*`).join('\n')})]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='accountage'){const username=interaction.options.getString('username');await interaction.deferReply();try{const ru=await getRobloxUser(username);const d=Math.floor((Date.now()-new Date(ru.created).getTime())/86400000),y=Math.floor(d/365);return interaction.editReply({embeds:[baseEmbed().setDescription(`✓ Account age — ${ru.name}`).addFields({name:'Created',value:new Date(ru.created).toLocaleDateString('en-GB'),inline:true},{name:'Age',value:`${d} days (${y} year${y!==1?'s':''})`,inline:true})]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='isbanned'){const username=interaction.options.getString('username');await interaction.deferReply();try{const ru=await getRobloxUser(username);const d=await getRobloxUserById(ru.id);return interaction.editReply({embeds:[baseEmbed().setDescription(`✓ Ban check — ${ru.name}`).addFields({name:'Banned',value:d.isBanned?'✗ Yes — account is banned':'✓ No'})]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='lookupid'){const uid=interaction.options.getString('userid');await interaction.deferReply();try{const ru=await getRobloxUserById(uid);return interaction.editReply({embeds:[baseEmbed().setDescription('✓ User ID lookup').addFields({name:'Username',value:ru.name,inline:true},{name:'Display Name',value:ru.displayName||ru.name,inline:true},{name:'ID',value:String(ru.id),inline:true})]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}

  // ═══ GROUP INFO ═══
  if(commandName==='groupinfo'){await interaction.deferReply();try{const[g,roles]=await Promise.all([getGroupInfo(),getGroupRoles()]);const e=baseEmbed().setDescription('✓ Group info').addFields({name:'Name',value:g.name,inline:true},{name:'ID',value:String(g.id),inline:true},{name:'Members',value:String(g.memberCount),inline:true},{name:'Owner',value:g.owner?.username??'None',inline:true},{name:`Ranks (${roles.length})`,value:trunc(roles.sort((a,b)=>b.rank-a.rank).map(r=>`**${r.name}** — ${r.rank} (${r.memberCount})`).join('\n'))});if(g.shout?.body)e.addFields({name:'Current Shout',value:trunc(g.shout.body,200)});return interaction.editReply({embeds:[e]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='groupmembers'){await interaction.deferReply();try{const g=await getGroupInfo();return interaction.editReply({embeds:[baseEmbed().setDescription(`✓ **${g.name}** has **${g.memberCount.toLocaleString()}** members.`)]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='groupowner'){await interaction.deferReply();try{const g=await getGroupInfo();const av=g.owner?await getAvatar(g.owner.userId):null;const e=baseEmbed().setDescription('✓ Group owner').addFields({name:'Group',value:g.name},{name:'Owner',value:g.owner?.username??'None'},{name:'Owner ID',value:g.owner?String(g.owner.userId):'N/A'});if(av)e.setThumbnail(av);return interaction.editReply({embeds:[e]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='groupshout'){await interaction.deferReply();try{const g=await getGroupInfo();if(!g.shout?.body)return interaction.editReply({embeds:[baseEmbed().setDescription('No shout set.')]});return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Group shout').addFields({name:'Message',value:g.shout.body},{name:'Posted By',value:g.shout.poster?.username??'Unknown'},{name:'Updated',value:new Date(g.shout.updated).toLocaleString('en-GB')})]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='groupwall'){await interaction.deferReply();try{const posts=await getGroupWall(10);if(!posts.length)return interaction.editReply({embeds:[baseEmbed().setDescription('Group wall is empty.')]});const list=posts.map((p,i)=>`**${i+1}.** ${p.poster?.username??'Unknown'} (ID: ${p.id})\n> ${trunc(p.body,100)}`).join('\n\n');return interaction.editReply({embeds:[baseEmbed().setDescription(`**Group Wall**\n\n${list}`)]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='deletewallpost'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const pid=interaction.options.getString('postid');await interaction.deferReply();try{await deleteWallPost(pid);pushAudit('DELETE_WALL_POST',interaction.user.tag,interaction.user.id,`Post ${pid}`);return interaction.editReply({embeds:[baseEmbed().setDescription(`✓ Wall post \`${pid}\` deleted.`)]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='joinrequests'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});await interaction.deferReply();try{const req=await getJoinRequests();if(!req.length)return interaction.editReply({embeds:[baseEmbed().setDescription('No pending join requests.')]});const jrList=req.map((r,i)=>'**'+(i+1)+'.** '+(r.requester&&r.requester.username?r.requester.username:'Unknown')+' (ID: '+(r.requester?r.requester.userId:'?')+')').join('\n');return interaction.editReply({embeds:[baseEmbed().setDescription('**Pending Join Requests ('+req.length+')**\n\n'+jrList)]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='acceptjoin'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const username=interaction.options.getString('username');await interaction.deferReply();try{const ru=await getRobloxUser(username);await acceptJoin(ru.id);pushAudit('ACCEPT_JOIN',interaction.user.tag,interaction.user.id,ru.name);return interaction.editReply({embeds:[baseEmbed().setDescription(`✓ Accepted **${ru.name}**'s join request.`)]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='declinejoin'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const username=interaction.options.getString('username');await interaction.deferReply();try{const ru=await getRobloxUser(username);await declineJoin(ru.id);pushAudit('DECLINE_JOIN',interaction.user.tag,interaction.user.id,ru.name);return interaction.editReply({embeds:[baseEmbed().setDescription(`✓ Declined **${ru.name}**'s join request.`)]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='groupgames'){const uid=interaction.options.getString('universeid');await interaction.deferReply();try{const g=await getGameInfo(uid);if(!g)return interaction.editReply({embeds:[errEmbed('Game not found.')]});return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Game info').addFields({name:'Name',value:g.name,inline:true},{name:'Creator',value:g.creator?.name??'Unknown',inline:true},{name:'Playing',value:String(g.playing??0),inline:true},{name:'Visits',value:String((g.visits??0).toLocaleString()),inline:true},{name:'Max Players',value:String(g.maxPlayers??'N/A'),inline:true},{name:'Favourites',value:String(g.favoritedCount??0),inline:true})]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}

  // ═══ SHOUT ═══
  if(commandName==='shout'){
    if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});
    const msg=interaction.options.getString('message');if(msg.length>255)return interaction.reply({embeds:[errEmbed('Max 255 chars.')],ephemeral:true});
    await interaction.deferReply();const cid=mkPending({message:msg});
    return interaction.editReply({embeds:[baseEmbed().setDescription('Confirm group shout').addFields({name:'Message',value:msg})],components:[row(btn(`shoutconfirm::${cid}`,'Post Shout',ButtonStyle.Secondary),btn(`cancel::${cid}`,'Cancel',ButtonStyle.Danger))]});
  }
  if(commandName==='clearshout'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});await interaction.deferReply();const cid=mkPending({});return interaction.editReply({embeds:[baseEmbed().setDescription('Clear the group shout?')],components:[row(btn(`clearshoutconfirm::${cid}`,'Clear Shout',ButtonStyle.Danger),btn(`cancel::${cid}`,'Cancel',ButtonStyle.Secondary))]});}
  if(commandName==='shouthistory'){const a=readJSON(AUDITLOG_FILE).filter(e=>e.action==='SHOUT'||e.action==='CLEARSHOUT');if(!a.length)return interaction.reply({embeds:[baseEmbed().setDescription('No shout history yet.')]});const lines=a.slice(0,10).map((e,i)=>`**${i+1}.** ${e.action==='CLEARSHOUT'?'*Cleared*':`"${trunc(e.details,80)}"`}\n> by ${e.staffTag} • ${new Date(e.timestamp).toLocaleString('en-GB')}`).join('\n\n');return interaction.reply({embeds:[baseEmbed().setDescription(`**Shout History**\n\n${lines}`)]});}

  // ═══ VERIFICATION ═══
  if(commandName==='verify'){
    const username=interaction.options.getString('username');await interaction.deferReply({ephemeral:true});
    try{const ru=await getRobloxUser(username);const v=readJSON(VERIFIED_FILE);const ex=Object.entries(v).find(([,vv])=>vv.robloxId===ru.id);if(ex&&ex[0]!==interaction.user.id)return interaction.editReply({embeds:[errEmbed('That Roblox account is linked to someone else.')]});
    v[interaction.user.id]={robloxId:ru.id,robloxUsername:ru.name,verifiedAt:new Date().toISOString()};writeJSON(VERIFIED_FILE,v);pushAudit('VERIFY',interaction.user.tag,interaction.user.id,ru.name);
    const rr=readJSON(RANKROLES_FILE);if(rr['__verified_role__']){try{const m=await interaction.guild.members.fetch(interaction.user.id);await m.roles.add(rr['__verified_role__']);}catch{}}
    return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Verified').addFields({name:'Discord',value:`<@${interaction.user.id}>`},{name:'Roblox',value:ru.name},{name:'Roblox ID',value:String(ru.id)})]});}
    catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}
  }
  if(commandName==='unverify'){const v=readJSON(VERIFIED_FILE);if(!v[interaction.user.id])return interaction.reply({embeds:[errEmbed('You are not verified.')],ephemeral:true});const old=v[interaction.user.id].robloxUsername;delete v[interaction.user.id];writeJSON(VERIFIED_FILE,v);return interaction.reply({embeds:[baseEmbed().setDescription(`✓ Unverified — removed link to **${old}**.`)],ephemeral:true});}
  if(commandName==='whois'){const tu=interaction.options.getUser('user');await interaction.deferReply();try{const v=readJSON(VERIFIED_FILE);const e=v[tu.id];if(!e)return interaction.editReply({embeds:[errEmbed(`<@${tu.id}> has not verified.`)]});const[ru,role,av]=await Promise.all([getRobloxUserById(e.robloxId),getUserGroupRole(e.robloxId),getAvatar(e.robloxId)]);const warns=(readJSON(WARNINGS_FILE)[e.robloxId]||[]).length,notes=(readJSON(NOTES_FILE)[e.robloxId]||[]).length;const emb=baseEmbed().setDescription('✓ Whois').addFields({name:'Discord',value:`<@${tu.id}>`},{name:'Roblox',value:ru.name,inline:true},{name:'Roblox ID',value:String(ru.id),inline:true},{name:'Group Rank',value:role?.name??'Not in group',inline:true},{name:'Warnings',value:String(warns),inline:true},{name:'Notes',value:String(notes),inline:true},{name:'Verified',value:new Date(e.verifiedAt).toLocaleDateString('en-GB'),inline:true});if(av)emb.setThumbnail(av);return interaction.editReply({embeds:[emb]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='whoverified'){const username=interaction.options.getString('username');await interaction.deferReply();try{const ru=await getRobloxUser(username);const v=readJSON(VERIFIED_FILE);const e=Object.entries(v).find(([,vv])=>vv.robloxId===ru.id);if(!e)return interaction.editReply({embeds:[errEmbed(`${ru.name} is not linked to any Discord.`)]});return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Verified lookup').addFields({name:'Roblox',value:ru.name},{name:'Discord',value:`<@${e[0]}>`},{name:'Verified',value:new Date(e[1].verifiedAt).toLocaleDateString('en-GB')})]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}

  if(commandName==='sync'){
    if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});
    const tu=interaction.options.getUser('user');await interaction.deferReply();
    try{const v=readJSON(VERIFIED_FILE);const e=v[tu.id];if(!e)return interaction.editReply({embeds:[errEmbed(`<@${tu.id}> has not verified.`)]});const role=await getUserGroupRole(e.robloxId);const rr=readJSON(RANKROLES_FILE);const m=await interaction.guild.members.fetch(tu.id);const drid=role?rr[role.name.toLowerCase()]:null;let res;if(drid){await m.roles.add(drid);res=`✓ Gave role <@&${drid}>`;}else{res=`✗ No Discord role mapped for: ${role?.name??'Not in group'}`;}pushAudit('SYNC',interaction.user.tag,interaction.user.id,`${tu.tag} → ${role?.name??'none'}`);return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Sync complete').addFields({name:'Discord',value:`<@${tu.id}>`},{name:'Roblox Rank',value:role?.name??'Not in group'},{name:'Result',value:res})]});}
    catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}
  }

  if(commandName==='syncall'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const v=readJSON(VERIFIED_FILE);const cid=mkPending({});return interaction.reply({embeds:[baseEmbed().setDescription(`Sync all ${Object.keys(v).length} verified users' Discord roles to their Roblox rank?`)],components:[row(btn(`syncallconfirm::${cid}`,`Sync All (${Object.keys(v).length})`,ButtonStyle.Secondary),btn(`cancel::${cid}`,'Cancel',ButtonStyle.Danger))],ephemeral:true});}
  if(commandName==='verifiedlist'){const PER=10,page=interaction.options.getInteger('page')||1,v=readJSON(VERIFIED_FILE),entries=Object.entries(v);if(!entries.length)return interaction.reply({embeds:[baseEmbed().setDescription('No verified users.')]});const total=Math.ceil(entries.length/PER),p=Math.min(Math.max(page,1),total),slice=entries.slice((p-1)*PER,p*PER);return interaction.reply({embeds:[baseEmbed().setDescription(`**Verified Users — Page ${p}/${total}**\n\n${slice.map(([did,vv],i)=>`**${(p-1)*PER+i+1}.** <@${did}> — \`${vv.robloxUsername}\``).join('\n')}`)]});}
  if(commandName==='unverifyuser'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const tu=interaction.options.getUser('user');const v=readJSON(VERIFIED_FILE);if(!v[tu.id])return interaction.reply({embeds:[errEmbed(`<@${tu.id}> is not verified.`)],ephemeral:true});const old=v[tu.id].robloxUsername;delete v[tu.id];writeJSON(VERIFIED_FILE,v);pushAudit('FORCE_UNVERIFY',interaction.user.tag,interaction.user.id,`${tu.tag} — was ${old}`);return interaction.reply({embeds:[baseEmbed().setDescription(`✓ Unverified <@${tu.id}> — removed link to **${old}**.`)]});}
  if(commandName==='forceverify'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const tu=interaction.options.getUser('user'),username=interaction.options.getString('username');await interaction.deferReply();try{const ru=await getRobloxUser(username);const v=readJSON(VERIFIED_FILE);v[tu.id]={robloxId:ru.id,robloxUsername:ru.name,verifiedAt:new Date().toISOString(),forcedBy:interaction.user.tag};writeJSON(VERIFIED_FILE,v);pushAudit('FORCE_VERIFY',interaction.user.tag,interaction.user.id,`${tu.tag} → ${ru.name}`);return interaction.editReply({embeds:[baseEmbed().setDescription(`✓ Force-verified <@${tu.id}> as **${ru.name}**.`)]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='setverifiedrole'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const role=interaction.options.getRole('role');const rr=readJSON(RANKROLES_FILE);rr['__verified_role__']=role.id;writeJSON(RANKROLES_FILE,rr);pushAudit('SET_VERIFIED_ROLE',interaction.user.tag,interaction.user.id,role.name);return interaction.reply({embeds:[baseEmbed().setDescription(`✓ Verified role set to <@&${role.id}>.`)]});}
  if(commandName==='rankroles'){const rr=readJSON(RANKROLES_FILE);const e=Object.entries(rr).filter(([k])=>k!=='__verified_role__');if(!e.length)return interaction.reply({embeds:[baseEmbed().setDescription('No rank→role mappings. Use /setrankrole.')]});return interaction.reply({embeds:[baseEmbed().setDescription('✓ Rank → Discord role mappings').addFields({name:'Mappings',value:e.map(([r,rid])=>`**${r}** → <@&${rid}>`).join('\n')})]});}
  if(commandName==='setrankrole'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const rn=interaction.options.getString('rank'),role=interaction.options.getRole('role');const rr=readJSON(RANKROLES_FILE);rr[rn.toLowerCase()]=role.id;writeJSON(RANKROLES_FILE,rr);pushAudit('SET_RANK_ROLE',interaction.user.tag,interaction.user.id,`${rn} → ${role.name}`);return interaction.reply({embeds:[baseEmbed().setDescription(`✓ Mapped **${rn}** → <@&${role.id}>.`)]});}
  if(commandName==='removerankrole'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const rn=interaction.options.getString('rank').toLowerCase();const rr=readJSON(RANKROLES_FILE);if(!rr[rn])return interaction.reply({embeds:[errEmbed(`No mapping for "${rn}".`)]});delete rr[rn];writeJSON(RANKROLES_FILE,rr);return interaction.reply({embeds:[baseEmbed().setDescription(`✓ Removed mapping for **${rn}**.`)]});}

  // ═══ INVENTORY ═══
  if(commandName==='own'){const username=interaction.options.getString('username'),gid=interaction.options.getString('gamepassid');await interaction.deferReply();try{const ru=await getRobloxUser(username);const owns=await checkOwn(ru.id,'GamePass',gid);return interaction.editReply({embeds:[baseEmbed().setDescription(owns?'✓ User owns this game pass':'✗ User does NOT own this game pass').addFields({name:'User',value:ru.name},{name:'Game Pass ID',value:gid},{name:'Owns',value:owns?'Yes':'No'})]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='ownbadge'){const username=interaction.options.getString('username'),bid=interaction.options.getString('badgeid');await interaction.deferReply();try{const ru=await getRobloxUser(username);const owns=await checkOwn(ru.id,'Badge',bid);return interaction.editReply({embeds:[baseEmbed().setDescription(owns?'✓ User has this badge':'✗ User does NOT have this badge').addFields({name:'User',value:ru.name},{name:'Badge ID',value:bid},{name:'Has It',value:owns?'Yes':'No'})]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='checkinventory'){const username=interaction.options.getString('username'),type=interaction.options.getString('type'),aid=interaction.options.getString('assetid');await interaction.deferReply();try{const ru=await getRobloxUser(username);const owns=await checkOwn(ru.id,type,aid);return interaction.editReply({embeds:[baseEmbed().setDescription(owns?`✓ User owns this ${type}`:`✗ User does NOT own this ${type}`).addFields({name:'User',value:ru.name},{name:'Type',value:type},{name:'Asset ID',value:aid})]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='gameinfo'){const uid=interaction.options.getString('universeid');await interaction.deferReply();try{const g=await getGameInfo(uid);if(!g)return interaction.editReply({embeds:[errEmbed('Game not found.')]});return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Game info').addFields({name:'Name',value:g.name,inline:true},{name:'Creator',value:g.creator?.name??'Unknown',inline:true},{name:'Playing',value:String(g.playing??0),inline:true},{name:'Visits',value:String((g.visits??0).toLocaleString()),inline:true},{name:'Max Players',value:String(g.maxPlayers??'N/A'),inline:true},{name:'Favourites',value:String(g.favoritedCount??0),inline:true})]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='rankingaccount'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});await interaction.deferReply({ephemeral:true});try{const a=await getAuthUser();const[role,av]=await Promise.all([getUserGroupRole(a.id),getAvatar(a.id)]);const e=baseEmbed().setDescription('✓ Ranking account').addFields({name:'Username',value:a.name,inline:true},{name:'ID',value:String(a.id),inline:true},{name:'Group Rank',value:role?.name??'Not in group',inline:true},{name:'Cookie',value:'✓ Valid'});if(av)e.setThumbnail(av);return interaction.editReply({embeds:[e]});}catch(err){return interaction.editReply({embeds:[errEmbed(`Cookie may be invalid: ${err.message}`)]});}}

  // ═══ MODERATION ═══
  if(commandName==='warn'){
    if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});
    const username=interaction.options.getString('username'),reason=interaction.options.getString('reason');await interaction.deferReply();
    try{const ru=await getRobloxUser(username);const w=readJSON(WARNINGS_FILE);if(!w[ru.id])w[ru.id]=[];w[ru.id].push({reason,warnedBy:interaction.user.tag,warnedById:interaction.user.id,timestamp:new Date().toISOString()});writeJSON(WARNINGS_FILE,w);pushAudit('WARN',interaction.user.tag,interaction.user.id,`${ru.name} — ${reason}`);await sendLog(baseEmbed().setDescription('⚠️ Warning issued').addFields({name:'User',value:ru.name},{name:'Reason',value:reason},{name:'Total',value:String(w[ru.id].length)},{name:'By',value:`<@${interaction.user.id}>`}));return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Warning issued').addFields({name:'User',value:ru.name},{name:'Reason',value:reason},{name:'Total Warnings',value:String(w[ru.id].length)})]});}
    catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}
  }
  if(commandName==='warnings'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const username=interaction.options.getString('username');await interaction.deferReply({ephemeral:true});try{const ru=await getRobloxUser(username);const w=readJSON(WARNINGS_FILE)[ru.id]||[];if(!w.length)return interaction.editReply({embeds:[baseEmbed().setDescription(`No warnings for **${ru.name}**.`)]});const lines=w.map((x,i)=>`**${i+1}.** ${x.reason}\n> by ${x.warnedBy} • ${new Date(x.timestamp).toLocaleDateString('en-GB')}`).join('\n\n');return interaction.editReply({embeds:[baseEmbed().setDescription(`**Warnings for ${ru.name} (${w.length})**\n\n${lines}`)]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='clearwarnings'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const username=interaction.options.getString('username');await interaction.deferReply({ephemeral:true});try{const ru=await getRobloxUser(username);const w=readJSON(WARNINGS_FILE);const c=w[ru.id]?.length||0;w[ru.id]=[];writeJSON(WARNINGS_FILE,w);pushAudit('CLEARWARNINGS',interaction.user.tag,interaction.user.id,`${ru.name} — ${c} cleared`);return interaction.editReply({embeds:[baseEmbed().setDescription(`✓ Cleared ${c} warnings for **${ru.name}**.`)]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='deletewarn'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const username=interaction.options.getString('username'),num=interaction.options.getInteger('number');await interaction.deferReply({ephemeral:true});try{const ru=await getRobloxUser(username);const w=readJSON(WARNINGS_FILE);const warns=w[ru.id]||[];if(num<1||num>warns.length)return interaction.editReply({embeds:[errEmbed(`Warning #${num} not found.`)]});const removed=warns.splice(num-1,1)[0];w[ru.id]=warns;writeJSON(WARNINGS_FILE,w);return interaction.editReply({embeds:[baseEmbed().setDescription(`✓ Deleted warning #${num} for **${ru.name}**\n> Was: ${removed.reason}`)]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='addnote'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const username=interaction.options.getString('username'),note=interaction.options.getString('note');await interaction.deferReply({ephemeral:true});try{const ru=await getRobloxUser(username);const n=readJSON(NOTES_FILE);if(!n[ru.id])n[ru.id]=[];n[ru.id].push({note,addedBy:interaction.user.tag,addedById:interaction.user.id,timestamp:new Date().toISOString()});writeJSON(NOTES_FILE,n);pushAudit('ADDNOTE',interaction.user.tag,interaction.user.id,`${ru.name} — ${note}`);return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Note added').addFields({name:ru.name,value:note})]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='notes'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const username=interaction.options.getString('username');await interaction.deferReply({ephemeral:true});try{const ru=await getRobloxUser(username);const n=readJSON(NOTES_FILE)[ru.id]||[];if(!n.length)return interaction.editReply({embeds:[baseEmbed().setDescription(`No notes for **${ru.name}**.`)]});const lines=n.map((x,i)=>`**${i+1}.** ${x.note}\n> by ${x.addedBy} • ${new Date(x.timestamp).toLocaleDateString('en-GB')}`).join('\n\n');return interaction.editReply({embeds:[baseEmbed().setDescription(`**Notes for ${ru.name}**\n\n${lines}`)]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='clearnotes'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const username=interaction.options.getString('username');await interaction.deferReply({ephemeral:true});try{const ru=await getRobloxUser(username);const n=readJSON(NOTES_FILE);n[ru.id]=[];writeJSON(NOTES_FILE,n);return interaction.editReply({embeds:[baseEmbed().setDescription(`✓ Cleared all notes for **${ru.name}**.`)]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='deletenote'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const username=interaction.options.getString('username'),num=interaction.options.getInteger('number');await interaction.deferReply({ephemeral:true});try{const ru=await getRobloxUser(username);const n=readJSON(NOTES_FILE);const notes=n[ru.id]||[];if(num<1||num>notes.length)return interaction.editReply({embeds:[errEmbed(`Note #${num} not found.`)]});const removed=notes.splice(num-1,1)[0];n[ru.id]=notes;writeJSON(NOTES_FILE,n);return interaction.editReply({embeds:[baseEmbed().setDescription(`✓ Deleted note #${num} for **${ru.name}**\n> Was: ${removed.note}`)]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}

  if(commandName==='kick'){
    if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});
    const username=interaction.options.getString('username'),reason=interaction.options.getString('reason');await interaction.deferReply();
    try{const ru=await getRobloxUser(username);const or=await getUserGroupRole(ru.id);if(!or)return interaction.editReply({embeds:[errEmbed('User is not in the group.')]});const cid=mkPending({userId:ru.id,robloxUser:ru,oldRole:or,reason});return interaction.editReply({embeds:[baseEmbed().setDescription('Confirm group kick').addFields({name:'User',value:ru.name},{name:'Rank',value:or.name},{name:'Reason',value:reason})],components:[row(btn(`kickconfirm::${cid}`,'Confirm Kick',ButtonStyle.Danger),btn(`kickcancel::${cid}`,'Cancel',ButtonStyle.Secondary))]});}
    catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}
  }

  // ═══ BLACKLIST ═══
  if(commandName==='blacklist'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const username=interaction.options.getString('username'),reason=interaction.options.getString('reason');await interaction.deferReply();try{const ru=await getRobloxUser(username);const bl=readJSON(BLACKLIST_FILE);if(bl.find(e=>e.robloxId===ru.id))return interaction.editReply({embeds:[errEmbed(`${ru.name} is already blacklisted.`)]});bl.push({robloxId:ru.id,robloxUsername:ru.name,reason,addedBy:interaction.user.tag,addedById:interaction.user.id,timestamp:new Date().toISOString()});writeJSON(BLACKLIST_FILE,bl);pushAudit('BLACKLIST',interaction.user.tag,interaction.user.id,`${ru.name} — ${reason}`);await sendLog(baseEmbed().setDescription('🚫 Blacklisted').addFields({name:'User',value:ru.name},{name:'Reason',value:reason},{name:'By',value:`<@${interaction.user.id}>`}));return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Blacklisted').addFields({name:'User',value:ru.name},{name:'Reason',value:reason})]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='unblacklist'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const username=interaction.options.getString('username');await interaction.deferReply();try{const ru=await getRobloxUser(username);let bl=readJSON(BLACKLIST_FILE);if(!bl.find(e=>e.robloxId===ru.id))return interaction.editReply({embeds:[errEmbed(`${ru.name} is not blacklisted.`)]});bl=bl.filter(e=>e.robloxId!==ru.id);writeJSON(BLACKLIST_FILE,bl);pushAudit('UNBLACKLIST',interaction.user.tag,interaction.user.id,ru.name);return interaction.editReply({embeds:[baseEmbed().setDescription(`✓ Removed **${ru.name}** from blacklist.`)]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='blacklisted'){const PER=10,page=interaction.options.getInteger('page')||1,bl=readJSON(BLACKLIST_FILE);if(!bl.length)return interaction.reply({embeds:[baseEmbed().setDescription('Blacklist is empty.')]});const total=Math.ceil(bl.length/PER),p=Math.min(Math.max(page,1),total),slice=bl.slice((p-1)*PER,p*PER);const lines=slice.map((e,i)=>`**${(p-1)*PER+i+1}.** \`${e.robloxUsername}\` — ${e.reason}\n> by ${e.addedBy} • ${new Date(e.timestamp).toLocaleDateString('en-GB')}`).join('\n\n');return interaction.reply({embeds:[baseEmbed().setDescription(`**Blacklist (${bl.length}) — Page ${p}/${total}**\n\n${lines}`)]});}
  if(commandName==='isblacklisted'){const username=interaction.options.getString('username');await interaction.deferReply();try{const ru=await getRobloxUser(username);const e=readJSON(BLACKLIST_FILE).find(x=>x.robloxId===ru.id);return interaction.editReply({embeds:[baseEmbed().setDescription(e?`🚫 **${ru.name}** IS blacklisted`:`✓ **${ru.name}** is NOT blacklisted`).addFields(...(e?[{name:'Reason',value:e.reason},{name:'By',value:e.addedBy},{name:'Date',value:new Date(e.timestamp).toLocaleDateString('en-GB')}]:[]))]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='blacklistreason'){const username=interaction.options.getString('username');await interaction.deferReply();try{const ru=await getRobloxUser(username);const e=readJSON(BLACKLIST_FILE).find(x=>x.robloxId===ru.id);if(!e)return interaction.editReply({embeds:[errEmbed(`${ru.name} is not blacklisted.`)]});return interaction.editReply({embeds:[baseEmbed().setDescription(`✓ Blacklist reason — **${ru.name}**`).addFields({name:'Reason',value:e.reason},{name:'Added By',value:e.addedBy},{name:'Date',value:new Date(e.timestamp).toLocaleDateString('en-GB')})]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='clearblacklist'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const cid=mkPending({},30000);return interaction.reply({embeds:[baseEmbed().setDescription('⚠️ Clear the ENTIRE blacklist?')],components:[row(btn(`clearblconfirm::${cid}`,'Clear Blacklist',ButtonStyle.Danger),btn(`cancel::${cid}`,'Cancel',ButtonStyle.Secondary))],ephemeral:true});}

  // ═══ WATCHLIST ═══
  if(commandName==='watchlist'){
    if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});
    const action=interaction.options.getString('action').toLowerCase(),username=interaction.options.getString('username');
    if(action==='view'){const wl=readJSON(WATCHLIST_FILE);if(!wl.length)return interaction.reply({embeds:[baseEmbed().setDescription('Watchlist is empty.')]});return interaction.reply({embeds:[baseEmbed().setDescription(`**Watchlist (${wl.length})**\n\n${wl.map((e,i)=>`**${i+1}.** \`${e.robloxUsername}\`${e.reason?` — ${e.reason}`:''}\n> by ${e.addedBy}`).join('\n\n')}`)]});}
    if(!username)return interaction.reply({embeds:[errEmbed('Username required for add/remove.')],ephemeral:true});
    await interaction.deferReply();
    try{const ru=await getRobloxUser(username);let wl=readJSON(WATCHLIST_FILE);if(action==='add'){if(wl.find(e=>e.robloxId===ru.id))return interaction.editReply({embeds:[errEmbed('Already on watchlist.')]});wl.push({robloxId:ru.id,robloxUsername:ru.name,addedBy:interaction.user.tag,timestamp:new Date().toISOString()});writeJSON(WATCHLIST_FILE,wl);pushAudit('WATCH_ADD',interaction.user.tag,interaction.user.id,ru.name);return interaction.editReply({embeds:[baseEmbed().setDescription(`✓ Added **${ru.name}** to watchlist.`)]});}if(action==='remove'){if(!wl.find(e=>e.robloxId===ru.id))return interaction.editReply({embeds:[errEmbed('Not on watchlist.')]});wl=wl.filter(e=>e.robloxId!==ru.id);writeJSON(WATCHLIST_FILE,wl);pushAudit('WATCH_REMOVE',interaction.user.tag,interaction.user.id,ru.name);return interaction.editReply({embeds:[baseEmbed().setDescription(`✓ Removed **${ru.name}** from watchlist.`)]});}return interaction.editReply({embeds:[errEmbed('Use: add, remove, or view.')]});}
    catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}
  }
  if(commandName==='iswatched'){const username=interaction.options.getString('username');await interaction.deferReply();try{const ru=await getRobloxUser(username);const e=readJSON(WATCHLIST_FILE).find(x=>x.robloxId===ru.id);return interaction.editReply({embeds:[baseEmbed().setDescription(e?`👁 **${ru.name}** IS on the watchlist`:`✓ **${ru.name}** is NOT on the watchlist`).addFields(...(e?[{name:'Added By',value:e.addedBy},{name:'Date',value:new Date(e.timestamp).toLocaleDateString('en-GB')}]:[]))]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='addwatch'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const username=interaction.options.getString('username'),reason=interaction.options.getString('reason');await interaction.deferReply();try{const ru=await getRobloxUser(username);let wl=readJSON(WATCHLIST_FILE);if(wl.find(e=>e.robloxId===ru.id))return interaction.editReply({embeds:[errEmbed('Already on watchlist.')]});wl.push({robloxId:ru.id,robloxUsername:ru.name,addedBy:interaction.user.tag,reason,timestamp:new Date().toISOString()});writeJSON(WATCHLIST_FILE,wl);pushAudit('WATCH_ADD',interaction.user.tag,interaction.user.id,`${ru.name} — ${reason}`);await sendLog(baseEmbed().setDescription('👁 Watchlist').addFields({name:'User',value:ru.name},{name:'Reason',value:reason},{name:'By',value:`<@${interaction.user.id}>`}));return interaction.editReply({embeds:[baseEmbed().setDescription(`✓ Added **${ru.name}** to watchlist`).addFields({name:'Reason',value:reason})]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}

  // ═══ APPEALS ═══
  if(commandName==='appeal'){const username=interaction.options.getString('username'),reason=interaction.options.getString('reason');await interaction.deferReply({ephemeral:true});try{const ru=await getRobloxUser(username);const a=readJSON(APPEALS_FILE);if(a.find(x=>x.robloxId===ru.id&&x.status==='pending'))return interaction.editReply({embeds:[errEmbed('You already have a pending appeal.')]});const id=`app-${Date.now()}`;a.push({id,robloxId:ru.id,robloxUsername:ru.name,discordId:interaction.user.id,discordTag:interaction.user.tag,reason,status:'pending',timestamp:new Date().toISOString()});writeJSON(APPEALS_FILE,a);await sendLog(baseEmbed().setDescription('📩 New appeal').addFields({name:'Roblox',value:ru.name},{name:'Discord',value:`<@${interaction.user.id}>`},{name:'Reason',value:reason},{name:'ID',value:id}));return interaction.editReply({embeds:[baseEmbed().setDescription('✓ Appeal submitted').addFields({name:'Appeal ID',value:id},{name:'Status',value:'Pending'})]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='appeals'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const PER=5,page=interaction.options.getInteger('page')||1,pending=readJSON(APPEALS_FILE).filter(a=>a.status==='pending');if(!pending.length)return interaction.reply({embeds:[baseEmbed().setDescription('No pending appeals.')]});const total=Math.ceil(pending.length/PER),p=Math.min(Math.max(page,1),total),slice=pending.slice((p-1)*PER,p*PER);const lines=slice.map((a,i)=>`**${(p-1)*PER+i+1}.** \`${a.robloxUsername}\` — <@${a.discordId}>\n> ${trunc(a.reason,80)}\n> ID: \`${a.id}\` • ${new Date(a.timestamp).toLocaleDateString('en-GB')}`).join('\n\n');return interaction.reply({embeds:[baseEmbed().setDescription(`**Pending Appeals — Page ${p}/${total}**\n\n${lines}`)]});}
  if(commandName==='resolveappeal'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const id=interaction.options.getString('id'),decision=interaction.options.getString('decision').toLowerCase(),note=interaction.options.getString('note')||'No note.';if(!['approve','deny'].includes(decision))return interaction.reply({embeds:[errEmbed('Decision must be "approve" or "deny".')],ephemeral:true});const a=readJSON(APPEALS_FILE);const ap=a.find(x=>x.id===id);if(!ap)return interaction.reply({embeds:[errEmbed(`Appeal \`${id}\` not found.`)]});if(ap.status!=='pending')return interaction.reply({embeds:[errEmbed('Already resolved.')]});ap.status=decision==='approve'?'approved':'denied';ap.resolvedBy=interaction.user.tag;ap.resolvedById=interaction.user.id;ap.resolvedAt=new Date().toISOString();ap.note=note;writeJSON(APPEALS_FILE,a);pushAudit('RESOLVE_APPEAL',interaction.user.tag,interaction.user.id,`${id} — ${decision}`);return interaction.reply({embeds:[baseEmbed().setDescription(`✓ Appeal ${decision==='approve'?'approved':'denied'}`).addFields({name:'Appeal ID',value:id},{name:'User',value:ap.robloxUsername},{name:'Decision',value:decision==='approve'?'✓ Approved':'✗ Denied'},{name:'Note',value:note})]});}
  if(commandName==='appealstatus'){const username=interaction.options.getString('username');await interaction.deferReply({ephemeral:true});try{const ru=await getRobloxUser(username);const a=readJSON(APPEALS_FILE).filter(x=>x.robloxId===ru.id).slice(0,5);if(!a.length)return interaction.editReply({embeds:[baseEmbed().setDescription(`No appeals for **${ru.name}**.`)]});const lines=a.map((x,i)=>`**${i+1}.** \`${x.id}\` — **${x.status.toUpperCase()}**\n> ${trunc(x.reason,60)} • ${new Date(x.timestamp).toLocaleDateString('en-GB')}`).join('\n\n');return interaction.editReply({embeds:[baseEmbed().setDescription(`**Appeals for ${ru.name}**\n\n${lines}`)]});}catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}}
  if(commandName==='allappeals'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const PER=5,page=interaction.options.getInteger('page')||1,all=readJSON(APPEALS_FILE);if(!all.length)return interaction.reply({embeds:[baseEmbed().setDescription('No appeals.')]});const total=Math.ceil(all.length/PER),p=Math.min(Math.max(page,1),total),slice=all.slice((p-1)*PER,p*PER);return interaction.reply({embeds:[baseEmbed().setDescription(`**All Appeals — Page ${p}/${total}**\n\n${slice.map((a,i)=>`**${(p-1)*PER+i+1}.** \`${a.robloxUsername}\` — **${a.status.toUpperCase()}**\n> ID: \`${a.id}\``).join('\n\n')}`)]});}
  if(commandName==='clearappeals'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const remaining=readJSON(APPEALS_FILE).filter(a=>a.status==='pending');const cleared=readJSON(APPEALS_FILE).length-remaining.length;writeJSON(APPEALS_FILE,remaining);return interaction.reply({embeds:[baseEmbed().setDescription(`✓ Cleared ${cleared} resolved appeals.`)]});}

  // ═══ TAGS ═══
  if(commandName==='tag'){const name=interaction.options.getString('name').toLowerCase();const t=readJSON(TAGS_FILE);if(!t[name])return interaction.reply({embeds:[errEmbed(`Tag \`${name}\` not found. Use /tags to see all.`)]});return interaction.reply({content:t[name].content});}
  if(commandName==='addtag'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const name=interaction.options.getString('name').toLowerCase(),content=interaction.options.getString('content');const t=readJSON(TAGS_FILE);t[name]={content,createdBy:interaction.user.tag,createdAt:new Date().toISOString()};writeJSON(TAGS_FILE,t);pushAudit('ADD_TAG',interaction.user.tag,interaction.user.id,name);return interaction.reply({embeds:[baseEmbed().setDescription(`✓ Tag \`${name}\` created.`)],ephemeral:true});}
  if(commandName==='edittag'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const name=interaction.options.getString('name').toLowerCase(),content=interaction.options.getString('content');const t=readJSON(TAGS_FILE);if(!t[name])return interaction.reply({embeds:[errEmbed(`Tag \`${name}\` not found.`)],ephemeral:true});t[name].content=content;t[name].editedBy=interaction.user.tag;t[name].editedAt=new Date().toISOString();writeJSON(TAGS_FILE,t);return interaction.reply({embeds:[baseEmbed().setDescription(`✓ Tag \`${name}\` updated.`)],ephemeral:true});}
  if(commandName==='deletetag'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const name=interaction.options.getString('name').toLowerCase();const t=readJSON(TAGS_FILE);if(!t[name])return interaction.reply({embeds:[errEmbed(`Tag \`${name}\` not found.`)],ephemeral:true});delete t[name];writeJSON(TAGS_FILE,t);pushAudit('DELETE_TAG',interaction.user.tag,interaction.user.id,name);return interaction.reply({embeds:[baseEmbed().setDescription(`✓ Tag \`${name}\` deleted.`)],ephemeral:true});}
  if(commandName==='tags'){const t=readJSON(TAGS_FILE);const names=Object.keys(t);if(!names.length)return interaction.reply({embeds:[baseEmbed().setDescription('No tags yet. Use /addtag.')]});return interaction.reply({embeds:[baseEmbed().setDescription(`**All Tags (${names.length})**\n\n${names.map(n=>`\`${n}\``).join(', ')}`)]});}

  // ═══ REMINDERS ═══
  if(commandName==='remind'){const minutes=interaction.options.getInteger('minutes'),message=interaction.options.getString('message');if(minutes<1||minutes>10080)return interaction.reply({embeds:[errEmbed('Minutes must be 1-10080.')],ephemeral:true});const r=readJSON(REMINDERS_FILE);if(r.filter(x=>x.userId===interaction.user.id&&!x.done).length>=10)return interaction.reply({embeds:[errEmbed('Max 10 pending reminders.')],ephemeral:true});const fireAt=new Date(Date.now()+minutes*60_000).toISOString();r.push({id:`rem-${Date.now()}`,userId:interaction.user.id,message,fireAt,createdAt:new Date().toISOString(),done:false});writeJSON(REMINDERS_FILE,r);return interaction.reply({embeds:[baseEmbed().setDescription(`✓ Reminder set! I'll DM you <t:${Math.floor(new Date(fireAt).getTime()/1000)}:R>.`).addFields({name:'Message',value:message})],ephemeral:true});}
  if(commandName==='myreminders'){const r=readJSON(REMINDERS_FILE).filter(x=>x.userId===interaction.user.id&&!x.done);if(!r.length)return interaction.reply({embeds:[baseEmbed().setDescription('No pending reminders.')],ephemeral:true});const lines=r.map((x,i)=>`**${i+1}.** ${x.message}\n> <t:${Math.floor(new Date(x.fireAt).getTime()/1000)}:R>`).join('\n\n');return interaction.reply({embeds:[baseEmbed().setDescription(`**Your Reminders (${r.length})**\n\n${lines}`)],ephemeral:true});}
  if(commandName==='cancelreminder'){const num=interaction.options.getInteger('number');const r=readJSON(REMINDERS_FILE);const ur=r.filter(x=>x.userId===interaction.user.id&&!x.done);if(num<1||num>ur.length)return interaction.reply({embeds:[errEmbed(`Reminder #${num} not found.`)],ephemeral:true});const target=ur[num-1];const idx=r.findIndex(x=>x.id===target.id);r.splice(idx,1);writeJSON(REMINDERS_FILE,r);return interaction.reply({embeds:[baseEmbed().setDescription(`✓ Cancelled: **${target.message}**`)],ephemeral:true});}

  // ═══ STAFF TOOLS ═══
  if(commandName==='staffstats'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const days=interaction.options.getInteger('days')||30;const since=Date.now()-days*86400000;const logs=readJSON(LOGS_FILE).filter(l=>new Date(l.timestamp).getTime()>since);if(!logs.length)return interaction.reply({embeds:[baseEmbed().setDescription(`No changes in ${days} days.`)]});const c={};for(const l of logs)c[l.staffDiscordId]=(c[l.staffDiscordId]||0)+1;const sorted=Object.entries(c).sort((a,b)=>b[1]-a[1]);return interaction.reply({embeds:[baseEmbed().setDescription(`**Staff Stats — Last ${days} days**`).addFields({name:'Actions',value:sorted.map(([id,n],i)=>`**${i+1}.** <@${id}> — ${n}`).join('\n')||'None'})]});}
  if(commandName==='topstaff'){const logs=readJSON(LOGS_FILE);if(!logs.length)return interaction.reply({embeds:[baseEmbed().setDescription('No logs yet.')]});const c={};for(const l of logs)c[l.staffDiscordId]=(c[l.staffDiscordId]||0)+1;const sorted=Object.entries(c).sort((a,b)=>b[1]-a[1]).slice(0,10);return interaction.reply({embeds:[baseEmbed().setDescription('**Top Staff (All Time)**').addFields({name:'Leaderboard',value:sorted.map(([id,n],i)=>`**${i+1}.** <@${id}> — ${n} actions`).join('\n')||'None'})]});}
  if(commandName==='staffactivity'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const su=interaction.options.getUser('staff'),days=interaction.options.getInteger('days')||7;const since=Date.now()-days*86400000;const logs=readJSON(LOGS_FILE).filter(l=>l.staffDiscordId===su.id&&new Date(l.timestamp).getTime()>since);return interaction.reply({embeds:[baseEmbed().setDescription(`**Activity — <@${su.id}> — Last ${days} days**`).addFields({name:'Actions',value:String(logs.length)},{name:'Active',value:logs.length>0?'✓ Yes':'✗ No activity'})]});}
  if(commandName==='inactivestaffs'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});await interaction.deferReply();const since=Date.now()-7*86400000;const active=new Set(readJSON(LOGS_FILE).filter(l=>new Date(l.timestamp).getTime()>since).map(l=>l.staffDiscordId));const allStaff=ALLOWED_ROLES.length>0?[...interaction.guild.members.cache.values()].filter(m=>m.roles.cache.some(r=>ALLOWED_ROLES.includes(r.id))):[]; const inactive=allStaff.filter(m=>!active.has(m.id)&&!m.user.bot);if(!inactive.length)return interaction.editReply({embeds:[baseEmbed().setDescription('All staff were active in the last 7 days.')]});return interaction.editReply({embeds:[baseEmbed().setDescription(`**Inactive Staff (${inactive.length})**\n\n${inactive.map((m,i)=>`**${i+1}.** <@${m.id}>`).join('\n')}`)]});}
  if(commandName==='staffcheck'){const tu=interaction.options.getUser('user');const m=await interaction.guild.members.fetch(tu.id).catch(()=>null);if(!m)return interaction.reply({embeds:[errEmbed('User not in server.')]});const isStaff=hasPerm(m);const v=readJSON(VERIFIED_FILE)[tu.id];const logs=readJSON(LOGS_FILE).filter(l=>l.staffDiscordId===tu.id);return interaction.reply({embeds:[baseEmbed().setDescription(`✓ Staff check — <@${tu.id}>`).addFields({name:'Is Staff',value:isStaff?'✓ Yes':'✗ No'},{name:'Verified Roblox',value:v?v.robloxUsername:'Not verified'},{name:'Total Actions',value:String(logs.length)})]});}

  // ═══ UTILITY ═══
  if(commandName==='serverinfo'){await interaction.guild.fetch();const g=interaction.guild;return interaction.reply({embeds:[baseEmbed().setDescription('✓ Server info').addFields({name:'Name',value:g.name,inline:true},{name:'ID',value:g.id,inline:true},{name:'Owner',value:`<@${g.ownerId}>`,inline:true},{name:'Members',value:String(g.memberCount),inline:true},{name:'Channels',value:String(g.channels.cache.size),inline:true},{name:'Roles',value:String(g.roles.cache.size),inline:true},{name:'Boost Level',value:String(g.premiumTier),inline:true},{name:'Boosts',value:String(g.premiumSubscriptionCount??0),inline:true},{name:'Created',value:`<t:${Math.floor(g.createdTimestamp/1000)}:R>`,inline:true})]});}
  if(commandName==='userinfo'){const tu=interaction.options.getUser('user')||interaction.user;const m=await interaction.guild.members.fetch(tu.id).catch(()=>null);const e=baseEmbed().setDescription('✓ User info').setThumbnail(tu.displayAvatarURL({dynamic:true})).addFields({name:'Username',value:tu.tag,inline:true},{name:'ID',value:tu.id,inline:true},{name:'Bot',value:tu.bot?'Yes':'No',inline:true},{name:'Account Created',value:`<t:${Math.floor(tu.createdTimestamp/1000)}:R>`,inline:true},...(m?[{name:'Joined Server',value:`<t:${Math.floor(m.joinedTimestamp/1000)}:R>`,inline:true},{name:'Nickname',value:m.nickname||'None',inline:true},{name:'Roles',value:trunc(m.roles.cache.filter(r=>r.id!==interaction.guild.id).map(r=>`<@&${r.id}>`).join(' ')||'None',500)}]:[]));return interaction.reply({embeds:[e]});}
  if(commandName==='roleinfo'){const role=interaction.options.getRole('role');return interaction.reply({embeds:[baseEmbed().setDescription('✓ Role info').addFields({name:'Name',value:role.name,inline:true},{name:'ID',value:role.id,inline:true},{name:'Color',value:role.hexColor,inline:true},{name:'Members',value:String(role.members.size),inline:true},{name:'Mentionable',value:role.mentionable?'Yes':'No',inline:true},{name:'Hoisted',value:role.hoist?'Yes':'No',inline:true},{name:'Position',value:String(role.position),inline:true},{name:'Created',value:`<t:${Math.floor(role.createdTimestamp/1000)}:R>`,inline:true})]});}
  if(commandName==='channelinfo'){const ch=interaction.options.getChannel('channel')||interaction.channel;return interaction.reply({embeds:[baseEmbed().setDescription('✓ Channel info').addFields({name:'Name',value:ch.name,inline:true},{name:'ID',value:ch.id,inline:true},{name:'Type',value:String(ch.type),inline:true},{name:'Category',value:ch.parent?.name??'None',inline:true},{name:'Created',value:`<t:${Math.floor(ch.createdTimestamp/1000)}:R>`,inline:true})]});}
  if(commandName==='membercount'){await interaction.guild.fetch();return interaction.reply({embeds:[baseEmbed().setDescription(`✓ **${interaction.guild.name}** has **${interaction.guild.memberCount.toLocaleString()}** members.`)]});}
  if(commandName==='boostinfo'){const g=interaction.guild;return interaction.reply({embeds:[baseEmbed().setDescription('✓ Boost info').addFields({name:'Boost Level',value:`Level ${g.premiumTier}`,inline:true},{name:'Total Boosts',value:String(g.premiumSubscriptionCount??0),inline:true})]});}
  if(commandName==='timestamp'){const ds=interaction.options.getString('date');let date;if(ds.toLowerCase()==='now')date=new Date();else{date=new Date(ds);if(isNaN(date.getTime()))return interaction.reply({embeds:[errEmbed('Invalid date. Try: 2025-01-01 or "now".')]});}const u=Math.floor(date.getTime()/1000);return interaction.reply({embeds:[baseEmbed().setDescription('✓ Discord timestamps').addFields({name:'Short Date',value:`\`<t:${u}:d>\` → <t:${u}:d>`},{name:'Long Date',value:`\`<t:${u}:D>\` → <t:${u}:D>`},{name:'Short Time',value:`\`<t:${u}:t>\` → <t:${u}:t>`},{name:'Full Date/Time',value:`\`<t:${u}:f>\` → <t:${u}:f>`},{name:'Relative',value:`\`<t:${u}:R>\` → <t:${u}:R>`},{name:'Unix',value:String(u)})]});}
  if(commandName==='calculate'){const expr=interaction.options.getString('expression');try{if(/[^0-9+\-*/().\s%]/.test(expr))return interaction.reply({embeds:[errEmbed('Only numbers and math operators allowed.')]});const result=Function('"use strict";return('+expr+')')();return interaction.reply({embeds:[baseEmbed().setDescription('✓ Calculator').addFields({name:'Expression',value:expr},{name:'Result',value:String(result)})]});}catch{return interaction.reply({embeds:[errEmbed('Invalid expression.')]});}}
  if(commandName==='say'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const msg=interaction.options.getString('message'),ch=interaction.options.getChannel('channel')||interaction.channel;try{await ch.send(msg);return interaction.reply({embeds:[baseEmbed().setDescription(`✓ Sent to <#${ch.id}>`)],ephemeral:true});}catch{return interaction.reply({embeds:[errEmbed("Couldn't send.")],ephemeral:true});}}
  if(commandName==='embed'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const title=interaction.options.getString('title'),desc=interaction.options.getString('description'),ch=interaction.options.getChannel('channel')||interaction.channel;try{await ch.send({embeds:[new EmbedBuilder().setColor(0x111111).setTitle(title).setDescription(desc).setTimestamp()]});return interaction.reply({embeds:[baseEmbed().setDescription(`✓ Embed sent to <#${ch.id}>`)],ephemeral:true});}catch{return interaction.reply({embeds:[errEmbed("Couldn't send.")],ephemeral:true});}}
  if(commandName==='poll'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const q=interaction.options.getString('question');const msg=await interaction.reply({embeds:[new EmbedBuilder().setColor(0x111111).setDescription(`📊 **Poll**\n\n${q}`).setFooter({text:`Asked by ${interaction.user.tag}`,iconURL:FOOTER_ICON}).setTimestamp()],fetchReply:true});await msg.react('✅');await msg.react('❌');return;}
  if(commandName==='announce'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const msg=interaction.options.getString('message'),ch=interaction.options.getChannel('channel')||interaction.channel;try{await ch.send({embeds:[new EmbedBuilder().setColor(0x111111).setDescription(`📣 **Announcement**\n\n${msg}`).setFooter({text:`By ${interaction.user.tag}`,iconURL:FOOTER_ICON}).setTimestamp()]});return interaction.reply({embeds:[baseEmbed().setDescription(`✓ Announced to <#${ch.id}>`)],ephemeral:true});}catch{return interaction.reply({embeds:[errEmbed("Couldn't send.")],ephemeral:true});}}
  if(commandName==='avatar'){const tu=interaction.options.getUser('user')||interaction.user;const url=tu.displayAvatarURL({dynamic:true,size:512});return interaction.reply({embeds:[new EmbedBuilder().setColor(0x111111).setDescription(`**${tu.tag}'s avatar**`).setImage(url).setFooter({text:'Rank System',iconURL:FOOTER_ICON})]});}

  // ═══ CONFIG ═══
  if(commandName==='config'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const rr=readJSON(RANKROLES_FILE);return interaction.reply({embeds:[baseEmbed().setDescription('✓ Bot configuration').addFields({name:'Group ID',value:GROUP_ID||'Not set'},{name:'Log Channel',value:LOG_CHANNEL_ID?`<#${LOG_CHANNEL_ID}>`:'Not set'},{name:'Audit Channel',value:AUDIT_LOG_CHANNEL?`<#${AUDIT_LOG_CHANNEL}>`:'Not set'},{name:'Staff Roles',value:ALLOWED_ROLES.length?ALLOWED_ROLES.map(r=>`<@&${r}>`).join(' '):'All users (no restriction)'},{name:'Verified Role',value:rr['__verified_role__']?`<@&${rr['__verified_role__']}>`:'Not set'},{name:'Rank→Role Mappings',value:String(Object.keys(rr).filter(k=>k!=='__verified_role__').length)},{name:'Total Commands',value:String(commands.length)})],ephemeral:true});}
  if(commandName==='setlogchannel'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const ch=interaction.options.getChannel('channel');return interaction.reply({embeds:[baseEmbed().setDescription(`✓ To set the log channel, add \`LOG_CHANNEL_ID=${ch.id}\` to your .env and restart.`)],ephemeral:true});}
  if(commandName==='setauditchannel'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const ch=interaction.options.getChannel('channel');return interaction.reply({embeds:[baseEmbed().setDescription(`✓ To set the audit channel, add \`AUDIT_LOG_CHANNEL=${ch.id}\` to your .env and restart.`)],ephemeral:true});}
  if(commandName==='addbannedword'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const w=interaction.options.getString('word').toLowerCase();const bw=readJSON(BANNEDWORDS_FILE);if(bw.includes(w))return interaction.reply({embeds:[errEmbed(`"${w}" already banned.`)],ephemeral:true});bw.push(w);writeJSON(BANNEDWORDS_FILE,bw);pushAudit('ADD_BANNED_WORD',interaction.user.tag,interaction.user.id,w);return interaction.reply({embeds:[baseEmbed().setDescription(`✓ \`${w}\` added to banned words.`)],ephemeral:true});}
  if(commandName==='removebannedword'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const w=interaction.options.getString('word').toLowerCase();let bw=readJSON(BANNEDWORDS_FILE);if(!bw.includes(w))return interaction.reply({embeds:[errEmbed(`"${w}" not in banned list.`)],ephemeral:true});bw=bw.filter(x=>x!==w);writeJSON(BANNEDWORDS_FILE,bw);return interaction.reply({embeds:[baseEmbed().setDescription(`✓ \`${w}\` removed.`)],ephemeral:true});}
  if(commandName==='bannedwords'){if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});const bw=readJSON(BANNEDWORDS_FILE);if(!bw.length)return interaction.reply({embeds:[baseEmbed().setDescription('No banned words.')],ephemeral:true});return interaction.reply({embeds:[baseEmbed().setDescription(`**Banned Words (${bw.length})**\n\n${bw.map(w=>`\`${w}\``).join(', ')}`)],ephemeral:true});}

  if(commandName==='cleardata'){
    if(!hasPerm(interaction.member))return interaction.reply({embeds:[errEmbed('No permission.')],ephemeral:true});
    const username=interaction.options.getString('username');await interaction.deferReply({ephemeral:true});
    try{const ru=await getRobloxUser(username);const cid=mkPending({robloxId:ru.id,robloxUsername:ru.name},30000);return interaction.editReply({embeds:[baseEmbed().setDescription(`⚠️ Clear ALL bot data for **${ru.name}**?\nThis removes: warnings, notes, blacklist, watchlist entries.`)],components:[row(btn(`cleardataconfirm::${cid}`,`Clear All Data`,ButtonStyle.Danger),btn(`cancel::${cid}`,'Cancel',ButtonStyle.Secondary))]});}
    catch(err){return interaction.editReply({embeds:[errEmbed(err.message)]});}
  }
});

// ─── AUTO MOD (banned words) ──────────────────────────────────────────────────
client.on('messageCreate', async message => {
  if(!message.guild||message.author.bot) return;
  const bw=readJSON(BANNEDWORDS_FILE); if(!bw.length) return;
  const found=bw.find(w=>message.content.toLowerCase().includes(w));
  if(found) {
    try {
      await message.delete();
      if(LOG_CHANNEL_ID){try{const ch=await client.channels.fetch(LOG_CHANNEL_ID);await ch.send({embeds:[new EmbedBuilder().setColor(0x111111).setDescription('🚫 Banned word auto-deleted').addFields({name:'User',value:`<@${message.author.id}> (${message.author.tag})`},{name:'Channel',value:`<#${message.channelId}>`},{name:'Word',value:`\`${found}\``},{name:'Message',value:trunc(message.content,200)}).setTimestamp().setFooter({text:'Auto Mod',iconURL:FOOTER_ICON})]});}catch{}}
    } catch {}
  }
});

// ─── AUDIT LOGGER ─────────────────────────────────────────────────────────────
require('./auditLogger')(client);

// ─── BOOT ─────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✓ Logged in as ${client.user.tag}`);
  console.log(`✓ ${commands.length} commands loaded`);
  client.user.setActivity('the group', { type: ActivityType.Watching });
  await registerCommands();
  startScheduleRunner();
  startReminderRunner();
  console.log('✓ Schedule + Reminder runners started');
  if(AUDIT_LOG_CHANNEL) console.log(`✓ Discord audit log → channel ${AUDIT_LOG_CHANNEL}`);
  else console.log('⚠ AUDIT_LOG_CHANNEL not set');
});

client.login(DISCORD_TOKEN);
