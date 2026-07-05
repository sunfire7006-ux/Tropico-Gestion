require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  AttachmentBuilder
} = require('discord.js');

/* ==========================================================================
   STOCKAGE : simples fichiers JSON, un fichier de config + un fichier de
   tickets par serveur Discord.
   ========================================================================== */

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULT_CONFIG = {
  welcome: {
    enabled: false,
    channelId: null,
    title: 'Bienvenue {username} !',
    description: 'Hey {user}, bienvenue sur **{server}** !\nTu es notre membre numero **{membercount}**.',
    color: '#5865F2',
    thumbnailEnabled: true,
    image: null,
    footer: '{server}',
    dmEnabled: false
  },
  tickets: {
    panelChannelId: null,
    pingRoles: [],
    accessRoles: [],
    categoryId: null,
    logChannelId: null
  }
};
const DEFAULT_TICKETS = { pending: {}, active: {} };

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return JSON.parse(JSON.stringify(fallback));
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (err) { console.error(`Erreur de lecture de ${filePath} :`, err); return JSON.parse(JSON.stringify(fallback)); }
}
function writeJson(filePath, data) { fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8'); }
function getGuildConfig(guildId) {
  const config = readJson(path.join(DATA_DIR, `config_${guildId}.json`), DEFAULT_CONFIG);
  config.welcome = { ...DEFAULT_CONFIG.welcome, ...config.welcome };
  config.tickets = { ...DEFAULT_CONFIG.tickets, ...config.tickets };
  return config;
}
function saveGuildConfig(guildId, config) { writeJson(path.join(DATA_DIR, `config_${guildId}.json`), config); }
function getTickets(guildId) {
  const tickets = readJson(path.join(DATA_DIR, `tickets_${guildId}.json`), DEFAULT_TICKETS);
  tickets.pending = tickets.pending || {};
  tickets.active = tickets.active || {};
  return tickets;
}
function saveTickets(guildId, tickets) { writeJson(path.join(DATA_DIR, `tickets_${guildId}.json`), tickets); }

/* ==========================================================================
   PETITES FONCTIONS UTILES
   ========================================================================== */

function applyPlaceholders(text, member) {
  if (!text) return text;
  return text
    .replaceAll('{user}', `<@${member.id}>`)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{server}', member.guild.name)
    .replaceAll('{membercount}', member.guild.memberCount.toString());
}
function parseColor(hex, fallback = '#5865F2') {
  const clean = (hex || fallback).replace('#', '');
  const parsed = parseInt(clean, 16);
  return isNaN(parsed) ? parseInt(fallback.replace('#', ''), 16) : parsed;
}
function buildWelcomeEmbed(member, w) {
  const embed = new EmbedBuilder()
    .setTitle(applyPlaceholders(w.title, member))
    .setDescription(applyPlaceholders(w.description, member))
    .setColor(parseColor(w.color));
  if (w.thumbnailEnabled) embed.setThumbnail(member.user.displayAvatarURL({ size: 256 }));
  if (w.image) embed.setImage(w.image);
  if (w.footer) embed.setFooter({ text: applyPlaceholders(w.footer, member) });
  embed.setTimestamp();
  return embed;
}
function generateTicketId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function sanitizeChannelName(categoryValue, username) {
  const clean = username.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `ticket-${categoryValue}-${clean || 'membre'}`.slice(0, 90);
}

const TICKET_CATEGORIES = [
  { value: 'abus', label: 'Gestion Abus', emoji: '🚫', description: 'Signaler un abus ou un comportement inapproprie.' },
  { value: 'staff', label: 'Gestion Staff', emoji: '🛠️', description: 'Demandes de recrutement, ou problemes lies a l\'equipe staff.' },
  { value: 'animation', label: 'Animation', emoji: '🎗️', description: 'Demandes liees aux animations et evenements.' },
  { value: 'owner', label: 'Ticket Owner', emoji: '👑', description: 'Demandes reservees aux proprietaires du serveur / demandes importantes.' }
];
function getCategoryByValue(value) {
  return TICKET_CATEGORIES.find(c => c.value === value) || { value, label: value, emoji: '🎫' };
}

/* ==========================================================================
   PANNEAU DE BIENVENUE (/panel-arrivee)
   ========================================================================== */

function buildWelcomePanel(guildId) {
  const config = getGuildConfig(guildId);
  const w = config.welcome;

  const embed = new EmbedBuilder()
    .setTitle('🎉 Panneau de configuration - Bienvenue')
    .setColor(parseColor(w.color))
    .setDescription([
      `**Statut :** ${w.enabled ? '🟢 Active' : '🔴 Desactive'}`,
      `**Salon :** ${w.channelId ? `<#${w.channelId}>` : 'Non defini'}`,
      `**Couleur :** ${w.color}`,
      `**Avatar en miniature :** ${w.thumbnailEnabled ? 'Oui' : 'Non'}`,
      `**Image :** ${w.image ? 'Definie' : 'Aucune'}`,
      `**Message prive (MP) au membre :** ${w.dmEnabled ? 'Oui' : 'Non'}`,
      '',
      `**Titre actuel :** ${w.title}`,
      `**Description actuelle :** ${w.description}`,
      `**Footer actuel :** ${w.footer || 'Aucun'}`,
      '',
      '_Placeholders utilisables dans le texte : {user} {username} {server} {membercount}_'
    ].join('\n'));

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('wp_channel').setLabel('Salon').setEmoji('📌').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('wp_toggle').setLabel(w.enabled ? 'Desactiver' : 'Activer').setStyle(w.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId('wp_avatar').setLabel(`Avatar : ${w.thumbnailEnabled ? 'ON' : 'OFF'}`).setStyle(ButtonStyle.Secondary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('wp_message').setLabel('Message').setEmoji('✏️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('wp_color').setLabel('Couleur').setEmoji('🎨').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('wp_image').setLabel('Image').setEmoji('🖼️').setStyle(ButtonStyle.Primary)
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('wp_dm').setLabel(`MP au membre : ${w.dmEnabled ? 'ON' : 'OFF'}`).setEmoji('📩').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('wp_test').setLabel('Tester').setEmoji('🔎').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('wp_close').setLabel('Fermer').setEmoji('✖️').setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row1, row2, row3] };
}

function buildBackRow(customId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(customId).setLabel('Retour').setEmoji('⬅️').setStyle(ButtonStyle.Secondary)
  );
}

/* ==========================================================================
   PANNEAU DE TICKETS (/ticket)
   ========================================================================== */

function buildTicketPanel(guildId) {
  const config = getGuildConfig(guildId);
  const t = config.tickets;

  const embed = new EmbedBuilder()
    .setTitle('🎫 Panneau de configuration - Tickets')
    .setColor('#5865F2')
    .setDescription([
      `**Salon du panneau ticket :** ${t.panelChannelId ? `<#${t.panelChannelId}>` : 'Non defini'}`,
      `**Categorie des tickets :** ${t.categoryId ? `<#${t.categoryId}>` : 'Aucune (crees a la racine)'}`,
      `**Roles pingues a chaque demande :** ${t.pingRoles.length ? t.pingRoles.map(id => `<@&${id}>`).join(', ') : 'Aucun'}`,
      `**Roles avec acces (accepter/renommer/fermer) :** ${t.accessRoles.length ? t.accessRoles.map(id => `<@&${id}>`).join(', ') : 'Aucun'}`,
      `**Salon de logs (justifications de fermeture) :** ${t.logChannelId ? `<#${t.logChannelId}>` : 'Non configure'}`
    ].join('\n'));

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tp_channel').setLabel('Salon du panneau').setEmoji('📌').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('tp_pingroles').setLabel('Roles a ping').setEmoji('🔔').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tp_accessroles').setLabel('Roles avec acces').setEmoji('🛡️').setStyle(ButtonStyle.Secondary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tp_category').setLabel('Categorie').setEmoji('📁').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tp_logs').setLabel('Logs').setEmoji('📝').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tp_close').setLabel('Fermer').setEmoji('✖️').setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row1, row2] };
}

