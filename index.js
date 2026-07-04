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
  TextInputStyle
} = require('discord.js');

/* ==========================================================================
   STOCKAGE : tout est sauvegarde dans de simples fichiers JSON.
   Un fichier de config + un fichier de tickets par serveur Discord.
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
    footer: '{server}'
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
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`Erreur de lecture de ${filePath} :`, err);
    return JSON.parse(JSON.stringify(fallback));
  }
}
function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}
function getGuildConfig(guildId) {
  const filePath = path.join(DATA_DIR, `config_${guildId}.json`);
  const config = readJson(filePath, DEFAULT_CONFIG);
  config.welcome = { ...DEFAULT_CONFIG.welcome, ...config.welcome };
  config.tickets = { ...DEFAULT_CONFIG.tickets, ...config.tickets };
  return config;
}
function saveGuildConfig(guildId, config) {
  writeJson(path.join(DATA_DIR, `config_${guildId}.json`), config);
}
function getTickets(guildId) {
  const filePath = path.join(DATA_DIR, `tickets_${guildId}.json`);
  const tickets = readJson(filePath, DEFAULT_TICKETS);
  tickets.pending = tickets.pending || {};
  tickets.active = tickets.active || {};
  return tickets;
}
function saveTickets(guildId, tickets) {
  writeJson(path.join(DATA_DIR, `tickets_${guildId}.json`), tickets);
}

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
function generateTicketId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function sanitizeChannelName(username) {
  const clean = username
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `ticket-${clean || 'membre'}`.slice(0, 90);
}

/* ==========================================================================
   DEFINITION DES COMMANDES SLASH (/welcome, /ticket-setup, /rename-ticket)
   ========================================================================== */

const commandsData = [
  new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Configurer le systeme de message de bienvenue')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub => sub.setName('channel').setDescription('Definit le salon de bienvenue')
      .addChannelOption(opt => opt.setName('salon').setDescription('Le salon').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(sub => sub.setName('toggle').setDescription('Active ou desactive le systeme')
      .addBooleanOption(opt => opt.setName('actif').setDescription('true/false').setRequired(true)))
    .addSubcommand(sub => sub.setName('message').setDescription('Personnaliser titre/description/footer (formulaire)'))
    .addSubcommand(sub => sub.setName('couleur').setDescription('Couleur de l\'embed')
      .addStringOption(opt => opt.setName('hex').setDescription('Ex: #5865F2').setRequired(true)))
    .addSubcommand(sub => sub.setName('image').setDescription('Image/banniere ("reset" pour retirer)')
      .addStringOption(opt => opt.setName('url').setDescription('URL ou "reset"').setRequired(true)))
    .addSubcommand(sub => sub.setName('avatar').setDescription('Afficher l\'avatar en miniature')
      .addBooleanOption(opt => opt.setName('actif').setDescription('true/false').setRequired(true)))
    .addSubcommand(sub => sub.setName('test').setDescription('Envoie un apercu'))
    .addSubcommand(sub => sub.setName('status').setDescription('Affiche la configuration actuelle')),

  new SlashCommandBuilder()
    .setName('ticket-setup')
    .setDescription('Configurer le systeme de tickets')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub => sub.setName('panel').setDescription('Publie le panneau de creation de ticket')
      .addChannelOption(opt => opt.setName('salon').setDescription('Salon du panneau').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption(opt => opt.setName('titre').setDescription('Titre du panneau').setRequired(false))
      .addStringOption(opt => opt.setName('description').setDescription('Description du panneau').setRequired(false)))
    .addSubcommand(sub => sub.setName('add-ping-role').setDescription('Ajoute un role a ping a chaque demande')
      .addRoleOption(opt => opt.setName('role').setDescription('Le role').setRequired(true)))
    .addSubcommand(sub => sub.setName('remove-ping-role').setDescription('Retire un role pingue')
      .addRoleOption(opt => opt.setName('role').setDescription('Le role').setRequired(true)))
    .addSubcommand(sub => sub.setName('add-access-role').setDescription('Ajoute un role qui gere les tickets')
      .addRoleOption(opt => opt.setName('role').setDescription('Le role').setRequired(true)))
    .addSubcommand(sub => sub.setName('remove-access-role').setDescription('Retire un role de la gestion des tickets')
      .addRoleOption(opt => opt.setName('role').setDescription('Le role').setRequired(true)))
    .addSubcommand(sub => sub.setName('category').setDescription('Categorie ou seront crees les salons de tickets')
      .addChannelOption(opt => opt.setName('categorie').setDescription('La categorie').addChannelTypes(ChannelType.GuildCategory).setRequired(true)))
    .addSubcommand(sub => sub.setName('logs').setDescription('Salon de logs des fermetures de tickets')
      .addChannelOption(opt => opt.setName('salon').setDescription('Vide = desactive').addChannelTypes(ChannelType.GuildText).setRequired(false)))
    .addSubcommand(sub => sub.setName('status').setDescription('Affiche la configuration actuelle')),

  new SlashCommandBuilder()
    .setName('rename-ticket')
    .setDescription('Renomme le salon de ticket actuel')
    .addStringOption(opt => opt.setName('nom').setDescription('Nouveau nom').setRequired(true).setMaxLength(90))
];

/* ==========================================================================
   CLIENT DISCORD
   ========================================================================== */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages
  ]
});

