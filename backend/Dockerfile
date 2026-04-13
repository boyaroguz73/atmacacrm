FROM node:20-alpine AS builder

WORKDIR /app

# Prisma postinstall (npm install) şemayı ister; ayrıca Alpine'da openssl önerilir
RUN apk add --no-cache openssl libc6-compat

COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm install

COPY . .
RUN npm run build

FROM node:20-alpine

RUN apk add --no-cache openssl libc6-compat ttf-dejavu

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./

# DejaVu fontlarını PDFKit için erişilebilir konuma kopyala
RUN mkdir -p /app/fonts && \
    cp /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf /app/fonts/ 2>/dev/null || \
    cp /usr/share/fonts/dejavu/DejaVuSans.ttf /app/fonts/ 2>/dev/null || \
    find /usr/share/fonts -name "DejaVuSans.ttf" -exec cp {} /app/fonts/ \; 2>/dev/null || true

EXPOSE 4000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