/* ==========================================================================
   COMMANDE /help
   ========================================================================== */

function buildHelpEmbed() {
  return new EmbedBuilder()
    .setTitle('📖 Aide - Liste des commandes')
    .setColor('#5865F2')
    .addFields(
      {
        name: '/panel-arrivee',
        value: 'Ouvre un panneau avec des boutons pour tout regler sur le systeme de bienvenue : salon, activer/desactiver, texte du message, couleur, image, avatar, MP au membre, et tester un apercu.'
      },
      {
        name: '/ticket',
        value: 'Ouvre un panneau avec des boutons pour tout regler sur le systeme de tickets : salon ou publier le menu "Tropico Ticket", roles pingues, roles avec acces aux tickets, categorie, salon de logs.'
      },
      {
        name: '/rename-ticket <nom>',
        value: 'A utiliser uniquement dans un salon de ticket deja ouvert. Renomme ce salon. Reserve aux membres ayant un role avec acces aux tickets.'
      },
      {
        name: '/help',
        value: 'Affiche ce message.'
      },
      {
        name: 'Comment fonctionne un ticket ?',
        value: '1) Un membre choisit une categorie (Gestion Abus, Gestion Staff, Animation, Ticket Owner) dans le menu deroulant du salon configure, puis decrit son probleme.\n2) La demande est postee avec les roles pingues et deux boutons Accepter/Refuser.\n3) Un membre avec acces clique Accepter : un salon prive est cree pour ce membre.\n4) Dans ce salon, `/rename-ticket` permet de le renommer, et le bouton "Fermer le ticket" demande une justification avant de fermer (envoyee dans le salon de logs si configure).'
      }
    );
}

