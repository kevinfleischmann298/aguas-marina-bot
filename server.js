// ============================================================
// AGUA MARINA BOT v2.0 - Plan Maestro (Nivel Empresarial)
// ============================================================
// Upgrades incluidos:
// 1. Rating Bypass (calificación sin IA)
// 2. PDFKit nativo (sin Puppeteer/Chrome para PDFs)
// 3. Soporte de Audios (transcripción con Gemini)
// 4. Prompt mejorado
// 5. Blindaje anti-crash total
// ============================================================

require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const path = require('path');

// --- SISTEMA DE LOGS EN ARCHIVO (Caja Negra) ---
const logFile = fs.createWriteStream(path.join(__dirname, 'bot_logs.txt'), { flags: 'a' });
const originalLog = console.log;
const originalError = console.error;
console.log = function(...args) {
    const msg = `[LOG] ${new Date().toISOString()} - ${args.join(' ')}\n`;
    logFile.write(msg);
    originalLog.apply(console, args);
};
console.error = function(...args) {
    const msg = `[ERR] ${new Date().toISOString()} - ${args.join(' ')}\n`;
    logFile.write(msg);
    originalError.apply(console, args);
};

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const { generarRemitoPDF } = require('./generar_pdf');

console.log("🚀 Iniciando Agua Marina Bot v2.0 (Plan Maestro)...");

// --- VARIABLES DE INICIO (para !status) ---
const BOT_START_TIME = Date.now();

// Link del JSON público que aloja GitHub Pages
const CATALOGO_URL = 'https://kevinfleischmann298.github.io/aguas-marina-dashboard/catalogo.json';

// --- SESIONES PERSISTENTES ---
const SESIONES_FILE = path.join(__dirname, 'sesiones.json');
let sesiones = {};
try {
    if (fs.existsSync(SESIONES_FILE)) {
        sesiones = JSON.parse(fs.readFileSync(SESIONES_FILE, 'utf8'));
        console.log(`💾 Sesiones cargadas: ${Object.keys(sesiones).length} chats recuperados.`);
    }
} catch(e) {
    console.error('Error cargando sesiones:', e);
}

function guardarSesiones() {
    try {
        fs.writeFileSync(SESIONES_FILE, JSON.stringify(sesiones, null, 2));
    } catch(e) {
        console.error('Error guardando sesiones:', e);
    }
}

let promptBase = '';
try {
    promptBase = fs.readFileSync('./prompt_agente.txt', 'utf-8');
} catch (e) {
    promptBase = "Eres el asistente virtual de Agua Marina.";
}

// --- CONFIGURACIÓN DE WHATSAPP-WEB.JS ---
const puppeteerOptions = {
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
};
if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    puppeteerOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
} else if (process.platform === 'linux') {
    puppeteerOptions.executablePath = '/usr/bin/google-chrome-stable';
}

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: puppeteerOptions
});

