/**
 * Swarm Router — Orquestador del Enjambre de IAs
 * Coordina los 4 cerebros: Oídos, Ojos, Recepcionista y Vendedor.
 * 
 * Flujo: Mensaje → Oídos/Ojos (si aplica) → Recepcionista → Vendedor (si compra)
 */

const axios = require('axios');

// ============================================================
// AGENTE 1: OÍDOS (Transcriptor de Audio)
// IA: Gemini 2.5 Flash (Gratis)
// ============================================================
async function agenteOidos(audioBase64, mimetype, geminiApiKey) {
    console.log('🎙️ [SWARM] Agente OÍDOS activado...');
    
    const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
        {
            contents: [{
                role: "user",
                parts: [
                    {
                        inlineData: {
                            mimeType: mimetype || 'audio/ogg',
                            data: audioBase64
                        }
                    },
                    {
                        text: "Transcribí este audio de voz de un cliente de una distribuidora de productos de limpieza en Argentina. Devolvé SOLAMENTE el texto transcripto, sin comentarios ni explicaciones. Si no se entiende algo, poné [inaudible]."
                    }
                ]
            }]
        },
        { headers: { "Content-Type": "application/json" }, timeout: 30000 }
    );

    const transcripcion = response.data.candidates[0].content.parts[0].text;
    console.log(`🎙️ [SWARM] Oídos transcribió: "${transcripcion}"`);
    return transcripcion;
}

// ============================================================
// AGENTE 2: OJOS (Analizador de Imágenes)
// IA: Gemini 2.5 Flash Vision (Gratis)
// ============================================================
async function agenteOjos(imageBase64, mimetype, geminiApiKey) {
    console.log('👁️ [SWARM] Agente OJOS activado...');

    const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
        {
            contents: [{
                role: "user",
                parts: [
                    {
                        inlineData: {
                            mimeType: mimetype || 'image/jpeg',
                            data: imageBase64
                        }
                    },
                    {
                        text: "Analizá esta imagen enviada por un cliente de una distribuidora de productos de limpieza. Describí brevemente qué ves: si es un producto (marca, tipo, tamaño), una mancha o superficie sucia, o un screenshot de un pedido anterior. Sé conciso en 1-2 oraciones."
                    }
                ]
            }]
        },
        { headers: { "Content-Type": "application/json" }, timeout: 30000 }
    );

    const descripcion = response.data.candidates[0].content.parts[0].text;
    console.log(`👁️ [SWARM] Ojos describe: "${descripcion}"`);
    return descripcion;
}

// ============================================================
// AGENTE 3: RECEPCIONISTA (Clasificador / Gatekeeper)
// IA: Llama 3 8B (OpenRouter, ultra barato) 
// Fallback: Gemini Flash si no hay OpenRouter
// ============================================================
async function agenteRecepcionista(texto, openrouterApiKey, geminiApiKey) {
    console.log('🚪 [SWARM] Agente RECEPCIONISTA activado...');

    const prompt = `Eres un clasificador de intenciones para un bot de ventas de productos de limpieza.
Leé el siguiente mensaje de un cliente y respondé SOLAMENTE con UNA de estas etiquetas:

- COMPRA (quiere comprar, pedir productos, agregar al carrito, repetir pedido)
- CONSULTA (pregunta horarios, ubicación, precios sin intención clara de compra, información general)
- SALUDO (solo dice hola, buen día, o similar)
- QUEJA (está enojado, tiene un reclamo, algo salió mal)
- HUMANO (pide hablar con una persona real, un humano, el dueño, el encargado)
- SPAM (mensaje sin sentido, insultos, memes, basura)

Mensaje del cliente: "${texto}"

Respondé SOLO la etiqueta, nada más.`;

    let clasificacion = 'COMPRA'; // Default seguro

    try {
        if (openrouterApiKey) {
            // Usar Llama 3 (ultra barato)
            const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
                model: "meta-llama/llama-3-8b-instruct",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.1,
                max_tokens: 10
            }, {
                headers: {
                    "Authorization": `Bearer ${openrouterApiKey}`,
                    "Content-Type": "application/json"
                },
                timeout: 10000
            });
            clasificacion = response.data.choices[0].message.content.trim().toUpperCase();
        } else if (geminiApiKey) {
            // Fallback a Gemini Flash
            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
                {
                    contents: [{ role: "user", parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.1, maxOutputTokens: 10 }
                },
                { headers: { "Content-Type": "application/json" }, timeout: 10000 }
            );
            clasificacion = response.data.candidates[0].content.parts[0].text.trim().toUpperCase();
        }
    } catch (err) {
        console.error('🚪 [SWARM] Error en Recepcionista, asumiendo COMPRA:', err.message);
    }

    // Limpiar la respuesta por si la IA devolvió algo extra
    const etiquetasValidas = ['COMPRA', 'CONSULTA', 'SALUDO', 'QUEJA', 'HUMANO', 'SPAM'];
    const etiquetaLimpia = etiquetasValidas.find(e => clasificacion.includes(e)) || 'COMPRA';

    console.log(`🚪 [SWARM] Recepcionista clasifica: ${etiquetaLimpia}`);
    return etiquetaLimpia;
}

// ============================================================
// AGENTE 4: VENDEDOR ESTRELLA (Closer de Ventas)
// IA: Claude 3.5 Sonnet (OpenRouter, pago por uso)
// Fallback: Gemini Flash si no hay OpenRouter
// ============================================================
async function agenteVendedor(historial, systemPrompt, openrouterApiKey, geminiApiKey) {
    console.log('💼 [SWARM] Agente VENDEDOR ESTRELLA activado...');

    let aiResponse = '';

    try {
        if (openrouterApiKey) {
            // Claude 3.5 Sonnet (El Buque Insignia)
            const messages = [
                { role: "system", content: systemPrompt },
                ...historial
            ];
            const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
                model: "anthropic/claude-3.5-sonnet",
                messages: messages,
                temperature: 0.2
            }, {
                headers: {
                    "Authorization": `Bearer ${openrouterApiKey}`,
                    "Content-Type": "application/json"
                },
                timeout: 60000
            });
            aiResponse = response.data.choices[0].message.content;
            console.log('💼 [SWARM] Vendedor respondió con Claude 3.5 Sonnet');
        } else if (geminiApiKey) {
            // Fallback a Gemini Flash
            const googleContents = historial.map(m => ({
                role: m.role === "assistant" ? "model" : "user",
                parts: [{ text: m.content }]
            }));

            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
                {
                    contents: googleContents,
                    systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
                    generationConfig: { temperature: 0.3 }
                },
                { headers: { "Content-Type": "application/json" }, timeout: 60000 }
            );
            aiResponse = response.data.candidates[0].content.parts[0].text;
            console.log('💼 [SWARM] Vendedor respondió con Gemini Flash (fallback)');
        } else {
            aiResponse = "⚠️ No hay credenciales de IA configuradas.";
        }
    } catch (err) {
        console.error('💼 [SWARM] Error en Vendedor:', err.message);
        throw err;
    }

    return aiResponse;
}

module.exports = {
    agenteOidos,
    agenteOjos,
    agenteRecepcionista,
    agenteVendedor
};