/* ==========================================================================
   DEFINITION DES COMMANDES SLASH
   ========================================================================== */

const commandsData = [
  new SlashCommandBuilder()
    .setName('panel-arrivee')
    .setDescription('Ouvre le panneau de configuration du systeme de bienvenue')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Ouvre le panneau de configuration du systeme de tickets')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('rename-ticket')
    .setDescription('Renomme le salon de ticket actuel')
    .addStringOption(opt => opt.setName('nom').setDescription('Nouveau nom').setRequired(true).setMaxLength(90)),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Affiche la liste des commandes et leur utilisation')
];

/* ==========================================================================
   CLIENT DISCORD
   ========================================================================== */

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages]
});

client.once('clientReady', async () => {
  console.log(`Connecte en tant que ${client.user.tag} !`);
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    const body = commandsData.map(c => c.toJSON());
    if (process.env.GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body });
      console.log('Commandes enregistrees sur le serveur (instantane).');
    } else {
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body });
      console.log('Commandes enregistrees globalement (jusqu\'a 1h pour apparaitre partout).');
    }
  } catch (err) {
    console.error('Erreur lors de l\'enregistrement des commandes :', err);
  }
});

client.on('guildMemberAdd', async (member) => {
  const config = getGuildConfig(member.guild.id);
  const w = config.welcome;
  if (!w.enabled || !w.channelId) return;
  const channel = member.guild.channels.cache.get(w.channelId);
  if (!channel) return;
  try {
    await channel.send({ content: `<@${member.id}>`, embeds: [buildWelcomeEmbed(member, w)] });
  } catch (err) {
    console.error('Erreur envoi message de bienvenue :', err);
  }

  if (w.dmEnabled) {
    try {
      await member.send({ embeds: [buildWelcomeEmbed(member, w)] });
    } catch (err) {
      // Le membre a peut-etre desactive les MP, on ignore silencieusement
    }
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'panel-arrivee') {
        return interaction.reply({ ...buildWelcomePanel(interaction.guild.id), ephemeral: true });
      }
      if (interaction.commandName === 'ticket') {
        return interaction.reply({ ...buildTicketPanel(interaction.guild.id), ephemeral: true });
      }
      if (interaction.commandName === 'rename-ticket') return handleRenameTicketCommand(interaction);
      if (interaction.commandName === 'help') {
        return interaction.reply({ embeds: [buildHelpEmbed()], ephemeral: true });
      }
    } else if (interaction.isButton()) {
      return handleButton(interaction);
    } else if (interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu()) {
      return handleSelectMenu(interaction);
    } else if (interaction.isStringSelectMenu()) {
      return handleTicketCategorySelect(interaction);
    } else if (interaction.isModalSubmit()) {
      return handleModal(interaction);
    }
  } catch (err) {
    console.error('Erreur interaction :', err);
    const payload = { content: 'Une erreur est survenue.', ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
});

/* ==========================================================================
   /rename-ticket
   ========================================================================== */

async function handleRenameTicketCommand(interaction) {
  const config = getGuildConfig(interaction.guild.id);
  const tickets = getTickets(interaction.guild.id);
  const ticketInfo = tickets.active[interaction.channel.id];
  if (!ticketInfo) return interaction.reply({ content: 'Cette commande fonctionne uniquement dans un salon de ticket.', ephemeral: true });

  const hasAccess = config.tickets.accessRoles.some(roleId => interaction.member.roles.cache.has(roleId));
  if (!hasAccess) return interaction.reply({ content: 'Tu n\'as pas le role necessaire.', ephemeral: true });

  let newName = interaction.options.getString('nom')
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!newName) return interaction.reply({ content: 'Nom invalide.', ephemeral: true });
  if (!newName.startsWith('ticket-')) newName = `ticket-${newName}`;

  await interaction.channel.setName(newName);
  return interaction.reply({ content: `Salon renomme en **${newName}**.` });
}

