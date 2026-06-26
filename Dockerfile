FROM node:18-slim

# Solo necesitamos las fuentes para PDFKit (no necesitamos Chrome/Puppeteer para PDFs)
# Chrome sigue siendo necesario SOLO para whatsapp-web.js (conexión a WhatsApp)
RUN apt-get update \
    && apt-get install -y wget gnupg \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
      --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar package.json
COPY package*.json ./
RUN npm install

# Copiar el código fuente
COPY . .

# Exponer el puerto para la API del Dashboard
EXPOSE 3000

# Comando de inicio
CMD ["node", "server.js"]
