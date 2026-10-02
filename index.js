// ============================================================
// GHASHASH STORE BOT  -  Discord Premium Store Bot
// ============================================================
// نظام الإعلانات:
//  - Embed فخم: صورة كبيرة + عنوان عريض + وصف بنقاط + حقول سفلى
//  - Select Menu (قائمة منسدلة) لاختيار المنتج
//  - أزرار Buy / كميات / سعر عند الاختيار
//  - لوحة تحكم للمسؤول لإنشاء كل شيء عبر Modal من الديسكورد
// ============================================================

const fs = require('fs');
const path = require('path');
const {
  Client, GatewayIntentBits, Events,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  SlashCommandBuilder, REST, Routes, StringSelectMenuBuilder, StringSelectMenuOptionBuilder
} = require('discord.js');

// ---------- قراءة الإعدادات (تدعم Render Env Vars) ----------
let config;
try {
  config = require('./config.json');
} catch (e) {
  config = {
    color: 0x2B2D31,
    accentColor: 0xFF0000,
    currency: '$',
    botName: 'GHASHASH STORE',
    supportRoleId: null
  };
}

// التوكن من Render Environment Variable أو من config.json
const TOKEN = process.env.DISCORD_TOKEN || config.token;

// ---------- مسار تخزين البيانات (يدعم Persistent Disk) ----------
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const STORE_FILE = path.join(DATA_DIR, 'store.json');

function loadStore() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); }
  catch (e) { return { products: [], nextId: 1 }; }
}
function saveStore(s) { fs.writeFileSync(STORE_FILE, JSON.stringify(s, null, 2)); }
let store = loadStore();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers
  ],
  allowedMentions: { parse: ['everyone', 'users', 'roles'] }
});

// ---------- الأوامر ----------
const commands = [
  new SlashCommandBuilder().setName('createstore').setDescription('أظهر زر إنشاء متجر / منتج').setDefaultMemberPermissions(0),
  new SlashCommandBuilder().setName('ads').setDescription('أنشئ إعلانًا فاخرًا تفاعليًا لكل منتج').setDefaultMemberPermissions(0),
  new SlashCommandBuilder().setName('setup').setDescription('حدد رتبة الدعم الفني')
    .addRoleOption(o => o.setName('role').setDescription('رتبة الدعم').setRequired(true)).setDefaultMemberPermissions(0),
  new SlashCommandBuilder().setName('products').setDescription('اعرض كل المنتجات'),
  new SlashCommandBuilder().setName('ping').setDescription('تحقق أن البوت يعمل')
];

const rest = new REST({ version: '10' }).setToken(TOKEN);
async function registerCommands() {
  try { await rest.put(Routes.applicationCommands(client.user.id), { body: commands }); console.log('lets commands OK'); }
  catch (e) { console.error('commands FAIL: ' + e.message); }
}

// ---------- بناء Embed فاخر ----------
function featuresText(p) {
  return (p.description || '')
    .split('\n').filter(Boolean).map(x => '• ' + x).join('\n') || '• Premium Quality';
}

function infoEmbed(p) {
  const embed = new EmbedBuilder()
    .setColor(config.color)
    .setTitle(p.name)
    .setDescription(featuresText(p))
    .setFooter({ text: config.botName })
    .setTimestamp();
  if (p.image) embed.setThumbnail(p.image);
  if (p.options && p.options.length) {
    embed.addFields({ name: '📦 Options / Packs', value: p.options.map(o => '• ' + o.label + ' — ' + config.currency + (o.price || '0') + (o.description ? ' | ' + o.description : '')).join('\n') });
  }
  return embed;
}

const RED = 0xFF0000;
function adEmbed(p) {
  const features = (p.description || '').split('\n').filter(Boolean).map(x => '• ' + x).join('\n');
  const desc = '# ' + p.name + (features ? '\n\n' + features : '');
  const embed = new EmbedBuilder()
    .setColor(RED)
    .setDescription(desc)
    .setFooter({ text: config.botName })
    .setTimestamp();
  if (p.image) embed.setImage(p.image);
  return embed;
}

async function pingEveryone(channel, guildId) {
  if (!channel || !guildId) return;
  try {
    const msg = await channel.send({
      content: '@everyone',
      allowedMentions: { parse: ['everyone', 'users', 'roles'] }
    });
    setTimeout(() => msg.delete().catch(() => {}), 8000);
  } catch (e) {
    console.error('MENTION FAILED (' + e.message + ') -> bot needs "Mention Everyone" permission');
  }
}