/* ==========================================================================
   BOUTONS
   ========================================================================== */

async function handleButton(interaction) {
  const { customId } = interaction;

  // ---- Panneau de bienvenue ----
  if (customId === 'wp_back') {
    return interaction.update(buildWelcomePanel(interaction.guild.id));
  }
  if (customId === 'wp_channel') {
    const select = new ChannelSelectMenuBuilder()
      .setCustomId('wp_channel_select')
      .setPlaceholder('Choisis le salon de bienvenue')
      .addChannelTypes(ChannelType.GuildText);
    return interaction.update({
      embeds: [new EmbedBuilder().setTitle('📌 Choisir le salon de bienvenue').setColor('#5865F2')],
      components: [new ActionRowBuilder().addComponents(select), buildBackRow('wp_back')]
    });
  }
  if (customId === 'wp_toggle') {
    const config = getGuildConfig(interaction.guild.id);
    if (!config.welcome.enabled && !config.welcome.channelId) {
      return interaction.reply({ content: 'Configure d\'abord un salon avant d\'activer le systeme (bouton "Salon").', ephemeral: true });
    }
    config.welcome.enabled = !config.welcome.enabled;
    saveGuildConfig(interaction.guild.id, config);
    return interaction.update(buildWelcomePanel(interaction.guild.id));
  }
  if (customId === 'wp_avatar') {
    const config = getGuildConfig(interaction.guild.id);
    config.welcome.thumbnailEnabled = !config.welcome.thumbnailEnabled;
    saveGuildConfig(interaction.guild.id, config);
    return interaction.update(buildWelcomePanel(interaction.guild.id));
  }
  if (customId === 'wp_dm') {
    const config = getGuildConfig(interaction.guild.id);
    config.welcome.dmEnabled = !config.welcome.dmEnabled;
    saveGuildConfig(interaction.guild.id, config);
    return interaction.update(buildWelcomePanel(interaction.guild.id));
  }
  if (customId === 'wp_message') {
    const config = getGuildConfig(interaction.guild.id);
    const modal = new ModalBuilder().setCustomId('welcome_message_modal').setTitle('Personnaliser le message de bienvenue');
    const titleInput = new TextInputBuilder().setCustomId('welcome_title').setLabel('Titre ({user} {username} {server} {membercount})')
      .setStyle(TextInputStyle.Short).setValue(config.welcome.title || '').setRequired(true).setMaxLength(256);
    const descInput = new TextInputBuilder().setCustomId('welcome_description').setLabel('Description')
      .setStyle(TextInputStyle.Paragraph).setValue(config.welcome.description || '').setRequired(true).setMaxLength(2000);
    const footerInput = new TextInputBuilder().setCustomId('welcome_footer').setLabel('Footer (optionnel)')
      .setStyle(TextInputStyle.Short).setValue(config.welcome.footer || '').setRequired(false).setMaxLength(256);
    modal.addComponents(
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(descInput),
      new ActionRowBuilder().addComponents(footerInput)
    );
    return interaction.showModal(modal);
  }
  if (customId === 'wp_color') {
    const config = getGuildConfig(interaction.guild.id);
    const modal = new ModalBuilder().setCustomId('welcome_color_modal').setTitle('Couleur du message de bienvenue');
    const colorInput = new TextInputBuilder().setCustomId('welcome_color_value').setLabel('Code couleur hexadecimal (ex: #5865F2)')
      .setStyle(TextInputStyle.Short).setValue(config.welcome.color || '#5865F2').setRequired(true).setMaxLength(7);
    modal.addComponents(new ActionRowBuilder().addComponents(colorInput));
    return interaction.showModal(modal);
  }
  if (customId === 'wp_image') {
    const config = getGuildConfig(interaction.guild.id);
    const modal = new ModalBuilder().setCustomId('welcome_image_modal').setTitle('Image du message de bienvenue');
    const imageInput = new TextInputBuilder().setCustomId('welcome_image_value').setLabel('URL de l\'image (ou "reset" pour retirer)')
      .setStyle(TextInputStyle.Short).setValue(config.welcome.image || '').setRequired(false).setMaxLength(500);
    modal.addComponents(new ActionRowBuilder().addComponents(imageInput));
    return interaction.showModal(modal);
  }
  if (customId === 'wp_test') {
    const config = getGuildConfig(interaction.guild.id);
    if (!config.welcome.channelId) return interaction.reply({ content: 'Aucun salon configure.', ephemeral: true });
    const channel = interaction.guild.channels.cache.get(config.welcome.channelId);
    if (!channel) return interaction.reply({ content: 'Salon introuvable.', ephemeral: true });
    await channel.send({ embeds: [buildWelcomeEmbed(interaction.member, config.welcome)] });
    await interaction.update(buildWelcomePanel(interaction.guild.id));
    return interaction.followUp({ content: `Apercu envoye dans ${channel}.`, ephemeral: true });
  }
  if (customId === 'wp_close') {
    return interaction.update({ content: 'Panneau ferme.', embeds: [], components: [] });
  }

  // ---- Panneau de tickets ----
  if (customId === 'tp_back') {
    return interaction.update(buildTicketPanel(interaction.guild.id));
  }
  if (customId === 'tp_channel') {
    const select = new ChannelSelectMenuBuilder()
      .setCustomId('tp_channel_select')
      .setPlaceholder('Choisis le salon ou publier le menu "Tropico Ticket"')
      .addChannelTypes(ChannelType.GuildText);
    return interaction.update({
      embeds: [new EmbedBuilder().setTitle('📌 Choisir le salon du panneau ticket').setColor('#5865F2')],
      components: [new ActionRowBuilder().addComponents(select), buildBackRow('tp_back')]
    });
  }
  if (customId === 'tp_pingroles') {
    const select = new RoleSelectMenuBuilder()
      .setCustomId('tp_pingroles_select')
      .setPlaceholder('Choisis les roles a ping (0 a 10)')
      .setMinValues(0).setMaxValues(10);
    return interaction.update({
      embeds: [new EmbedBuilder().setTitle('🔔 Roles pingues a chaque demande de ticket').setColor('#5865F2')],
      components: [new ActionRowBuilder().addComponents(select), buildBackRow('tp_back')]
    });
  }
  if (customId === 'tp_accessroles') {
    const select = new RoleSelectMenuBuilder()
      .setCustomId('tp_accessroles_select')
      .setPlaceholder('Choisis les roles avec acces aux tickets (0 a 10)')
      .setMinValues(0).setMaxValues(10);
    return interaction.update({
      embeds: [new EmbedBuilder().setTitle('🛡️ Roles pouvant accepter/renommer/fermer les tickets').setColor('#5865F2')],
      components: [new ActionRowBuilder().addComponents(select), buildBackRow('tp_back')]
    });
  }
  if (customId === 'tp_category') {
    const select = new ChannelSelectMenuBuilder()
      .setCustomId('tp_category_select')
      .setPlaceholder('Choisis la categorie des salons de tickets')
      .addChannelTypes(ChannelType.GuildCategory);
    return interaction.update({
      embeds: [new EmbedBuilder().setTitle('📁 Categorie des salons de tickets').setColor('#5865F2')],
      components: [new ActionRowBuilder().addComponents(select), buildBackRow('tp_back')]
    });
  }
  if (customId === 'tp_logs') {
    const select = new ChannelSelectMenuBuilder()
      .setCustomId('tp_logs_select')
      .setPlaceholder('Choisis le salon de logs')
      .addChannelTypes(ChannelType.GuildText);
    const buttonsRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tp_back').setLabel('Retour').setEmoji('⬅️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tp_logs_disable').setLabel('Desactiver les logs').setStyle(ButtonStyle.Danger)
    );
    return interaction.update({
      embeds: [new EmbedBuilder().setTitle('📝 Salon de logs (justifications de fermeture)').setColor('#5865F2')],
      components: [new ActionRowBuilder().addComponents(select), buttonsRow]
    });
  }
  if (customId === 'tp_logs_disable') {
    const config = getGuildConfig(interaction.guild.id);
    config.tickets.logChannelId = null;
    saveGuildConfig(interaction.guild.id, config);
    return interaction.update(buildTicketPanel(interaction.guild.id));
  }
  if (customId === 'tp_close') {
    return interaction.update({ content: 'Panneau ferme.', embeds: [], components: [] });
  }

  // ---- Systeme de tickets (acceptation / refus / fermeture) ----
  if (customId.startsWith('ticket_accept_')) return acceptTicket(interaction, customId.replace('ticket_accept_', ''));
  if (customId.startsWith('ticket_deny_')) return denyTicket(interaction, customId.replace('ticket_deny_', ''));
  if (customId.startsWith('ticket_close_')) {
    const channelId = customId.replace('ticket_close_', '');
    const config = getGuildConfig(interaction.guild.id);
    const hasAccess = config.tickets.accessRoles.some(roleId => interaction.member.roles.cache.has(roleId));
    if (!hasAccess) return interaction.reply({ content: 'Tu n\'as pas le role necessaire pour fermer ce ticket.', ephemeral: true });
    const modal = new ModalBuilder().setCustomId(`ticket_close_modal_${channelId}`).setTitle('Fermer le ticket');
    const reasonInput = new TextInputBuilder().setCustomId('close_reason').setLabel('Justification de la fermeture')
      .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000);
    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
    return interaction.showModal(modal);
  }
}