client.on('qr', (qr) => {
    console.log('\n======================================================');
    console.log('📱 ESCANEA ESTE CÓDIGO QR EN LA APP DE WHATSAPP:');
    console.log('======================================================\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('\n✅ ¡WHATSAPP VINCULADO CON ÉXITO!');
    console.log('🤖 Agua Marina Bot v2.0 operativo.');
});

// --- UPGRADE 5: RECONEXIÓN AUTOMÁTICA ---
client.on('disconnected', (reason) => {
    console.error(`⚠️ WhatsApp desconectado: ${reason}. Reintentando en 30 segundos...`);
    setTimeout(() => {
        console.log('🔄 Intentando reconexión...');
        client.initialize().catch(err => {
            console.error('Error reconectando:', err);
        });
    }, 30000);
});

// Caché global del catálogo
let cacheCatalogoReducido = '';
let lastFetchTime = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutos

// ============================================================
// HANDLER PRINCIPAL DE MENSAJES
// ============================================================
client.on('message_create', async (message) => {
    // --- UPGRADE 5: TRY/CATCH GLOBAL ---
    try {
        // Evitar estados y grupos
        if (message.from === 'status@broadcast' || message.from.includes('@g.us') || message.to.includes('@g.us')) return;

        const chatID = message.fromMe ? message.to : message.from;
        const body = message.body || '';
        
        // --- UPGRADE 3: SOPORTE DE AUDIOS ---
        // Ya no ignoramos los mensajes con media. Los audios se procesan abajo.
        const esAudio = message.hasMedia && (message.type === 'ptt' || message.type === 'audio');
        
        // Si tiene media pero NO es audio ni texto, ignorar (imágenes, stickers, etc.)
        if (message.hasMedia && !esAudio && message.type !== 'chat') return;
        
        // Si no hay body y no es audio, ignorar
        if (!body && !esAudio) return;

        // Inicializar memoria del chat si no existe
        const esNuevo = !sesiones[chatID];
        if (esNuevo) sesiones[chatID] = { carrito: [], historial: [], botActivo: true, lastBotResponse: '', esperandoCalificacion: false };

        // ========================
        // COMANDOS ESPECIALES
        // ========================
        
        if (body.toLowerCase() === '!ping') {
            await client.sendMessage(chatID, "pong 🏓");
            return;
        }

        if (body.toLowerCase() === '!logs') {
            try {
                const logsText = fs.readFileSync(path.join(__dirname, 'bot_logs.txt'), 'utf8');
                const lastLogs = logsText.substring(logsText.length - 3000);
                await client.sendMessage(chatID, `*Últimos logs del bot:*\n\`\`\`\n${lastLogs}\n\`\`\``);
            } catch(e) {
                await client.sendMessage(chatID, "Error leyendo logs.");
            }
            return;
        }

        // --- UPGRADE 5: COMANDO !STATUS ---
        if (body.toLowerCase() === '!status') {
            const uptimeMs = Date.now() - BOT_START_TIME;
            const uptimeMin = Math.floor(uptimeMs / 60000);
            const uptimeHrs = Math.floor(uptimeMin / 60);
            const memUsage = process.memoryUsage();
            const ramMB = (memUsage.rss / 1024 / 1024).toFixed(1);
            const heapMB = (memUsage.heapUsed / 1024 / 1024).toFixed(1);
            const sesionesActivas = Object.keys(sesiones).length;

            await client.sendMessage(chatID, 
                `📊 *Estado del Bot Agua Marina v2.0*\n\n` +
                `⏱️ Uptime: ${uptimeHrs}h ${uptimeMin % 60}m\n` +
                `💾 RAM usada: ${ramMB} MB\n` +
                `🧠 Heap: ${heapMB} MB\n` +
                `👥 Sesiones activas: ${sesionesActivas}\n` +
                `📦 Motor PDF: PDFKit (nativo)\n` +
                `🤖 IA: Gemini 2.5 Flash\n` +
                `🎙️ Audios: Habilitados`
            );
            return;
        }

        const sesion = sesiones[chatID];

        // ========================
        // UPGRADE 1: RATING BYPASS
        // ========================
        if (sesion.esperandoCalificacion) {
            console.log(`[RATING BYPASS] Procesando calificación manual para ${chatID}: ${body}`);
            const ratingMatch = body.match(/\d/);
            let ratingVal = ratingMatch ? parseInt(ratingMatch[0]) : 5;

            const dataObj = {
                cliente_id: chatID,
                rating: ratingVal,
                comentario: body,
                fecha: new Date().toISOString()
            };
            const filepath = path.join(__dirname, 'ratings.json');
            let fileData = [];
            try { if (fs.existsSync(filepath)) fileData = JSON.parse(fs.readFileSync(filepath, 'utf8')); } catch(e) {}
            fileData.push(dataObj);
            try { fs.writeFileSync(filepath, JSON.stringify(fileData, null, 2)); } catch(e) {}

            // Resetear TODO
            sesion.historial = [];
            sesion.carrito = [];
            sesion.esperandoCalificacion = false;
            guardarSesiones();

            await client.sendMessage(chatID, "¡Muchas gracias por tu calificación! 🌟 ¿En qué más te puedo ayudar hoy?");
            return;
        }

        // Limitar historial a los últimos 20 mensajes
        if (sesion.historial.length > 20) {
            sesion.historial = sesion.historial.slice(-20);
        }

        // --- LÓGICA DE MODO HUMANO ---
        if (message.fromMe) {
            const txt = body.trim().toLowerCase();
            if (txt === '!bot off') {
                sesion.botActivo = false;
                console.log(`🔴 Bot apagado manualmente para ${chatID}`);
            } else if (txt === '!bot on') {
                sesion.botActivo = true;
                console.log(`🟢 Bot reactivado para ${chatID}`);
            } else if (body !== sesion.lastBotResponse) {
                if (sesion.botActivo) {
                    sesion.botActivo = false;
                    console.log(`🔴 Auto-pausa activada: El humano intervino en la conversación con ${chatID}`);
                }
            }
            return;
        }

        if (!sesion.botActivo) return;

        console.log(`\nMensaje recibido de ${chatID}: ${esAudio ? '[AUDIO]' : body}`);

        // --- BIENVENIDA PARA CLIENTES NUEVOS ---
        if (esNuevo && !message.fromMe) {
            const bienvenida = `¡Hola! 👋 Soy el asistente de *Agua Marina*.
📦 Puedo ayudarte a armar tu pedido de productos de limpieza.
💰 Decime qué necesitás y te paso precios al instante.
🎙️ También podés mandarme un audio con tu pedido.
🕐 Entregas: Lunes a Sábados de 8 a 13hs.

¿En qué te puedo ayudar?`;
            sesion.lastBotResponse = bienvenida;
            guardarSesiones();
            await client.sendMessage(chatID, bienvenida);
            console.log(`🌟 Bienvenida enviada a nuevo cliente ${chatID}`);
            return;
        }

        // ========================
        // UPGRADE 3: TRANSCRIPCIÓN DE AUDIO
        // ========================
        let textoParaIA = body;
        
        if (esAudio) {
            try {
                console.log(`🎙️ Descargando audio de ${chatID}...`);
                const media = await message.downloadMedia();
                
                if (media && media.data) {
                    console.log(`🎙️ Audio descargado. Mimetype: ${media.mimetype}, Size: ${Math.round(media.data.length * 0.75 / 1024)}KB. Enviando a Gemini...`);
                    
                    // Enviar audio directamente a Gemini para transcripción
                    const transcriptionResponse = await axios.post(
                        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
                        {
                            contents: [{
                                role: "user",
                                parts: [
                                    {
                                        inlineData: {
                                            mimeType: media.mimetype || 'audio/ogg',
                                            data: media.data
                                        }
                                    },
                                    {
                                        text: "Transcribí este audio de voz de un cliente de una distribuidora de productos de limpieza. Devolvé SOLAMENTE el texto transcripto, sin comentarios ni explicaciones. Si no se entiende algo, poné [inaudible]."
                                    }
                                ]
                            }]
                        },
                        { headers: { "Content-Type": "application/json" }, timeout: 30000 }
                    );
                    
                    textoParaIA = transcriptionResponse.data.candidates[0].content.parts[0].text;
                    console.log(`🎙️ Transcripción exitosa: "${textoParaIA}"`);
                    
                    // Notificar al cliente que entendimos su audio
                    await client.sendMessage(chatID, `🎙️ _Entendido:_ "${textoParaIA}"\n\n_Procesando tu pedido..._`);
                } else {
                    await client.sendMessage(chatID, "No pude descargar el audio. ¿Podrías escribirme el pedido por texto?");
                    return;
                }
            } catch (audioError) {
                console.error("Error transcribiendo audio:", audioError.message);
                await client.sendMessage(chatID, "No pude procesar el audio en este momento. ¿Podrías escribirme el pedido por texto? 🙏");
                return;
            }
        }

        // --- COMANDO REPETIR ---
        const bodyLower = textoParaIA.trim().toLowerCase();
        if (bodyLower === 'repetir' || bodyLower === 'mismo pedido' || bodyLower === 'lo de siempre' || bodyLower === 'lo mismo') {
            try {
                const pedidosFile = path.join(__dirname, 'pedidos.json');
                if (fs.existsSync(pedidosFile)) {
                    const pedidos = JSON.parse(fs.readFileSync(pedidosFile, 'utf8'));
                    const ultimoPedido = [...pedidos].reverse().find(p => p.cliente_id === chatID || p.cliente_id?.includes(chatID.replace('@c.us', '')));
                    if (ultimoPedido) {
                        sesion.historial.push({ role: "user", content: `Quiero repetir mi último pedido. Los productos eran: ${JSON.stringify(ultimoPedido.productos)}. Total anterior: $${ultimoPedido.total}. Confirmámelo por favor.` });
                    } else {
                        await client.sendMessage(chatID, 'No encontré pedidos anteriores tuyos. ¿Qué te gustaría pedir?');
                        guardarSesiones();
                        return;
                    }
                } else {
                    await client.sendMessage(chatID, 'Todavía no tenés pedidos anteriores. ¿Qué te gustaría pedir?');
                    guardarSesiones();
                    return;
                }
            } catch(e) {
                console.error('Error buscando pedido anterior:', e);
            }
        } else {
            sesion.historial.push({ role: "user", content: textoParaIA });
        }

        // ========================
        // LLAMADA A LA IA
        // ========================
        try {
            // OBTENER CATÁLOGO CON CACHÉ
            if (Date.now() - lastFetchTime > CACHE_TTL || !cacheCatalogoReducido) {
                try {
                    console.log("Descargando catálogo fresco desde GitHub...");
                    const res = await axios.get(CATALOGO_URL);
                    const catalogoActual = res.data;

                    const lineasCatalogo = catalogoActual.map(p => {
                        return `Cod:${p.codigo || '-'} | ${p.nombre} | ${p.presentacion || '-'} | May:$${p.precio_mayorista} | Min:$${p.precio_minorista} | Stock:${p.sin_stock ? 'NO' : 'SI'}`;
                    });
                    cacheCatalogoReducido = lineasCatalogo.join('\n');
                    lastFetchTime = Date.now();
                } catch(e) {
                    console.error("Error obteniendo catálogo. Usando caché anterior si existe.");
                }
            }

            let aiResponse = "";

            if (process.env.GEMINI_API_KEY) {
                const googleContents = sesion.historial.map(m => ({
                    role: m.role === "assistant" ? "model" : "user",
                    parts: [{ text: m.content }]
                }));

                const systemPrompt = `${promptBase}

[IMPORTANTE - INFO DEL CLIENTE ACTUAL]
El ID (número de teléfono) de este cliente es: "${chatID.replace('@c.us', '')}". 
DEBES usar este número exacto en todos los campos "cliente_id" de los JSON. ¡NO uses el número del ejemplo!

CATÁLOGO ACTUALIZADO EN VIVO:
${cacheCatalogoReducido}

CARRITO ACTUAL:
${JSON.stringify(sesion.carrito)}`;

                const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
                    contents: googleContents,
                    systemInstruction: {
                        role: "system",
                        parts: [{ text: systemPrompt }]
                    },
                    generationConfig: {
                        temperature: 0.3
                    }
                }, {
                    headers: { "Content-Type": "application/json" },
                    timeout: 60000
                });
                aiResponse = response.data.candidates[0].content.parts[0].text;
            } else if (process.env.OPENROUTER_API_KEY) {
                const openaiMessages = [
                    {
                        role: "system",
                        content: `${promptBase}\n\nCATÁLOGO ACTUALIZADO EN VIVO:\n${cacheCatalogoReducido}\n\nCARRITO ACTUAL:\n${JSON.stringify(sesion.carrito)}`
                    },
                    ...sesion.historial
                ];
                const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
                    model: "google/gemini-2.5-flash",
                    messages: openaiMessages,
                    temperature: 0.3
                }, {
                    headers: {
                        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                        "Content-Type": "application/json"
                    },
                    timeout: 60000
                });
                aiResponse = response.data.choices[0].message.content;
            } else {
                aiResponse = "⚠️ Faltan las credenciales de Gemini (Variable de entorno GEMINI_API_KEY en Easypanel).";
            }

            // ========================
            // PROCESAMIENTO DE RESPUESTA
            // ========================
            let mensajeFinal = aiResponse;

            console.log(`\n📝 RESPUESTA DE LA IA (${chatID}):`);
            console.log(aiResponse.substring(0, 500));

            // Función para extraer, guardar y limpiar JSONs ocultos
            const extractAndSave = (tagOpen, tagClose, filename) => {
                const regex = new RegExp(`\\[${tagOpen}\\]([\\s\\S]*?)\\[\\/${tagClose}\\]`, 'gi');
                let matches = [...mensajeFinal.matchAll(regex)];
                matches.forEach(matchData => {
                    if (matchData && matchData[1]) {
                        try {
                            const dataObj = JSON.parse(matchData[1].trim());
                            mensajeFinal = mensajeFinal.replace(matchData[0], '').trim();
                            const filepath = path.join(__dirname, filename);
                            let fileData = [];
                            if (fs.existsSync(filepath)) {
                                try { fileData = JSON.parse(fs.readFileSync(filepath, 'utf8')); } catch(e) {}
                            }
                            fileData.push(dataObj);
                            fs.writeFileSync(filepath, JSON.stringify(fileData, null, 2));
                            console.log(`✅ Guardado ${tagOpen} en ${filename}`);
                        } catch(e) {
                            console.error(`Error parseando ${tagOpen}:`, e);
                        }
                    }
                });
            };

            extractAndSave('PEDIDO_DATA', 'PEDIDO_DATA', 'pedidos.json');
            extractAndSave('RATING_DATA', 'RATING_DATA', 'ratings.json');
            extractAndSave('CLIENTE_CALIDAD_DATA', 'CLIENTE_CALIDAD_DATA', 'clientes_calidad.json');

            // ========================
            // DETECCIÓN Y GENERACIÓN DE REMITOS PDF
            // ========================
            let remitoMatches = [...mensajeFinal.matchAll(/\[REMITO_JSON\]([\s\S]*?)\[\/REMITO_JSON\]/gi)];

            // Respaldo: bloques de código markdown
            if (remitoMatches.length === 0) {
                let altMatch = mensajeFinal.match(/```(?:json)?\s*(\{[\s\S]*?"productos"[\s\S]*?\})\s*```/i);
                if (altMatch) remitoMatches = [altMatch];
            }
            // Respaldo: JSON crudo al final
            if (remitoMatches.length === 0) {
                let altMatch = mensajeFinal.match(/(?:json|JSON)?\s*(\{[\s\S]*?"productos"[\s\S]*?"total"[\s\S]*?\})\s*$/i);
                if (altMatch) remitoMatches = [altMatch];
            }

            console.log(`📊 Remitos encontrados: ${remitoMatches.length}`);

            if (remitoMatches.length > 0) {
                // Eliminar etiquetas JSON del mensaje visible
                for (const match of remitoMatches) {
                    if (match && match[0]) {
                        mensajeFinal = mensajeFinal.replace(match[0], '').trim();
                    }
                }

                if (mensajeFinal) {
                    sesion.historial.push({ role: "assistant", content: mensajeFinal });
                    sesion.lastBotResponse = mensajeFinal;
                    await client.sendMessage(chatID, mensajeFinal);
                } else {
                    sesion.historial.push({ role: "assistant", content: "[Remito generado y enviado al cliente en formato PDF]" });
                }

                // Generar PDFs con PDFKit (UPGRADE 2)
                for (const match of remitoMatches) {
                    if (match && match[1]) {
                        try {
                            const remitoData = JSON.parse(match[1].trim());
                            console.log(`📄 Generando PDF con PDFKit para ${remitoData.nombre}...`);

                            const pdfPath = await generarRemitoPDF(remitoData);
                            const media = MessageMedia.fromFilePath(pdfPath);
                            await client.sendMessage(chatID, media, { caption: `📄 Remito oficial` });

                            // Limpiar archivo temporal
                            try { fs.unlinkSync(pdfPath); } catch(e) {}
                            console.log(`✅ PDF enviado exitosamente para ${remitoData.nombre}`);

                        } catch(e) {
                            console.error("Error generando PDF:", e);
                            await client.sendMessage(chatID, `⚠️ Hubo un error generando el PDF. Tu pedido está confirmado de todas formas. Error: ${e.message}`);
                        }
                    }
                }

                // Limpiar carrito y activar Rating Bypass
                sesion.carrito = [];
                sesion.esperandoCalificacion = true;
                guardarSesiones();
                console.log(`🧹 Carrito limpiado para ${chatID}. Modo espera de calificación activado.`);

            } else {
                // Sin remito: comportamiento normal
                mensajeFinal = mensajeFinal.trim();

                if (mensajeFinal === "") {
                    mensajeFinal = "¡Listo! ¿Te puedo ayudar con algo más?";
                }

                sesion.historial.push({ role: "assistant", content: mensajeFinal });

                if (sesion.historial.length > 40) {
                    sesion.historial = sesion.historial.slice(sesion.historial.length - 40);
                }

                sesion.lastBotResponse = mensajeFinal;
                await client.sendMessage(chatID, mensajeFinal);
                guardarSesiones();
                console.log(`🤖 Respondido a ${chatID}`);
            }

        } catch (aiError) {
            console.error("Error en llamada a IA:", aiError.message);

            let debugInfo = aiError.message;
            if (aiError.response && aiError.response.data) {
                debugInfo = JSON.stringify(aiError.response.data, null, 2);
            }
            if (debugInfo.length > 800) {
                debugInfo = debugInfo.substring(0, 800) + "... [truncado]";
            }

            try {
                await client.sendMessage(chatID, `Disculpa, estoy experimentando problemas técnicos temporales. ¿Podrías intentar de nuevo en unos segundos?\n\n*DEBUG:*\n\`\`\`\n${debugInfo}\n\`\`\``);
            } catch (sendError) {
                console.error("Error crítico enviando fallback:", sendError);
            }
        }

    } catch (globalError) {
        // UPGRADE 5: CATCH GLOBAL - El bot NUNCA se cuelga
        console.error("💀 ERROR GLOBAL CAPTURADO:", globalError);
        try {
            const chatID = message.fromMe ? message.to : message.from;
            if (chatID) {
                await client.sendMessage(chatID, "Disculpa, tuve un error inesperado. ¿Podrías repetir tu mensaje? 🙏");
            }
        } catch(e) {
            console.error("Error en catch global al intentar notificar:", e);
        }
    }
