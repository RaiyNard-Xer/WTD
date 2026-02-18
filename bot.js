// =========================
// IMPORTS
// =========================
const { Client: WhatsAppClient, LocalAuth } = require("whatsapp-web.js");
const { Client: DiscordClient, GatewayIntentBits } = require("discord.js");
const qrcode = require("qrcode-terminal");
const puppeteer = require("puppeteer");

// =========================
/* CONFIG À REMPLACER */
// =========================
const DISCORD_TOKEN = "Ton token";
const DISCORD_CHANNEL_ID = "id chanelle discord";

// =========================
// VARIABLES GLOBALES
// =========================
let whatsappReady = false;
let groupsCache = [];
let TARGET_GROUP_ID = null;

// =========================
// DISCORD CLIENT
// =========================
const discord = new DiscordClient({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

discord.once("clientReady", () => {
    console.log("✅ Discord connecté :", discord.user.tag);
});

// =========================
// WHATSAPP CLIENT
// =========================
const whatsapp = new WhatsAppClient({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: puppeteer.executablePath(),
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
    }
});

// QR CODE DANS LES LOGS
whatsapp.on("qr", qr => {
    console.log("\n📱 Scanne ce QR code pour connecter WhatsApp :\n");
    qrcode.generate(qr, { small: true });
    console.log("\n⚠️ Si le QR est illisible, agrandis ton terminal.\n");
});

// WHATSAPP PRÊT
whatsapp.on("ready", () => {
    whatsappReady = true;
    console.log("📱 WhatsApp connecté !");
});

// =========================
// COMMANDES DISCORD
// =========================
discord.on("messageCreate", async message => {
    if (message.author.bot) return;
    if (message.channel.id !== DISCORD_CHANNEL_ID) return;

    // ----------------------------
    // !groupes → liste les groupes
    // ----------------------------
    if (message.content === "!groupes") {

        if (!whatsappReady) {
            return message.reply("❌ WhatsApp n'est pas encore connecté.");
        }

        try {
            const chats = await whatsapp.getChats();
            groupsCache = chats.filter(c => c.isGroup);

            if (groupsCache.length === 0) {
                return message.reply("❌ Aucun groupe WhatsApp trouvé.");
            }

            let txt = "📋 **Liste des groupes WhatsApp :**\n\n";
            groupsCache.forEach((g, i) => {
                txt += `**${i + 1}** — ${g.name}\n`;
            });

            txt += "\n➡️ Utilise : `!select <numéro>` pour choisir un groupe.";

            return message.reply(txt);

        } catch (err) {
            console.error("Erreur !groupes :", err);
            return message.reply("❌ Impossible de récupérer les groupes WhatsApp.");
        }
    }

    // ----------------------------
    // !select X → choisir un groupe
    // ----------------------------
    if (message.content.startsWith("!select")) {

        if (!whatsappReady) {
            return message.reply("❌ WhatsApp n'est pas encore connecté.");
        }

        const parts = message.content.split(" ");
        const index = parseInt(parts[1]) - 1;

        if (isNaN(index)) {
            return message.reply("❌ Utilisation : `!select <numéro>`");
        }

        if (!groupsCache[index]) {
            return message.reply("❌ Numéro invalide. Tape `!groupes` pour voir la liste.");
        }

        TARGET_GROUP_ID = groupsCache[index].id._serialized;

        return message.reply(`✅ Groupe sélectionné : **${groupsCache[index].name}**`);
    }

    // ----------------------------
    // Envoi Discord → WhatsApp
    // ----------------------------
    if (TARGET_GROUP_ID) {
        const pseudo = message.member?.nickname || message.author.username;
        await whatsapp.sendMessage(
            TARGET_GROUP_ID,
            `[Discord | ${pseudo}] ${message.content}`
        );
    }
});

// =========================
// WHATSAPP → DISCORD
// =========================
whatsapp.on("message", async msg => {
    const channel = await discord.channels.fetch(DISCORD_CHANNEL_ID).catch(() => null);
    if (!channel) return;

    const chat = await msg.getChat();
    let senderName = "Inconnu";

    if (msg.fromMe) {
        senderName = "Moi";
    } else {
        const contact = await msg.getContact();
        senderName =
            contact.pushname ||
            contact.verifiedName ||
            contact.name ||
            contact.number;
    }

    channel.send(`📩 **WhatsApp | ${senderName} :** ${msg.body}`);
});

// =========================
// LANCEMENT
// =========================
(async () => {
    try {
        await discord.login(DISCORD_TOKEN);
        await whatsapp.initialize();
    } catch (err) {
        console.error("❌ Erreur :", err);
    }
})();