async function handleTicketCategorySelect(interaction) {
  if (interaction.customId !== 'ticket_category_select') return;
  const config = getGuildConfig(interaction.guild.id);
  if (!config.tickets.panelChannelId) return interaction.reply({ content: 'Systeme de tickets non configure.', ephemeral: true });

  const categoryValue = interaction.values[0];
  const category = getCategoryByValue(categoryValue);

  const modal = new ModalBuilder().setCustomId(`ticket_create_modal_${categoryValue}`).setTitle(`Ticket - ${category.label}`);
  const descInput = new TextInputBuilder().setCustomId('ticket_description').setLabel('Decris ton probleme')
    .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000);
  modal.addComponents(new ActionRowBuilder().addComponents(descInput));
  return interaction.showModal(modal);
}

/* ==========================================================================
   MENUS DEROULANTS (salons / roles)
   ========================================================================== */

async function handleSelectMenu(interaction) {
  const { customId } = interaction;
  const config = getGuildConfig(interaction.guild.id);

  if (customId === 'wp_channel_select') {
    config.welcome.channelId = interaction.values[0];
    saveGuildConfig(interaction.guild.id, config);
    return interaction.update(buildWelcomePanel(interaction.guild.id));
  }

  if (customId === 'tp_channel_select') {
    const channelId = interaction.values[0];
    config.tickets.panelChannelId = channelId;
    saveGuildConfig(interaction.guild.id, config);

    const channel = interaction.guild.channels.cache.get(channelId);
    if (channel) {
      const bannerPath = path.join(__dirname, 'assets', 'ticket-banniere.png');
      const attachment = new AttachmentBuilder(bannerPath, { name: 'ticket-banniere.png' });

      const categoriesText = TICKET_CATEGORIES
        .map(c => `**${c.label}** ${c.emoji}\n${c.description}`)
        .join('\n\n');

      const embed = new EmbedBuilder()
        .setTitle('Tropico Ticket')
        .setDescription(`Ce systeme te permet de contacter l'equipe du serveur selon le type de demande.\nChoisissez une option dans le menu ci-dessous.\n\n${categoriesText}`)
        .setColor('#2b6cff')
        .setImage('attachment://ticket-banniere.png');

      const select = new StringSelectMenuBuilder()
        .setCustomId('ticket_category_select')
        .setPlaceholder('Selectionnez une categorie de gestion...')
        .addOptions(TICKET_CATEGORIES.map(c => ({ label: c.label, value: c.value, emoji: c.emoji, description: c.description })));

      await channel.send({ embeds: [embed], files: [attachment], components: [new ActionRowBuilder().addComponents(select)] });
    }

    await interaction.update(buildTicketPanel(interaction.guild.id));
    if (channel) return interaction.followUp({ content: `Panneau publie dans ${channel}.`, ephemeral: true });
    return;
  }

  if (customId === 'tp_pingroles_select') {
    config.tickets.pingRoles = interaction.values;
    saveGuildConfig(interaction.guild.id, config);
    return interaction.update(buildTicketPanel(interaction.guild.id));
  }

  if (customId === 'tp_accessroles_select') {
    config.tickets.accessRoles = interaction.values;
    saveGuildConfig(interaction.guild.id, config);
    return interaction.update(buildTicketPanel(interaction.guild.id));
  }

  if (customId === 'tp_category_select') {
    config.tickets.categoryId = interaction.values[0];
    saveGuildConfig(interaction.guild.id, config);
    return interaction.update(buildTicketPanel(interaction.guild.id));
  }

  if (customId === 'tp_logs_select') {
    config.tickets.logChannelId = interaction.values[0];
    saveGuildConfig(interaction.guild.id, config);
    return interaction.update(buildTicketPanel(interaction.guild.id));
  }
}

