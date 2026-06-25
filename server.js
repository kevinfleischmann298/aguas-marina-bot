require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const PDFDocument = require('pdfkit');
const path = require('path');
const express = require('express');

console.log("Iniciando Bot de Aguas Marina para Easypanel...");

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

const puppeteerOptions = {
    // Configuraciones CLAVES para correr dentro de Easypanel/Docker (Linux) sin entorno gráfico
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
    console.log('\n\n======================================================');
    console.log('📱 ESCANEA ESTE CÓDIGO QR EN LA APP DE WHATSAPP:');
    console.log('======================================================\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('\n✅ ¡WHATSAPP VINCULADO CON ÉXITO EN EASYPANEL!');
    console.log('🤖 El agente está leyendo el catálogo desde GitHub Pages y esperando mensajes...');
});

// Caché global del catálogo
let cacheCatalogoReducido = '';
let lastFetchTime = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutos

client.on('message_create', async (message) => {
    // Evitar estados y grupos
    if (message.from === 'status@broadcast' || message.from.includes('@g.us') || message.to.includes('@g.us')) return;

    // Identificar el chat real (si es nuestro, usamos 'to', si es del cliente, usamos 'from')
    const chatID = message.fromMe ? message.to : message.from;
    const body = message.body;
    if (!body) return;
    // Permitir audios más adelante, por ahora solo texto
    if (message.hasMedia && message.type !== 'chat') return;

    // Inicializar memoria del chat si no existe
    const esNuevo = !sesiones[chatID];
    if (esNuevo) sesiones[chatID] = { carrito: [], historial: [], botActivo: true, lastBotResponse: '' };
    const sesion = sesiones[chatID];

    // Limitar historial a los últimos 20 mensajes para ahorrar tokens y evitar confusiones
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
            // Si mandamos un mensaje nosotros (el humano) y no es el que acaba de mandar el bot...
            if (sesion.botActivo) {
                sesion.botActivo = false;
                console.log(`🔴 Auto-pausa activada: El humano intervino en la conversación con ${chatID}`);
            }
        }
        return; // Salir de la función (no procesar mensajes que enviamos nosotros)
    }

    // Si el bot está apagado para este cliente, ignorar todo
    if (!sesion.botActivo) return;

    console.log(`\nMensaje recibido de ${chatID}: ${body}`);

    // --- MENSAJE DE BIENVENIDA PARA CLIENTES NUEVOS ---
    if (esNuevo && !message.fromMe) {
        const bienvenida = `¡Hola! 👋 Soy el asistente de *Agua Marina*.
📦 Puedo ayudarte a armar tu pedido de productos de limpieza.
💰 Decime qué necesitás y te paso precios al instante.
🕐 Entregas: Lunes a Sábados de 8 a 13hs.

¿En qué te puedo ayudar?`;
        sesion.lastBotResponse = bienvenida;
        guardarSesiones();
        await client.sendMessage(chatID, bienvenida);
        console.log(`🌟 Bienvenida enviada a nuevo cliente ${chatID}`);
        return; // No procesar más, esperar su próximo mensaje
    }

    // --- COMANDO REPETIR ---
    const bodyLower = body.trim().toLowerCase();
    if (bodyLower === 'repetir' || bodyLower === 'mismo pedido' || bodyLower === 'lo de siempre' || bodyLower === 'lo mismo') {
        try {
            const pedidosFile = path.join(__dirname, 'pedidos.json');
            if (fs.existsSync(pedidosFile)) {
                const pedidos = JSON.parse(fs.readFileSync(pedidosFile, 'utf8'));
                // Buscar el último pedido de este cliente
                const ultimoPedido = [...pedidos].reverse().find(p => p.cliente_id === chatID || p.cliente_id?.includes(chatID.replace('@c.us', '')));
                if (ultimoPedido) {
                    const listaProductos = ultimoPedido.productos.map(p => `- ${p.cantidad}x ${p.nombre}: $${p.precio?.toLocaleString('es-AR')}`).join('\n');
                    sesion.historial.push({ role: "user", content: `Quiero repetir mi último pedido. Los productos eran: ${JSON.stringify(ultimoPedido.productos)}. Total anterior: $${ultimoPedido.total}. Confirmámelo por favor.` });
                    // Continuar con el flujo normal para que la IA confirme
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
        sesion.historial.push({ role: "user", content: body });
    }

    try {
        // OBTENER CATÁLOGO CON CACHÉ
        if (Date.now() - lastFetchTime > CACHE_TTL || !cacheCatalogoReducido) {
            try {
                console.log("Descargando catálogo fresco desde GitHub...");
                const res = await axios.get(CATALOGO_URL);
                const catalogoActual = res.data;
                
                // Compresión a texto plano denso para ahorrar tokens y acelerar la IA
                const lineasCatalogo = catalogoActual.map(p => {
                    return `Cod:${p.codigo || '-'} | ${p.nombre} | ${p.presentacion || '-'} | May:$${p.precio_mayorista} | Min:$${p.precio_minorista} | Stock:${p.sin_stock ? 'NO' : 'SI'}`;
                });
                cacheCatalogoReducido = lineasCatalogo.join('\n');
                lastFetchTime = Date.now();
            } catch(e) {
                console.error("Error obteniendo catálogo. Usando caché anterior si existe.");
            }
        }
        
        const openaiMessages = [
            {
                role: "system",
                content: `${promptBase}\n\nCATÁLOGO ACTUALIZADO EN VIVO:\n${cacheCatalogoReducido}\n\nCARRITO ACTUAL:\n${JSON.stringify(sesion.carrito)}`
            },
            ...sesion.historial
        ];

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
                headers: { "Content-Type": "application/json" }
            });
            aiResponse = response.data.candidates[0].content.parts[0].text;
        } else if (process.env.OPENROUTER_API_KEY) {
            const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
                model: "google/gemini-2.5-flash",
                messages: openaiMessages,
                temperature: 0.3
            }, {
                headers: {
                    "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json"
                }
            });
            aiResponse = response.data.choices[0].message.content;
        } else {
            aiResponse = "⚠️ Faltan las credenciales de Gemini (Variable de entorno GEMINI_API_KEY en Easypanel).";
        }

        // INTERCEPTAR EL REMITO SI EXISTE
        let mensajeFinal = aiResponse;

        // DEBUG: Ver qué devolvió la IA
        console.log(`\n📝 RESPUESTA CRUDA DE LA IA (${chatID}):`);
        console.log(aiResponse);
        console.log(`\n🔍 ¿Contiene [REMITO_JSON]? ${aiResponse.includes('[REMITO_JSON]')}`);
        console.log(`🔍 ¿Contiene [PEDIDO_DATA]? ${aiResponse.includes('[PEDIDO_DATA]')}`);
        console.log(`🔍 ¿Contiene [RATING_DATA]? ${aiResponse.includes('[RATING_DATA]')}`);

        // Función para extraer, guardar y limpiar otros JSONs
        const extractAndSave = (tagOpen, tagClose, filename) => {
            const regex = new RegExp(`\\[${tagOpen}\\]([\\s\\S]*?)\\[\\/${tagClose}\\]`, 'gi');
            let matches = [...mensajeFinal.matchAll(regex)];
            matches.forEach(matchData => {
                if (matchData && matchData[1]) {
                    try {
                        const dataObj = JSON.parse(matchData[1].trim());
                        mensajeFinal = mensajeFinal.replace(matchData[0], '').trim();
                        // Guardar en archivo
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

        let remitoMatches = [...mensajeFinal.matchAll(/\[REMITO_JSON\]([\s\S]*?)\[\/REMITO_JSON\]/gi)];
        
        // Respaldo por si la IA usa bloques de código markdown
        if (remitoMatches.length === 0) {
            let altMatch = mensajeFinal.match(/```(?:json)?\s*(\{[\s\S]*?"productos"[\s\S]*?\})\s*```/i);
            if (altMatch) remitoMatches = [altMatch];
        }
        // Respaldo por si la IA solo escupe JSON crudo al final
        if (remitoMatches.length === 0) {
            let altMatch = mensajeFinal.match(/(?:json|JSON)?\s*(\{[\s\S]*?"productos"[\s\S]*?"total"[\s\S]*?\})\s*$/i);
            if (altMatch) remitoMatches = [altMatch];
        }
        
        console.log(`📊 Remitos encontrados: ${remitoMatches.length}`);

        if (remitoMatches.length > 0) {
            // Eliminar todas las etiquetas JSON del mensaje final antes de enviar
            for (const match of remitoMatches) {
                if (match && match[0]) {
                    mensajeFinal = mensajeFinal.replace(match[0], '').trim();
                }
            }
            
            if (mensajeFinal) {
                sesion.historial.push({ role: "assistant", content: mensajeFinal });
                sesion.lastBotResponse = mensajeFinal;
                await client.sendMessage(chatID, mensajeFinal);
            }
            
            await client.sendMessage(chatID, `*[DEBUG] Interceptados ${remitoMatches.length} remitos para generar PDF...*`);

            for (const match of remitoMatches) {
                if (match && match[1]) {
                    try {
                        const remitoData = JSON.parse(match[1].trim());
                        await client.sendMessage(chatID, `*[DEBUG] JSON parseado con éxito para ${remitoData.nombre}. Generando PDF...*`);
                        
                        try {
                            const htmlTemplate = fs.readFileSync(path.join(__dirname, 'plantilla.html'), 'utf8');
                            const browser = client.pupBrowser;
                            if (!browser) throw new Error("Puppeteer browser no está disponible en whatsapp-web.js.");
                            
                            const page = await browser.newPage();
                            await page.setContent(htmlTemplate, { waitUntil: 'networkidle0' });
                            
                            await page.evaluate((data) => {
                                if (document.getElementById('cliente')) document.getElementById('cliente').value = data.nombre || '';
                                if (document.getElementById('cuit')) document.getElementById('cuit').value = data.cuit || '';
                                if (document.getElementById('domicilio')) document.getElementById('domicilio').value = data.direccion || '';
                                if (document.getElementById('localidad')) document.getElementById('localidad').value = data.localidad || 'Paraná';
                                if (document.getElementById('pago')) document.getElementById('pago').value = data.pago || '';
                                if (document.getElementById('fecha')) document.getElementById('fecha').value = new Date().toLocaleDateString('es-AR');
                                
                                const tbody = document.getElementById('productosTable');
                                if (tbody) {
                                    tbody.innerHTML = '';
                                    if (data.productos && data.productos.length > 0) {
                                        data.productos.forEach(p => {
                                            let subStr = String(p.subtotal).replace(/[^0-9,-]+/g, '');
                                            subStr = subStr.replace(',', '.');
                                            let sub = parseFloat(subStr) || 0;
                                            let cant = parseFloat(p.cantidad) || 1;
                                            let unit = sub / cant;
                                            
                                            const tr = document.createElement('tr');
                                            tr.innerHTML = `
                                                <td><input class="prod-input" value="${p.descripcion || p.nombre || ''}"></td>
                                                <td class="num-cell"><input class="prod-input" type="number" value="${cant}"></td>
                                                <td class="num-cell"><input class="prod-input" type="number" value="${unit}"></td>
                                                <td class="num-cell"><span class="subtotal">0,00</span></td>
                                                <td></td>
                                            `;
                                            tbody.appendChild(tr);
                                        });
                                    }
                                }
                                
                                if (typeof window.calcularTotal === 'function') window.calcularTotal();
                            }, remitoData);
                    
                            const pdfBuffer = await page.pdf({ 
                                format: 'A4', 
                                printBackground: true,
                                margin: { top: 0, right: 0, bottom: 0, left: 0 }
                            });
                            
                            await page.close();
                            
                            const docName = remitoData.nombre ? `Remito_${remitoData.nombre.replace(/[^a-z0-9]/gi, '_')}.pdf` : 'Remito_AguaMarina.pdf';
                            const tempFilePath = path.join(__dirname, docName);
                            fs.writeFileSync(tempFilePath, pdfBuffer);
                            
                            const media = MessageMedia.fromFilePath(tempFilePath);
                            
                            await client.sendMessage(chatID, media, { caption: `📄 Remito oficial` });
                            
                            try { fs.unlinkSync(tempFilePath); } catch(e) {}
                        } catch(e) {
                            console.error("Error generando PDF HTML:", e);
                            await client.sendMessage(chatID, `*[DEBUG] Error en Puppeteer PDF:* ${e.message}`);
                        }

                    } catch(e) {
                        console.error("Error parseando el JSON del remito:", e);
                        await client.sendMessage(chatID, `*[DEBUG] Error de formato JSON:* La IA generó un JSON inválido. Error: ${e.message}. Texto: ${match[1]}`);
                    }
                }
            }

            // LIMPIAR CARRITO después de emitir los remitos para que el cliente pueda hacer un pedido nuevo
            sesion.carrito = [];
            
            // Inyectar el aviso de reseteo en el último mensaje del asistente para no romper la alternancia de roles
            const lastMsg = sesion.historial[sesion.historial.length - 1];
            if (lastMsg && lastMsg.role === "assistant") {
                lastMsg.content += "\n\n[SISTEMA INTERNO: El remito del pedido anterior ya fue generado y enviado con éxito. El carrito está vacío. Si el cliente escribe de nuevo, trátalo como una nueva compra desde cero.]";
            }
            
            guardarSesiones();
            console.log(`🧹 Carrito limpiado para ${chatID}. Listo para nuevo pedido.`);
        } else {
            // Si no hay remito, comportamiento normal
            mensajeFinal = mensajeFinal.trim();
            
            // Si la IA solo devolvió un JSON oculto y quedó vacío, ponemos un texto natural para que no se quede mudo
            if (mensajeFinal === "") {
                mensajeFinal = "¡Listo! ¿Te puedo ayudar con algo más?";
            }
            
            sesion.historial.push({ role: "assistant", content: mensajeFinal });
            
            // Limitar historial a los últimos 40 mensajes para no saturar a la IA
            if (sesion.historial.length > 40) {
                sesion.historial = sesion.historial.slice(sesion.historial.length - 40);
            }
            
            sesion.lastBotResponse = mensajeFinal;
            await client.sendMessage(chatID, mensajeFinal);
            
            guardarSesiones();
            console.log(`🤖 Respondido a ${chatID}`);
        }

    } catch (error) {
        console.error("Error AI:", error.message);
        if (error.response && error.response.data) {
            console.error(JSON.stringify(error.response.data, null, 2));
        }
        
        let debugInfo = error.message;
        if (error.response && error.response.data) {
            debugInfo = JSON.stringify(error.response.data, null, 2);
        }

        await client.sendMessage(chatID, `Disculpa, estoy experimentando problemas técnicos temporales.\n\n*DEBUG INFO (Pasale esto a tu programador):*\n\`\`\`json\n${debugInfo}\n\`\`\``);
    }
});

client.initialize();

// --- EXPRESS API PARA DASHBOARD ---
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 API interna escuchando en el puerto ${PORT}`);
});
