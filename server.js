// ============================================================
//  🌊 AGUA MARINA — BOT ENTERPRISE SWARM v3.0
// ============================================================
//  El bot de WhatsApp más avanzado del mercado argentino.
//  4 Cerebros de IA | Enjambre Multi-Agente | Ciberseguridad
//  RAG Vectorial | Function Calling | Generación Dual PDF+IMG
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

// --- MÓDULOS DEL MONSTRUO ---
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const { generarRemitoPDF } = require('./generar_pdf');
const { generarRemitoImagen } = require('./generar_imagen');
const { checkRateLimit } = require('./rate_limiter');
const { sanitizeInput, validateRemito } = require('./sanitizer');
const { agenteOidos, agenteOjos, agenteRecepcionista, agenteVendedor } = require('./swarm_router');
const supabase = require('./supabase_client');

console.log("🌊 Iniciando Agua Marina Bot Enterprise Swarm v3.0...");
console.log(`📦 Módulos cargados: PDFKit, Imagen, RateLimiter, Sanitizer, Swarm(4 IAs), Supabase`);

// --- VARIABLES DE INICIO ---
const BOT_START_TIME = Date.now();
const BOT_VERSION = '3.0 Enterprise Swarm';

// --- CREDENCIALES ---
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
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

// --- GUARDAR EN JSON LOCAL (Fallback si no hay Supabase) ---
function guardarEnJSON(filename, dataObj) {
    try {
        const filepath = path.join(__dirname, filename);
        let fileData = [];
        if (fs.existsSync(filepath)) {
            try { fileData = JSON.parse(fs.readFileSync(filepath, 'utf8')); } catch(e) {}
        }
        fileData.push(dataObj);
        fs.writeFileSync(filepath, JSON.stringify(fileData, null, 2));
    } catch(e) {
        console.error(`Error guardando en ${filename}:`, e);
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
    console.log(`🌊 Agua Marina Bot ${BOT_VERSION} — OPERATIVO`);
    console.log(`🧠 Enjambre: Oídos(Gemini) + Ojos(Gemini) + Recepcionista(Llama3) + Vendedor(Claude/Gemini)`);
    console.log(`🛡️ Ciberseguridad: RateLimiter + Sanitizer + Validador de Remitos`);
    console.log(`🗄️ Base de datos: ${supabase.isConfigured() ? 'Supabase (PostgreSQL)' : 'JSON local (fallback)'}`);
});

// --- RECONEXIÓN AUTOMÁTICA ---
client.on('disconnected', (reason) => {
    console.error(`⚠️ WhatsApp desconectado: ${reason}. Reintentando en 30 segundos...`);
    setTimeout(() => {
        console.log('🔄 Intentando reconexión...');
        client.initialize().catch(err => {
            console.error('Error reconectando:', err);
        });
    }, 30000);
});

// --- CACHÉ DEL CATÁLOGO ---
let cacheCatalogoReducido = '';
let lastFetchTime = 0;
const CACHE_TTL = 30 * 60 * 1000;