/* ==========================================================================
   FORMULAIRES (modals)
   ========================================================================== */

async function handleModal(interaction) {
  const { customId } = interaction;
  const config = getGuildConfig(interaction.guild.id);

  if (customId === 'welcome_message_modal') {
    config.welcome.title = interaction.fields.getTextInputValue('welcome_title');
    config.welcome.description = interaction.fields.getTextInputValue('welcome_description');
    config.welcome.footer = interaction.fields.getTextInputValue('welcome_footer') || null;
    saveGuildConfig(interaction.guild.id, config);
    if (interaction.isFromMessage()) return interaction.update(buildWelcomePanel(interaction.guild.id));
    return interaction.reply({ content: 'Message de bienvenue mis a jour.', ephemeral: true });
  }

  if (customId === 'welcome_color_modal') {
    const hex = interaction.fields.getTextInputValue('welcome_color_value');
    if (isNaN(parseInt(hex.replace('#', ''), 16))) {
      return interaction.reply({ content: 'Couleur invalide, exemple : `#5865F2`', ephemeral: true });
    }
    config.welcome.color = hex;
    saveGuildConfig(interaction.guild.id, config);
    if (interaction.isFromMessage()) return interaction.update(buildWelcomePanel(interaction.guild.id));
    return interaction.reply({ content: 'Couleur mise a jour.', ephemeral: true });
  }

  if (customId === 'welcome_image_modal') {
    const url = interaction.fields.getTextInputValue('welcome_image_value');
    if (!url || url.toLowerCase() === 'reset') {
      config.welcome.image = null;
    } else if (!/^https?:\/\/.+/i.test(url)) {
      return interaction.reply({ content: 'URL invalide (ou laisse vide / mets "reset" pour retirer).', ephemeral: true });
    } else {
      config.welcome.image = url;
    }
    saveGuildConfig(interaction.guild.id, config);
    if (interaction.isFromMessage()) return interaction.update(buildWelcomePanel(interaction.guild.id));
    return interaction.reply({ content: 'Image mise a jour.', ephemeral: true });
  }

  if (customId.startsWith('ticket_create_modal_')) return handleTicketCreateModal(interaction, customId.replace('ticket_create_modal_', ''));
  if (customId.startsWith('ticket_close_modal_')) return handleTicketCloseModal(interaction, customId.replace('ticket_close_modal_', ''));
}

