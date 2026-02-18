// auditLogger.js — Full Discord Server Audit Log
// Drop this file next to index.js, then add to index.js:
//   require('./auditLogger')(client);
// And add AUDIT_LOG_CHANNEL=your_channel_id to your .env

const { EmbedBuilder, AuditLogEvent } = require('discord.js');

const THUMBNAIL  = 'https://cdn.discordapp.com/attachments/1473143652371927209/1473181303389290569/image.png?ex=6995ef41&is=69949dc1&hm=7bfda4ad5d3c84d2ae2bbf84f7a48c1174e0d09952cea66e0dd411e215e30c88&';
const FOOTER_TXT = 'Server Audit Log • Made by Zaid';

// ─── COLORS ───────────────────────────────────────────────────────────────────
const COLOR = {
  DELETE:  0x1a1a1a,
  EDIT:    0x1f1f1f,
  JOIN:    0x1a1a1a,
  LEAVE:   0x111111,
  BAN:     0x0d0d0d,
  ROLE:    0x181818,
  CHANNEL: 0x161616,
  VOICE:   0x141414,
  SERVER:  0x121212,
  INVITE:  0x1c1c1c,
  BOOST:   0x1e1e1e,
  THREAD:  0x171717,
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function auditEmbed(color) {
  return new EmbedBuilder()
    .setColor(color)
    .setThumbnail(THUMBNAIL)
    .setTimestamp()
    .setFooter({ text: FOOTER_TXT, iconURL: THUMBNAIL });
}

async function send(channel, embed) {
  if (!channel) return;
  try { await channel.send({ embeds: [embed] }); } catch { }
}

function truncate(str, max = 1024) {
  if (!str) return 'None';
  return str.length > max ? str.slice(0, max - 3) + '...' : str;
}

async function getAuditEntry(guild, type, targetId, delay = 800) {
  await new Promise(r => setTimeout(r, delay));
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 1 });
    const entry = logs.entries.first();
    if (!entry) return null;
    if (targetId && entry.target?.id !== targetId) return null;
    if (Date.now() - entry.createdTimestamp > 5000) return null;
    return entry;
  } catch { return null; }
}

// ─── MODULE EXPORT ────────────────────────────────────────────────────────────

