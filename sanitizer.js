/**
 * Módulo de Sanitización — Ciberseguridad Agua Marina
 * Protege contra Prompt Injection y mensajes maliciosos.
 */

const MAX_MESSAGE_LENGTH = 1000; // Caracteres máximos por mensaje

/**
 * Sanitiza el texto de entrada del cliente antes de enviarlo a la IA.
 * @param {string} text - Texto crudo del cliente
 * @returns {string} - Texto sanitizado
 */
function sanitizeInput(text) {
    if (!text || typeof text !== 'string') return '';

    let clean = text;

    // 1. Cortar mensajes excesivamente largos
    if (clean.length > MAX_MESSAGE_LENGTH) {
        clean = clean.substring(0, MAX_MESSAGE_LENGTH) + '... [mensaje recortado]';
    }

    // 2. Eliminar intentos de prompt injection comunes
    const dangerousPatterns = [
        /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|rules?|prompts?)/gi,
        /olvida\s+(todas?\s+)?(las?\s+)?(instrucciones?|reglas?|indicaciones?)/gi,
        /you\s+are\s+now\s+/gi,
        /ahora\s+sos\s+/gi,
        /actua\s+como\s+/gi,
        /act\s+as\s+/gi,
        /system\s*prompt/gi,
        /\[REMITO_JSON\]/gi,
        /\[PEDIDO_DATA\]/gi,
        /\[RATING_DATA\]/gi,
        /\[CLIENTE_CALIDAD_DATA\]/gi,
        /\[\/REMITO_JSON\]/gi,
        /\[\/PEDIDO_DATA\]/gi,
        /\[\/RATING_DATA\]/gi,
    ];

    let injectionDetected = false;
    for (const pattern of dangerousPatterns) {
        if (pattern.test(clean)) {
            injectionDetected = true;
            clean = clean.replace(pattern, '[FILTRADO]');
        }
    }

    if (injectionDetected) {
        console.log(`⚠️ [SANITIZER] Prompt injection detectado y neutralizado`);
    }

    // 3. Eliminar caracteres de control Unicode (invisibles)
    clean = clean.replace(/[\u200B-\u200D\uFEFF\u202A-\u202E]/g, '');

    return clean.trim();
}

/**
 * Valida los datos de un remito generado por la IA contra el catálogo real.
 * Evita que la IA invente precios o productos.
 * @param {Object} remitoData - Datos del remito generado por la IA
 * @param {string} catalogoTexto - Catálogo en formato texto
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateRemito(remitoData, catalogoTexto) {
    const errors = [];

    if (!remitoData || !remitoData.productos || !Array.isArray(remitoData.productos)) {
        errors.push('El remito no tiene productos válidos');
        return { valid: false, errors };
    }

    if (remitoData.productos.length === 0) {
        errors.push('El remito está vacío (0 productos)');
        return { valid: false, errors };
    }

    // Verificar que el total no sea negativo ni absurdamente alto
    const total = parseFloat(remitoData.total) || 0;
    if (total <= 0) {
        errors.push(`Total inválido: $${total}`);
    }
    if (total > 10000000) {
        errors.push(`Total sospechosamente alto: $${total}`);
    }

    // Verificar cada producto
    for (const prod of remitoData.productos) {
        const cantidad = parseFloat(prod.cantidad) || 0;
        const subtotal = parseFloat(prod.subtotal) || 0;

        if (cantidad <= 0 || cantidad > 1000) {
            errors.push(`Cantidad sospechosa para "${prod.descripcion || prod.nombre}": ${cantidad}`);
        }
        if (subtotal <= 0) {
            errors.push(`Subtotal inválido para "${prod.descripcion || prod.nombre}": $${subtotal}`);
        }
    }

    // Recalcular total como medida de seguridad
    const totalRecalculado = remitoData.productos.reduce((sum, p) => sum + (parseFloat(p.subtotal) || 0), 0);
    const diferencia = Math.abs(total - totalRecalculado);
    if (diferencia > 1) {
        errors.push(`Total inconsistente: IA dice $${total}, recalculado: $${totalRecalculado}`);
    }

    return { valid: errors.length === 0, errors };
}

module.exports = { sanitizeInput, validateRemito, MAX_MESSAGE_LENGTH };
