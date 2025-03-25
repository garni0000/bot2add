require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { MongoClient } = require('mongodb');
const express = require('express');
const http = require('http');

const ADMINS = process.env.ADMINS ? process.env.ADMINS.split(',') : [];
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME;
const COLLECTION_NAME = 'telegram_users';
const VIDEO_URL = process.env.VIDEO_URL;

// --- Configuration Express ---
const app = express();
app.get('/', (req, res) => res.send('Bot is running...'));
app.listen(PORT, () => console.log(`✅ Serveur Express lancé sur le port ${PORT}`));

// --- Configuration MongoDB ---
let db;
async function connectDB() {
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db(DB_NAME);
    console.log('✅ Connecté à MongoDB');
  } catch (error) {
    console.error('Erreur de connexion MongoDB:', error);
    process.exit(1);
  }
}

// --- Configuration du Bot Telegram ---
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN, {
  handlerTimeout: 30000,
  telegram: {
    apiRoot: 'https://api.telegram.org',
    timeout: 30000
  }
});

// --- Fonctions utilitaires ---
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeMarkdown(text) {
  if (!text) return text;
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function generateButtons() {
  return {
    inline_keyboard: [
      [
        { text: 'Canal Officiel 🌟', url: process.env.CHANNEL1_URL },
        { text: 'Groupe VIP 💎', url: process.env.CHANNEL2_URL }
      ],
      [
        { text: 'Canal 3 ✅', url: process.env.CHANNEL3_URL },
        { text: 'Canal 4 📚', url: process.env.CHANNEL4_URL }
      ],
      [
        { text: 'Notre Bot 🤖', url: process.env.BOT_URL },
        { text: 'Canal crash💎', url: process.env.CHANNEL5_URL }
      ]
    ]
  };
}

function isAdmin(userId) {
  return ADMINS.includes(userId.toString());
}

async function saveUserToDB(userData) {
  try {
    const collection = db.collection(COLLECTION_NAME);
    await collection.updateOne(
      { telegram_id: userData.telegram_id },
      { $set: userData },
      { upsert: true }
    );
  } catch (error) {
    console.error('Erreur lors de la sauvegarde en DB:', error);
  }
}

// --- Gestion des demandes d'adhésion ---
bot.on('chat_join_request', async (ctx) => {
  const { from: user, chat } = ctx.update.chat_join_request;

  const userData = {
    telegram_id: user.id,
    first_name: user.first_name,
    username: user.username,
    chat_id: chat.id,
    joined_at: new Date(),
    status: 'pending'
  };

  try {
    await saveUserToDB(userData);
    setTimeout(() => sendWelcomeMessage(ctx, user), 250000);
    setTimeout(() => handleUserApproval(ctx, user, chat),6000000);
  } catch (error) {
    console.error('Erreur lors du traitement de la demande d’adhésion:', error);
  }
});

async function sendWelcomeMessage(ctx, user) {
  const caption = `*${escapeMarkdown(user.first_name)}*, félicitations \\! Vous êtes sur le point de rejoindre un groupe d'élite réservé aux personnes ambitieuses et prêtes à réussir 💎

⚠️ *Action Requise* : Confirmez votre présence en rejoignant nos canaux pour finaliser votre adhésion et accéder à notre communauté privée\\.
⏳ Vous avez 10 minutes pour valider votre place exclusive dans le Club des Millionnaires\\.
🚫 Après ce délai, votre demande sera annulée et votre place sera offerte à quelqu'un d'autre\\.`;

  try {
    await ctx.telegram.sendVideo(user.id, VIDEO_URL, {
      caption,
      parse_mode: 'MarkdownV2',
      reply_markup: generateButtons()
    });
  } catch (error) {
    if (error.code === 403) {
      console.log(`L'utilisateur ${user.first_name} a bloqué le bot.`);
    } else {
      console.error('Erreur lors de l’envoi du message de bienvenue:', error);
    }
  }
}

async function handleUserApproval(ctx, user, chat) {
  try {
    const collection = db.collection(COLLECTION_NAME);
    const userDoc = await collection.findOne({ telegram_id: user.id });

    if (userDoc && userDoc.status === 'pending') {
      await ctx.approveChatJoinRequest(user.id);
      await collection.updateOne(
        { telegram_id: user.id },
        { $set: { status: 'approved', approved_at: new Date() } }
      );
      console.log(`Utilisateur approuvé : ${user.first_name}`);
    }
  } catch (error) {
    console.error('Erreur lors de l’approbation finale:', error);
  }
}

// --- Fonctionnalité de Broadcast ---
async function sendContent(userId, content) {
  const timeout = 30000;
  try {
    if (!content) return false;

    const escapedCaption = content.parse_mode === 'MarkdownV2' ? escapeMarkdown(content.caption) : content.caption;
    const escapedText = content.parse_mode === 'MarkdownV2' ? escapeMarkdown(content.text) : content.text;

    const options = {
      caption: escapedCaption,
      parse_mode: content.parse_mode,
      caption_entities: content.entities
    };

    if (content.photo) {
      await Promise.race([
        bot.telegram.sendPhoto(userId, content.photo, options),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout))
      ]);
    } 
    else if (content.video) {
      await Promise.race([
        bot.telegram.sendVideo(userId, content.video.file_id, options),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout))
      ]);
    }
    else if (content.document) {
      await Promise.race([
        bot.telegram.sendDocument(userId, content.document.file_id, options),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout))
      ]);
    }
    else if (content.text) {
      try {
        await Promise.race([
          bot.telegram.sendMessage(userId, escapedText, {
            entities: content.entities,
            parse_mode: content.parse_mode
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout))
        ]);
      } catch (err) {
        await Promise.race([
          bot.telegram.sendMessage(userId, escapedText),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout))
        ]);
      }
    }
    return true;
  } catch (error) {
    if (error.code === 403 || error.response?.description === 'Bad Request: chat not found') {
      return false;
    }
    console.error(`Erreur avec ${userId}:`, error);
    return false;
  }
}

