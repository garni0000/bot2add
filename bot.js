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
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// --- Fonctions utilitaires ---
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeMarkdown(text) {
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
    // Envoi d'un message de bienvenue après 5 secondes
    setTimeout(() => sendWelcomeMessage(ctx, user), 5000);
    // Approbation finale après 10 minutes
    setTimeout(() => handleUserApproval(ctx, user, chat), 600000);
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

// --- Commandes Bot ---

// Commande Admin pour afficher les statistiques
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

// Commande pour compter le nombre total d’utilisateurs
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

/* 
  Commande /send :
  - L'admin doit répondre à un message (de n'importe quel type) avec /send.
  - Le bot répond avec un bouton inline pour confirmer la diffusion.
  - Lors du clic sur le bouton, le bot copie le message initial à tous les utilisateurs enregistrés.
*/
bot.command('send', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;

  const replyMsg = ctx.message.reply_to_message;
  if (!replyMsg) {
    return ctx.reply('⚠️ Veuillez répondre à un message avec /send pour le diffuser.');
  }

  // On prépare les données à diffuser : on récupère le chat_id et le message_id du message original
  const fromChatId = replyMsg.chat.id;
  const messageId = replyMsg.message_id;

  // On envoie un message de confirmation avec un bouton inline
  await ctx.reply(
    '⚠️ Confirmez la diffusion du message à tous les utilisateurs',
    Markup.inlineKeyboard([
      Markup.button.callback('Confirmer la diffusion', `broadcast:${fromChatId}:${messageId}`)
    ])
  );
});

// Gestion du callback pour la confirmation de diffusion
bot.on('callback_query', async (ctx) => {
  const callbackData = ctx.callbackQuery.data;
  if (!callbackData.startsWith('broadcast:')) return;
  
  // Extraction des informations du callback (format: broadcast:fromChatId:messageId)
  const parts = callbackData.split(':');
  if (parts.length !== 3) return;
  const fromChatId = parseInt(parts[1]);
  const messageId = parseInt(parts[2]);
  
  // Vérification que l'utilisateur qui confirme est bien admin
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery('Vous n\'êtes pas autorisé à effectuer cette action.', { show_alert: true });
  }
  
  await ctx.answerCbQuery('Diffusion lancée');
  
  try {
    const collection = db.collection(COLLECTION_NAME);
    const users = await collection.find().toArray();
    let success = 0;
    let errors = 0;
    const batchSize = 100;
    
    await ctx.reply(`📤 Début de la diffusion à ${users.length} utilisateurs...`);
    
    // Parcours des utilisateurs par batch
    for (let i = 0; i < users.length; i += batchSize) {
      const batch = users.slice(i, i + batchSize);
      await Promise.all(batch.map(async (user) => {
        try {
          // Utilisation de copyMessage pour envoyer le même type de message
          await ctx.telegram.copyMessage(user.telegram_id, fromChatId, messageId, {
            parse_mode: 'MarkdownV2'
          });
          success++;
        } catch (error) {
          if (error.code === 403) {
            await collection.deleteOne({ telegram_id: user.telegram_id });
          }
          errors++;
        }
      }));
      await sleep(1000); // Pause entre chaque batch
    }
    
    await ctx.reply(`✅ Diffusion terminée :
📨 Envoyés avec succès : ${success}
❌ Échecs : ${errors}`);
    
  } catch (error) {
    console.error('Erreur lors de la diffusion:', error);
    await ctx.reply('❌ Erreur lors de la diffusion des messages.');
  }
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