client.once('clientReady', async () => {
  console.log(`Connecte en tant que ${client.user.tag} !`);

  // Enregistrement automatique des commandes slash au demarrage
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

/* ---------------- Message de bienvenue a l'arrivee d'un membre ---------------- */

client.on('guildMemberAdd', async (member) => {
  const config = getGuildConfig(member.guild.id);
  const w = config.welcome;
  if (!w.enabled || !w.channelId) return;
  const channel = member.guild.channels.cache.get(w.channelId);
  if (!channel) return;
  try {
    const embed = buildWelcomeEmbed(member, w);
    await channel.send({ content: `<@${member.id}>`, embeds: [embed] });
  } catch (err) {
    console.error('Erreur envoi message de bienvenue :', err);
  }
});

/* ---------------- Toutes les interactions (commandes, boutons, formulaires) ---------------- */

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'welcome') return handleWelcomeCommand(interaction);
      if (interaction.commandName === 'ticket-setup') return handleTicketSetupCommand(interaction);
      if (interaction.commandName === 'rename-ticket') return handleRenameTicketCommand(interaction);
    } else if (interaction.isButton()) {
      return handleButton(interaction);
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
   COMMANDE /welcome
   ========================================================================== */

async function handleWelcomeCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  const config = getGuildConfig(interaction.guild.id);

  if (sub === 'channel') {
    const channel = interaction.options.getChannel('salon');
    config.welcome.channelId = channel.id;
    saveGuildConfig(interaction.guild.id, config);
    return interaction.reply({ content: `Le salon de bienvenue est maintenant ${channel}.`, ephemeral: true });
  }

  if (sub === 'toggle') {
    const actif = interaction.options.getBoolean('actif');
    if (actif && !config.welcome.channelId) {
      return interaction.reply({ content: 'Configure d\'abord un salon avec `/welcome channel`.', ephemeral: true });
    }
    config.welcome.enabled = actif;
    saveGuildConfig(interaction.guild.id, config);
    return interaction.reply({ content: `Systeme de bienvenue ${actif ? 'active' : 'desactive'}.`, ephemeral: true });
  }

  if (sub === 'message') {
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

  if (sub === 'couleur') {
    const hex = interaction.options.getString('hex');
    if (isNaN(parseInt(hex.replace('#', ''), 16))) {
      return interaction.reply({ content: 'Couleur invalide, exemple : `#5865F2`', ephemeral: true });
    }
    config.welcome.color = hex;
    saveGuildConfig(interaction.guild.id, config);
    return interaction.reply({ content: `Couleur mise a jour : ${hex}`, ephemeral: true });
  }

  if (sub === 'image') {
    const url = interaction.options.getString('url');
    if (url.toLowerCase() === 'reset') {
      config.welcome.image = null;
      saveGuildConfig(interaction.guild.id, config);
      return interaction.reply({ content: 'Image retiree.', ephemeral: true });
    }
    if (!/^https?:\/\/.+/i.test(url)) {
      return interaction.reply({ content: 'URL invalide (ou "reset").', ephemeral: true });
    }
    config.welcome.image = url;
    saveGuildConfig(interaction.guild.id, config);
    return interaction.reply({ content: 'Image mise a jour.', ephemeral: true });
  }

  if (sub === 'avatar') {
    const actif = interaction.options.getBoolean('actif');
    config.welcome.thumbnailEnabled = actif;
    saveGuildConfig(interaction.guild.id, config);
    return interaction.reply({ content: `Miniature avatar ${actif ? 'activee' : 'desactivee'}.`, ephemeral: true });
  }

  if (sub === 'test') {
    if (!config.welcome.channelId) return interaction.reply({ content: 'Aucun salon configure.', ephemeral: true });
    const channel = interaction.guild.channels.cache.get(config.welcome.channelId);
    if (!channel) return interaction.reply({ content: 'Salon introuvable.', ephemeral: true });
    await channel.send({ embeds: [buildWelcomeEmbed(interaction.member, config.welcome)] });
    return interaction.reply({ content: `Apercu envoye dans ${channel}.`, ephemeral: true });
  }

  if (sub === 'status') {
    const w = config.welcome;
    return interaction.reply({
      content: [
        `**Systeme de bienvenue**`,
        `Statut : ${w.enabled ? 'Active' : 'Desactive'}`,
        `Salon : ${w.channelId ? `<#${w.channelId}>` : 'Non configure'}`,
        `Couleur : ${w.color}`,
        `Avatar : ${w.thumbnailEnabled ? 'Oui' : 'Non'}`,
        `Image : ${w.image || 'Aucune'}`,
        `Titre : ${w.title}`,
        `Description : ${w.description}`,
        `Footer : ${w.footer || 'Aucun'}`
      ].join('\n'),
      ephemeral: true
    });
  }
}

/* ==========================================================================
   COMMANDE /ticket-setup
   ========================================================================== */

async function handleTicketSetupCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  const config = getGuildConfig(interaction.guild.id);

  if (sub === 'panel') {
    const channel = interaction.options.getChannel('salon');
    const titre = interaction.options.getString('titre') || 'Support - Creation de ticket';
    const description = interaction.options.getString('description')
      || 'Clique sur le bouton ci-dessous et decris ton probleme pour ouvrir un ticket.';
    const embed = new EmbedBuilder().setTitle(titre).setDescription(description).setColor('#5865F2');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_create').setLabel('Creer un ticket').setEmoji('🎫').setStyle(ButtonStyle.Primary)
    );
    await channel.send({ embeds: [embed], components: [row] });
    config.tickets.panelChannelId = channel.id;
    saveGuildConfig(interaction.guild.id, config);
    return interaction.reply({ content: `Panneau publie dans ${channel}.`, ephemeral: true });
  }

  if (sub === 'add-ping-role') {
    const role = interaction.options.getRole('role');
    if (!config.tickets.pingRoles.includes(role.id)) config.tickets.pingRoles.push(role.id);
    saveGuildConfig(interaction.guild.id, config);
    return interaction.reply({ content: `${role} sera pingue a chaque demande de ticket.`, ephemeral: true });
  }
  if (sub === 'remove-ping-role') {
    const role = interaction.options.getRole('role');
    config.tickets.pingRoles = config.tickets.pingRoles.filter(id => id !== role.id);
    saveGuildConfig(interaction.guild.id, config);
    return interaction.reply({ content: `${role} retire.`, ephemeral: true });
  }
  if (sub === 'add-access-role') {
    const role = interaction.options.getRole('role');
    if (!config.tickets.accessRoles.includes(role.id)) config.tickets.accessRoles.push(role.id);
    saveGuildConfig(interaction.guild.id, config);
    return interaction.reply({ content: `${role} peut gerer les tickets.`, ephemeral: true });
  }
  if (sub === 'remove-access-role') {
    const role = interaction.options.getRole('role');
    config.tickets.accessRoles = config.tickets.accessRoles.filter(id => id !== role.id);
    saveGuildConfig(interaction.guild.id, config);
    return interaction.reply({ content: `${role} retire de la gestion des tickets.`, ephemeral: true });
  }
  if (sub === 'category') {
    const category = interaction.options.getChannel('categorie');
    config.tickets.categoryId = category.id;
    saveGuildConfig(interaction.guild.id, config);
    return interaction.reply({ content: `Salons de tickets crees dans **${category.name}**.`, ephemeral: true });
  }
  if (sub === 'logs') {
    const channel = interaction.options.getChannel('salon');
    config.tickets.logChannelId = channel ? channel.id : null;
    saveGuildConfig(interaction.guild.id, config);
    return interaction.reply({ content: channel ? `Logs envoyes dans ${channel}.` : 'Logs desactives.', ephemeral: true });
  }
  if (sub === 'status') {
    const t = config.tickets;
    return interaction.reply({
      content: [
        `**Systeme de tickets**`,
        `Panneau : ${t.panelChannelId ? `<#${t.panelChannelId}>` : 'Non publie'}`,
        `Categorie : ${t.categoryId ? `<#${t.categoryId}>` : 'Aucune'}`,
        `Roles pingues : ${t.pingRoles.length ? t.pingRoles.map(id => `<@&${id}>`).join(', ') : 'Aucun'}`,
        `Roles avec acces : ${t.accessRoles.length ? t.accessRoles.map(id => `<@&${id}>`).join(', ') : 'Aucun'}`,
        `Logs : ${t.logChannelId ? `<#${t.logChannelId}>` : 'Non configure'}`
      ].join('\n'),
      ephemeral: true
    });
  }
}