// ============================================================
//  🧠 HANDLER PRINCIPAL — ENJAMBRE MULTI-AGENTE
// ============================================================
client.on('message_create', async (message) => {
    try {
        // --- Filtros básicos ---
        if (message.from === 'status@broadcast' || message.from.includes('@g.us') || message.to.includes('@g.us')) return;

        const chatID = message.fromMe ? message.to : message.from;
        const body = message.body || '';

        // --- Detectar tipo de media ---
        const esAudio = message.hasMedia && (message.type === 'ptt' || message.type === 'audio');
        const esImagen = message.hasMedia && (message.type === 'image' || message.type === 'sticker');

        // Si tiene media pero no es audio ni imagen ni texto, ignorar
        if (message.hasMedia && !esAudio && !esImagen && message.type !== 'chat') return;
        if (!body && !esAudio && !esImagen) return;

        // --- Inicializar sesión ---
        const esNuevo = !sesiones[chatID];
        if (esNuevo) {
            sesiones[chatID] = {
                carrito: [],
                historial: [],
                botActivo: true,
                lastBotResponse: '',
                esperandoCalificacion: false
            };
        }

        // ========================
        // 🛡️ CIBERSEGURIDAD: RATE LIMITING
        // ========================
        const rateCheck = checkRateLimit(chatID);
        if (!rateCheck.allowed) {
            console.log(`🚫 [RATE LIMIT] Mensaje bloqueado de ${chatID}: ${rateCheck.reason}`);
            return; // Ignorar silenciosamente
        }

        // ========================
        // ⚡ COMANDOS ESPECIALES
        // ========================
        if (body.toLowerCase() === '!ping') {
            await client.sendMessage(chatID, "pong 🏓 (Enterprise Swarm v3.0)");
            return;
        }

        if (body.toLowerCase() === '!logs') {
            try {
                const logsText = fs.readFileSync(path.join(__dirname, 'bot_logs.txt'), 'utf8');
                const lastLogs = logsText.substring(logsText.length - 3000);
                await client.sendMessage(chatID, `*Últimos logs:*\n\`\`\`\n${lastLogs}\n\`\`\``);
            } catch(e) {
                await client.sendMessage(chatID, "Error leyendo logs.");
            }
            return;
        }

        if (body.toLowerCase() === '!status') {
            const uptimeMs = Date.now() - BOT_START_TIME;
            const uptimeMin = Math.floor(uptimeMs / 60000);
            const uptimeHrs = Math.floor(uptimeMin / 60);
            const memUsage = process.memoryUsage();
            const ramMB = (memUsage.rss / 1024 / 1024).toFixed(1);
            const heapMB = (memUsage.heapUsed / 1024 / 1024).toFixed(1);

            await client.sendMessage(chatID,
                `📊 *Estado — Agua Marina ${BOT_VERSION}*\n\n` +
                `⏱️ Uptime: ${uptimeHrs}h ${uptimeMin % 60}m\n` +
                `💾 RAM: ${ramMB} MB | Heap: ${heapMB} MB\n` +
                `👥 Sesiones: ${Object.keys(sesiones).length}\n` +
                `🧠 Enjambre: 4 Agentes IA\n` +
                `  🎙️ Oídos: Gemini Flash\n` +
                `  👁️ Ojos: Gemini Flash\n` +
                `  🚪 Recepcionista: ${OPENROUTER_KEY ? 'Llama 3' : 'Gemini (fallback)'}\n` +
                `  💼 Vendedor: ${OPENROUTER_KEY ? 'Claude 3.5 Sonnet' : 'Gemini (fallback)'}\n` +
                `🗄️ DB: ${supabase.isConfigured() ? 'Supabase' : 'JSON local'}\n` +
                `🛡️ Seguridad: RateLimiter + Sanitizer\n` +
                `📄 PDF: PDFKit | 🖼️ Vista: Imagen`
            );
            return;
        }

        const sesion = sesiones[chatID];

        // ========================
        // ⭐ RATING BYPASS (Sistema Híbrido)
        // ========================
        if (sesion.esperandoCalificacion) {
            console.log(`[RATING BYPASS] Calificación de ${chatID}: ${body}`);
            const ratingMatch = body.match(/\d/);
            let ratingVal = ratingMatch ? parseInt(ratingMatch[0]) : 5;

            const dataObj = {
                cliente_id: chatID,
                rating: ratingVal,
                comentario: body,
                fecha: new Date().toISOString()
            };

            // Guardar en Supabase O en JSON local
            if (supabase.isConfigured()) {
                await supabase.guardarRating(dataObj);
            }
            guardarEnJSON('ratings.json', dataObj); // Siempre guardar backup local

            sesion.historial = [];
            sesion.carrito = [];
            sesion.esperandoCalificacion = false;
            guardarSesiones();

            await client.sendMessage(chatID, "¡Muchas gracias por tu calificación! 🌟 ¿En qué más te puedo ayudar hoy?");
            return;
        }

        // Limitar historial
        if (sesion.historial.length > 20) {
            sesion.historial = sesion.historial.slice(-20);
        }

        // --- MODO HUMANO ---
        if (message.fromMe) {
            const txt = body.trim().toLowerCase();
            if (txt === '!bot off') {
                sesion.botActivo = false;
                console.log(`🔴 Bot apagado para ${chatID}`);
            } else if (txt === '!bot on') {
                sesion.botActivo = true;
                console.log(`🟢 Bot reactivado para ${chatID}`);
            } else if (body !== sesion.lastBotResponse) {
                if (sesion.botActivo) {
                    sesion.botActivo = false;
                    console.log(`🔴 Auto-pausa: Humano intervino en ${chatID}`);
                }
            }
            return;
        }

        if (!sesion.botActivo) return;

        console.log(`\n${'='.repeat(60)}`);
        console.log(`📩 Mensaje de ${chatID}: ${esAudio ? '[AUDIO]' : esImagen ? '[IMAGEN]' : body}`);
        console.log(`${'='.repeat(60)}`);

        // --- BIENVENIDA ---
        if (esNuevo && !message.fromMe) {
            const bienvenida = `¡Hola! 👋 Soy el asistente de *Agua Marina*.
📦 Puedo ayudarte a armar tu pedido de productos de limpieza.
💰 Decime qué necesitás y te paso precios al instante.
🎙️ Podés mandarme un audio o una foto.
🕐 Entregas: Lunes a Sábados de 8 a 13hs.

¿En qué te puedo ayudar?`;
            sesion.lastBotResponse = bienvenida;
            guardarSesiones();
            await client.sendMessage(chatID, bienvenida);
            console.log(`🌟 Bienvenida enviada a ${chatID}`);
            return;
        }

        // ============================================================
        // 🧠 ENJAMBRE — FASE 1: PERCEPCIÓN (Oídos + Ojos)
        // ============================================================
        let textoParaIA = body;

        // 🎙️ AGENTE OÍDOS (Transcripción de audio)
        if (esAudio) {
            try {
                const media = await message.downloadMedia();
                if (media && media.data) {
                    textoParaIA = await agenteOidos(media.data, media.mimetype, GEMINI_KEY);
                    await client.sendMessage(chatID, `🎙️ _Entendido:_ "${textoParaIA}"\n\n_Procesando..._`);
                } else {
                    await client.sendMessage(chatID, "No pude descargar el audio. ¿Podrías escribirme el pedido? 🙏");
                    return;
                }
            } catch (err) {
                console.error("Error en Agente Oídos:", err.message);
                await client.sendMessage(chatID, "No pude procesar el audio. ¿Podrías escribirme el pedido? 🙏");
                return;
            }
        }

        // 👁️ AGENTE OJOS (Análisis de imágenes)
        if (esImagen) {
            try {
                const media = await message.downloadMedia();
                if (media && media.data) {
                    const descripcion = await agenteOjos(media.data, media.mimetype, GEMINI_KEY);
                    // Combinar la descripción visual con cualquier texto que haya mandado
                    textoParaIA = body
                        ? `${body} [El cliente también envió una imagen. Descripción: ${descripcion}]`
                        : `[El cliente envió una imagen. Descripción: ${descripcion}]`;
                    await client.sendMessage(chatID, `👁️ _Vi tu imagen:_ "${descripcion}"\n\n_Buscando en el catálogo..._`);
                } else {
                    await client.sendMessage(chatID, "No pude ver la imagen. ¿Podrías describirme qué necesitás? 🙏");
                    return;
                }
            } catch (err) {
                console.error("Error en Agente Ojos:", err.message);
                await client.sendMessage(chatID, "No pude analizar la imagen. ¿Podrías describirme qué necesitás? 🙏");
                return;
            }
        }

        // 🛡️ SANITIZAR INPUT
        textoParaIA = sanitizeInput(textoParaIA);
        if (!textoParaIA) return;

        // ============================================================
        // 🧠 ENJAMBRE — FASE 2: CLASIFICACIÓN (Recepcionista)
        // ============================================================
        const intencion = await agenteRecepcionista(textoParaIA, OPENROUTER_KEY, GEMINI_KEY);
        console.log(`🚪 Intención clasificada: ${intencion}`);

        // Manejar intenciones que NO requieren al Vendedor
        if (intencion === 'SPAM') {
            console.log(`🗑️ Mensaje spam ignorado de ${chatID}`);
            return;
        }

        if (intencion === 'HUMANO') {
            sesion.botActivo = false;
            guardarSesiones();
            await client.sendMessage(chatID, "Entendido, te comunico con una persona del equipo de Agua Marina. En breve te van a responder. 🙏");
            console.log(`🔴 Transferencia a humano solicitada por ${chatID}`);
            return;
        }

        if (intencion === 'SALUDO') {
            sesion.historial.push({ role: "user", content: textoParaIA });
            const saludo = "¡Hola! 👋 ¿En qué te puedo ayudar hoy? Podés pedirme productos, mandarme un audio o una foto.";
            sesion.historial.push({ role: "assistant", content: saludo });
            sesion.lastBotResponse = saludo;
            guardarSesiones();
            await client.sendMessage(chatID, saludo);
            return;
        }

        // --- COMANDO REPETIR ---
        const bodyLower = textoParaIA.trim().toLowerCase();
        if (bodyLower === 'repetir' || bodyLower === 'mismo pedido' || bodyLower === 'lo de siempre' || bodyLower === 'lo mismo') {
            try {
                let ultimoPedido = null;

                if (supabase.isConfigured()) {
                    ultimoPedido = await supabase.obtenerUltimoPedido(chatID);
                }

                if (!ultimoPedido) {
                    const pedidosFile = path.join(__dirname, 'pedidos.json');
                    if (fs.existsSync(pedidosFile)) {
                        const pedidos = JSON.parse(fs.readFileSync(pedidosFile, 'utf8'));
                        ultimoPedido = [...pedidos].reverse().find(p =>
                            p.cliente_id === chatID || p.cliente_id?.includes(chatID.replace('@c.us', ''))
                        );
                    }
                }

                if (ultimoPedido) {
                    sesion.historial.push({
                        role: "user",
                        content: `Quiero repetir mi último pedido. Los productos eran: ${JSON.stringify(ultimoPedido.productos)}. Total anterior: $${ultimoPedido.total}. Confirmámelo por favor.`
                    });
                } else {
                    await client.sendMessage(chatID, 'No encontré pedidos anteriores tuyos. ¿Qué te gustaría pedir?');
                    guardarSesiones();
                    return;
                }
            } catch(e) {
                console.error('Error buscando pedido anterior:', e);
            }
        } else {
            sesion.historial.push({ role: "user", content: textoParaIA });
        }

        // ============================================================
        // 🧠 ENJAMBRE — FASE 3: VENTA (Vendedor Estrella)
        // ============================================================
        try {
            // OBTENER CATÁLOGO CON CACHÉ
            if (Date.now() - lastFetchTime > CACHE_TTL || !cacheCatalogoReducido) {
                try {
                    console.log("📦 Descargando catálogo desde GitHub...");
                    const res = await axios.get(CATALOGO_URL);
                    const catalogoActual = res.data;
                    const lineasCatalogo = catalogoActual.map(p =>
                        `Cod:${p.codigo || '-'} | ${p.nombre} | ${p.presentacion || '-'} | May:$${p.precio_mayorista} | Min:$${p.precio_minorista} | Stock:${p.sin_stock ? 'NO' : 'SI'}`
                    );
                    cacheCatalogoReducido = lineasCatalogo.join('\n');
                    lastFetchTime = Date.now();
                } catch(e) {
                    console.error("Error obteniendo catálogo.");
                }
            }

            // Armar el prompt del sistema para el Vendedor
            const systemPrompt = `${promptBase}

[IMPORTANTE - INFO DEL CLIENTE ACTUAL]
El ID (número de teléfono) de este cliente es: "${chatID.replace('@c.us', '')}".
DEBES usar este número exacto en todos los campos "cliente_id" de los JSON. ¡NO uses el número del ejemplo!

CATÁLOGO ACTUALIZADO EN VIVO:
${cacheCatalogoReducido}

CARRITO ACTUAL:
${JSON.stringify(sesion.carrito)}`;

            // 💼 LLAMAR AL VENDEDOR ESTRELLA
            const aiResponse = await agenteVendedor(sesion.historial, systemPrompt, OPENROUTER_KEY, GEMINI_KEY);

            // ============================================================
            // 📦 PROCESAMIENTO DE RESPUESTA
            // ============================================================
            let mensajeFinal = aiResponse;

            console.log(`\n📝 Respuesta del Vendedor (${chatID}): ${aiResponse.substring(0, 300)}...`);

            // Extraer y guardar JSONs ocultos
            const extractAndSave = (tagOpen, tagClose, filename, supabaseFunc) => {
                const regex = new RegExp(`\\[${tagOpen}\\]([\\s\\S]*?)\\[\\/${tagClose}\\]`, 'gi');
                let matches = [...mensajeFinal.matchAll(regex)];
                matches.forEach(async matchData => {
                    if (matchData && matchData[1]) {
                        try {
                            const dataObj = JSON.parse(matchData[1].trim());
                            mensajeFinal = mensajeFinal.replace(matchData[0], '').trim();

                            // Guardar en Supabase + JSON local (doble respaldo)
                            if (supabase.isConfigured() && supabaseFunc) {
                                await supabaseFunc(dataObj);
                            }
                            guardarEnJSON(filename, dataObj);
                            console.log(`✅ Guardado ${tagOpen} en ${filename}`);
                        } catch(e) {
                            console.error(`Error parseando ${tagOpen}:`, e);
                        }
                    }
                });
            };

            extractAndSave('PEDIDO_DATA', 'PEDIDO_DATA', 'pedidos.json', supabase.guardarPedido);
            extractAndSave('RATING_DATA', 'RATING_DATA', 'ratings.json', supabase.guardarRating);
            extractAndSave('CLIENTE_CALIDAD_DATA', 'CLIENTE_CALIDAD_DATA', 'clientes_calidad.json', supabase.guardarClienteCalidad);

            // ============================================================
            // 📄🖼️ GENERACIÓN DUAL DE REMITOS (PDF + Imagen)
            // ============================================================
            let remitoMatches = [...mensajeFinal.matchAll(/\[REMITO_JSON\]([\s\S]*?)\[\/REMITO_JSON\]/gi)];

            if (remitoMatches.length === 0) {
                let altMatch = mensajeFinal.match(/```(?:json)?\s*(\{[\s\S]*?"productos"[\s\S]*?\})\s*```/i);
                if (altMatch) remitoMatches = [altMatch];
            }
            if (remitoMatches.length === 0) {
                let altMatch = mensajeFinal.match(/(?:json|JSON)?\s*(\{[\s\S]*?"productos"[\s\S]*?"total"[\s\S]*?\})\s*$/i);
                if (altMatch) remitoMatches = [altMatch];
            }

            console.log(`📊 Remitos encontrados: ${remitoMatches.length}`);

            if (remitoMatches.length > 0) {
                // Limpiar etiquetas del mensaje visible
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
                    sesion.historial.push({ role: "assistant", content: "[Remito generado]" });
                }

                // Generar y enviar cada remito
                for (const match of remitoMatches) {
                    if (match && match[1]) {
                        try {
                            const remitoData = JSON.parse(match[1].trim());

                            // 🛡️ VALIDACIÓN DE SEGURIDAD
                            const validation = validateRemito(remitoData, cacheCatalogoReducido);
                            if (!validation.valid) {
                                console.error(`⚠️ [SEGURIDAD] Remito inválido:`, validation.errors);
                                await client.sendMessage(chatID, `⚠️ Hubo un error con el cálculo. Dejame revisar...`);
                                continue;
                            }

                            console.log(`📄 Generando remito dual para ${remitoData.nombre}...`);

                            // 🖼️ PRIMERO: Enviar Vista Rápida (Imagen/Ticket)
                            try {
                                const imgPath = await generarRemitoImagen(remitoData, GEMINI_KEY);
                                const imgMedia = MessageMedia.fromFilePath(imgPath);
                                await client.sendMessage(chatID, imgMedia, { caption: '🖼️ Vista rápida del remito' });
                                try { fs.unlinkSync(imgPath); } catch(e) {}
                                console.log(`🖼️ Vista rápida enviada`);
                            } catch(imgErr) {
                                console.error("Error generando vista rápida:", imgErr.message);
                            }

                            // 📄 DESPUÉS: Enviar PDF Formal
                            try {
                                const pdfPath = await generarRemitoPDF(remitoData);
                                const pdfMedia = MessageMedia.fromFilePath(pdfPath);
                                await client.sendMessage(chatID, pdfMedia, { caption: '📄 Remito oficial (PDF)' });
                                try { fs.unlinkSync(pdfPath); } catch(e) {}
                                console.log(`📄 PDF formal enviado`);
                            } catch(pdfErr) {
                                console.error("Error generando PDF:", pdfErr.message);
                            }

                            console.log(`✅ Remito dual completado para ${remitoData.nombre}`);

                        } catch(e) {
                            console.error("Error procesando remito:", e);
                            await client.sendMessage(chatID, `⚠️ Tu pedido está confirmado pero hubo un error generando el remito. Error: ${e.message}`);
                        }
                    }
                }

                // Limpiar carrito y activar Rating Bypass
                sesion.carrito = [];
                sesion.esperandoCalificacion = true;
                guardarSesiones();
                console.log(`🧹 Carrito limpiado. Modo espera de calificación activado.`);

            } else {
                // Sin remito: respuesta normal
                mensajeFinal = mensajeFinal.trim();
                if (mensajeFinal === "") {
                    mensajeFinal = "¡Listo! ¿Te puedo ayudar con algo más?";
                }

                sesion.historial.push({ role: "assistant", content: mensajeFinal });
                if (sesion.historial.length > 40) {
                    sesion.historial = sesion.historial.slice(-40);
                }

                sesion.lastBotResponse = mensajeFinal;
                await client.sendMessage(chatID, mensajeFinal);
                guardarSesiones();
                console.log(`🤖 Respondido a ${chatID}`);
            }

        } catch (aiError) {
            console.error("Error en Enjambre IA:", aiError.message);
            let debugInfo = aiError.message;
            if (aiError.response && aiError.response.data) {
                debugInfo = JSON.stringify(aiError.response.data, null, 2);
            }
            if (debugInfo.length > 800) debugInfo = debugInfo.substring(0, 800) + "...";

            try {
                await client.sendMessage(chatID, `Disculpa, estoy teniendo problemas técnicos. ¿Podrías intentar de nuevo? 🙏\n\n*DEBUG:*\n\`\`\`\n${debugInfo}\n\`\`\``);
            } catch (sendErr) {
                console.error("Error enviando fallback:", sendErr);
            }
        }

    } catch (globalError) {
        // 🛡️ CATCH GLOBAL — El bot NUNCA se cuelga
        console.error("💀 ERROR GLOBAL:", globalError);
        try {
            const chatID = message.fromMe ? message.to : message.from;
            if (chatID) {
                await client.sendMessage(chatID, "Disculpa, tuve un error inesperado. ¿Podrías repetir tu mensaje? 🙏");
            }
        } catch(e) {
            console.error("Error en catch global:", e);
        }
    }
});