function buildAd(p) {
  const rows = [];
  if (p.options && p.options.length) rows.push(planSelect(p));
  else rows.push(productBuyButton(p));
  return { embeds: [adEmbed(p)], components: rows };
}

function parseOptions(text) {
  const lines = (text || '').split('\n').map(l => l.trim()).filter(Boolean);
  const opts = [];
  for (let i = 0; i < lines.length; i += 2) {
    const label = lines[i];
    if (!label) continue;
    const desc = lines[i + 1] || '';
    const nums = label.match(/\d+(?:[.,]\d+)?/g);
    const price = nums ? nums[nums.length - 1].replace(',', '.') : '';
    opts.push({ label: label.slice(0, 100), description: desc.slice(0, 100), price });
  }
  return opts;
}

function planSelect(p) {
  const opts = (p.options || []).map((o, i) => new StringSelectMenuOptionBuilder()
    .setLabel(String(o.label).slice(0, 100))
    .setDescription(String(o.description || (o.price ? config.currency + o.price : '')).slice(0, 100))
    .setValue('opt_' + p.id + '_' + i));
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('plan_' + p.id)
      .setPlaceholder('Select From Here')
      .addOptions(opts));
}

function productBuyButton(p) {
  const stockTxt = (p.stock !== '\u221E' && p.stock != null) ? ' - Restam apenas ' + p.stock : '';
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('cart_' + p.id)
      .setLabel(p.name.toUpperCase())
      .setEmoji('\uD83D\uDED2')
      .setStyle(ButtonStyle.Success)
  ).addComponents(
    new ButtonBuilder()
      .setCustomId('buy_' + p.id)
      .setLabel((p.price ? config.currency + ' ' + p.price : '\uD83D\uDCE6 اختر الباقة') + ' ' + stockTxt)
      .setStyle(ButtonStyle.Success)
  );
}

function ticketButtons(locked) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_deliver').setLabel('Deliver / Receive').setEmoji('\u2705').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ticket_lock').setLabel(locked ? 'Unlock' : 'Lock').setEmoji(locked ? '\uD83D\uDD13' : '\uD83D\uDD12').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Close / Archive').setEmoji('\uD83D\uDD10').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ticket_delete').setLabel('Delete').setEmoji('\uD83D\uDDD1\uFE0F').setStyle(ButtonStyle.Danger)
  );
}

// ============================================================
client.once(Events.ClientReady, async (c) => {
  console.log('BOT ONLINE: ' + c.user.tag);
  await registerCommands();
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) return await handleCommand(interaction);
    if (interaction.isButton()) return await handleButton(interaction);
    if (interaction.isStringSelectMenu()) return await handleSelect(interaction);
    if (interaction.isModalSubmit()) return await handleModal(interaction);
  } catch (err) {
    console.error('ERR: ' + err.message);
    if (interaction.isRepliable() && !interaction.replied) interaction.reply({ content: 'error: ' + err.message, ephemeral: true }).catch(() => {});
  }
});