module.exports = function registerAuditLog(client) {

  async function getLogChannel(guild) {
    const id = process.env.AUDIT_LOG_CHANNEL;
    if (!id) return null;
    try { return await guild.channels.fetch(id); } catch { return null; }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MESSAGES
  // ══════════════════════════════════════════════════════════════════════════

  // Message Deleted
  client.on('messageDelete', async message => {
    if (!message.guild || message.author?.bot) return;
    const ch = await getLogChannel(message.guild);
    if (!ch) return;

    const entry = await getAuditEntry(message.guild, AuditLogEvent.MessageDelete, message.author?.id);
    const deletedBy = entry ? `<@${entry.executor?.id}> (${entry.executor?.tag})` : 'Unknown / Self';

    const embed = auditEmbed(COLOR.DELETE)
      .setAuthor({ name: 'Message Deleted', iconURL: THUMBNAIL })
      .addFields(
        { name: 'Author', value: message.author ? `<@${message.author.id}> (${message.author.tag})` : 'Unknown' },
        { name: 'Channel', value: `<#${message.channelId}>` },
        { name: 'Deleted By', value: deletedBy },
        { name: 'Content', value: truncate(message.content || '*No text content*', 1000) }
      );

    if (message.attachments.size > 0) {
      embed.addFields({ name: `Attachments (${message.attachments.size})`, value: message.attachments.map(a => a.url).join('\n') });
    }

    await send(ch, embed);
  });

  // Bulk Message Delete
  client.on('messageDeleteBulk', async (messages, channel) => {
    if (!channel.guild) return;
    const ch = await getLogChannel(channel.guild);
    if (!ch) return;

    const entry = await getAuditEntry(channel.guild, AuditLogEvent.MessageBulkDelete, channel.id);
    const deletedBy = entry ? `<@${entry.executor?.id}> (${entry.executor?.tag})` : 'Unknown';

    const embed = auditEmbed(COLOR.DELETE)
      .setAuthor({ name: 'Bulk Messages Deleted', iconURL: THUMBNAIL })
      .addFields(
        { name: 'Channel', value: `<#${channel.id}>` },
        { name: 'Messages Deleted', value: String(messages.size) },
        { name: 'Deleted By', value: deletedBy }
      );

    await send(ch, embed);
  });

  // Message Edited
  client.on('messageUpdate', async (oldMsg, newMsg) => {
    if (!newMsg.guild || newMsg.author?.bot) return;
    if (!oldMsg.content || oldMsg.content === newMsg.content) return;
    const ch = await getLogChannel(newMsg.guild);
    if (!ch) return;

    const embed = auditEmbed(COLOR.EDIT)
      .setAuthor({ name: 'Message Edited', iconURL: THUMBNAIL })
      .addFields(
        { name: 'Author', value: `<@${newMsg.author.id}> (${newMsg.author.tag})` },
        { name: 'Channel', value: `<#${newMsg.channelId}>` },
        { name: 'Before', value: truncate(oldMsg.content || '*Empty*', 500) },
        { name: 'After', value: truncate(newMsg.content || '*Empty*', 500) },
        { name: 'Jump to Message', value: `[Click here](${newMsg.url})` }
      );

    await send(ch, embed);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // MEMBERS
  // ══════════════════════════════════════════════════════════════════════════

  // Member Join
  client.on('guildMemberAdd', async member => {
    const ch = await getLogChannel(member.guild);
    if (!ch) return;

    const accountAge = Math.floor((Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24));
    const isNew = accountAge < 7;

    const embed = auditEmbed(COLOR.JOIN)
      .setAuthor({ name: 'Member Joined', iconURL: THUMBNAIL })
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: 'User', value: `<@${member.id}> (${member.user.tag})` },
        { name: 'User ID', value: member.id },
        { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>` },
        { name: 'Account Age', value: `${accountAge} days${isNew ? ' ⚠ New account' : ''}` },
        { name: 'Member Count', value: String(member.guild.memberCount) }
      );

    await send(ch, embed);
  });

  // Member Leave
  client.on('guildMemberRemove', async member => {
    const ch = await getLogChannel(member.guild);
    if (!ch) return;

    const entry = await getAuditEntry(member.guild, AuditLogEvent.MemberKick, member.id);
    const wasKicked = !!entry;
    const kickedBy = wasKicked ? `<@${entry.executor?.id}> (${entry.executor?.tag})` : null;
    const kickReason = wasKicked ? (entry.reason || 'No reason provided') : null;

    const roles = member.roles.cache.filter(r => r.id !== member.guild.id).map(r => `<@&${r.id}>`).join(' ') || 'None';

    const embed = auditEmbed(COLOR.LEAVE)
      .setAuthor({ name: wasKicked ? 'Member Kicked' : 'Member Left', iconURL: THUMBNAIL })
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: 'User', value: `${member.user.tag}` },
        { name: 'User ID', value: member.id },
        { name: 'Joined At', value: member.joinedAt ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Unknown' },
        { name: 'Roles Held', value: truncate(roles, 500) },
        ...(wasKicked ? [
          { name: 'Kicked By', value: kickedBy },
          { name: 'Kick Reason', value: kickReason }
        ] : [])
      );

    await send(ch, embed);
  });

  // Member Update (roles, nickname, timeout)
  client.on('guildMemberUpdate', async (oldMember, newMember) => {
    const ch = await getLogChannel(newMember.guild);
    if (!ch) return;

    // Nickname change
    if (oldMember.nickname !== newMember.nickname) {
      const entry = await getAuditEntry(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id);
      const changedBy = entry ? `<@${entry.executor?.id}>` : 'Unknown';

      const embed = auditEmbed(COLOR.EDIT)
        .setAuthor({ name: 'Nickname Changed', iconURL: THUMBNAIL })
        .addFields(
          { name: 'User', value: `<@${newMember.id}> (${newMember.user.tag})` },
          { name: 'Before', value: oldMember.nickname || '*None*' },
          { name: 'After', value: newMember.nickname || '*None*' },
          { name: 'Changed By', value: changedBy }
        );

      await send(ch, embed);
    }

    // Role added
    const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
    const removedRoles = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));

    if (addedRoles.size > 0 || removedRoles.size > 0) {
      const entry = await getAuditEntry(newMember.guild, AuditLogEvent.MemberRoleUpdate, newMember.id);
      const changedBy = entry ? `<@${entry.executor?.id}>` : 'Unknown';

      const embed = auditEmbed(COLOR.ROLE)
        .setAuthor({ name: 'Member Roles Updated', iconURL: THUMBNAIL })
        .addFields(
          { name: 'User', value: `<@${newMember.id}> (${newMember.user.tag})` },
          ...(addedRoles.size > 0 ? [{ name: `✓ Roles Added (${addedRoles.size})`, value: addedRoles.map(r => `<@&${r.id}>`).join(' ') }] : []),
          ...(removedRoles.size > 0 ? [{ name: `✗ Roles Removed (${removedRoles.size})`, value: removedRoles.map(r => `<@&${r.id}>`).join(' ') }] : []),
          { name: 'Updated By', value: changedBy }
        );

      await send(ch, embed);
    }

    // Timeout
    if (!oldMember.communicationDisabledUntil && newMember.communicationDisabledUntil) {
      const entry = await getAuditEntry(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id);
      const by = entry ? `<@${entry.executor?.id}>` : 'Unknown';
      const until = `<t:${Math.floor(newMember.communicationDisabledUntilTimestamp / 1000)}:R>`;

      const embed = auditEmbed(COLOR.BAN)
        .setAuthor({ name: 'Member Timed Out', iconURL: THUMBNAIL })
        .addFields(
          { name: 'User', value: `<@${newMember.id}> (${newMember.user.tag})` },
          { name: 'Times Out', value: until },
          { name: 'By', value: by },
          { name: 'Reason', value: entry?.reason || 'No reason provided' }
        );

      await send(ch, embed);
    }

    // Timeout removed
    if (oldMember.communicationDisabledUntil && !newMember.communicationDisabledUntil) {
      const entry = await getAuditEntry(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id);
      const by = entry ? `<@${entry.executor?.id}>` : 'Unknown';

      const embed = auditEmbed(COLOR.EDIT)
        .setAuthor({ name: 'Timeout Removed', iconURL: THUMBNAIL })
        .addFields(
          { name: 'User', value: `<@${newMember.id}> (${newMember.user.tag})` },
          { name: 'Removed By', value: by }
        );

      await send(ch, embed);
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // BANS
  // ══════════════════════════════════════════════════════════════════════════

  client.on('guildBanAdd', async ban => {
    const ch = await getLogChannel(ban.guild);
    if (!ch) return;

    const entry = await getAuditEntry(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
    const by = entry ? `<@${entry.executor?.id}> (${entry.executor?.tag})` : 'Unknown';
    const reason = entry?.reason || 'No reason provided';

    const embed = auditEmbed(COLOR.BAN)
      .setAuthor({ name: 'Member Banned', iconURL: THUMBNAIL })
      .setThumbnail(ban.user.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: 'User', value: `${ban.user.tag}` },
        { name: 'User ID', value: ban.user.id },
        { name: 'Banned By', value: by },
        { name: 'Reason', value: reason }
      );

    await send(ch, embed);
  });

  client.on('guildBanRemove', async ban => {
    const ch = await getLogChannel(ban.guild);
    if (!ch) return;

    const entry = await getAuditEntry(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
    const by = entry ? `<@${entry.executor?.id}> (${entry.executor?.tag})` : 'Unknown';

    const embed = auditEmbed(COLOR.EDIT)
      .setAuthor({ name: 'Member Unbanned', iconURL: THUMBNAIL })
      .setThumbnail(ban.user.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: 'User', value: `${ban.user.tag}` },
        { name: 'User ID', value: ban.user.id },
        { name: 'Unbanned By', value: by }
      );

    await send(ch, embed);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ROLES
  // ══════════════════════════════════════════════════════════════════════════

  client.on('roleCreate', async role => {
    const ch = await getLogChannel(role.guild);
    if (!ch) return;

    const entry = await getAuditEntry(role.guild, AuditLogEvent.RoleCreate, role.id);
    const by = entry ? `<@${entry.executor?.id}>` : 'Unknown';

    const embed = auditEmbed(COLOR.ROLE)
      .setAuthor({ name: 'Role Created', iconURL: THUMBNAIL })
      .addFields(
        { name: 'Role', value: `<@&${role.id}> (${role.name})` },
        { name: 'Role ID', value: role.id },
        { name: 'Color', value: role.hexColor },
        { name: 'Mentionable', value: role.mentionable ? 'Yes' : 'No' },
        { name: 'Hoisted', value: role.hoist ? 'Yes' : 'No' },
        { name: 'Created By', value: by }
      );

    await send(ch, embed);
  });

  client.on('roleDelete', async role => {
    const ch = await getLogChannel(role.guild);
    if (!ch) return;

    const entry = await getAuditEntry(role.guild, AuditLogEvent.RoleDelete, role.id);
    const by = entry ? `<@${entry.executor?.id}>` : 'Unknown';

    const embed = auditEmbed(COLOR.DELETE)
      .setAuthor({ name: 'Role Deleted', iconURL: THUMBNAIL })
      .addFields(
        { name: 'Role Name', value: role.name },
        { name: 'Role ID', value: role.id },
        { name: 'Color', value: role.hexColor },
        { name: 'Deleted By', value: by }
      );

    await send(ch, embed);
  });

  client.on('roleUpdate', async (oldRole, newRole) => {
    const ch = await getLogChannel(newRole.guild);
    if (!ch) return;

    const changes = [];
    if (oldRole.name !== newRole.name) changes.push({ name: 'Name', before: oldRole.name, after: newRole.name });
    if (oldRole.hexColor !== newRole.hexColor) changes.push({ name: 'Color', before: oldRole.hexColor, after: newRole.hexColor });
    if (oldRole.hoist !== newRole.hoist) changes.push({ name: 'Hoisted', before: String(oldRole.hoist), after: String(newRole.hoist) });
    if (oldRole.mentionable !== newRole.mentionable) changes.push({ name: 'Mentionable', before: String(oldRole.mentionable), after: String(newRole.mentionable) });
    if (!changes.length) return;

    const entry = await getAuditEntry(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
    const by = entry ? `<@${entry.executor?.id}>` : 'Unknown';

    const embed = auditEmbed(COLOR.ROLE)
      .setAuthor({ name: 'Role Updated', iconURL: THUMBNAIL })
      .addFields(
        { name: 'Role', value: `<@&${newRole.id}> (${newRole.name})` },
        ...changes.map(c => ({ name: c.name, value: `${c.before} → ${c.after}` })),
        { name: 'Updated By', value: by }
      );

    await send(ch, embed);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // CHANNELS
  // ══════════════════════════════════════════════════════════════════════════

  client.on('channelCreate', async channel => {
    if (!channel.guild) return;
    const ch = await getLogChannel(channel.guild);
    if (!ch) return;

    const entry = await getAuditEntry(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
    const by = entry ? `<@${entry.executor?.id}>` : 'Unknown';

    const embed = auditEmbed(COLOR.CHANNEL)
      .setAuthor({ name: 'Channel Created', iconURL: THUMBNAIL })
      .addFields(
        { name: 'Channel', value: `<#${channel.id}> (${channel.name})` },
        { name: 'Type', value: channel.type.toString() },
        { name: 'Category', value: channel.parent?.name ?? 'None' },
        { name: 'Created By', value: by }
      );

    await send(ch, embed);
  });

  client.on('channelDelete', async channel => {
    if (!channel.guild) return;
    const ch = await getLogChannel(channel.guild);
    if (!ch) return;

    const entry = await getAuditEntry(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
    const by = entry ? `<@${entry.executor?.id}>` : 'Unknown';

    const embed = auditEmbed(COLOR.DELETE)
      .setAuthor({ name: 'Channel Deleted', iconURL: THUMBNAIL })
      .addFields(
        { name: 'Channel Name', value: `#${channel.name}` },
        { name: 'Channel ID', value: channel.id },
        { name: 'Type', value: channel.type.toString() },
        { name: 'Category', value: channel.parent?.name ?? 'None' },
        { name: 'Deleted By', value: by }
      );

    await send(ch, embed);
  });

  client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (!newChannel.guild) return;
    const ch = await getLogChannel(newChannel.guild);
    if (!ch) return;

    const changes = [];
    if (oldChannel.name !== newChannel.name) changes.push({ name: 'Name', before: oldChannel.name, after: newChannel.name });
    if (oldChannel.topic !== newChannel.topic) changes.push({ name: 'Topic', before: oldChannel.topic || '*None*', after: newChannel.topic || '*None*' });
    if (oldChannel.nsfw !== newChannel.nsfw) changes.push({ name: 'NSFW', before: String(oldChannel.nsfw), after: String(newChannel.nsfw) });
    if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) changes.push({ name: 'Slowmode', before: `${oldChannel.rateLimitPerUser}s`, after: `${newChannel.rateLimitPerUser}s` });
    if (oldChannel.parentId !== newChannel.parentId) changes.push({ name: 'Category', before: oldChannel.parent?.name ?? 'None', after: newChannel.parent?.name ?? 'None' });
    if (!changes.length) return;

    const entry = await getAuditEntry(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);
    const by = entry ? `<@${entry.executor?.id}>` : 'Unknown';

    const embed = auditEmbed(COLOR.CHANNEL)
      .setAuthor({ name: 'Channel Updated', iconURL: THUMBNAIL })
      .addFields(
        { name: 'Channel', value: `<#${newChannel.id}>` },
        ...changes.map(c => ({ name: c.name, value: `${truncate(c.before, 200)} → ${truncate(c.after, 200)}` })),
        { name: 'Updated By', value: by }
      );

    await send(ch, embed);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // VOICE
  // ══════════════════════════════════════════════════════════════════════════

  client.on('voiceStateUpdate', async (oldState, newState) => {
    const guild = newState.guild || oldState.guild;
    const ch = await getLogChannel(guild);
    if (!ch) return;
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;

    // Joined voice
    if (!oldState.channelId && newState.channelId) {
      const embed = auditEmbed(COLOR.VOICE)
        .setAuthor({ name: 'Joined Voice Channel', iconURL: THUMBNAIL })
        .addFields(
          { name: 'User', value: `<@${member.id}> (${member.user.tag})` },
          { name: 'Channel', value: `${newState.channel?.name ?? 'Unknown'}` }
        );
      return await send(ch, embed);
    }

    // Left voice
    if (oldState.channelId && !newState.channelId) {
      const embed = auditEmbed(COLOR.VOICE)
        .setAuthor({ name: 'Left Voice Channel', iconURL: THUMBNAIL })
        .addFields(
          { name: 'User', value: `<@${member.id}> (${member.user.tag})` },
          { name: 'Channel', value: `${oldState.channel?.name ?? 'Unknown'}` }
        );
      return await send(ch, embed);
    }

    // Moved between channels
    if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
      const embed = auditEmbed(COLOR.VOICE)
        .setAuthor({ name: 'Moved Voice Channel', iconURL: THUMBNAIL })
        .addFields(
          { name: 'User', value: `<@${member.id}> (${member.user.tag})` },
          { name: 'From', value: oldState.channel?.name ?? 'Unknown' },
          { name: 'To', value: newState.channel?.name ?? 'Unknown' }
        );
      return await send(ch, embed);
    }

    // Server mute/deafen
    if (oldState.serverMute !== newState.serverMute) {
      const entry = await getAuditEntry(guild, AuditLogEvent.MemberUpdate, member.id);
      const by = entry ? `<@${entry.executor?.id}>` : 'Unknown';
      const embed = auditEmbed(COLOR.VOICE)
        .setAuthor({ name: newState.serverMute ? 'Server Muted' : 'Server Unmuted', iconURL: THUMBNAIL })
        .addFields(
          { name: 'User', value: `<@${member.id}> (${member.user.tag})` },
          { name: 'By', value: by }
        );
      return await send(ch, embed);
    }

    if (oldState.serverDeaf !== newState.serverDeaf) {
      const entry = await getAuditEntry(guild, AuditLogEvent.MemberUpdate, member.id);
      const by = entry ? `<@${entry.executor?.id}>` : 'Unknown';
      const embed = auditEmbed(COLOR.VOICE)
        .setAuthor({ name: newState.serverDeaf ? 'Server Deafened' : 'Server Undeafened', iconURL: THUMBNAIL })
        .addFields(
          { name: 'User', value: `<@${member.id}> (${member.user.tag})` },
          { name: 'By', value: by }
        );
      return await send(ch, embed);
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // INVITES
  // ══════════════════════════════════════════════════════════════════════════

  client.on('inviteCreate', async invite => {
    if (!invite.guild) return;
    const ch = await getLogChannel(invite.guild);
    if (!ch) return;

    const embed = auditEmbed(COLOR.INVITE)
      .setAuthor({ name: 'Invite Created', iconURL: THUMBNAIL })
      .addFields(
        { name: 'Code', value: invite.code },
        { name: 'Channel', value: invite.channel ? `<#${invite.channel.id}>` : 'Unknown' },
        { name: 'Created By', value: invite.inviter ? `<@${invite.inviter.id}> (${invite.inviter.tag})` : 'Unknown' },
        { name: 'Max Uses', value: invite.maxUses ? String(invite.maxUses) : 'Unlimited' },
        { name: 'Expires', value: invite.expiresAt ? `<t:${Math.floor(invite.expiresTimestamp / 1000)}:R>` : 'Never' }
      );

    await send(ch, embed);
  });

  client.on('inviteDelete', async invite => {
    if (!invite.guild) return;
    const ch = await getLogChannel(invite.guild);
    if (!ch) return;

    const embed = auditEmbed(COLOR.DELETE)
      .setAuthor({ name: 'Invite Deleted', iconURL: THUMBNAIL })
      .addFields(
        { name: 'Code', value: invite.code },
        { name: 'Channel', value: invite.channel ? `<#${invite.channel.id}>` : 'Unknown' }
      );

    await send(ch, embed);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SERVER (GUILD)
  // ══════════════════════════════════════════════════════════════════════════

  client.on('guildUpdate', async (oldGuild, newGuild) => {
    const ch = await getLogChannel(newGuild);
    if (!ch) return;

    const changes = [];
    if (oldGuild.name !== newGuild.name) changes.push({ name: 'Server Name', before: oldGuild.name, after: newGuild.name });
    if (oldGuild.iconURL() !== newGuild.iconURL()) changes.push({ name: 'Server Icon', before: 'Changed', after: newGuild.iconURL() ?? 'Removed' });
    if (oldGuild.description !== newGuild.description) changes.push({ name: 'Description', before: oldGuild.description || 'None', after: newGuild.description || 'None' });
    if (oldGuild.verificationLevel !== newGuild.verificationLevel) changes.push({ name: 'Verification Level', before: String(oldGuild.verificationLevel), after: String(newGuild.verificationLevel) });
    if (oldGuild.systemChannelId !== newGuild.systemChannelId) changes.push({ name: 'System Channel', before: oldGuild.systemChannelId ? `<#${oldGuild.systemChannelId}>` : 'None', after: newGuild.systemChannelId ? `<#${newGuild.systemChannelId}>` : 'None' });
    if (!changes.length) return;

    const entry = await getAuditEntry(newGuild, AuditLogEvent.GuildUpdate);
    const by = entry ? `<@${entry.executor?.id}>` : 'Unknown';

    const embed = auditEmbed(COLOR.SERVER)
      .setAuthor({ name: 'Server Updated', iconURL: THUMBNAIL })
      .addFields(
        ...changes.map(c => ({ name: c.name, value: `${truncate(String(c.before), 200)} → ${truncate(String(c.after), 200)}` })),
        { name: 'Updated By', value: by }
      );

    await send(ch, embed);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // THREADS
  // ══════════════════════════════════════════════════════════════════════════

  client.on('threadCreate', async thread => {
    if (!thread.guild) return;
    const ch = await getLogChannel(thread.guild);
    if (!ch) return;

    const embed = auditEmbed(COLOR.THREAD)
      .setAuthor({ name: 'Thread Created', iconURL: THUMBNAIL })
      .addFields(
        { name: 'Thread', value: `<#${thread.id}> (${thread.name})` },
        { name: 'Parent Channel', value: thread.parent ? `<#${thread.parent.id}>` : 'Unknown' },
        { name: 'Created By', value: thread.ownerId ? `<@${thread.ownerId}>` : 'Unknown' }
      );

    await send(ch, embed);
  });

  client.on('threadDelete', async thread => {
    if (!thread.guild) return;
    const ch = await getLogChannel(thread.guild);
    if (!ch) return;

    const embed = auditEmbed(COLOR.DELETE)
      .setAuthor({ name: 'Thread Deleted', iconURL: THUMBNAIL })
      .addFields(
        { name: 'Thread Name', value: thread.name },
        { name: 'Thread ID', value: thread.id },
        { name: 'Parent Channel', value: thread.parent ? `<#${thread.parent.id}>` : 'Unknown' }
      );

    await send(ch, embed);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // EMOJI & STICKERS
  // ══════════════════════════════════════════════════════════════════════════

  client.on('emojiCreate', async emoji => {
    const ch = await getLogChannel(emoji.guild);
    if (!ch) return;

    const entry = await getAuditEntry(emoji.guild, AuditLogEvent.EmojiCreate, emoji.id);
    const by = entry ? `<@${entry.executor?.id}>` : 'Unknown';

    const embed = auditEmbed(COLOR.SERVER)
      .setAuthor({ name: 'Emoji Added', iconURL: THUMBNAIL })
      .addFields(
        { name: 'Emoji', value: `${emoji} \`:${emoji.name}:\`` },
        { name: 'ID', value: emoji.id },
        { name: 'Added By', value: by }
      );

    await send(ch, embed);
  });

  client.on('emojiDelete', async emoji => {
    const ch = await getLogChannel(emoji.guild);
    if (!ch) return;

    const entry = await getAuditEntry(emoji.guild, AuditLogEvent.EmojiDelete, emoji.id);
    const by = entry ? `<@${entry.executor?.id}>` : 'Unknown';

    const embed = auditEmbed(COLOR.DELETE)
      .setAuthor({ name: 'Emoji Deleted', iconURL: THUMBNAIL })
      .addFields(
        { name: 'Emoji Name', value: `:${emoji.name}:` },
        { name: 'ID', value: emoji.id },
        { name: 'Deleted By', value: by }
      );

    await send(ch, embed);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // BOOSTS
  // ══════════════════════════════════════════════════════════════════════════

  client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (oldMember.premiumSince || !newMember.premiumSince) return;
    const ch = await getLogChannel(newMember.guild);
    if (!ch) return;

    const embed = auditEmbed(COLOR.BOOST)
      .setAuthor({ name: 'Server Boosted', iconURL: THUMBNAIL })
      .setThumbnail(newMember.user.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: 'User', value: `<@${newMember.id}> (${newMember.user.tag})` },
        { name: 'Total Boosts', value: String(newMember.guild.premiumSubscriptionCount ?? 0) },
        { name: 'Boost Tier', value: `Level ${newMember.guild.premiumTier}` }
      );

    await send(ch, embed);
  });

  console.log('Discord server audit log registered.');
};
