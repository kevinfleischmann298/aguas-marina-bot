/**
 * Módulo de Rate Limiting — Ciberseguridad Agua Marina
 * Protege contra spam, DDoS y abuso de tokens de IA.
 * 
 * Regla: Máximo 15 mensajes por minuto por número de teléfono.
 * Si se excede, el número queda bloqueado 30 minutos.
 */

const rateLimitMap = new Map(); // chatID -> { count, firstMessageTime, blocked, blockedUntil }

const RATE_LIMIT_WINDOW = 60 * 1000;     // 1 minuto
const RATE_LIMIT_MAX = 15;                // Máximo 15 mensajes por ventana
const RATE_LIMIT_BLOCK_TIME = 30 * 60 * 1000; // Bloqueo de 30 minutos

/**
 * Verifica si un chatID puede enviar un mensaje.
 * @param {string} chatID - ID del chat de WhatsApp
 * @returns {{ allowed: boolean, reason?: string, remaining?: number }}
 */
function checkRateLimit(chatID) {
    const now = Date.now();
    
    if (!rateLimitMap.has(chatID)) {
        rateLimitMap.set(chatID, { count: 1, firstMessageTime: now, blocked: false, blockedUntil: 0 });
        return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
    }

    const entry = rateLimitMap.get(chatID);

    // Si está bloqueado, verificar si ya pasó el tiempo
    if (entry.blocked) {
        if (now < entry.blockedUntil) {
            const minutesLeft = Math.ceil((entry.blockedUntil - now) / 60000);
            return { allowed: false, reason: `bloqueado por spam (${minutesLeft} min restantes)` };
        }
        // Se acabó el bloqueo, resetear
        entry.blocked = false;
        entry.count = 1;
        entry.firstMessageTime = now;
        return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
    }

    // Si la ventana de tiempo expiró, resetear contador
    if (now - entry.firstMessageTime > RATE_LIMIT_WINDOW) {
        entry.count = 1;
        entry.firstMessageTime = now;
        return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
    }

    // Incrementar contador
    entry.count++;

    // Si excedió el límite, bloquear
    if (entry.count > RATE_LIMIT_MAX) {
        entry.blocked = true;
        entry.blockedUntil = now + RATE_LIMIT_BLOCK_TIME;
        console.log(`🚫 [RATE LIMIT] ${chatID} bloqueado por 30 minutos (${entry.count} msgs en 1 min)`);
        return { allowed: false, reason: 'demasiados mensajes, bloqueado 30 minutos' };
    }

    return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count };
}

/**
 * Limpia entradas viejas del mapa para liberar memoria (llamar cada hora).
 */
function cleanupRateLimits() {
    const now = Date.now();
    for (const [chatID, entry] of rateLimitMap) {
        if (!entry.blocked && (now - entry.firstMessageTime > RATE_LIMIT_WINDOW * 5)) {
            rateLimitMap.delete(chatID);
        }
    }
}

// Auto-limpieza cada hora
setInterval(cleanupRateLimits, 60 * 60 * 1000);

module.exports = { checkRateLimit };