/* ==========================================================================
   COMMANDE /rename-ticket
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
   BOUTONS (creer / accepter / refuser / fermer un ticket)
   ========================================================================== */

async function handleButton(interaction) {
  const { customId } = interaction;

  if (customId === 'ticket_create') {
    const config = getGuildConfig(interaction.guild.id);
    if (!config.tickets.panelChannelId) return interaction.reply({ content: 'Systeme de tickets non configure.', ephemeral: true });
    const modal = new ModalBuilder().setCustomId('ticket_create_modal').setTitle('Ouvrir un ticket');
    const descInput = new TextInputBuilder().setCustomId('ticket_description').setLabel('Decris ton probleme')
      .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000);
    modal.addComponents(new ActionRowBuilder().addComponents(descInput));
    return interaction.showModal(modal);
  }

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

  const channel = await interaction.guild.channels.create({
    name: sanitizeChannelName(requester.user.username),
    type: ChannelType.GuildText,
    parent: config.tickets.categoryId || null,
    permissionOverwrites
  });

  const accessRolesMention = config.tickets.accessRoles.map(id => `<@&${id}>`).join(' ');
  const welcomeEmbed = new EmbedBuilder()
    .setTitle('Ticket ouvert')
    .setDescription(`Ticket ouvert par <@${requester.id}>.\n\n**Probleme decrit :**\n${pending.description}`)
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