/* ==========================================================================
   LOGIQUE DES TICKETS (creation / acceptation / refus / fermeture)
   ========================================================================== */

async function acceptTicket(interaction, ticketId) {
  const config = getGuildConfig(interaction.guild.id);
  const hasAccess = config.tickets.accessRoles.some(roleId => interaction.member.roles.cache.has(roleId));
  if (!hasAccess) return interaction.reply({ content: 'Tu n\'as pas le role necessaire.', ephemeral: true });

  const tickets = getTickets(interaction.guild.id);
  const pending = tickets.pending[ticketId];
  if (!pending) return interaction.reply({ content: 'Cette demande n\'existe plus.', ephemeral: true });

  await interaction.deferUpdate();

  const requester = await interaction.guild.members.fetch(pending.requesterId).catch(() => null);
  if (!requester) {
    delete tickets.pending[ticketId];
    saveTickets(interaction.guild.id, tickets);
    return interaction.message.edit({ content: 'Le membre a quitte le serveur.', components: [] }).catch(() => {});
  }

  const permissionOverwrites = [
    { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: requester.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] }
  ];
  for (const roleId of config.tickets.accessRoles) {
    permissionOverwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  }

  const category = getCategoryByValue(pending.category || 'ticket');

  const channel = await interaction.guild.channels.create({
    name: sanitizeChannelName(pending.category || 'ticket', requester.user.username),
    type: ChannelType.GuildText,
    parent: config.tickets.categoryId || null,
    permissionOverwrites
  });

  const accessRolesMention = config.tickets.accessRoles.map(id => `<@&${id}>`).join(' ');
  const welcomeEmbed = new EmbedBuilder()
    .setTitle('Ticket ouvert')
    .setDescription(`Ticket ouvert par <@${requester.id}>.\n**Categorie :** ${category.label} ${category.emoji}\n\n**Probleme decrit :**\n${pending.description}`)
    .setColor('#57F287').setFooter({ text: `Accepte par ${interaction.user.username}` }).setTimestamp();

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticket_close_${channel.id}`).setLabel('Fermer le ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger)
  );

  await channel.send({ content: `<@${requester.id}> ${accessRolesMention}`, embeds: [welcomeEmbed], components: [closeRow] });

  tickets.active[channel.id] = { ownerId: requester.id, ticketId, openedAt: Date.now() };
  delete tickets.pending[ticketId];
  saveTickets(interaction.guild.id, tickets);

  const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0]).setColor('#57F287')
    .addFields({ name: 'Statut', value: `Accepte par <@${interaction.user.id}> -> ${channel}` });
  await interaction.message.edit({ embeds: [updatedEmbed], components: [] }).catch(() => {});
}

async function denyTicket(interaction, ticketId) {
  const config = getGuildConfig(interaction.guild.id);
  const hasAccess = config.tickets.accessRoles.some(roleId => interaction.member.roles.cache.has(roleId));
  if (!hasAccess) return interaction.reply({ content: 'Tu n\'as pas le role necessaire.', ephemeral: true });

  const tickets = getTickets(interaction.guild.id);
  const pending = tickets.pending[ticketId];
  if (!pending) return interaction.reply({ content: 'Cette demande n\'existe plus.', ephemeral: true });

  await interaction.deferUpdate();
  delete tickets.pending[ticketId];
  saveTickets(interaction.guild.id, tickets);

  const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0]).setColor('#ED4245')
    .addFields({ name: 'Statut', value: `Refuse par <@${interaction.user.id}>` });
  await interaction.message.edit({ embeds: [updatedEmbed], components: [] }).catch(() => {});

  const requester = await interaction.guild.members.fetch(pending.requesterId).catch(() => null);
  if (requester) await requester.send(`Ta demande de ticket sur **${interaction.guild.name}** a ete refusee.`).catch(() => {});
}

async function handleTicketCreateModal(interaction, categoryValue) {
  const config = getGuildConfig(interaction.guild.id);
  const panelChannel = interaction.guild.channels.cache.get(config.tickets.panelChannelId);
  if (!panelChannel) return interaction.reply({ content: 'Systeme de tickets non configure.', ephemeral: true });

  const category = getCategoryByValue(categoryValue);
  const description = interaction.fields.getTextInputValue('ticket_description');
  const ticketId = generateTicketId();
  const pingRolesMention = config.tickets.pingRoles.map(id => `<@&${id}>`).join(' ');

  const embed = new EmbedBuilder()
    .setTitle('Nouvelle demande de ticket')
    .setDescription(`**Categorie :** ${category.label} ${category.emoji}\n**Demandeur :** <@${interaction.user.id}>\n**Probleme :**\n${description}`)
    .setColor('#FEE75C').setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticket_accept_${ticketId}`).setLabel('Accepter').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ticket_deny_${ticketId}`).setLabel('Refuser').setEmoji('❌').setStyle(ButtonStyle.Secondary)
  );

  const requestMessage = await panelChannel.send({ content: pingRolesMention || undefined, embeds: [embed], components: [row] });

  const tickets = getTickets(interaction.guild.id);
  tickets.pending[ticketId] = { requesterId: interaction.user.id, description, requestMessageId: requestMessage.id, category: categoryValue };
  saveTickets(interaction.guild.id, tickets);

  return interaction.reply({ content: 'Ta demande a bien ete envoyee, patiente pendant qu\'un membre de l\'equipe la traite.', ephemeral: true });
}

async function handleTicketCloseModal(interaction, channelId) {
  const config = getGuildConfig(interaction.guild.id);
  const tickets = getTickets(interaction.guild.id);
  const ticketInfo = tickets.active[channelId];
  if (!ticketInfo) return interaction.reply({ content: 'Ce ticket n\'est plus actif.', ephemeral: true });

  const reason = interaction.fields.getTextInputValue('close_reason');
  await interaction.reply({ content: `Ticket ferme. Ce salon sera supprime dans 5 secondes.\n**Raison :** ${reason}` });

  if (config.tickets.logChannelId) {
    const logChannel = interaction.guild.channels.cache.get(config.tickets.logChannelId);
    if (logChannel) {
      const logEmbed = new EmbedBuilder()
        .setTitle('Ticket ferme').setColor('#ED4245')
        .addFields(
          { name: 'Salon', value: `#${interaction.channel.name}`, inline: true },
          { name: 'Ouvert par', value: `<@${ticketInfo.ownerId}>`, inline: true },
          { name: 'Ferme par', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Justification', value: reason }
        ).setTimestamp();
      await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
    }
  }

  delete tickets.active[channelId];
  saveTickets(interaction.guild.id, tickets);
  setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
}

/* ==========================================================================
   DEMARRAGE
   ========================================================================== */

if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) {
  console.error('DISCORD_TOKEN et CLIENT_ID sont obligatoires (variables d\'environnement).');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