// --- Commandes Bot ---
bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;

  try {
    const collection = db.collection(COLLECTION_NAME);
    const total = await collection.countDocuments();
    const approved = await collection.countDocuments({ status: 'approved' });
    const pending = await collection.countDocuments({ status: 'pending' });

    const stats = `📊 Statistiques du bot:
👥 Total utilisateurs: ${total}
✅ Approuvés: ${approved}
⏳ En attente: ${pending}`;

    await ctx.reply(stats);
  } catch (error) {
    console.error('Erreur lors de la récupération des statistiques:', error);
    await ctx.reply('❌ Erreur lors de la récupération des statistiques.');
  }
});

bot.command('count', async (ctx) => {
  try {
    const collection = db.collection(COLLECTION_NAME);
    const count = await collection.countDocuments();
    await ctx.reply(`👥 Nombre total d'utilisateurs: ${count}`);
  } catch (error) {
    console.error('Erreur count:', error);
    await ctx.reply('❌ Erreur lors du comptage des utilisateurs.');
  }
});

bot.command('send', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;

  const message = ctx.message.reply_to_message;
  if (!message) return ctx.reply('⚠️ Répondez à un message avec /send');

  const content = {
    text: message.text,
    caption: message.caption,
    entities: message.entities || message.caption_entities,
    photo: message.photo ? message.photo[message.photo.length - 1].file_id : null,
    video: message.video ? { file_id: message.video.file_id } : null,
    document: message.document ? { file_id: message.document.file_id } : null,
    parse_mode: 'MarkdownV2'
  };

  await db.collection('broadcasts').insertOne({
    content,
    date: new Date(),
    initiator: ctx.from.id
  });

  await ctx.reply(
    `⚠️ Diffuser ce message à tous les utilisateurs ?\n\n` +
    `📝 Type: ${message.photo ? 'Photo' : ''} ${message.video ? 'Vidéo' : ''} ${message.document ? 'Document' : ''} ${message.text ? 'Texte' : ''}\n` +
    `📏 Légende: ${content.caption ? 'Oui' : 'Non'}`,
    Markup.inlineKeyboard([
      Markup.button.callback('✅ Confirmer', 'confirm_broadcast'),
      Markup.button.callback('❌ Annuler', 'cancel_broadcast')
    ])
  );
});

bot.action('confirm_broadcast', async (ctx) => {
  const users = await db.collection(COLLECTION_NAME)
    .find({ status: 'approved' })
    .project({ telegram_id: 1 })
    .toArray();

  const broadcast = await db.collection('broadcasts')
    .findOne({}, { sort: { $natural: -1 } });

  let success = 0, failed = 0;
  const batchSize = 30;
  const totalUsers = users.length;

  let statusMessage = await ctx.editMessageText(
    `🚀 **Diffusion en cours...**\n\n` +
    `📢 **Total à envoyer :** ${totalUsers}\n` +
    `✅ **Réussis :** 0\n` +
    `❌ **Échecs :** 0\n` +
    `📡 **Progression :** 0%`
  );

  async function updateStats() {
    try {
      await bot.telegram.editMessageText(
        ctx.chat.id, statusMessage.message_id, null,
        `🚀 **Diffusion en cours...**\n\n` +
        `📢 **Total à envoyer :** ${totalUsers}\n` +
        `✅ **Réussis :** ${success}\n` +
        `❌ **Échecs :** ${failed}\n` +
        `📡 **Progression :** ${((success + failed) / totalUsers * 100).toFixed(2)}%`
      );
    } catch (error) {
      console.error("⚠️ Erreur mise à jour stats:", error);
    }
  }

  const updateInterval = setInterval(updateStats, 1000);

  for (let i = 0; i < users.length; i += batchSize) {
    const batch = users.slice(i, i + batchSize);
    const batchPromises = [];

    for (const user of batch) {
      batchPromises.push(
        sendContent(user.telegram_id, broadcast.content)
          .then(sent => sent ? success++ : failed++)
          .catch(() => failed++)
      );
    }

    await Promise.all(batchPromises);
    await sleep(1000);
  }

  clearInterval(updateInterval);

  await ctx.editMessageText(
    `✅ **Diffusion terminée !**\n\n` + 
    `📢 **Total :** ${totalUsers}\n` +
    `✅ **Réussis :** ${success}\n` +
    `❌ **Échecs :** ${failed}\n` +
    `📡 **Progression :** 100%`
  );
});

bot.action('cancel_broadcast', async (ctx) => {
  await ctx.editMessageText('❌ Diffusion annulée.');
});

// --- Démarrage du bot et serveur HTTP ---
async function start() {
  await connectDB();
  await bot.launch();
  console.log('🤖 Bot démarré avec succès');
}

start();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// --- Serveur HTTP pour le ping ---
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end("I'm alive");
});
server.listen(8080, () => console.log("🌍 Server running on port 8080"));