/* ==========================================================================
   FORMULAIRES (modals)
   ========================================================================== */

async function handleModal(interaction) {
  const { customId } = interaction;
  if (customId === 'welcome_message_modal') return handleWelcomeMessageModal(interaction);
  if (customId === 'ticket_create_modal') return handleTicketCreateModal(interaction);
  if (customId.startsWith('ticket_close_modal_')) return handleTicketCloseModal(interaction, customId.replace('ticket_close_modal_', ''));
}

async function handleWelcomeMessageModal(interaction) {
  const config = getGuildConfig(interaction.guild.id);
  config.welcome.title = interaction.fields.getTextInputValue('welcome_title');
  config.welcome.description = interaction.fields.getTextInputValue('welcome_description');
  config.welcome.footer = interaction.fields.getTextInputValue('welcome_footer') || null;
  saveGuildConfig(interaction.guild.id, config);
  return interaction.reply({ content: 'Message de bienvenue mis a jour. Utilise `/welcome test` pour previsualiser.', ephemeral: true });
}

async function handleTicketCreateModal(interaction) {
  const config = getGuildConfig(interaction.guild.id);
  const panelChannel = interaction.guild.channels.cache.get(config.tickets.panelChannelId);
  if (!panelChannel) return interaction.reply({ content: 'Systeme de tickets non configure.', ephemeral: true });

  const description = interaction.fields.getTextInputValue('ticket_description');
  const ticketId = generateTicketId();
  const pingRolesMention = config.tickets.pingRoles.map(id => `<@&${id}>`).join(' ');

  const embed = new EmbedBuilder()
    .setTitle('Nouvelle demande de ticket')
    .setDescription(`**Demandeur :** <@${interaction.user.id}>\n**Probleme :**\n${description}`)
    .setColor('#FEE75C').setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticket_accept_${ticketId}`).setLabel('Accepter').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ticket_deny_${ticketId}`).setLabel('Refuser').setEmoji('❌').setStyle(ButtonStyle.Secondary)
  );

  const requestMessage = await panelChannel.send({ content: pingRolesMention || undefined, embeds: [embed], components: [row] });

  const tickets = getTickets(interaction.guild.id);
  tickets.pending[ticketId] = { requesterId: interaction.user.id, description, requestMessageId: requestMessage.id };
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
