// ================= IMPORTS =================
require("dotenv").config();
const { Client: WhatsAppClient, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const qrcode = require("qrcode-terminal");
const puppeteer = require("puppeteer");
const fetch = require("node-fetch");
const fs = require("fs");

// ================= CONFIG =================
const DISCORD_TOKEN = "TON_TOKEN";
const DISCORD_CHANNEL_ID = "TON_ID_SALON";
const DATA_FILE = "./accepted.json";

const CONDITIONS = `
🟢 **Conditions de l’interface WhatsApp**
Merci de respecter les règles suivantes :
- Pas de spam (1 msg / 3s)
- Uniquement pour l'école
- Pas d'insultes ni de contenu illégal

👉 Tape **!accepte** pour continuer.
`;

// ================= GLOBALS & HELPERS =================
let TARGET_GROUP_ID = null;
let groupsCache = [];
let whatsappReady = false;
let lastMsg = {};

function loadAccepted() {
    if (!fs.existsSync(DATA_FILE)) return {};
    return JSON.parse(fs.readFileSync(DATA_FILE, { encoding: "utf8" }));
}
function saveAccepted(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), { encoding: "utf8" });
}
function canSend(id) {
    const now = Date.now();
    if (!lastMsg[id] || now - lastMsg[id] > 3000) {
        lastMsg[id] = now; return true;
    }
    return false;
}

// ================= DISCORD CLIENT =================
const discord = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildWebhooks
    ]
});

discord.once("ready", () => console.log("✅ Discord connecté :", discord.user.tag));

// ================= WHATSAPP CLIENT =================
const whatsapp = new WhatsAppClient({
    authStrategy: new LocalAuth(),
    puppeteer: { 
        headless: true, 
        args: ["--no-sandbox", "--disable-setuid-sandbox"] 
    }
});

whatsapp.on("qr", qr => qrcode.generate(qr, { small: true }));
whatsapp.on("ready", () => { 
    whatsappReady = true; 
    console.log("✅ WhatsApp connecté !"); 
});

// ================= DISCORD ➡ WHATSAPP =================
discord.on("messageCreate", async message => {
    if (message.author.bot || message.channel.id !== DISCORD_CHANNEL_ID) return;

    const accepted = loadAccepted();

    if (message.content === "!accepte") {
        accepted[message.author.id] = true;
        saveAccepted(accepted);
        return message.reply("✅ Conditions acceptées !");
    }

    if (message.content === "!groupes") {
        if (!whatsappReady) return message.reply("⏳ WhatsApp pas prêt...");
        const chats = await whatsapp.getChats();
        groupsCache = chats.filter(c => c.isGroup);
        let txt = "📱 **Groupes WhatsApp:**\n" + groupsCache.map((g, i) => `${i + 1} - ${g.name}`).join("\n");
        return message.reply(txt + "\n\nTape `!select X` pour choisir.");
    }

    if (message.content.startsWith("!select")) {
        const i = parseInt(message.content.split(" ")[1], 10) - 1;
        if (!groupsCache[i]) return message.reply("❌ Mauvais numéro.");
        TARGET_GROUP_ID = groupsCache[i].id._serialized;
        return message.reply(`✅ Connecté à : **${groupsCache[i].name}**`);
    }

    if (!accepted[message.author.id]) return message.reply(CONDITIONS);
    if (!canSend(message.author.id) || !TARGET_GROUP_ID) return;

    const pseudo = message.member?.nickname || message.author.globalName || message.author.username;
    let content = message.content;

    // Traduction mentions Discord
    for (const [id, user] of message.mentions.users) {
        content = content.replace(new RegExp(`<@!?${id}>`, "g"), `@${user.username}`);
    }

    // Gestion réponse (Quotes)
    if (message.reference) {
        const ref = await message.channel.messages.fetch(message.reference.messageId);
        const refName = ref.member?.nickname || ref.author.globalName || ref.author.username;
        content = `> ${refName}: ${ref.content.replace(/\n/g, '\n> ')}\n\n${content}`;
    }

    const signature = `*[Discord | ${pseudo}]*`;
    
    if (message.attachments.size > 0) {
        const file = message.attachments.first();
        const buffer = await fetch(file.url).then(r => r.arrayBuffer());
        const media = new MessageMedia(file.contentType, Buffer.from(buffer).toString("base64"), file.name);
        await whatsapp.sendMessage(TARGET_GROUP_ID, media, { caption: `${signature}\n${content}` });
    } else {
        await whatsapp.sendMessage(TARGET_GROUP_ID, `${signature} ${content}`);
    }
});

