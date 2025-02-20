 require('dotenv').config();
const { Telegraf } = require('telegraf');
const { MongoClient } = require('mongodb');
const fs = require('fs');

// Configuration MongoDB
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME;
const COLLECTION_NAME = 'telegram_users';

// Configuration du bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const VIDEO_URL = process.env.VIDEO_URL;

// Connexion MongoDB
let db;
async function connectDB() {
  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    db = client.db(DB_NAME);
    console.log('✅ Connecté à MongoDB');
  } catch (error) {
    console.error('Erreur connexion MongoDB:', error);
    process.exit(1);
  }
}

// Gestion des demandes d'adhésion
bot.on('chat_join_request', async (ctx) => {
  const { from: user, chat } = ctx.update.chat_join_request;

  try {
    // Acceptation immédiate
    await ctx.approveChatJoinRequest(user.id);

    // Sauvegarde dans MongoDB
    const userData = {
      telegram_id: user.id,
      first_name: user.first_name,
      username: user.username,
      chat_id: chat.id,
      joined_at: new Date(),
      status: 'pending'
    };

    await saveUserToDB(userData);

    // Envoi notification après 5s
    setTimeout(() => sendWelcomeMessage(ctx, user), 5000);

    // Approbation finale après 10min
    setTimeout(() => handleUserApproval(ctx, user, chat), 600000);

  } catch (error) {
    console.error('Erreur traitement demande:', error);
  }
});

// Fonctions MongoDB
async function saveUserToDB(user) {
  try {
    const collection = db.collection(COLLECTION_NAME);
    await collection.updateOne(
      { telegram_id: user.telegram_id },
      { $set: user },
      { upsert: true }
    );
  } catch (error) {
    console.error('Erreur sauvegarde DB:', error);
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
      console.log(`Utilisateur approuvé: ${user.first_name}`);
    }
  } catch (error) {
    console.error('Erreur approbation finale:', error);
  }
}

// Envoi message de bienvenue
async function sendWelcomeMessage(ctx, user) {
  try {
    const caption = `*${escapeMarkdown(user.first_name)}*,  félicitations Vous êtes sur le point de rejoindre un groupe d'élite réservé aux personnes ambitieuses et prêtes à réussir 💎


⚠️ *Action Requise* :Confirmez votre présence en rejoignant nos canaux pour finaliser votre adhésion et accéder à notre communauté privée 
⏳  Vous avez 10 minutes pour valider votre place exclusive dans le Club des Millionnaires
🚫 Après ce délai, votre demande sera annulée et votre place sera offerte à quelqu'un d'autre`;

    await ctx.telegram.sendVideo(user.id, VIDEO_URL, {
      caption: caption,
      parse_mode: 'MarkdownV2',
      reply_markup: generateButtons()
    });

  } catch (error) {
    if (error.code === 403) {
      console.log(`L'utilisateur ${user.first_name} a bloqué le bot`);
    } else {
      console.error('Erreur envoi message:', error);
    }
  }
}

// Génération des boutons
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
        { text: 'Notre Bot 🤖', url: process.env.BOT_URL }
      ]
    ]
  };
}

// Sécurité Markdown
function escapeMarkdown(text) {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

// Démarrage
async function start() {
  await connectDB();
  await bot.launch();
  console.log('🤖 Bot démarré avec succès');
}

start();

// Gestion des arrêts
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));









// Vérification des droits admin
function isAdmin(userId) {
  return ADMINS.includes(userId.toString());
}

// Commandes admin
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
    console.error('Erreur stats admin:', error);
    await ctx.reply('❌ Erreur lors de la récupération des statistiques');
  }
});

// Commande count
bot.command('count', async (ctx) => {
  try {
    const collection = db.collection(COLLECTION_NAME);
    const count = await collection.countDocuments();
    await ctx.reply(`👥 Nombre total d'utilisateurs: ${count}`);
  } catch (error) {
    console.error('Erreur count:', error);
    await ctx.reply('❌ Erreur lors du comptage des utilisateurs');
  }
});

// Gestion de l'envoi de messages
bot.command('send', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;

  if (!ctx.message.reply_to_message) {
    return ctx.reply('⚠️ Veuillez répondre à un message avec /send pour le diffuser');
  }

  const message = ctx.message.reply_to_message;
  const users = await db.collection(COLLECTION_NAME).find().toArray();
  let success = 0, errors = 0;

  await ctx.reply(`📤 Début de la diffusion à ${users.length} utilisateurs...`);

  for (const user of users) {
    try {
      if (message.text) {
        await ctx.telegram.sendMessage(user.telegram_id, message.text, {
          parse_mode: 'MarkdownV2'
        });
      } else if (message.photo) {
        await ctx.telegram.sendPhoto(user.telegram_id, message.photo[0].file_id, {
          caption: message.caption,
          parse_mode: 'MarkdownV2'
        });
      } else if (message.video) {
        await ctx.telegram.sendVideo(user.telegram_id, message.video.file_id, {
          caption: message.caption,
          parse_mode: 'MarkdownV2'
        });
      }
      success++;
    } catch (error) {
      if (error.code === 403) {
        await db.collection(COLLECTION_NAME).deleteOne({ telegram_id: user.telegram_id });
      }
      errors++;
    }
  }

  await ctx.reply(`✅ Diffusion terminée :
📨 Envoyés avec succès: ${success}
❌ Échecs: ${errors}`);
});

// ... (le reste du code existant reste inchangé)