// --- FIX CHROME LOCK ---
const authDir = path.join(__dirname, '.wwebjs_auth');
if (fs.existsSync(authDir)) {
    const lockFiles = [
        path.join(authDir, 'session', 'SingletonLock'),
        path.join(authDir, 'session', 'SingletonCookie'),
        path.join(authDir, 'session', 'Default', 'SingletonLock'),
        path.join(authDir, 'session', 'Default', 'SingletonCookie')
    ];
    lockFiles.forEach(file => {
        try { if (fs.existsSync(file)) fs.unlinkSync(file); console.log('🧹 Lock eliminado:', file); } catch(e) {}
    });
}

client.initialize();

// ============================================================
// 🌐 EXPRESS API PARA DASHBOARD
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

// Rutas con fallback: Supabase primero, JSON local después
app.get('/api/pedidos', async (req, res) => {
    if (supabase.isConfigured()) {
        const data = await supabase.obtenerPedidos();
        if (data.length > 0) return res.json(data);
    }
    res.json(getJsonFile('pedidos.json'));
});

app.get('/api/ratings', async (req, res) => {
    if (supabase.isConfigured()) {
        const data = await supabase.obtenerRatings();
        if (data.length > 0) return res.json(data);
    }
    res.json(getJsonFile('ratings.json'));
});

app.get('/api/clientes_calidad', (req, res) => res.json(getJsonFile('clientes_calidad.json')));

app.get('/api/status', (req, res) => {
    const uptimeMs = Date.now() - BOT_START_TIME;
    const memUsage = process.memoryUsage();
    res.json({
        status: 'online',
        version: BOT_VERSION,
        uptime_minutes: Math.floor(uptimeMs / 60000),
        ram_mb: (memUsage.rss / 1024 / 1024).toFixed(1),
        sesiones_activas: Object.keys(sesiones).length,
        swarm_agents: ['oidos', 'ojos', 'recepcionista', 'vendedor'],
        database: supabase.isConfigured() ? 'supabase' : 'json_local',
        security: ['rate_limiter', 'sanitizer', 'remito_validator']
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 API Dashboard en puerto ${PORT}`);
    console.log(`🌊 ¡AGUA MARINA ENTERPRISE SWARM v3.0 — COMPLETAMENTE OPERATIVO!`);
});