// ================= WHATSAPP ➡ DISCORD (WEBHOOK + DESIGN) =================
whatsapp.on("message", async msg => {
    if (!TARGET_GROUP_ID || msg.from !== TARGET_GROUP_ID) return;
    
    const accepted = loadAccepted();
    if (!accepted["whatsapp"]) return;

    const channel = await discord.channels.fetch(DISCORD_CHANNEL_ID);
    if (!channel) return;

    // 1. Setup Webhook
    let webhooks = await channel.fetchWebhooks();
    let webhook = webhooks.find(wh => wh.owner.id === discord.user.id) || await channel.createWebhook({ name: 'Bridge WA' });

    // 2. Infos Expéditeur
    const contact = await msg.getContact();
    const senderName = contact.pushname || contact.name || contact.number;
    const profilePic = await contact.getProfilePicUrl();
    const waIcon = "https://i.imgur.com/v8pmi9V.png";

    // 3. Nettoyage du corps du message (Mentions @numéro -> @Nom)
    let body = msg.body || "";
    if (msg.mentionedIds) {
        for (const jid of msg.mentionedIds) {
            const mContact = await whatsapp.getContactById(jid);
            const mName = mContact.pushname || mContact.name || mContact.number;
            body = body.replace(new RegExp(`@${jid.split('@')[0]}`, 'g'), `**@${mName}**`);
        }
    }

    // 4. Construction de l'Embed
    const embed = new EmbedBuilder()
        .setColor(0x25D366) // Vert WhatsApp
        .setDescription(body || "*Fichier média*")
        .setTimestamp()
        .setFooter({ text: "WhatsApp", iconURL: waIcon });

    // 5. Gestion intelligente des Réponses
    if (msg.hasQuotedMsg) {
        const q = await msg.getQuotedMessage();
        let qAuthor = "Inconnu";
        let qText = q.body || "";

        // Si on répond à un msg Discord
        if (q.body.includes("[Discord |")) {
            const match = q.body.match(/\[Discord \| (.*?)\]/);
            qAuthor = match ? match[1] : "Membre Discord";
            qText = q.body.split(']').slice(1).join(']').trim();
        } else {
            const qContact = await q.getContact();
            qAuthor = qContact.pushname || qContact.name;
        }

        embed.addFields({ 
            name: `↩️ Réponse à ${qAuthor}`, 
            value: qText.length > 100 ? qText.substring(0, 100) + "..." : qText || "Média"
        });
    }

    // 6. Envoi final
    const sendOptions = {
        username: `📱 ${senderName}`,
        avatarURL: profilePic || waIcon,
        embeds: [embed],
        files: []
    };

    if (msg.hasMedia) {
        const media = await msg.downloadMedia();
        if (media) {
            const buffer = Buffer.from(media.data, "base64");
            const isAudio = media.mimetype.startsWith("audio");
            const fileName = isAudio ? "vocal.ogg" : "fichier";
            
            sendOptions.files.push({ attachment: buffer, name: fileName });
            if (media.mimetype.startsWith("image")) embed.setImage(`attachment://${fileName}`);
        }
    }

    await webhook.send(sendOptions);
});

// ================= START =================
(async () => {
    await discord.login(DISCORD_TOKEN);
    await whatsapp.initialize();
})();