// ---------------- أوامر ----------------
async function handleCommand(interaction) {
  const c = interaction.commandName;
  if (c === 'ping') return interaction.reply({ content: 'Pong! bot works', ephemeral: true });

  if (c === 'setup') {
    config.supportRoleId = interaction.options.getRole('role').id;
    try {
      const cfgPath = path.join(__dirname, 'config.json');
      const existing = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
      fs.writeFileSync(cfgPath, JSON.stringify({ ...existing, ...config }, null, 2));
    } catch (e) { console.error('save config fail: ' + e.message); }
    return interaction.reply({ content: 'Support role set.', ephemeral: true });
  }

  if (c === 'products') {
    if (!store.products.length) return interaction.reply({ content: 'No products.', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    for (const p of store.products) await interaction.channel.send(buildAd(p)).catch(() => {});
    return interaction.editReply({ content: 'Shown ' + store.products.length + ' products.' });
  }

  if (c === 'createstore') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('create_store').setLabel('+ Create Store / Product').setEmoji('🛒').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('admin_panel').setLabel('⚙ Admin Panel').setEmoji('🎛️').setStyle(ButtonStyle.Secondary)
    );
    const embed = new EmbedBuilder()
      .setColor(config.accentColor || config.color)
      .setTitle('🛒 ' + config.botName + ' CONTROL')
      .setDescription('**Admin Panel** — create your ads easily.\n\n• Press **Create Store** to add a product\n• **Admin Panel** to manage ads & settings')
      .setFooter({ text: config.botName });
    return interaction.reply({ embeds: [embed], components: [row] });
  }

  if (c === 'ads') {
    if (!store.products.length) return interaction.reply({ content: 'No products yet. Use /createstore first.', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    let count = 0;
    for (const p of store.products) {
      await interaction.channel.send(buildAd(p)).catch(() => {});
      count++;
    }
    await pingEveryone(interaction.channel, interaction.guildId);
    return interaction.editReply({ content: 'Posted ' + count + ' premium ads.' });
  }
}

// ---------------- أزرار ----------------
async function handleButton(interaction) {
  const id = interaction.customId;

  if (id === 'create_store') {
    const modal = new ModalBuilder().setCustomId('product_modal').setTitle('\uD83D\uDED2 Add Product');
    const n = new TextInputBuilder().setCustomId('p_name').setLabel('Product Name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80);
    const pr = new TextInputBuilder().setCustomId('p_price').setLabel('Price (USD)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(12);
    const img = new TextInputBuilder().setCustomId('p_image').setLabel('Large Image / Logo Link (URL)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(300);
    const desc = new TextInputBuilder().setCustomId('p_desc').setLabel('Features / text (one per line)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000);
    const opts = new TextInputBuilder().setCustomId('p_opts')
      .setLabel('Options (2 lines per option)')
      .setPlaceholder('Example:\n1 Day - $3\nWorks full day\n3 Days - $7\n3 days warranty')
      .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000);
    modal.addComponents(
      new ActionRowBuilder().addComponents(n),
      new ActionRowBuilder().addComponents(pr),
      new ActionRowBuilder().addComponents(img),
      new ActionRowBuilder().addComponents(desc),
      new ActionRowBuilder().addComponents(opts)
    );
    return interaction.showModal(modal);
  }

  if (id === 'admin_panel') {
    const embed = new EmbedBuilder().setColor(config.color)
      .setTitle('⚙ Admin Panel')
      .setDescription('Commands you can use:\n• `/createstore` - show store buttons\n• `/ads` - post premium ads\n• `/setup role:@support` - set support role\n• `/products` - show all products');
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (id.startsWith('cart_')) {
    const pid = parseInt(id.split('_')[1]);
    const p = store.products.find(x => x.id === pid);
    if (!p) return interaction.reply({ content: 'Not found', ephemeral: true });
    return openTicket(interaction, p);
  }

  if (id.startsWith('info_')) {
    const pid = parseInt(id.split('_')[1]);
    const p = store.products.find(x => x.id === pid);
    if (!p) return interaction.reply({ content: 'Not found', ephemeral: true });
    return interaction.reply({ embeds: [infoEmbed(p)], ephemeral: true });
  }

  if (id.startsWith('ticket_')) return handleTicketButton(interaction, id);
}

// ---------------- Select Menu ----------------
async function handleSelect(interaction) {
  if (interaction.customId.startsWith('plan_')) {
    const pid = parseInt(interaction.customId.split('_')[1]);
    const p = store.products.find(x => x.id === pid);
    if (!p) return interaction.reply({ content: 'Not found', ephemeral: true });
    const idx = parseInt(interaction.values[0].split('_')[2]);
    const plan = (p.options || [])[idx];
    if (!plan) return interaction.reply({ content: 'Option not found', ephemeral: true });
    return openTicket(interaction, p, plan);
  }
}

// ---------------- تذكرة ----------------
async function openTicket(interaction, p, plan) {
  const user = interaction.user;
  const channel = interaction.channel;
  if (!channel || !channel.threads || typeof channel.threads.create !== 'function') {
    return interaction.reply({ content: 'Cannot open ticket here.', ephemeral: true });
  }
  const pp = plan ? (plan.price || p.price) : (p.price || '0');
  const planTxt = plan ? config.currency + pp + ' — ' + plan.label : config.currency + pp;
  const tname = '\uD83D\uDED2 ticket-' + user.username.slice(0, 30) + (plan ? '-' + plan.label.slice(0, 30) : '');
  let thread;
  try {
    thread = await channel.threads.create({ name: tname, autoArchiveDuration: 4320 });
  } catch (e) {
    return interaction.reply({ content: 'Ticket failed: ' + e.message, ephemeral: true });
  }
  await thread.members.add(user.id).catch(() => {});
  const roleMention = config.supportRoleId ? '<@&' + config.supportRoleId + '>' : '@Support (set via /setup)';
  const embed = new EmbedBuilder()
    .setColor(config.color)
    .setTitle('\uD83E\uDDFE Purchase Ticket')
    .setDescription('**Customer:** ' + user + '\n**Product:** ' + p.name + ' (# ' + p.id + ')\n**Price:** ' + planTxt)
    .setThumbnail(p.image || null)
    .setTimestamp();
  if (plan) embed.addFields({ name: '\uD83D\uDCE6 Option / Pack', value: plan.label + ' — ' + config.currency + (plan.price || pp), inline: true });
  await thread.send({ content: roleMention, embeds: [embed], components: [ticketButtons(false)] });
  return interaction.reply({ content: 'Ticket opened: ' + thread, ephemeral: true });
}

async function handleTicketButton(interaction, id) {
  const ch = interaction.channel;
  const isStaff = !config.supportRoleId || (interaction.member && interaction.member.roles && interaction.member.roles.cache.has(config.supportRoleId));
  try {
    if (!isStaff) {
      await interaction.reply({ content: '\u26A0\uFE0F Only the support role can use these buttons.', ephemeral: true });
      return;
    }
    if (id === 'ticket_deliver') {
      await interaction.reply({ content: '\u2705 Delivery / Receive confirmed.', ephemeral: true });
      return;
    }
    if (id === 'ticket_lock') {
      await interaction.deferUpdate().catch(() => {});
      const nowLocked = !(ch && ch.locked);
      if (ch && typeof ch.setLocked === 'function') { await ch.setLocked(nowLocked).catch(() => {}); }
      await interaction.message.edit({ components: [ticketButtons(nowLocked)] }).catch(() => {});
      await interaction.followUp({ content: nowLocked ? '\uD83D\uDD12 Ticket locked.' : '\uD83D\uDD13 Ticket unlocked.', ephemeral: true }).catch(() => {});
      return;
    }
    if (id === 'ticket_close') {
      await interaction.deferUpdate().catch(() => {});
      if (ch && typeof ch.setArchived === 'function') { await ch.setArchived(true).catch(() => {}); }
      await interaction.followUp({ content: '\uD83D\uDD10 Ticket closed & archived.', ephemeral: true }).catch(() => {});
      return;
    }
    if (id === 'ticket_delete') {
      await interaction.deferUpdate().catch(() => {});
      if (ch && typeof ch.delete === 'function') { await ch.delete('ticket deleted').catch(() => {}); }
      return;
    }
    await interaction.reply({ content: 'done', ephemeral: true });
  } catch (e) {
    console.error('TICKET ERR: ' + e.message);
    await interaction.reply({ content: 'Error: ' + e.message, ephemeral: true }).catch(() => {});
  }
}

// ---------------- Modal ----------------
async function handleModal(interaction) {
  if (interaction.customId !== 'product_modal') return;
  const get = (k) => { try { return interaction.fields.getTextInputValue(k).trim(); } catch (e) { return ''; } };
  const name = get('p_name') || 'Untitled';
  const price = get('p_price') || '0.00';
  const image = get('p_image');
  const desc = get('p_desc');
  const optsText = get('p_opts');

  const p = {
    id: store.nextId++,
    name, price, image,
    tagline: 'Premium Quality',
    category: 'Tools',
    description: desc,
    options: parseOptions(optsText),
    stock: '\u221E'
  };
  store.products.push(p);
  saveStore(store);

  await interaction.reply({ content: 'Added #' + p.id + ' ' + p.name + (p.options.length ? ' with ' + p.options.length + ' options.' : '') + ' Use /ads to post it.', ephemeral: true }).catch(() => {});

  if (interaction.channel) {
    await interaction.channel.send(buildAd(p)).catch(() => {});
    await pingEveryone(interaction.channel, interaction.guildId);
  }
}

// ---------- تشغيل ----------
process.on('unhandledRejection', (r) => console.error('UNHANDLED REJECTION:', r && (r.message || r)));
process.on('uncaughtException', (e) => console.error('UNCAUGHT EXCEPTION:', e && (e.message || e)));

if (!TOKEN) {
  console.error('❌ DISCORD_TOKEN مش موجود! ضيفه في Environment Variables على Render.');
  process.exit(1);
}

client.login(TOKEN).then(() => console.log('Logging in...')).catch((err) => {
  console.error('LOGIN FAIL: ' + err.message);
  console.error('Check DISCORD_TOKEN in Render Environment Variables');
  process.exit(1);
});