// --- FIX CHROME LOCK (Evita crashear al hacer Deploy en Easypanel) ---
const authDir = path.join(__dirname, '.wwebjs_auth');
if (fs.existsSync(authDir)) {
    const lockFiles = [
        path.join(authDir, 'session', 'SingletonLock'),
        path.join(authDir, 'session', 'SingletonCookie'),
        path.join(authDir, 'session', 'Default', 'SingletonLock'),
        path.join(authDir, 'session', 'Default', 'SingletonCookie')
    ];
    lockFiles.forEach(file => {
        try { if (fs.existsSync(file)) fs.unlinkSync(file); console.log('🧹 Archivo Lock de Chrome eliminado:', file); } catch(e) {}
    });
}

client.initialize();

// ============================================================
// EXPRESS API PARA DASHBOARD
// ============================================================
const app = express();

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

const getJsonFile = (filename) => {
    const filepath = path.join(__dirname, filename);
    if (fs.existsSync(filepath)) {
        try { return JSON.parse(fs.readFileSync(filepath, 'utf8')); } catch(e) {}
    }
    return [];
};

app.get('/api/pedidos', (req, res) => res.json(getJsonFile('pedidos.json')));
app.get('/api/ratings', (req, res) => res.json(getJsonFile('ratings.json')));
app.get('/api/clientes_calidad', (req, res) => res.json(getJsonFile('clientes_calidad.json')));

// Endpoint de health check
app.get('/api/status', (req, res) => {
    const uptimeMs = Date.now() - BOT_START_TIME;
    const memUsage = process.memoryUsage();
    res.json({
        status: 'online',
        version: '2.0',
        uptime_minutes: Math.floor(uptimeMs / 60000),
        ram_mb: (memUsage.rss / 1024 / 1024).toFixed(1),
        sesiones_activas: Object.keys(sesiones).length
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 API interna escuchando en el puerto ${PORT}`);
});
